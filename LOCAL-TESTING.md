# Testing locally (before the 3060 laptop)

This runs the whole poster → router → gate → project flow on your own
machine. No Cloudflare, no domain, no real ports needed to start.

## Quickest: one command

```bash
cd heraberg-kit
./local-test.sh
```

Then open in a browser:

| URL | What |
|---|---|
| http://localhost:8080 | poster page |
| http://model.localhost:8080 | project 1 (open) |
| http://medical.localhost:8080 | project 2 (gated — password `demo123`) |
| http://harness.localhost:8080 | project 3 (open) |

Hover a card on the poster → the panel surfaces → "Visit project" links to
the matching `*.localhost` address above. Ctrl-C stops everything.

> `*.localhost` automatically points to your own machine on modern systems —
> no `/etc/hosts` edit needed. If your browser refuses `medical.localhost`,
> add this to `/etc/hosts` (needs sudo) and retry:
> ```
> 127.0.0.1  model.localhost medical.localhost harness.localhost
> ```

By default this uses **stub projects** — placeholder pages standing in for
your real apps — so you can see the flow without knowing your real ports yet.

---

## Step 1 — find your real ports

On the machine where your 3 projects run:

```bash
# Docker projects (medical gateway, test harness):
docker ps
#   look at the PORTS column, e.g.  0.0.0.0:7860->8000/tcp
#   the HOST port (left of ->, here 7860) is what you want

# anything listening (incl. the venv project):
ss -tlnp 2>/dev/null | grep LISTEN
# or:  lsof -iTCP -sTCP:LISTEN -P -n
```

## Step 2 — put the ports in the JSON

Edit the `"port"` field in each project's file:

```
projects/01-scratch-llm/project.json     → "port": <venv app port>
projects/02-medical-gateway/project.json → "port": <docker host port>
projects/03-model-harness/project.json   → "port": <docker host port>
```

That's the whole "link to those ports" mechanism — the glue server reads these
and proxies each subdomain to 127.0.0.1:<port>.

## Step 3 — run against your REAL apps

Make sure your 3 real apps are running on those ports, then:

```bash
# don't start the stubs this time — your real apps ARE the projects.
# just build + serve:
PORT=8080 LOCAL=1 GATE_PASSWORD=demo123 COOKIE_SECRET=local-test-secret \
  node build.mjs && \
PORT=8080 LOCAL=1 GATE_PASSWORD=demo123 COOKIE_SECRET=local-test-secret \
  node server.mjs
```

Open the same `*.localhost:8080` URLs — now they hit your real projects.

---

## Notes

- The gate password for local testing is `demo123` (override with the
  `GATE_PASSWORD` env var). On localhost the auth cookie is sent without the
  `Secure` flag so it works over plain http; in production it stays `Secure`.
- `LOCAL=1` is what makes the poster link to `*.localhost:8080`. Drop it (and
  it points back to `https://*.heraberg.com`) for the real deployment.
- If a project's stub/app isn't running on its port, that subdomain shows a
  friendly "demo is offline" page instead of crashing — expected.
