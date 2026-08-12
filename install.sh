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
#   ./install.sh --skills        symlink .claude/skills/* sang ~/.claude/skills
#                                (de skill chay duoc o MOI project, khong chi repo nay)
#   ./install.sh --bootstrap     may trang: tu cai nvm + Node LTS, uv, va Claude Code
#                                (khong can Homebrew, khong can git, khong can sudo)
#   ./install.sh --fetch         tu tai code repo (nhanh local-fixes) vao thu muc hien tai
#                                neu chua co — dung khi chi co mot file install.sh trong tay
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
LINK_SKILLS=0
BOOTSTRAP=0
FETCH=0
SCOPE=user
NVM_VERSION=v0.40.6
ZIP_URL=https://github.com/anhthienonline/adb-mcp/archive/refs/heads/local-fixes.zip

BREW_FORMULAS="imagemagick librsvg poppler ghostscript ffmpeg exiftool webp uv"
CEP_EXTENSIONS="com.mikechambers.ae com.mikechambers.ai"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
UDT_WS="$HOME/Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json"

WARNINGS=0

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32mok\033[0m   %s\n' "$*"; }
warn() { WARNINGS=$((WARNINGS+1)); printf '   \033[33mchu y\033[0m %s\n' "$*"; }
die()  { printf '   \033[31mloi\033[0m  %s\n' "$*"; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --with-brew) WITH_BREW=1 ;;
    --skip-cep)  SKIP_CEP=1 ;;
    --skip-uxp)  SKIP_UXP=1 ;;
    --skip-mcp)  SKIP_MCP=1 ;;
    --skills)    LINK_SKILLS=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    --fetch)     FETCH=1 ;;
    --scope)     [ $# -ge 2 ] || die "--scope thieu gia tri (user | local | project)"
                 case "$2" in
                   user|local|project) SCOPE="$2" ;;
                   *) die "--scope '$2' khong hop le (user | local | project)" ;;
                 esac
                 shift ;;
    -h|--help)   sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Khong hieu tham so: $1 (xem --help)"; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------- 0. preflight

step "0. Kiem moi truong"

if [ "$FETCH" = "1" ] && [ ! -d "$MCPDIR" ]; then
  echo "   dang tai code repo — chua thay mcp/ o day"
  for b in curl unzip rsync; do
    command -v "$b" >/dev/null 2>&1 || die "--fetch can '$b' ma may khong co"
  done
  WORK="$REPO/.adb-mcp-fetch"
  rm -rf "$WORK"; mkdir -p "$WORK"
  curl -fsSL -o "$WORK/repo.zip" "$ZIP_URL" || die "tai that bai: $ZIP_URL"
  unzip -q -o "$WORK/repo.zip" -d "$WORK" || die "giai nen that bai"
  SRC="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -d "$SRC/mcp" ] || die "zip khong dung dinh dang — khong thay mcp/ trong $SRC"
  # KHONG ghi de install.sh dang chay: bash doc script theo tung doan, thay file giua
  # duong la hanh vi khong xac dinh. start.sh/doctor.sh khong chay nen ghi de duoc.
  rsync -a --exclude 'install.sh' "$SRC"/ "$REPO"/ || die "copy that bai"
  rm -rf "$WORK"
  ok "tai xong — $(find "$REPO" -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ') muc trong $REPO"
fi

[ -d "$MCPDIR" ]   || die "khong thay $MCPDIR — day khong phai repo adb-mcp.
        Chi co mot file install.sh? Chay: ./install.sh --fetch --bootstrap"
[ -d "$PROXYDIR" ] || die "khong thay $PROXYDIR"

# Kiem dung NOI DUNG, khong dung git: tai ZIP tu GitHub thi khong co .git, ma nhanh sai
# la mat phan lon kha nang cua skill. `main` chi co 1 tool AE, `local-fixes` co 4.
# grep -c in "0" VA exit 1 khi khong match — `|| true` chu khong `|| echo 0`, khong thi
# bien nhan hai dong "0" va phep so sanh so ben duoi bao loi.
AE_TOOLS=0
[ -f "$MCPDIR/ae-mcp.py" ] && AE_TOOLS="$(grep -c '@mcp.tool' "$MCPDIR/ae-mcp.py" || true)"
if [ "$AE_TOOLS" -lt 4 ]; then
  die "ae-mcp.py chi co $AE_TOOLS tool (can >= 4) — day la nhanh 'main', thieu 3 fix bat buoc:
        Illustrator khong tra structured data, Premiere crash voi WebSocket, tool AE noi sai.
        Co git : git checkout local-fixes
        Tai ZIP: lay dung nhanh — https://github.com/anhthienonline/adb-mcp/archive/refs/heads/local-fixes.zip"
