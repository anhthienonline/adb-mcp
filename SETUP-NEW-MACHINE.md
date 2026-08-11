# Setup máy mới — Adobe MCP + skills

Dựng lại toàn bộ stack automation Adobe (Illustrator / Photoshop / After Effects / InDesign /
Premiere điều khiển từ Claude Code) trên một máy macOS trắng.

Cấu hình tham chiếu là máy đang chạy được: **macOS 26.6, Apple Silicon, Homebrew ở
`/opt/homebrew`, Node 20.20.2, Python 3.12 do `uv` quản lý.**

Thứ tự trong tài liệu này là thứ tự phụ thuộc thật — làm nhảy bước sẽ hỏng.

> **Stage C và Stage D đã được đóng gói thành `./install.sh`** trong repo. Sau khi xong
> Stage 0 / A / B (những thứ cần tài khoản, GUI, hoặc Creative Cloud), chạy:
>
> ```bash
> ./install.sh --with-brew     # proxy + venv + 5 MCP server + CEP symlink + UXP workspace
> ./doctor.sh                  # kiểm cả 3 lớp
> ```
>
> Còn lại vẫn phải làm tay: bật Developer Mode trong từng app UXP, bấm **Load** trong UDT,
> bấm **Connect** trong panel, restore `~/.claude/skills`, authorize connector claude.ai.
> Phần Stage C/D bên dưới giữ lại để debug khi `doctor.sh` báo lỗi.

---

## Stage 0 — Chuẩn bị TRƯỚC khi có máy mới

Bốn thứ này không cài được bằng lệnh, phải có sẵn tài khoản/file. Đây là phần hay bị kẹt nhất.

| Cần | Vì sao | Kiểm tra
| --- | --- | ---
| **Adobe Creative Cloud** đăng nhập được, có Illustrator / Photoshop / AE / InDesign / Premiere | Không có app thì cả stack vô nghĩa | thấy app trong CC Desktop
| **Adobe Fonts đã activate Poppins** | Poppins trên máy cũ đến từ Adobe Fonts (`/Library/Fonts/Managed/`), **không phải file cài tay**. Preset `print-ad-from-brief` refuse build nếu thiếu font | `fonts.adobe.com` → Poppins → Active
| **SSH key + `~/.ssh/config`** cho GitHub | Remote của repo dùng **host alias**, không phải `github.com` trực tiếp: `git@gh-anhthienonline:anhthienonline/adb-mcp.git`. Không có alias thì `git clone` fail dù key đúng | `ssh -T gh-anhthienonline`
| **Backup `~/.claude/skills` + `~/.claude/commands`** | 10 skill + 4 command là công sức tự viết, không tải lại được từ đâu. **`git clone` không kéo skill về** — repo này public nên `.claude/skills/` bị gitignore, vì skill chứa cây layer, mã job và convention đặt tên của khách hàng | copy sang Dropbox/USB trước khi trả máy cũ

Nên copy luôn khối `mcpServers` trong `~/.claude.json` của máy cũ để đối chiếu ở Stage D.

`~/.ssh/config` cần đúng dạng này:

```
Host gh-anhthienonline
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_anhthienonline
  IdentitiesOnly yes
```

---

## Stage A — Nền máy

### A1. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/brew/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### A2. CLI tools

```bash
brew install imagemagick librsvg poppler ghostscript ffmpeg exiftool webp uv
```

| Formula | Skill nào cần | Thiếu thì sao
| --- | --- | ---
| `imagemagick` | gần như tất cả — cutout ảnh, montage, đọc webp/avif | hỏng nặng nhất
| `poppler` | `pdf-icons-to-svg` (`pdftocairo`) | skill chết; Claude Code cũng **không render được PDF**
| `ghostscript` | `pdf-icons-to-svg` (`gs` crop từng icon ở tầng PDF) | skill `sys.exit`
| `librsvg` | `pdf-icons-to-svg` (`rsvg-convert` render verify) | không verify được SVG
| `ffmpeg`, `exiftool`, `webp` | các skill motion + đọc metadata ảnh | lỗi lẻ
| `uv` | quản lý Python cho MCP server | Stage C không chạy

`sips`, `qlmanage`, `screencapture`, `osascript` là built-in macOS, không cần cài.

### A3. Bỏ alias `gs` — bắt buộc

Trên máy cũ `~/.zshrc` có `alias gs="git status"`. Alias này **che ghostscript**: script check
`shutil.which("gs")` vẫn thấy có, nhưng gọi ra lại là `git status`.

Chọn một trong hai:

```bash
# đổi alias
alias gst="git status"
# hoặc để nguyên alias và luôn gọi ghostscript bằng đường dẫn đầy đủ
/opt/homebrew/bin/gs
```

### A4. Node ≥ 18

Proxy build target là node18; máy tham chiếu chạy 20.20.2 qua `fnm`.

```bash
brew install fnm
fnm install 20 && fnm use 20
node -v      # v20.x
```

---

## Stage B — Phía Adobe

