# Quickstart — dựng lại trên máy khác

> Đây là **bản fork**. Toàn bộ phần lõi là của **Mike Chambers**
> ([mikechambers/adb-mcp](https://github.com/mikechambers/adb-mcp), giấy phép MIT).
> Fork này chỉ mang thêm vài bản vá lỗi cho luồng PSD → After Effects.
> Xem [README.md](README.md) để biết chính xác khác gì bản gốc.

Điều khiển Photoshop / Premiere / InDesign / After Effects / Illustrator bằng AI qua MCP.

```
AI (Claude Code hoặc Claude Desktop)
      ↓  MCP (stdio)
MCP server  —  Python, thư mục mcp/
      ↓  socket.io  ws://localhost:3001
Proxy server  —  Node, thư mục adb-proxy-socket/
      ↓  socket.io
Plugin trong app  —  UXP (PS/ID/PR)  hoặc  CEP (AE/AI)
      ↓
Adobe app
```

Proxy phải có mặt vì plugin UXP không được phép mở socket server, chỉ nối ra ngoài như client.

---

## 0. Cần sẵn trên máy

| | Bản đang chạy được | Ghi chú |
| --- | --- | --- |
| macOS | 15 (Darwin 25.6) | Windows có nhưng doc này viết cho Mac |
| Node | v20.20.2 | proxy cần ≥18 |
| uv | 0.12.0 | `brew install uv` |
| Python | 3.12 | uv tự lo, chỉ cần ≥3.10 |
| Adobe CC | PS 2026, AE 26.3 | AE cần ≥25.0 (CEP manifest ghi vậy) |
| UXP Developer Tools | bản mới nhất | tải từ Creative Cloud Desktop |

Kiểm nhanh:

```bash
node --version && uv --version && which uv
```

Nhớ đường dẫn `uv` in ra — lát nữa phải điền tuyệt đối vào config, Claude không đọc `PATH` của shell.

---

## 1. Lấy code

```bash
git clone https://github.com/mikechambers/adb-mcp.git
cd adb-mcp
git checkout local-fixes
```

> **Phải checkout `local-fixes`.** Nhánh `main` là bản upstream gốc và **thiếu** một loạt sửa lỗi
> mà workflow đang dựa vào. Thiếu một cách im lặng — mọi thứ trông vẫn như chạy được.

Kiểm nhanh là đúng nhánh:

```bash
git rev-parse --abbrev-ref HEAD          # local-fixes
grep -c "visible" mcp/ps-mcp.py          # > 0
```

### Nhánh đó sửa gì

Nếu mất, đây là những thứ sẽ hỏng:

| File | Sửa gì | Không có thì |
| --- | --- | --- |
| `uxp/ps/commands/utils.js` | bọc mọi lệnh trong `suspendHistory` | mỗi lệnh đẻ ra nhiều bước History, undo một phát không về được |
| `uxp/ps/commands/layers.js` | thêm `visible` vào `getLayers` | không đọc được layer nào đang bật/tắt — cả hai skill PSD→AE đều cần |
| " | rename giữ nguyên trạng thái ẩn/hiện | đổi tên một layer đang ẩn thì nó **tự bật lên** |
| " | `translateLayer` báo lỗi khi không dịch được | trong artboard nó **báo thành công mà không di chuyển gì** |
| " | bỏ `executeAsModal` lồng nhau ở `exportLayersAsPng` | khôi phục visibility luôn thất bại |
| `uxp/ps/commands/core.js` | `setActiveDocument` duyệt `app.documents` | gán nhầm object rỗng, đổi document không ăn |
| `mcp/ae-mcp.py` | thêm `get_project_info`, `get_compositions`, `get_layers` | AE chỉ còn đúng 1 tool `execute_extend_script` |
| `cep/com.mikechambers.ae/commands.js` | đăng ký 3 handler trên, bỏ bọc gói hai lần, `decodeURI` tên file | 3 tool trên gọi vào là lỗi; tên file hiện ra `%20` |
| `mcp/ps-mcp.py` | tả lại docstring `get_layers` | AI hiểu sai `visible` là đã tính cả nhóm cha |

### Khi đẩy thay đổi lên nhánh này

`.claude/settings.local.json` và `.claude/*.bak` đã được chặn trong `.gitignore` — chúng là danh
sách quyền của riêng từng máy, toàn đường dẫn tuyệt đối, đẩy lên repo công khai là vừa vô dụng vừa
lộ cấu trúc thư mục cá nhân.

Đẩy lên `mikechambers/adb-mcp` cần quyền ghi vào repo đó. Nếu `git push` bị từ chối thì fork về
tài khoản mình rồi trỏ lại:

```bash
git remote set-url origin https://github.com/<tai-khoan>/adb-mcp.git
git push -u origin local-fixes
```

---

## 2. Proxy server (Node)

```bash
cd <repo>/adb-proxy-socket
npm install
```

---

## 3. MCP server (Python)

```bash
cd <repo>/mcp
uv sync
```

Thử một phát cho chắc:

```bash
uv run mcp run ps-mcp.py < /dev/null
```

Ra `Adobe Photoshop MCP Server running on stdio` là được.

> Đừng dùng `mcp install` hay `uv run --with ...` — chúng kéo về `mcp` 2.x và server sẽ chết với
> `No module named 'mcp.server.fastmcp'`.

---

## 4. Đăng ký MCP server

### Claude Code

Bốn lệnh, scope `user` để dùng được ở mọi thư mục:

```bash
REPO=<duong dan tuyet doi toi repo>
UV=$(which uv)

claude mcp add -s user photoshop    -- "$UV" run --directory "$REPO/mcp" mcp run ps-mcp.py
claude mcp add -s user premiere     -- "$UV" run --directory "$REPO/mcp" mcp run pr-mcp.py
claude mcp add -s user aftereffects -- "$UV" run --directory "$REPO/mcp" mcp run ae-mcp.py
claude mcp add -s user illustrator  -- "$UV" run --directory "$REPO/mcp" mcp run ai-mcp.py
```

Dấu `--` phải nằm **ngay sau tên server**; mọi thứ phía sau là lệnh và tham số. Đặt sai chỗ thì
`uv` bị coi là tham số chứ không phải lệnh. Kiểm bằng `claude mcp get photoshop` — phải thấy
`Command: …/uv` và `Args: run --directory …`.

Thêm InDesign nếu cần: `id-mcp.py`.

Kiểm tra:

```bash
claude mcp list
```

Bốn dòng phải ra `✔ Connected`. Đây chỉ nghĩa là server Python chạy được — **chưa** nói gì về việc
app Adobe đã nối hay chưa.

### Claude Desktop

*Settings > Developer > Edit Config*, đường dẫn phải tuyệt đối:

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "ps-mcp.py"]
    },
    "aftereffects": {
      "command": "/opt/homebrew/bin/uv",
      "args": ["run", "--directory", "<REPO>/mcp", "mcp", "run", "ae-mcp.py"]
    }
  }
}
```

Config chỉ nạp lúc khởi động — sửa xong phải restart Claude Desktop.

---

## 5. Plugin UXP — Photoshop, InDesign, Premiere

1. Trong Photoshop: *Settings > Plugins* → bật **Enable Developer Mode** → restart Photoshop.
   Premiere cũng có mục tương tự.
2. Mở **UXP Developer Tools** → *File > Add Plugin* → chọn:
   - `<repo>/uxp/ps/manifest.json`
   - `<repo>/uxp/id/manifest.json`
   - `<repo>/uxp/pr/manifest.json`
3. Bấm **Load** cạnh từng plugin.

> Phải bấm **Load** lại **mỗi lần khởi động lại app**. Đây là chỗ hay quên nhất.

---

## 6. Extension CEP — After Effects, Illustrator

CEP khó hơn UXP vì extension chưa ký, phải bật debug mode thủ công.

**a. Bật PlayerDebugMode** (README gốc không nhắc, thiếu là extension không hiện trong menu):

```bash
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
killall cfprefsd
```

**b. Tạo symlink:**

```bash
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
cd ~/Library/Application\ Support/Adobe/CEP/extensions
ln -s <repo>/cep/com.mikechambers.ae com.mikechambers.ae
ln -s <repo>/cep/com.mikechambers.ai com.mikechambers.ai
```

**c.** Khởi động lại AE / Illustrator, mở panel ở *Window > Extensions*.

---

## 7. Skills (nếu cần workflow PSD → AE)

Skill nằm **ngoài repo**, ở `~/.claude/skills/`. Chép cả thư mục sang máy mới:

```
psd-to-ae-animate     dựng animation mới từ artboard PSD
psd-to-ae-size-port   port comp AE đã xong sang size khác
psd-naming-linter     dọn tên layer trong PSD
```

Hai skill đầu cần Python có **PIL** để đo pixel và so ảnh:

```bash
python3 -c "import PIL; print(PIL.__version__)"
```

**Font phải cài trên máy mới, và AE phải nhận diện được.** AE thay font thiếu mà không báo gì —
bước kiểm pixel ở Phase 2 chính là chỗ bắt được lỗi đó, nhưng chỉ khi bạn không bỏ qua nó.

`.claude/settings.local.json` trong repo là danh sách quyền của **riêng máy này**, toàn đường dẫn
tuyệt đối. Chép sang máy khác phải sửa lại hết đường dẫn, hoặc bỏ qua và để nó tự sinh dần.

---

## Mỗi lần dùng — 4 bước

**1. Chạy proxy, để terminal mở nguyên:**

```bash
cd <repo>/adb-proxy-socket && node proxy.js
```

Đợi dòng: `adb-mcp Command proxy server running on ws://localhost:3001`

