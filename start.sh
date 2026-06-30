#!/usr/bin/env bash
# start.sh — Start the Document Converter (checks deps, installs, launches server)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=7789
MIN_NODE_MAJOR=18

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'
BLU='\033[0;34m'; CYN='\033[0;36m'; RST='\033[0m'; BLD='\033[1m'

info()  { printf "${BLU}  →${RST} %s\n" "$*"; }
ok()    { printf "${GRN}  ✓${RST} %s\n" "$*"; }
warn()  { printf "${YEL}  ⚠${RST} %s\n" "$*"; }
err()   { printf "${RED}  ✗${RST} %s\n" "$*" >&2; }
title() { printf "\n${BLD}${CYN}%s${RST}\n" "$*"; }
die()   { err "$*"; exit 1; }

open_browser() {
  local u="$1"
  if [ -n "${WSL_DISTRO_NAME:-}" ] || [ -n "${WSL_INTEROP:-}" ]; then
    /mnt/c/Windows/System32/cmd.exe /c "start ${u}" 2>/dev/null &
  elif command -v wslview &>/dev/null; then
    wslview "$u" 2>/dev/null &
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$u" 2>/dev/null &
  elif command -v open &>/dev/null; then
    open "$u" 2>/dev/null &
  fi
}

# ── Banner ────────────────────────────────────────────────────────────────────
printf "\n${BLD}${CYN}📚 Document Converter${RST}\n"
printf "${BLU}   HTML / Markdown → HTML · EPUB · PDF${RST}\n\n"

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
title "Checking prerequisites"

if ! command -v node &>/dev/null; then
  err "Node.js is not installed."
  printf "\n  Install it from: https://nodejs.org  (v${MIN_NODE_MAJOR}+ required)\n"
  printf "  On Ubuntu/WSL:   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -\n"
  printf "                   sudo apt-get install -y nodejs\n\n"
  die "Aborting — Node.js required."
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node.js ${NODE_VERSION} is too old. Need v${MIN_NODE_MAJOR}+."
fi
ok "Node.js v${NODE_VERSION}"

if ! command -v npm &>/dev/null; then
  die "npm not found. Reinstall Node.js."
fi
ok "npm $(npm --version)"

# ── 2. Check optional tools ───────────────────────────────────────────────────
if command -v make &>/dev/null; then
  ok "make $(make --version | head -1 | grep -oP '\d+\.\d+' | head -1)"
else
  warn "make not found — HTML rendering will not work"
fi

if command -v pandoc &>/dev/null; then
  ok "pandoc $(pandoc --version | head -1 | awk '{print $2}')"
else
  warn "pandoc not found — EPUB/PDF via pandoc will not work"
fi

if command -v xelatex &>/dev/null; then
  ok "xelatex $(xelatex --version 2>&1 | head -1 | grep -oP '\d+\.\d+[\d.]*' | head -1)"
else
  warn "xelatex not found — PDF via LaTeX will not work"
fi

# ── 3. Install npm dependencies ───────────────────────────────────────────────
title "Checking npm dependencies"

cd "$SCRIPT_DIR"

if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json 2>/dev/null ]; then
  info "Running npm install..."
  npm install --prefer-offline 2>&1 | while IFS= read -r line; do
    printf "     %s\n" "$line"
  done
  ok "Dependencies installed"
else
  ok "node_modules up to date"
fi

# ── 4. Free port if busy ─────────────────────────────────────────────────────
title "Starting server"

PIDS_ON_PORT=$(lsof -ti:"$PORT" 2>/dev/null || true)
if [ -n "$PIDS_ON_PORT" ]; then
  warn "Port ${PORT} in use — killing existing process(es): ${PIDS_ON_PORT}"
  echo "$PIDS_ON_PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.5   # brief wait for OS to release the port
  ok "Port ${PORT} freed"
fi

# ── 5. Start server.mjs ───────────────────────────────────────────────────────
SERVER_LOG="${SCRIPT_DIR}/.server.log"
info "Launching server on port ${PORT}..."

node server.mjs > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Wait for ready signal (up to 5s)
READY=0
for i in $(seq 1 25); do
  if curl -s --max-time 0.3 "http://127.0.0.1:${PORT}/api/status" -o /dev/null 2>/dev/null; then
    READY=1; break
  fi
  sleep 0.2
done

if [ "$READY" -eq 0 ]; then
  err "Server did not start in time."
  printf "\n  Last log output:\n"
  tail -10 "$SERVER_LOG" | while IFS= read -r line; do printf "    %s\n" "$line"; done
  kill "$SERVER_PID" 2>/dev/null || true
  die "Check ${SERVER_LOG} for details."
fi

ok "Server running (PID ${SERVER_PID})"

# ── 6. Open browser ───────────────────────────────────────────────────────────
URL="http://127.0.0.1:${PORT}/"
open_browser "$URL"

# ── 7. Summary ────────────────────────────────────────────────────────────────
printf "\n${BLD}${GRN}  ✓ Document Converter is ready${RST}\n"
printf "  ${BLD}→ ${CYN}${URL}${RST}\n"
printf "\n  Press ${BLD}Ctrl+C${RST} to stop.\n\n"

# ── 8. Wait and cleanup ───────────────────────────────────────────────────────
trap 'echo; info "Stopping server (PID ${SERVER_PID})..."; kill "$SERVER_PID" 2>/dev/null; ok "Stopped."; echo' INT TERM

wait "$SERVER_PID" 2>/dev/null || true