### B1. Cài app từ Creative Cloud

Illustrator, Photoshop, After Effects, InDesign, Premiere Pro. Bản 2025 hoặc 2026 đều được
(máy tham chiếu: Illustrator 30.7.0 = 2026).

### B2. Bật PlayerDebugMode

Bắt buộc, vì CEP extension chưa được Adobe sign.

```bash
for k in 9 10 11 12 13; do
  defaults write com.adobe.CSXS.$k PlayerDebugMode 1
done
```

Quit hẳn app Adobe rồi mở lại sau khi chạy.

### B3. Adobe Fonts

Đăng nhập CC → `fonts.adobe.com` → activate **Poppins** (ExtraBold, SemiBold, Medium, Regular).
`AvenirNextCondensed-Bold` có sẵn trong macOS, không cần làm gì.

---

## Stage C — Cái bridge

### C1. Clone repo, checkout branch đúng

```bash
mkdir -p ~/Projects/Tool-FE-Helper/mcp-adb
cd ~/Projects/Tool-FE-Helper/mcp-adb
git clone git@gh-anhthienonline:anhthienonline/adb-mcp.git
cd adb-mcp
git checkout local-fixes
```

> **`local-fixes` không phải nhánh phụ — nó là nhánh bắt buộc.** Bản upstream có 3 chỗ hỏng đã
> sửa trên nhánh này: extension Illustrator không trả structured data (mọi kết quả thành
> `"[object Object]"`), Premiere crash với WebSocket, và tool AE nối sai. Chạy `main` là mất
> phần lớn khả năng của các skill Illustrator.

Giữ đúng đường dẫn `~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp` — nó bị hard-code trong
`bridge.py` của skill và trong lệnh đăng ký MCP. Đặt chỗ khác thì phải sửa cả hai
(hoặc export `ADB_MCP_DIR`).

### C2. Python env

`pyproject.toml` yêu cầu Python ≥ 3.10. **Python hệ thống của macOS là 3.9.6 → quá cũ**, và
cũng không có `socketio`. Để `uv` tự kéo CPython 3.12:

```bash
cd ~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/mcp
uv venv --python 3.12
uv pip install -e .
```

Cài xong sẽ có: `fonttools`, `python-socketio`, `mcp[cli]`, `requests`, `websocket-client`,
`pillow`, `numpy`.

Verify:

```bash
.venv/bin/python3 -c "import PIL, socketio, requests, numpy, mcp; print('deps ok')"
```

> ⚠️ Mọi script skill nói chuyện với Adobe **phải** chạy bằng interpreter này:
> `~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/mcp/.venv/bin/python3`
> Dùng `/usr/bin/python3` sẽ fail ngay ở `import socket_client` vì thiếu `socketio`.

### C3. Proxy socket

```bash
cd ../adb-proxy-socket
npm install
node proxy.js          # lắng nghe localhost:3001
```

Proxy **không tự bật**. Không có nó thì mọi lệnh Adobe timeout và báo
"Could not connect to <app>". Nên để chạy trong một tab terminal riêng, hoặc dựng LaunchAgent.

Kiểm tra: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001` → trả `404` là
**server sống** (không có route `/`, nên 404 là đúng).

### C4. CEP extensions — symlink, đừng copy

Illustrator và After Effects dùng CEP. **Symlink** để mọi lần `git pull` là extension cập nhật
theo, không phải copy lại:

```bash
CEP=~/Library/Application\ Support/Adobe/CEP/extensions
REPO=~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/cep
mkdir -p "$CEP"
ln -s "$REPO/com.mikechambers.ai" "$CEP/com.mikechambers.ai"
ln -s "$REPO/com.mikechambers.ae" "$CEP/com.mikechambers.ae"
```

### C5. UXP plugins

Photoshop, InDesign và Premiere dùng UXP, không phải CEP. Cài qua **UXP Developer Tool**
(có trong Creative Cloud Desktop → Work → UXP Developer Tool):

| Plugin | Thư mục | Host
| --- | --- | ---
| Photoshop MCP Agent | `uxp/ps/manifest.json` | PS
| InDesign MCP Agent | `uxp/id/manifest.json` | ID
| Premiere MCP Agent | `uxp/pr/manifest.json` | premierepro

Trong UDT: **Add Plugin** → chọn `manifest.json` → **Load**. Premiere còn cần bật Developer Mode
trong app (xem `README.md` của repo).

---

## Stage D — Phía Claude Code

### D1. Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### D2. Đăng ký 5 MCP server

Cả 5 dùng `uv run` trỏ vào thư mục `mcp` — không cần activate venv:

```bash
MCPDIR=~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/mcp
UV=$(command -v uv)

