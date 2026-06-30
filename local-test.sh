#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# local-test.sh — run the whole thing on your machine.
#
#   ./local-test.sh
#
# Starts:
#   1. stub projects (placeholders on each project's port)
#   2. a LOCAL build (poster links → *.localhost:8080)
#   3. the glue server (poster + router + gate) on :8080
#
# Then open:
#   http://localhost:8080            → poster page
#   http://model.localhost:8080      → project 1 (open)
#   http://medical.localhost:8080    → project 2 (gated: password below)
#   http://harness.localhost:8080    → project 3 (open)
#
# *.localhost resolves to 127.0.0.1 automatically on modern systems —
# no /etc/hosts editing needed. (If it doesn't on yours, see SETUP note.)
#
# Stop everything with Ctrl-C.
# ───────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

export PORT="${PORT:-5080}"
export LOCAL=1
export GATE_PASSWORD="${GATE_PASSWORD:-demo123}"   # local test password
export COOKIE_SECRET="${COOKIE_SECRET:-local-test-secret}"

echo "▶ building poster (LOCAL mode)…"
node build.mjs

echo "▶ starting stub projects…"
node stub-projects.mjs &
STUB_PID=$!

# make sure we clean up both processes on exit
cleanup() { echo; echo "stopping…"; kill $STUB_PID 2>/dev/null; kill $SRV_PID 2>/dev/null; exit 0; }
trap cleanup INT TERM

sleep 1
echo "▶ starting glue server on :$PORT…"
node server.mjs &
SRV_PID=$!

sleep 1
echo
echo "──────────────────────────────────────────────"
echo "  Poster:   http://localhost:$PORT"
echo "  Project1: http://model.localhost:$PORT      (open)"
echo "  Project2: http://medical.localhost:$PORT    (GATED — password: $GATE_PASSWORD)"
echo "  Project3: http://harness.localhost:$PORT    (open)"
echo "──────────────────────────────────────────────"
echo "  Ctrl-C to stop everything."
echo

wait $SRV_PID