**2. Mở app Adobe.** Với PS/ID/PR: mở UXP Developer Tools, bấm **Load**.

**3. Bấm Connect trong panel của app:**

| App | Vào đâu |
| --- | --- |
| Photoshop | *Plugins > Photoshop MCP Agent* |
| InDesign | *Plugins > InDesign MCP Agent* |
| Premiere | *Plugins > Premiere MCP Agent* |
| After Effects | *Window > Extensions > AfterEffects MCP Agent* |
| Illustrator | *Window > Extensions > Illustrator MCP Agent* |

Terminal proxy phải hiện:

```
User connected: Ud6L4CjMWGAeofYAAAAB
Client Ud6L4CjMWGAeofYAAAAB registered for application: photoshop
```

Nút vẫn ghi "Connect" nghĩa là chưa nối được — quay lại bước 1.

**4. Nạp instructions.** Claude Desktop: bấm **+** trong khung chat → *Add from Adobe Photoshop* →
`config://get_instructions`. Claude Code: gọi thẳng tool là được.

---

## Kiểm tra toàn tuyến

Chạy được đến cuối là mọi mắt xích đều thông:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN     # proxy dang nghe
claude mcp list                       # 4 dong Connected
```

Rồi bảo Claude gọi `get_document_info` (Photoshop) hoặc `get_project_info` (AE). Ra dữ liệu thật
là xong.

---

## Khi lỗi

| Triệu chứng | Xử lý |
| --- | --- |
| `error: Failed to spawn: mcp` | Đang đứng ở repo root — `cd mcp` trước |
| `No module named 'mcp.server.fastmcp'` | Config còn dùng `--with` — đổi sang `--directory` |
| `No module named 'pydantic_core._pydantic_core'` | `cd mcp && uv sync --reinstall` |
| Claude báo **Server disconnected** | `tail -30 ~/Library/Logs/Claude/mcp-server-*.log` |
| Claude không thấy tool nào | Restart Claude Desktop — config chỉ nạp lúc khởi động |
| Nút Connect không đổi trạng thái | Proxy chưa chạy, hoặc bấm **Debug** trong UXP Developer Tools xem lỗi |
| Panel CEP không hiện trong *Window > Extensions* | Chưa bật PlayerDebugMode, hoặc symlink sai — kiểm bằng `ls -la ~/Library/Application\ Support/Adobe/CEP/extensions` |
| AE có mỗi 1 tool `execute_extend_script` | Chưa áp patch — xem mục 1 |
| `get_layers` không có trường `visible` | Chưa áp patch, hoặc quên bấm **Load** lại sau khi sửa plugin |
| Lệnh chạy xong mà **AE đứng im, không phản hồi** | AE đang kẹt hộp thoại. Nhìn cửa sổ AE, tắt hộp thoại đi. Photoshop trả lời mà AE thì không = kẹt dialog, không phải mất kết nối |
| Đổi tên layer xong nó **tự bật hiện** | Chưa áp patch `layers.js` |
| `translate_layer` báo OK mà layer không nhúc nhích | Layer nằm trong artboard — Photoshop tự nest lại và triệt tiêu offset. Có patch thì nó báo lỗi thay vì im lặng |

## Sau khi sửa code thì phải nạp lại thế nào

| Sửa ở đâu | Cần làm gì |
| --- | --- |
| `mcp/*.py` | restart Claude (Code hoặc Desktop) |
| `uxp/**` | bấm **Reload** trong UXP Developer Tools |
| `cep/**` | đóng panel rồi mở lại từ *Window > Extensions* |
| `adb-proxy-socket/proxy.js` | Ctrl-C rồi `node proxy.js` lại, sau đó **Connect lại từ mọi app** |