fi
BRANCH=""
if [ -d "$REPO/.git" ] && command -v git >/dev/null 2>&1; then
  BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [ -n "$BRANCH" ]; then
  ok "branch $BRANCH — ae-mcp.py $AE_TOOLS tool"
else
  ok "ae-mcp.py $AE_TOOLS tool — dung ban da patch (khong doc duoc branch: tai ZIP, hoac khong co git)"
fi

if [ "$WITH_BREW" = "1" ]; then
  command -v brew >/dev/null 2>&1 || die "chua co Homebrew. Cai roi chay lai voi --with-brew:
        /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/brew/HEAD/install.sh)\"
        eval \"\$(/opt/homebrew/bin/brew shellenv)\""
  echo "   dang brew install $BREW_FORMULAS"
  brew install $BREW_FORMULAS
fi

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]
}

if [ "$BOOTSTRAP" = "1" ] && ! node_ok; then
  step "0a. Cai nvm + Node LTS (chua co node >= 18)"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    # METHOD=script bat nvm dung curl. Mac dinh no uu tien git — tren may chua cai
    # Xcode CLT thi /usr/bin/git chi la stub, goi vao la bung GUI installer roi treo.
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" \
      | METHOD=script bash || die "cai nvm that bai"
  fi
  # nvm.sh doc nhieu bien chua khai bao va tra ma khac 0 mot cach vo hai — `set -eu`
  # lam no chet giua duong. Tat quanh cho nay roi bat lai.
  set +eu
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  NVM_RC=$?
  set -eu
  [ "$NVM_RC" = "0" ] || die "nvm install --lts that bai"
  node_ok || die "cai xong van khong thay node >= 18 trong PATH"
  ok "node $(node -v) qua nvm"

  # Installer cua nvm chi ghi vao shell profile khi no doan ra dung file; doan sai thi
  # cai xong ma terminal MOI van khong thay node. Tu bao dam lay.
  ZSHRC="$HOME/.zshrc"
  if ! grep -q 'NVM_DIR' "$ZSHRC" 2>/dev/null; then
    {
      printf '\n# nvm — them boi adb-mcp install.sh --bootstrap\n'
      printf 'export NVM_DIR="$HOME/.nvm"\n'
      printf '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n'
    } >> "$ZSHRC"
    ok "them 3 dong nap nvm vao $ZSHRC (khong thi terminal moi khong thay node)"
  fi
fi

if [ "$BOOTSTRAP" = "1" ] && ! command -v uv >/dev/null 2>&1; then
  step "0b. Cai uv (chua co)"
  curl -LsSf https://astral.sh/uv/install.sh | sh || die "cai uv that bai"
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || die "cai xong van khong thay uv — them \$HOME/.local/bin vao PATH"
  ok "uv $(uv --version | awk '{print $2}')"
fi

if [ "$BOOTSTRAP" = "1" ] && ! command -v claude >/dev/null 2>&1; then
  step "0c. Cai Claude Code (chua co)"
  # Installer native cai vao ~/.local/bin: khong can node, khong can sudo, va tu tu choi
  # chay duoi sudo. `npm install -g @anthropic-ai/claude-code` cung duoc nhung de vuong
  # quyen ghi vao prefix toan may.
  curl -fsSL https://claude.ai/install.sh | bash || die "cai Claude Code that bai"
  export PATH="$HOME/.local/bin:$PATH"
  command -v claude >/dev/null 2>&1 \
    || die "cai xong van khong thay claude — them \$HOME/.local/bin vao PATH roi chay lai"
  ok "claude $(claude --version 2>/dev/null | awk '{print $1}')"
fi

command -v node >/dev/null 2>&1 || die "chua co node (>=18). Chon mot cach:
        tu dong     : ./install.sh --bootstrap   (cai nvm + Node LTS, khong can brew)
        co Homebrew : brew install fnm && fnm install 20
        khong co    : tai .pkg tai https://nodejs.org (ban LTS)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $(node -v) qua cu, can >= 18"
