#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────
   HERABERG glue server
   - Serves the poster page (index.html, projects.json, ai.json, assets)
   - Reverse-proxies each project to its local port
   - Gates whichever projects are marked  "gated": true  in their
     project.json  behind a single disclaimer + password screen
   - Runtime-agnostic: it does NOT care whether the project behind a
     port is venv, Docker, or anything else. It just proxies a port.

   No npm install needed — pure Node standard library.
   Tested on Node 18+ (use 20+ if you can).
─────────────────────────────────────────────────────────────── */

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── config ──────────────────────────────────────────────────── */
const PUBLIC_DIR = join(__dirname, 'public');           // poster page lives here
const PROJECTS_DIR = join(__dirname, 'projects');       // drop folders here
const AI_PROJECTS_DIR = join(__dirname, 'ai-projects'); // The Lab — AI experiments (ports 9000+)
const LISTEN_PORT = process.env.PORT || 8080;           // cloudflared points here

// the gate password — set in .env / environment. NEVER hardcode in git.
const GATE_PASSWORD = process.env.GATE_PASSWORD || 'change-me';
// secret used to sign the access cookie so it can't be forged
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(16).toString('hex');
const COOKIE_NAME = 'heraberg_access';
const COOKIE_MAX_AGE = 60 * 60 * 12; // 12 hours

/* ── load project routing from each projects/<name>/project.json ─
   Each project.json should contain at least:
     { "id", "subdomain", "port", "gated": true|false }
   build.mjs (separate file) keeps projects.json for the poster page
   in sync; THIS file reads the same folders for routing.
─────────────────────────────────────────────────────────────── */
import { readdirSync } from 'node:fs';

function loadRoutesFrom(dir, routes) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(dir, entry.name, 'project.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta.subdomain && meta.port) {
        routes[meta.subdomain] = {
          port: meta.port,
          gated: !!meta.gated,
          name: meta.name || meta.id || entry.name,
          disclaimer: meta.disclaimer || null,
        };
      }
    } catch (e) {
      console.warn(`[routes] skipping ${entry.name}: ${e.message}`);
    }
  }
}

function loadRoutes() {
  const routes = {};
  loadRoutesFrom(PROJECTS_DIR, routes);      // main projects (ports 8001+)
  loadRoutesFrom(AI_PROJECTS_DIR, routes);   // The Lab AI projects (ports 9000+)
  return routes;
}

let ROUTES = loadRoutes();
// hot-reload routes every 10s so dropping a folder takes effect without restart
setInterval(() => { ROUTES = loadRoutes(); }, 10_000);

/* ── cookie signing ──────────────────────────────────────────── */
function sign(value) {
  const h = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}
function verify(signed) {
  if (!signed || !signed.includes('.')) return false;
  const i = signed.lastIndexOf('.');
  const value = signed.slice(0, i);
  return sign(value) === signed ? value : false;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}
function hasAccess(req) {
  const c = parseCookies(req)[COOKIE_NAME];
  const v = verify(c);
  if (!v) return false;
  const ts = parseInt(v, 10);
  return Number.isFinite(ts) && (Date.now() / 1000 - ts) < COOKIE_MAX_AGE;
}

/* ── which subdomain is this request for? ────────────────────── */
function subdomainOf(host) {
  if (!host) return '';
  const h = host.split(':')[0].toLowerCase();
  const parts = h.split('.');

  // ── local testing: *.localhost ──────────────────────────────
  // bare "localhost" or "127.0.0.1" → poster page
  // "medical.localhost" → subdomain "medical"
  if (h === 'localhost' || h === '127.0.0.1') return '';
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    return parts[0] === 'www' ? '' : parts[0];
  }

  // ── production: *.heraberg.com ──────────────────────────────
  if (parts.length <= 2) return '';            // heraberg.com
  if (parts[0] === 'www') return '';           // www.heraberg.com
  return parts[0];                             // model / medical / harness
}

