# HERABERG — setup guide

Everything you need to take this from "laptop arrives" to "heraberg.com is live"
in about an hour. Your three projects keep their own runtimes (venv / Docker) —
nothing about them gets rewritten. This kit is only the glue that sits in front.

---

## The shape of it

```
                    Cloudflare (DNS + tunnel, free)
                              │
                    cloudflared (one tunnel)
                              │
                  ┌───────────▼───────────┐
                  │   glue server :8080    │   ← this kit (Node)
                  │  routes by subdomain,  │
                  │  gates medical w/ pwd  │
                  └───┬────────┬────────┬──┘
        proxies to    │        │        │
                  :8001     :8002     :8003
              from-scratch  medical    test
                 (venv)    (Docker)  (Docker)
```

- `heraberg.com` / `www` → poster page (public)
- `model.heraberg.com` → from-scratch LLM (public)
- `medical.heraberg.com` → medical gateway (**password + disclaimer**)
- `harness.heraberg.com` → test harness (public, uses visitor's own RunPod key)

The one password — printed on your CV — only protects the medical gateway,
the only project that costs you money.

---

## 0. Prereqs on the laptop

```bash
# Node 20+ (this kit uses --env-file, needs 20+; 22 is ideal)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker (for projects 2 & 3) — if not already installed
# follow docker's official install for your distro

# cloudflared
# download the latest from Cloudflare's site / your package manager
```

Your three projects: get each one listening on its local port:

- from-scratch LLM → `127.0.0.1:8001` (run inside its venv)
- medical gateway → `127.0.0.1:8002` (its Docker container, `-p 8002:<internal>`)
- test harness → `127.0.0.1:8003` (its Docker container, `-p 8003:<internal>`)

> If a project currently serves on a different port, either change it to serve on
> the port above, or change the `"port"` field in that project's `project.json`.

---

## 1. Drop this kit on the laptop

```bash
# copy the heraberg-kit folder to e.g. /home/youruser/heraberg-kit
cd ~/heraberg-kit
cp .env.example .env
# edit .env:
#   GATE_PASSWORD = your CV access code
#   COOKIE_SECRET = output of:  openssl rand -hex 16
nano .env
```

Your real `index.html` is already in `public/`. Build + run once to check:

```bash
npm run build      # writes public/projects.json from the project folders
npm run serve      # starts the glue server on :8080
# in another terminal:
curl -H "Host: heraberg.com" http://127.0.0.1:8080/ | head
curl -H "Host: medical.heraberg.com" http://127.0.0.1:8080/ | grep "Access code"
```

---

## 2. Cloudflare tunnel (free, no port-forwarding)

```bash
cloudflared tunnel login                 # opens browser, pick heraberg.com
cloudflared tunnel create heraberg       # note the TUNNEL-UUID it prints

# route each hostname to the tunnel:
cloudflared tunnel route dns heraberg heraberg.com
cloudflared tunnel route dns heraberg www.heraberg.com
cloudflared tunnel route dns heraberg model.heraberg.com
cloudflared tunnel route dns heraberg medical.heraberg.com
cloudflared tunnel route dns heraberg harness.heraberg.com
```

Put `cloudflared/config.yml` from this kit at `~/.cloudflared/config.yml`,
and fill in:

- `credentials-file:` → the path to `<TUNNEL-UUID>.json` it created
- the tunnel name (`heraberg`) should already match

Test it:

```bash
cloudflared tunnel run heraberg
# now visit https://heraberg.com in a browser
```

---

## 3. Make it survive reboots (systemd)

```bash
# edit deploy/*.service: set User= and the two paths to your real ones
sudo cp deploy/heraberg.service /etc/systemd/system/
sudo cp deploy/heraberg-watch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now heraberg heraberg-watch

# cloudflared as a service too:
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Now everything comes back automatically after a power cut / reboot.

---

## 4. The "drop a folder and it updates" workflow

When you finish a new project:

1. Get it listening on a free local port (e.g. `:8004`).
2. Create a folder `projects/04-newthing/` with a `project.json` (copy an
   existing one as a template). Set `subdomain`, `port`, `gated`, `status`.
3. Add one DNS route + one ingress line:
   ```bash
   cloudflared tunnel route dns heraberg newthing.heraberg.com
   ```
   and add to `~/.cloudflared/config.yml`:
   ```yaml
   - hostname: newthing.heraberg.com
     service: http://127.0.0.1:8080
   ```
   then `sudo systemctl restart cloudflared`.

That's it. The watcher regenerates `projects.json` automatically (poster page
shows the new card on next load), and the glue server hot-reloads routes every
10s, so the new subdomain starts proxying without a restart.

> The only manual bit per new project is the DNS route + ingress line, because
> Cloudflare needs to know the hostname exists. Everything else is automatic.
> (If you'd rather make even that automatic, a wildcard `*.heraberg.com` route +
> origin cert removes it — ask and I'll wire that variant.)

---

## 5. Things to remember

- **The password goes on your CV**, e.g. "Live demo at heraberg.com — medical
  gateway access code: `xxxx`". Recruiters click, type it once, in for 12h.
- The from-scratch model and test harness are **open** — no password — so a
  recruiter skimming your CV can click straight in.
- The medical gateway shows the **disclaimer + password on one screen**, with
  the diabetes-only caveat you wanted.
- Change the password anytime: edit `.env`, `sudo systemctl restart heraberg`.
- Update poster text (skills, socials, AI links) directly in `public/index.html`.
- The poster's LinkedIn/email placeholders (`in/your-handle`, `you@heraberg.com`)
  still need your real handles — search those strings in index.html.

---

## Security notes (worth a glance)

- The glue server binds to `127.0.0.1`, so it's only reachable via the tunnel —
  not exposed on your LAN or the raw internet. Good.
- The gate cookie is HMAC-signed and HttpOnly/Secure/SameSite=Lax. It's a
  portfolio gate, not a bank — fine for this purpose, but don't put anything
  truly sensitive behind it.
- Keep `.env` out of git (the included `.gitignore` already does this).
- The test harness takes the _visitor's_ RunPod key client-side; make sure that
  project never logs or stores it server-side.
