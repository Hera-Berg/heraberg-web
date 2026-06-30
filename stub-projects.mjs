#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────
   stub-projects.mjs  —  LOCAL TESTING ONLY

   Stands in for your 3 real projects so you can see the whole
   poster → router → gate → project flow working before the real
   apps (or their real ports) are wired up.

   It reads each projects/<name>/project.json, and starts a tiny
   placeholder web server on that project's "port". Each placeholder
   just shows a page saying "this is where <project> would load".

   When you know your real ports / have the real apps running:
     1. stop this stub (Ctrl-C)
     2. set the real port in each project.json
     3. start your real apps on those ports
   …and the glue server proxies to them instead. Nothing else changes.
─────────────────────────────────────────────────────────────── */

import http from 'node:http';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIRS = [join(__dirname, 'projects'), join(__dirname, 'ai-projects')];

const metas = [];
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const mp = join(dir, d.name, 'project.json');
    if (!existsSync(mp)) continue;
    try {
      const m = JSON.parse(readFileSync(mp, 'utf8'));
      if (m.port) metas.push(m);
    } catch { /* skip */ }
  }
}

if (!metas.length) {
  console.log('No projects with a "port" found. Nothing to stub.');
  process.exit(0);
}

function page(m) {
  return `<!doctype html><meta charset="utf-8">
<title>${m.name} (stub)</title>
<body style="margin:0;font-family:system-ui,sans-serif;background:#04101c;color:#e9f6fa;
display:grid;place-items:center;height:100vh;text-align:center">
  <div style="max-width:560px;padding:24px">
    <div style="font-family:monospace;color:#ff9d6e;font-size:13px;letter-spacing:.1em">STUB · PORT ${m.port}</div>
    <h1 style="font-size:30px;margin:10px 0 6px">${m.name}</h1>
    <p style="color:#8fb3c4;font-size:15px;line-height:1.6">
      This placeholder is standing in for your real project on port
      <b style="color:#bfe6f0">${m.port}</b>.<br>
      When your real app runs on this port, the glue server will proxy to it instead — automatically.
    </p>
    <p style="margin-top:18px"><a style="color:#ff9d6e" href="http://localhost:${process.env.PORT||8080}">← back to poster</a></p>
  </div>
</body>`;
}

for (const m of metas) {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(m));
  }).listen(m.port, '127.0.0.1', () => {
    console.log(`  stub: ${m.name.padEnd(22)} → http://127.0.0.1:${m.port}  (${m.gated ? 'gated' : 'open'})`);
  });
}
console.log('\n[stubs] running. Ctrl-C to stop. Start the glue server in another terminal.');
