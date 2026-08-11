#!/usr/bin/env bash
#
# adb-mcp — cai dat mot lenh.
#
#   ./install.sh                 cai het (proxy + python + 5 MCP server + CEP + UXP)
#   ./install.sh --with-brew     cai luon cac formula Homebrew ma skill can
#   ./install.sh --skip-cep      bo qua After Effects / Illustrator
#   ./install.sh --skip-uxp      bo qua Photoshop / InDesign / Premiere
#   ./install.sh --skip-mcp      khong dang ky lai MCP server voi Claude Code
#   ./install.sh --scope local   dang ky MCP chi cho project nay (default: user)
#
# Idempotent — chay lai bao nhieu lan cung duoc.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPDIR="$REPO/mcp"
PROXYDIR="$REPO/adb-proxy-socket"
VENV_PY="$MCPDIR/.venv/bin/python3"

WITH_BREW=0
SKIP_CEP=0
SKIP_UXP=0
SKIP_MCP=0
SCOPE=user

BREW_FORMULAS="imagemagick librsvg poppler ghostscript ffmpeg exiftool webp uv"
CEP_EXTENSIONS="com.mikechambers.ae com.mikechambers.ai"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
UDT_WS="$HOME/Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json"

WARNINGS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --with-brew) WITH_BREW=1 ;;
    --skip-cep)  SKIP_CEP=1 ;;
    --skip-uxp)  SKIP_UXP=1 ;;
    --skip-mcp)  SKIP_MCP=1 ;;
    --scope)     SCOPE="${2:-user}"; shift ;;
    -h|--help)   sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Khong hieu tham so: $1 (xem --help)"; exit 2 ;;
  esac
  shift
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32mok\033[0m   %s\n' "$*"; }
warn() { WARNINGS=$((WARNINGS+1)); printf '   \033[33mchu y\033[0m %s\n' "$*"; }
die()  { printf '   \033[31mloi\033[0m  %s\n' "$*"; exit 1; }

# ---------------------------------------------------------------- 0. preflight

step "0. Kiem moi truong"

[ -d "$MCPDIR" ]   || die "khong thay $MCPDIR — chay script tu trong repo adb-mcp"
[ -d "$PROXYDIR" ] || die "khong thay $PROXYDIR"

BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$BRANCH" = "local-fixes" ]; then
  ok "branch local-fixes"
else
  warn "dang o branch '$BRANCH'. Nhanh 'local-fixes' co 3 fix bat buoc (Illustrator structured data, Premiere WebSocket, tool AE). Chay: git checkout local-fixes"
fi

if [ "$WITH_BREW" = "1" ]; then
  command -v brew >/dev/null 2>&1 || die "chua co Homebrew — cai truoc roi chay lai voi --with-brew"
  echo "   dang brew install $BREW_FORMULAS"
  brew install $BREW_FORMULAS
fi

command -v node >/dev/null 2>&1 || die "chua co node (>=18). brew install fnm && fnm install 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $(node -v) qua cu, can >= 18"
ok "node $(node -v)"

command -v uv >/dev/null 2>&1 || die "chua co uv. brew install uv"
UV="$(command -v uv)"
ok "uv $($UV --version | awk '{print $2}') tai $UV"

if command -v claude >/dev/null 2>&1; then
  ok "claude $(claude --version 2>/dev/null | awk '{print $1}')"
else
  warn "chua co Claude Code CLI — buoc dang ky MCP se bi bo qua. npm install -g @anthropic-ai/claude-code"
  SKIP_MCP=1
fi

# Alias 'gs' che ghostscript: which() thay co, goi ra lai la git status.
if [ -n "${ZSH_VERSION:-}" ] && alias gs >/dev/null 2>&1; then
  warn "shell co alias 'gs' — che ghostscript. Doi thanh 'gst' hoac goi /opt/homebrew/bin/gs"
fi

# ---------------------------------------------------------------- 1. proxy

step "1. Proxy socket (node)"
( cd "$PROXYDIR" && npm install --silent )
ok "npm install xong — $PROXYDIR"

# ---------------------------------------------------------------- 2. python

step "2. MCP server (python qua uv)"
( cd "$MCPDIR" && $UV sync --quiet ) || ( cd "$MCPDIR" && $UV venv --python 3.12 && $UV pip install -e . )

if [ -x "$VENV_PY" ] && "$VENV_PY" -c "import PIL, socketio, requests, numpy, mcp" 2>/dev/null; then
  ok "venv day du deps — $VENV_PY"
else
  ( cd "$MCPDIR" && $UV pip install -e . )
  "$VENV_PY" -c "import PIL, socketio, requests, numpy, mcp" \
    || die "venv thieu deps. Chay tay: cd $MCPDIR && uv venv --python 3.12 && uv pip install -e ."
  ok "venv day du deps — $VENV_PY"
fi

# Server phai khoi dong duoc trong stdio mode truoc khi dang ky.
if ( cd "$MCPDIR" && $UV run mcp run ps-mcp.py </dev/null >/dev/null 2>&1 ); then
  ok "ps-mcp.py khoi dong duoc"
else
  warn "ps-mcp.py khong khoi dong sach — xem: cd $MCPDIR && uv run mcp run ps-mcp.py"
fi

# ---------------------------------------------------------------- 3. MCP servers

if [ "$SKIP_MCP" = "0" ]; then
  step "3. Dang ky 5 MCP server voi Claude Code (scope $SCOPE)"
  for pair in photoshop:ps illustrator:ai aftereffects:ae indesign:id premiere:pr; do
    name="${pair%%:*}"
    file="${pair##*:}-mcp.py"
    claude mcp remove --scope "$SCOPE" "$name" >/dev/null 2>&1 || true
    claude mcp add --scope "$SCOPE" "$name" -- "$UV" run --directory "$MCPDIR" mcp run "$file" >/dev/null
    ok "$name -> $file"
  done
  echo "   Trong session Claude Code: /mcp reconnect all (hoac restart)"
else
  step "3. Dang ky MCP — bo qua"
fi

# ---------------------------------------------------------------- 4. CEP

if [ "$SKIP_CEP" = "0" ]; then
  step "4. CEP — After Effects, Illustrator"

  for k in 9 10 11 12 13; do
    defaults write "com.adobe.CSXS.$k" PlayerDebugMode 1
  done
  killall cfprefsd >/dev/null 2>&1 || true
  ok "PlayerDebugMode = 1 cho CSXS 9..13"

  mkdir -p "$CEP_DIR"
  for ext in $CEP_EXTENSIONS; do
    src="$REPO/cep/$ext"
    dst="$CEP_DIR/$ext"
    [ -d "$src" ] || { warn "khong thay $src"; continue; }
    if [ -d "$dst" ] && [ ! -L "$dst" ]; then
      warn "$dst la thu muc that (khong phai symlink) — doi ten thu cong roi chay lai"
      continue
    fi
    ln -sfn "$src" "$dst"
    ok "symlink $ext"
  done
else
  step "4. CEP — bo qua"
fi

# ---------------------------------------------------------------- 5. UXP

if [ "$SKIP_UXP" = "0" ]; then
  step "5. UXP — Photoshop, InDesign, Premiere"

  if [ ! -d "/Applications/Adobe UXP Developer Tools" ]; then
    warn "chua cai UXP Developer Tools (Creative Cloud Desktop > Work > UXP Developer Tool)"
  fi

  if pgrep -f "Adobe UXP Developer Tools" >/dev/null 2>&1; then
    warn "UDT dang mo — no ghi de plugins_workspace.json luc quit. Dong UDT roi chay lai buoc nay"
  fi

  mkdir -p "$(dirname "$UDT_WS")"
  /usr/bin/python3 - "$UDT_WS" "$REPO" <<'PY'
import json, os, sys

ws, repo = sys.argv[1], sys.argv[2]
want = [("uxp/ps/manifest.json", "PS"),
        ("uxp/id/manifest.json", "ID"),
        ("uxp/pr/manifest.json", "premierepro")]

data = {"version": 1, "plugins": []}
if os.path.exists(ws):
    try:
        with open(ws) as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            data = loaded
    except Exception:
        print("   chu y  plugins_workspace.json khong doc duoc — tao lai")

plugins = data.get("plugins") or []
seen = {p.get("manifestPath") for p in plugins if isinstance(p, dict)}
added = 0
for rel, host in want:
    path = os.path.join(repo, rel)
    if not os.path.exists(path):
        print("   chu y  thieu %s" % path)
        continue
    if path in seen:
        continue
    plugins.append({"manifestPath": path,
                    "pluginOptions": {"breakOnStart": False},
                    "hostParam": host})
    added += 1

data["version"] = data.get("version", 1)
data["plugins"] = plugins
with open(ws, "w") as f:
    json.dump(data, f)
print("   \033[32mok\033[0m   UDT workspace: them %d, tong %d plugin" % (added, len(plugins)))
PY

  echo "   3 plugin da nam san trong UDT — chi con bam Load. Bat Enable Developer Mode"
  echo "   trong tung app (Settings > Plugins) roi restart app."
else
  step "5. UXP — bo qua"
fi

# ---------------------------------------------------------------- xong

step "Xong"
if [ "$WARNINGS" -gt 0 ]; then
  printf '   %d canh bao o tren.\n' "$WARNINGS"
fi
cat <<EOF

   Moi lan dung:   $REPO/start.sh
   Kiem tra:       $REPO/doctor.sh

EOF
