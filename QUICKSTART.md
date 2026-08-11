# Cài đặt

> Bản fork của [mikechambers/adb-mcp](https://github.com/mikechambers/adb-mcp) (Mike Chambers, MIT).
> Xem [README.md](README.md).

Điều khiển Photoshop / Premiere / InDesign / After Effects / Illustrator bằng AI qua MCP.
Dùng được với **Claude Code**, **Claude Desktop**, hoặc cả hai cùng lúc.

---

## Đường ngắn — 1 lệnh

```bash
git clone https://github.com/anhthienonline/adb-mcp.git && cd adb-mcp && git checkout local-fixes && ./install.sh
```

`install.sh` làm gọn các bước 2–6 bên dưới: `npm install` proxy, `uv sync` venv Python,
đăng ký 5 MCP server với Claude Code, bật `PlayerDebugMode` + symlink 2 extension CEP,
và **add sẵn 3 plugin UXP vào UXP Developer Tools** (ghi thẳng
`plugins_workspace.json`, giữ nguyên plugin cũ). Chạy lại bao nhiêu lần cũng được.

```bash
./install.sh --with-brew    # cài luôn imagemagick / poppler / ghostscript / ffmpeg / uv …
./install.sh --help         # các cờ khác: --skip-cep --skip-uxp --skip-mcp --scope local
```

Hai việc **không** tự động được, phải làm tay một lần: bật *Enable Developer Mode*
trong Settings > Plugins của từng app UXP, và bấm **Load** trong UDT.

```bash
./start.sh     # mỗi lần dùng: bật proxy + in checklist Connect
./doctor.sh    # kiểm cả 3 lớp, xem app nào thật sự đã nối
```

Phần còn lại của tài liệu là bản làm tay từng bước — đọc khi `doctor.sh` báo lỗi.

---

## 0. Cần sẵn

| | Bản đang chạy được |
| --- | --- |
| macOS | 15 (Darwin 25.6) |
| Node | v20.20.2 (≥18) |
| uv | 0.12.0 — `brew install uv` |
| Python | 3.12 (≥3.10) |
| Adobe CC | PS 2026, AE 26.3 (≥25.0) |
| UXP Developer Tools | tải từ Creative Cloud Desktop |

```bash
node --version && uv --version && which uv
```

Ghi lại đường dẫn `uv` — bước 4 cần điền tuyệt đối.

---

## 1. Clone

```bash
git clone https://github.com/anhthienonline/adb-mcp.git
cd adb-mcp
git checkout local-fixes
```

```bash
git rev-parse --abbrev-ref HEAD          # local-fixes
```

---

## 2. Proxy server

```bash
cd <repo>/adb-proxy-socket
npm install
```

---

## 3. MCP server

```bash
cd <repo>/mcp
uv sync
uv run mcp run ps-mcp.py < /dev/null     # ra "running on stdio" la duoc
```

---

## 4A. Claude Code

```bash
REPO=<duong dan tuyet doi toi repo>
UV=$(which uv)

claude mcp add -s user photoshop    -- "$UV" run --directory "$REPO/mcp" mcp run ps-mcp.py
claude mcp add -s user premiere     -- "$UV" run --directory "$REPO/mcp" mcp run pr-mcp.py
claude mcp add -s user aftereffects -- "$UV" run --directory "$REPO/mcp" mcp run ae-mcp.py
claude mcp add -s user illustrator  -- "$UV" run --directory "$REPO/mcp" mcp run ai-mcp.py
claude mcp add -s user indesign     -- "$UV" run --directory "$REPO/mcp" mcp run id-mcp.py
```

`--` phải nằm ngay sau tên server. Kiểm bằng `claude mcp get photoshop`: phải ra
`Command: …/uv` và `Args: run --directory …`.

### Check

```bash
claude mcp list
```

Năm dòng Adobe phải ra `✔ Connected`.

Trong Claude Code gõ `/mcp` — phải thấy năm server kèm số tool:

```
aftereffects  ✔ connected   4 tools
illustrator   ✔ connected   5 tools
photoshop     ✔ connected  62 tools
premiere      ✔ connected  26 tools
indesign      ✔ connected   1 tool
```

Số tool cũng là cách kiểm nhánh: **AE phải có 4 tool**. Nếu chỉ có 1 (`execute_extend_script`)
là đang đứng ở nhánh `main`, quay lại bước 1.

Vừa đăng ký xong mà `/mcp` chưa thấy thì gõ `/mcp reconnect all`, hoặc khởi động lại Claude Code.

---

## 4B. Claude Desktop

*Settings > Developer > Edit Config*, hoặc sửa thẳng
`~/Library/Application Support/Claude/claude_desktop_config.json`.
Đường dẫn phải **tuyệt đối** — Claude Desktop không đọc `PATH` của shell:

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "ps-mcp.py"]
    },
    "premiere": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "pr-mcp.py"]
    },
    "aftereffects": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "ae-mcp.py"]
    },
    "illustrator": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "ai-mcp.py"]
    },
    "indesign": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "id-mcp.py"]
    }
  }
}
```

**Restart Claude Desktop** — config chỉ nạp lúc khởi động.

### Check

Bấm biểu tượng công cụ dưới khung chat: phải liệt kê năm server và tool của từng cái.
Hoặc *Settings > Developer* — mỗi server một dòng kèm trạng thái.

Không thấy gì thì xem log:

```bash
tail -30 ~/Library/Logs/Claude/mcp-server-photoshop.log
```

---

## 5. Plugin UXP — Photoshop, InDesign, Premiere

1. Trong app: *Settings > Plugins* → bật **Enable Developer Mode** → restart app.
2. **UXP Developer Tools** → *File > Add Plugin* → chọn:
   - `<repo>/uxp/ps/manifest.json`
   - `<repo>/uxp/id/manifest.json`
   - `<repo>/uxp/pr/manifest.json`
3. Bấm **Load** cạnh từng plugin.

---

## 6. Extension CEP — After Effects, Illustrator

```bash
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
killall cfprefsd
```

```bash
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
cd ~/Library/Application\ Support/Adobe/CEP/extensions
ln -s <repo>/cep/com.mikechambers.ae com.mikechambers.ae
ln -s <repo>/cep/com.mikechambers.ai com.mikechambers.ai
```

Restart AE / Illustrator.

---

## 7. Skills

**Không có trong repo** — repo này public, mà skill chứa cây layer, mã job và convention đặt
tên của khách hàng. Xin file từ người giữ repo rồi chép vào `~/.claude/skills/`:

```
illustrator-to-ae-motion     print-ad-from-brief        ← cần proxy + app Adobe mở
indesign-to-ae-motion        psd-artboard-clone
psd-to-ae-animate            psd-naming-linter
psd-to-ae-size-port