claude mcp add --scope user photoshop    -- "$UV" run --directory "$MCPDIR" mcp run ps-mcp.py
claude mcp add --scope user illustrator  -- "$UV" run --directory "$MCPDIR" mcp run ai-mcp.py
claude mcp add --scope user aftereffects -- "$UV" run --directory "$MCPDIR" mcp run ae-mcp.py
claude mcp add --scope user indesign     -- "$UV" run --directory "$MCPDIR" mcp run id-mcp.py
claude mcp add --scope user premiere     -- "$UV" run --directory "$MCPDIR" mcp run pr-mcp.py
```

Kiểm tra bằng `claude mcp list`, hoặc `/mcp` trong session.

### D3. Restore skills + commands

Cả hai đều **không** có trong repo — repo public, mà skill chứa dữ liệu khách hàng. Phải
nhận file riêng (Dropbox/USB/zip từ người giữ repo):

```bash
mkdir -p ~/.claude
cp -R <backup>/skills   ~/.claude/skills
cp -R <backup>/commands ~/.claude/commands
ls ~/.claude/skills | wc -l    # 10
```

Xoá `__pycache__` nếu có mang theo: `find ~/.claude/skills -name __pycache__ -exec rm -rf {} +`

Nếu thay vì vậy bạn đặt skill vào `<repo>/.claude/skills/` (để version bằng git riêng, hoặc
để sửa cùng repo), thì nhớ skill trong project **chỉ nạp khi cwd nằm trong repo adb-mcp** —
mà việc thật chạy ở folder job. Bắc sang user-scope bằng:

```bash
./install.sh --skills          # symlink từng skill sang ~/.claude/skills
```

Symlink chứ không copy, nên sửa trong repo là bản đang dùng đổi theo. Skill nào đã tồn tại
thật ở `~/.claude/skills` thì script bỏ qua, không ghi đè.

Cả hai đường đều cần: 10 skill (7 cần proxy Adobe, 3 chạy độc lập) và 4 command
(`fb-post`, `gen-commit`, `review-change`, `review-pr`).

### D4. Connector claude.ai (Asana, Figma, Atlassian…)

Đây là OAuth, không cài bằng lệnh được: vào **Settings → Connectors** trên claude.ai và
authorize từng cái. Skill `print-ad-from-brief` và 2 skill `*-task-brief` đọc task Asana qua
connector này — thiếu nó thì phải paste brief tay (vẫn chạy được).

---

## Verify — chạy một lượt

```bash
# 1. binaries
for b in magick rsvg-convert pdftocairo ffmpeg exiftool node uv; do
  printf '%-14s %s\n' "$b" "$(command -v $b || echo MISSING)"
done
/opt/homebrew/bin/gs --version      # gọi full path, tránh alias

# 2. python deps
~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/mcp/.venv/bin/python3 \
  -c "import PIL, socketio, requests, numpy, mcp; print('python ok')"

# 3. proxy
curl -s -o /dev/null -w 'proxy: %{http_code}\n' http://localhost:3001   # 404 = ok

# 4. CEP symlinks
ls -l ~/Library/Application\ Support/Adobe/CEP/extensions/ | grep mikechambers

# 5. bridge tới Illustrator (mở Illustrator, panel MCP, bấm Connect trước)
~/Projects/Tool-FE-Helper/mcp-adb/adb-mcp/mcp/.venv/bin/python3 \
  ~/.claude/skills/print-ad-from-brief/scripts/bridge.py
```

Bước 5 in ra `illustrator: connected` và `{"docs": N, "version": "30.x"}` là toàn bộ chain
đã thông.

---

## Ba thứ không phải lỗi cài đặt nhưng làm chết script

Đây là ba nguyên nhân thực tế hay bị nhầm thành "cài sai".

1. **Proxy chưa chạy.** Báo lỗi giống hệt như app chưa mở. Check `curl localhost:3001` trước
   khi debug bất cứ thứ gì khác.
2. **Chưa bấm Connect trong app.** Extension đã cài ≠ đã kết nối. Mỗi app phải mở panel MCP
   (*Window → Extensions* với CEP, *Plugins* với UXP) và bấm **Connect**. Sau khi sửa code
   extension thì phải đóng panel, mở lại, bấm Connect lần nữa.
3. **Có dialog modal đang mở ở BẤT KỲ document nào.** Dialog treo toàn bộ scripting và báo lỗi
   trông y như mất kết nối. Nguy hiểm nhất: một file mở sẵn có link ảnh bị thiếu — vì lúc place
   ảnh Illustrator validate lại link của *mọi* document đang mở, nên một file không liên quan
   cũng làm chết build đang chạy. Đóng hết document không cần thiết trước khi chạy skill.

---

## Tóm tắt cài gì

```bash
# Homebrew
brew install imagemagick librsvg poppler ghostscript ffmpeg exiftool webp uv fnm

# Node
fnm install 20 && fnm use 20
npm install -g @anthropic-ai/claude-code

# Python (trong adb-mcp/mcp)
uv venv --python 3.12 && uv pip install -e .

# Node proxy (trong adb-mcp/adb-proxy-socket)
npm install
```

Ngoài ra: Creative Cloud + 5 app + Adobe Fonts (Poppins), PlayerDebugMode, symlink CEP,
UXP plugin qua UDT, 5 MCP server, restore `~/.claude/skills`.