ok "node $(node -v)"

command -v uv >/dev/null 2>&1 || die "chua co uv. Chon mot cach:
        tu dong     : ./install.sh --bootstrap
        co Homebrew : brew install uv
        khong co    : curl -LsSf https://astral.sh/uv/install.sh | sh
        Cach thu hai cai vao ~/.local/bin — mo terminal moi, hoac:
        export PATH=\"\$HOME/.local/bin:\$PATH\""
UV="$(command -v uv)"
ok "uv $($UV --version | awk '{print $2}') tai $UV"

if command -v claude >/dev/null 2>&1; then
  ok "claude $(claude --version 2>/dev/null | awk '{print $1}')"
else
  warn "chua co Claude Code CLI — buoc dang ky MCP se bi bo qua. Cai bang:
        ./install.sh --bootstrap   (hoac: curl -fsSL https://claude.ai/install.sh | bash)"
  SKIP_MCP=1
fi

# Xcode CLT chua accept license thi MOI cong cu no cung cap deu tu choi chay — git,
# /usr/bin/python3, make... voi thong bao "You have not agreed to the Xcode license".
# Script nay khong con can /usr/bin/python3 nua, nhung `git pull` sau nay se chet.
if [ -x /usr/bin/python3 ] && ! /usr/bin/python3 -c pass >/dev/null 2>&1; then
  warn "Xcode CLT chua accept license — git va /usr/bin/python3 se bao loi. Chay:
        sudo xcodebuild -license accept"
fi

# Alias 'gs' che ghostscript: shutil.which("gs") thay co, goi ra lai la git status.
# Script chay bang bash nen khong thay alias cua zsh — phai doc thang ~/.zshrc.
if [ -f "$HOME/.zshrc" ] && grep -qE '^[[:space:]]*alias[[:space:]]+gs=' "$HOME/.zshrc"; then
  warn "~/.zshrc co alias 'gs' — che ghostscript. Doi thanh 'gst', hoac luon goi /opt/homebrew/bin/gs"
fi

# ---------------------------------------------------------------- 1. proxy

step "1. Proxy socket (node)"
( cd "$PROXYDIR" && npm install --silent )
ok "npm install xong — $PROXYDIR"

# ---------------------------------------------------------------- 2. python

step "2. MCP server (python qua uv)"
# Ep Python 3.12. Tha cho uv tu chon la no lay ban moi nhat (3.14) — pillow 11.2.1 chua co
# wheel cho cp314 nen no bien dich tu source roi chet vi thieu header jpeg. `mcp/.python-version`
# lo cho moi lenh uv khac; con o day noi ro cho chac.
# `--clear` o duong du phong: lan sync that bai de lai .venv nua voi, uv venv se tu choi.
( cd "$MCPDIR" && "$UV" sync --quiet --python 3.12 ) \
  || ( cd "$MCPDIR" && "$UV" venv --clear --python 3.12 && "$UV" pip install -e . )

if [ -x "$VENV_PY" ] && "$VENV_PY" -c "import PIL, socketio, requests, numpy, mcp" 2>/dev/null; then
  ok "venv day du deps — $VENV_PY"
else
  ( cd "$MCPDIR" && $UV pip install -e . )
  "$VENV_PY" -c "import PIL, socketio, requests, numpy, mcp" \
    || die "venv thieu deps. Chay tay: cd $MCPDIR && uv venv --python 3.12 && uv pip install -e ."
  ok "venv day du deps — $VENV_PY"
fi

# `uv run mcp` can console script .venv/bin/mcp cua goi mcp[cli]. Thieu no thi uv bao
# "Failed to spawn: `mcp` / No such file or directory (os error 2)" — nhin nhu loi python
# nhung khong phai, va Claude Code chi hien "-32000: Connection closed".
if [ ! -x "$MCPDIR/.venv/bin/mcp" ]; then
  warn "thieu $MCPDIR/.venv/bin/mcp — dang cai lai mcp[cli]"
  ( cd "$MCPDIR" && "$UV" pip install --force-reinstall --quiet "mcp[cli]" ) || true
fi
if [ ! -x "$MCPDIR/.venv/bin/mcp" ]; then
  die "van thieu .venv/bin/mcp. Dung venv nay lam lai: rm -rf $MCPDIR/.venv && cd $MCPDIR && uv sync"
fi

# Thu CHAY thay vi doan shebang. Shebang co it nhat ba dang — duong dan python tuyet doi,
# `/usr/bin/env python3`, va wrapper `#!/bin/sh` ma uv sinh ra khi duong dan qua dai — nen
# doc shebang roi test -x cho ket qua sai o hai dang sau. Chay duoc hay khong moi la that.
# Ca gap hay nhat: DOI TEN hoac DI CHUYEN folder repo. Venv nuong duong dan tuyet doi vao
# shebang moi console script; doi cho la exec ENOENT, giong het nhu thieu file.
if ! "$MCPDIR/.venv/bin/mcp" --help >/dev/null 2>&1; then
  warn ".venv/bin/mcp co file nhung khong chay duoc (repo bi doi ten?). Dung venv lai"
  rm -rf "$MCPDIR/.venv"
  ( cd "$MCPDIR" && "$UV" sync --quiet )
  "$MCPDIR/.venv/bin/mcp" --help >/dev/null 2>&1 \
    || die "dung lai venv van khong chay duoc. Chay tay: cd $MCPDIR && uv sync"
fi
ok "mcp CLI chay duoc — $(head -1 "$MCPDIR/.venv/bin/mcp" | sed 's|^#!||' | awk '{print $1}')"

# Server phai khoi dong duoc trong stdio mode truoc khi dang ky.
if ( cd "$MCPDIR" && "$UV" run mcp run ps-mcp.py </dev/null >/dev/null 2>&1 ); then
  ok "ps-mcp.py khoi dong duoc"
else
  warn "ps-mcp.py khong khoi dong sach — xem loi that: cd $MCPDIR && uv run mcp run ps-mcp.py"
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
  echo "   Thoat han Claude Code roi mo lai — server chi duoc spawn luc khoi dong."
  echo "   (/mcp trong session chi xem duoc; 'reconnect all' khong phai lenh hop le)"
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
  # Dung python cua venv, KHONG dung /usr/bin/python3: cai do la stub cua Xcode Command
  # Line Tools. May chua accept license Xcode thi no tu choi chay va tra ma loi —
  # `set -e` giet ca script ngay giua buoc 5. Python cua uv khong lien quan Xcode.
  "$VENV_PY" - "$UDT_WS" "$REPO" <<'PY'
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

# ---------------------------------------------------------------- 6. skills

if [ "$LINK_SKILLS" = "1" ]; then
  step "6. Skills — symlink sang ~/.claude/skills"

  # .claude/skills/ bi gitignore — no chua du lieu san xuat cua khach hang va repo nay
  # PUBLIC. `git clone` khong keo skill ve; phai nhan file rieng roi bo vao day.
  # Skill dat trong repo cung chi duoc nap khi cwd nam trong repo, ma viec that chay o
  # folder job (Dropbox, Studio) — nen phai symlink sang ban user-scope.
  USER_SKILLS="$HOME/.claude/skills"
  SKILL_SRC="$REPO/.claude/skills"
  linked=0; kept=0; found=0

  mkdir -p "$USER_SKILLS"
  for src in "$SKILL_SRC"/*/; do
    [ -d "$src" ] || continue
    found=$((found+1))
    dst="$USER_SKILLS/$(basename "$src")"
    if [ -L "$dst" ]; then
      ln -sfn "${src%/}" "$dst"; linked=$((linked+1))
    elif [ -e "$dst" ]; then
      kept=$((kept+1))          # ban that cua nguoi dung — khong dung vao
    else
      ln -s "${src%/}" "$dst"; linked=$((linked+1))
    fi
  done

  if [ "$found" = "0" ]; then
    warn "khong co skill nao trong $SKILL_SRC — thu muc do bi gitignore nen clone khong keo ve"
    echo "        Xin file tu nguoi giu repo, giai nen vao do roi chay lai ./install.sh --skills."
    echo "        Hoac bo thang vao $USER_SKILLS, khi do khong can buoc nay."
  else
    ok "symlink $linked/$found skill"
    if [ "$kept" -gt 0 ]; then
      warn "$kept skill da ton tai that trong $USER_SKILLS — giu nguyen, khong ghi de. Muon dung ban repo thi xoa/doi ten ban cu roi chay lai"
    fi
  fi
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