html-banner-task-brief       pdf-icons-to-svg           ← chạy độc lập
static-banner-task-brief
```

Đặt trong `<repo>/.claude/skills/` cũng được, nhưng khi đó chúng chỉ nạp lúc cwd nằm trong
repo — chạy `./install.sh --skills` để symlink sang `~/.claude/skills`.

```bash
python3 -c "import PIL; print(PIL.__version__)"
```

Cài font mà thiết kế dùng, cho cả Photoshop lẫn After Effects.

---

## Mỗi lần dùng

**1.** Chạy proxy, để terminal mở nguyên:

```bash
cd <repo>/adb-proxy-socket && node proxy.js
```

**2.** Mở app Adobe. Với PS / ID / PR: mở UXP Developer Tools, bấm **Load**.

**3.** Bấm **Connect** trong panel:

| App | Vào đâu |
| --- | --- |
| Photoshop | *Plugins > Photoshop MCP Agent* |
| InDesign | *Plugins > InDesign MCP Agent* |
| Premiere | *Plugins > Premiere MCP Agent* |
| After Effects | *Window > Extensions > AfterEffects MCP Agent* |
| Illustrator | *Window > Extensions > Illustrator MCP Agent* |

**4.** Claude Desktop: bấm **+** → *Add from Adobe Photoshop* → `config://get_instructions`.
Claude Code: gọi thẳng tool.

---

## Kiểm tra toàn tuyến

Ba lớp độc lập nhau. Lớp 1 và 2 đạt **không** có nghĩa là app Adobe đã nối.

### Lớp 1 — server Python chạy được

```bash
claude mcp list                                    # Claude Code
tail -30 ~/Library/Logs/Claude/mcp-server-*.log    # Claude Desktop
```

Chỉ chứng minh `uv run … ps-mcp.py` khởi động không lỗi. Vẫn báo Connected kể cả khi chưa mở
app Adobe nào, thậm chí khi proxy chưa chạy.

### Lớp 2 — client thấy tool

`/mcp` trong Claude Code, hoặc biểu tượng công cụ trong Claude Desktop.
Cho biết đã đăng ký đủ server chưa và đúng nhánh chưa (AE = 4 tool).

### Lớp 3 — app Adobe thật sự nối

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN     # proxy dang nghe
```

```bash
cd <repo>/mcp && uv run python - <<'EOF'
import socket_client
from socket_client import AppError
for app in ("photoshop", "aftereffects", "illustrator", "indesign", "premiere"):
    socket_client.configure(app=app, url="http://localhost:3001", timeout=6)
    try:
        socket_client.send_message_blocking(
            {"application": app, "action": "__probe__", "options": {}}, timeout=6)
        ok = True
    except AppError:
        ok = True          # plugin tra loi "unknown command" -> dang song
    except Exception:
        ok = False
    print(f"  {app:14} {'OK' if ok else 'chua noi'}")
EOF
```

### Đối chiếu

| Lớp 1 | Lớp 2 | Lớp 3 | Xử lý |
| --- | --- | --- | --- |
| Failed | — | — | Sai đường dẫn `uv`, hoặc chưa `uv sync` |
| OK | thiếu server | — | Chưa `claude mcp add` server đó, hoặc chưa restart Claude Desktop |
| OK | AE chỉ 1 tool | — | Đang ở nhánh `main` — `git checkout local-fixes` |
| OK | OK | `chua noi` | Proxy chưa chạy, app chưa mở, hoặc chưa bấm **Connect** |
| OK | OK | OK | Xong |