/* ── static file serving for the poster page ─────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA-ish fallback to index.html
    const fallback = join(PUBLIC_DIR, 'index.html');
    if (existsSync(fallback)) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); createReadStream(fallback).pipe(res); return; }
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

/* ── the gate screen (disclaimer + password on ONE screen) ───── */
function gatePage(route, opts = {}) {
  const wrong = opts.wrong ? `<p class="err">Wrong password — check the access code on the CV.</p>` : '';
  const disclaimer = route.disclaimer || DEFAULT_DISCLAIMER;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${route.name} — access</title>
<style>
  :root{--abyss:#04101c;--deep:#0a2f47;--ice:#bfe6f0;--frost:#eaf6fa;
        --dawn:#ff9d6e;--text:#e9f6fa;--muted:#8fb3c4;--line:rgba(191,230,240,.18)}
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:grid;place-items:center;padding:24px;
       font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--text);
       background:radial-gradient(120% 80% at 70% -10%,rgba(255,157,110,.18),transparent 55%),var(--abyss)}
  .card{width:min(560px,94vw);background:rgba(8,34,52,.6);border:1px solid var(--line);
        border-radius:18px;padding:30px 30px 26px;backdrop-filter:blur(16px);
        box-shadow:0 24px 70px rgba(0,0,0,.45)}
  h1{font-family:"Syne",system-ui,sans-serif;font-weight:800;font-size:26px;color:var(--frost);letter-spacing:.01em}
  .tag{color:var(--dawn);font-size:13px;margin-top:4px;font-family:"JetBrains Mono",monospace}
  .disc{margin-top:18px;padding:16px;border-radius:12px;background:rgba(255,157,110,.08);
        border:1px solid rgba(255,157,110,.25);font-size:14px;line-height:1.55;color:#ffe3cf}
  .disc strong{color:#ffd9b0}
  form{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
  input{flex:1;min-width:200px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);
        background:rgba(191,230,240,.06);color:var(--text);font-size:15px}
  button{padding:12px 20px;border:0;border-radius:10px;background:var(--dawn);color:var(--abyss);
         font-weight:700;font-size:15px;cursor:pointer}
  .err{color:#ff9d9d;font-size:13px;margin-top:10px;font-family:"JetBrains Mono",monospace}
  .foot{margin-top:18px;font-size:12px;color:var(--muted);font-family:"JetBrains Mono",monospace}
  a{color:var(--ice)}
</style></head><body>
  <div class="card">
    <h1>${route.name}</h1>
    <div class="tag">protected demo · access required</div>
    <div class="disc">${disclaimer}</div>
    <form method="POST" action="/__gate">
      <input type="password" name="password" placeholder="Access code (from CV)" autofocus autocomplete="off">
      <button type="submit">Enter demo</button>
    </form>
    ${wrong}
    <div class="foot">← <a href="https://heraberg.com">back to heraberg.com</a></div>
  </div>
</body></html>`;
}

const DEFAULT_DISCLAIMER = `
  <strong>Demo only — not a medical device.</strong> This is a portfolio demonstration and
  must not be used for real clinical decisions. You may upload real patient data if you wish,
  but you do not need to: sample data is available. Right now the demo is loaded only with
  <strong>diabetes</strong> data (it's hosted on a personal machine and space is limited).
  Diabetes is the only condition tested so far, and it performs well — the production version
  is designed to cover many more conditions, and results should generalise similarly.
  Inference runs on rented GPUs and may occasionally be slow or temporarily unavailable.`;

/* ── proxy a request to a local project port ─────────────────── */
function proxy(req, res, port) {
  const opts = {
    hostname: '127.0.0.1', port, path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  };
  const up = http.request(opts, upRes => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(`<body style="font-family:sans-serif;background:#04101c;color:#e9f6fa;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h2>This demo is offline right now.</h2>
      <p style="color:#8fb3c4">The project behind it isn't running on the host. Try again shortly.</p>
      <p><a style="color:#ff9d6e" href="https://heraberg.com">← heraberg.com</a></p></div></body>`);
  });
  req.pipe(up);
}

/* ── read a POSTed body (for the gate form) ──────────────────── */
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}

/* ── main handler ────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const sub = subdomainOf(req.headers.host);

  // poster page (apex / www)
  if (!sub) return serveStatic(req, res);

  const route = ROUTES[sub];
  if (!route) { res.writeHead(404); return res.end('No such project.'); }

  // handle gate form POST
  if (req.method === 'POST' && (req.url || '').startsWith('/__gate')) {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    if (params.get('password') === GATE_PASSWORD) {
      const cookie = `${COOKIE_NAME}=${encodeURIComponent(sign(String(Math.floor(Date.now()/1000))))}`;
      // "Secure" makes browsers drop the cookie over plain http (i.e. local
      // testing). Keep it for real hostnames, omit it for localhost so the
      // gate works when you're testing without HTTPS.
      const host = (req.headers.host || '').split(':')[0].toLowerCase();
      const isLocal = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
      const secure = isLocal ? '' : ' Secure;';
      res.writeHead(302, {
        'Set-Cookie': `${cookie}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
        'Location': '/',
      });
      return res.end();
    }
    res.writeHead(401, { 'Content-Type': 'text/html' });
    return res.end(gatePage(route, { wrong: true }));
  }

  // gated project, no valid cookie → show the gate
  if (route.gated && !hasAccess(req)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(gatePage(route));
  }

  // otherwise proxy straight through to the project
  return proxy(req, res, route.port);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[heraberg] glue server on http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`[heraberg] routes:`, Object.keys(ROUTES).map(s => `${s}(${ROUTES[s].gated?'gated':'open'})`).join(', ') || '(none yet)');
  if (GATE_PASSWORD === 'change-me') console.warn('[heraberg] ⚠  GATE_PASSWORD is default — set it in .env');
});
