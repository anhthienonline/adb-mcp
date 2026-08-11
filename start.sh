#!/usr/bin/env bash
#
# adb-mcp — chay hang ngay.
#
#   ./start.sh           bat proxy o background, in checklist
#   ./start.sh --fg      bat proxy o foreground (Ctrl-C de dung)
#   ./start.sh --stop    tat proxy
#   ./start.sh --udt     mo luon UXP Developer Tools
#
# Proxy khong tu bat. Thieu no thi moi lenh Adobe timeout va bao
# "Could not connect to <app>" — giong het loi chua mo app.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXYDIR="$REPO/adb-proxy-socket"
LOG="$HOME/Library/Logs/adb-mcp-proxy.log"
PORT=3001

MODE=bg
OPEN_UDT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fg)   MODE=fg ;;
    --stop) MODE=stop ;;
    --udt)  OPEN_UDT=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Khong hieu tham so: $1"; exit 2 ;;
  esac
  shift
done

listening() { lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; }

if [ "$MODE" = "stop" ]; then
  if listening; then
    lsof -nP -iTCP:$PORT -sTCP:LISTEN -t | xargs kill
    echo "proxy da tat"
  else
    echo "proxy khong chay"
  fi
  exit 0
fi

if [ "$MODE" = "fg" ]; then
  listening && { echo "Port $PORT dang bi chiem — ./start.sh --stop truoc"; exit 1; }
  cd "$PROXYDIR" && exec node proxy.js
fi

if listening; then
  printf '\033[32mproxy\033[0m  da chay san tren localhost:%s\n' "$PORT"
else
  mkdir -p "$(dirname "$LOG")"
  ( cd "$PROXYDIR" && nohup node proxy.js >>"$LOG" 2>&1 & )
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    listening && break
    sleep 0.3
  done
  if listening; then
    printf '\033[32mproxy\033[0m  bat xong tren localhost:%s  (log: %s)\n' "$PORT" "$LOG"
  else
    printf '\033[31mproxy\033[0m  khong bat duoc. Xem %s\n' "$LOG"
    exit 1
  fi
fi

if [ "$OPEN_UDT" = "1" ]; then
  open -a "Adobe UXP Developer Tools" 2>/dev/null && echo "udt    da mo" || echo "udt    khong mo duoc"
fi

cat <<'EOF'

Con lai phai lam tay trong app (extension da cai != da ket noi):

  Photoshop      Plugins > Photoshop MCP Agent        -> Connect   (Load trong UDT truoc)
  InDesign       Plugins > InDesign MCP Agent         -> Connect   (Load trong UDT truoc)
  Premiere       Plugins > Premiere MCP Agent         -> Connect   (Load trong UDT truoc)
  After Effects  Window > Extensions > AfterEffects MCP Agent -> Connect
  Illustrator    Window > Extensions > Illustrator MCP Agent  -> Connect

Dong het document khong can thiet: mot dialog modal — hoac mot file co link anh
bi thieu — treo toan bo scripting o moi document dang mo.

Kiem xem app nao that su da noi:  ./doctor.sh
EOF
