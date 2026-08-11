#!/usr/bin/env bash
#
# adb-mcp — kiem tra toan tuyen.
#
# Ba lop doc lap nhau. Lop 1 va 2 dat KHONG co nghia la app Adobe da noi.
#
#   Lop 1  server python chay duoc
#   Lop 2  Claude Code thay tool
#   Lop 3  app Adobe that su da bam Connect

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPDIR="$REPO/mcp"
VENV_PY="$MCPDIR/.venv/bin/python3"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
UDT_WS="$HOME/Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
row()  { printf '  %-16s %s\n' "$1" "$2"; }
good() { printf '  %-16s \033[32m%s\033[0m\n' "$1" "$2"; }
bad()  { printf '  %-16s \033[31m%s\033[0m\n' "$1" "$2"; }

# ------------------------------------------------------------------ lop 0

step "Lop 0 — binaries"
for b in node uv claude magick rsvg-convert pdftocairo ffmpeg exiftool; do
  p="$(command -v "$b" 2>/dev/null)"
  if [ -n "$p" ]; then good "$b" "$p"; else bad "$b" "MISSING"; fi
done
if [ -x /opt/homebrew/bin/gs ]; then
  good "gs" "$(/opt/homebrew/bin/gs --version 2>/dev/null)"
else
  bad "gs" "MISSING (goi full path /opt/homebrew/bin/gs — alias 'gs' co the che)"
fi

BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$BRANCH" = "local-fixes" ]; then good "branch" "$BRANCH"; else bad "branch" "$BRANCH (can local-fixes)"; fi

# ------------------------------------------------------------------ lop 1

step "Lop 1 — server python"
if [ -x "$VENV_PY" ]; then
  if "$VENV_PY" -c "import PIL, socketio, requests, numpy, mcp" 2>/dev/null; then
    good "venv deps" "PIL socketio requests numpy mcp"
  else
    bad "venv deps" "thieu — cd $MCPDIR && uv sync"
  fi
else
  bad "venv" "chua co $VENV_PY — chay ./install.sh"
fi

# ------------------------------------------------------------------ lop 2

step "Lop 2 — Claude Code thay server"
if command -v claude >/dev/null 2>&1; then
  OUT="$(claude mcp list 2>&1)"
  for name in photoshop illustrator aftereffects indesign premiere; do
    line="$(printf '%s\n' "$OUT" | grep -i "^$name" | head -1)"
    status="$(printf '%s' "$line" | sed 's/.* - //')"
    if [ -z "$line" ]; then
      bad "$name" "chua dang ky — ./install.sh"
    elif printf '%s' "$line" | grep -qi "connected"; then
      good "$name" "$status"
    else
      bad "$name" "$status"
    fi
  done
  echo "  (Connected o day chi nghia la server khoi dong duoc — chua noi gi toi app Adobe)"
else
  bad "claude" "khong co CLI"
fi

# ------------------------------------------------------------------ extensions

step "Extensions da cai"
for k in 9 10 11 12 13; do
  v="$(defaults read "com.adobe.CSXS.$k" PlayerDebugMode 2>/dev/null || echo 0)"
  if [ "$v" = "1" ]; then good "CSXS.$k" "PlayerDebugMode=1"; else bad "CSXS.$k" "PlayerDebugMode chua bat"; fi
done
for ext in com.mikechambers.ae com.mikechambers.ai; do
  if [ -L "$CEP_DIR/$ext" ]; then
    good "$ext" "-> $(readlink "$CEP_DIR/$ext")"
  elif [ -d "$CEP_DIR/$ext" ]; then
    row "$ext" "thu muc that (khong phai symlink — git pull se khong cap nhat)"
  else
    bad "$ext" "chua cai"
  fi
done
if [ -f "$UDT_WS" ]; then
  /usr/bin/python3 - "$UDT_WS" "$REPO" <<'PY'
import json, sys
ws, repo = sys.argv[1], sys.argv[2]
try:
    plugins = json.load(open(ws)).get("plugins") or []
except Exception:
    plugins = []
paths = {p.get("manifestPath") for p in plugins if isinstance(p, dict)}
for rel, label in (("uxp/ps/manifest.json", "UDT ps"),
                   ("uxp/id/manifest.json", "UDT id"),
                   ("uxp/pr/manifest.json", "UDT pr")):
    full = "%s/%s" % (repo, rel)
    if full in paths:
        print("  %-16s \033[32mda add trong UDT (con phai bam Load)\033[0m" % label)
    else:
        print("  %-16s \033[31mchua add — ./install.sh\033[0m" % label)
PY
else
  bad "UDT" "chua co plugins_workspace.json — mo UDT 1 lan roi chay ./install.sh"
fi

# ------------------------------------------------------------------ lop 3

step "Lop 3 — app Adobe that su da noi"
if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  good "proxy" "dang nghe localhost:3001"
  if [ -x "$VENV_PY" ]; then
    ( cd "$MCPDIR" && "$VENV_PY" - <<'PY'
import socket_client
from socket_client import AppError

for app in ("photoshop", "illustrator", "aftereffects", "indesign", "premiere"):
    socket_client.configure(app=app, url="http://localhost:3001", timeout=6)
    try:
        socket_client.send_message_blocking(
            {"application": app, "action": "__probe__", "options": {}}, timeout=6)
        ok = True
    except AppError:
        ok = True          # plugin tra loi "unknown command" -> dang song
    except Exception:
        ok = False
    color = "\033[32mnoi duoc\033[0m" if ok else "\033[31mchua noi\033[0m"
    print("  %-16s %s" % (app, color))
PY
    ) 2>/dev/null
  fi
else
  bad "proxy" "chua chay — ./start.sh"
fi

cat <<'EOF'

Doi chieu
  lop 1 fail                     sai duong dan uv, hoac chua uv sync
  lop 2 thieu server             chua ./install.sh, hoac chua /mcp reconnect all
  lop 2 AE chi 1 tool            dang o branch main -> git checkout local-fixes
  lop 3 "chua noi"               proxy chua chay, app chua mo, hoac chua bam Connect
EOF
