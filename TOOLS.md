# Làm được gì với MCP

Mô tả theo **công việc**, không theo tên hàm. Danh sách tên hàm đầy đủ nằm trong `mcp/*-mcp.py`.

| App | Năng lực trần | Vì sao |
| --- | --- | --- |
| [Photoshop](#photoshop) | Rất rộng | 62 tool sẵn, phủ hầu hết thao tác thường ngày |
| [After Effects](#after-effects) | **Không giới hạn** | 4 tool, nhưng một trong đó chạy ExtendScript bất kỳ |
| [Illustrator](#illustrator) | **Không giới hạn** | 5 tool, cũng có ExtendScript |
| [Premiere Pro](#premiere-pro) | **Có trần rõ ràng** | 26 tool, hết là hết — không có cửa thoát |
| [InDesign](#indesign) | Gần như không | 1 tool |

Số tool đo **độ tiện**, không đo **năng lực**. After Effects có 4 tool mà làm được mọi thứ;
Premiere có 26 mà đụng trần rất nhanh.

---

## Photoshop

### Đọc và hiểu file

Lấy được cây layer lồng cấp đầy đủ: tên, kiểu, ID, **đang bật hay tắt**, opacity, blend mode, và
với layer chữ thì có cả nội dung, font, cỡ chữ. Đọc được toạ độ pixel của từng layer.

Quan trọng hơn cả: AI **nhìn thấy ảnh thật** của layer hoặc cả document, không chỉ đọc toạ độ.
Nhờ vậy mới làm được những việc như "xem artboard rồi đề xuất animation" hay "so bản render với
thiết kế gốc xem lệch chỗ nào".

### Dọn dẹp file hàng loạt

Đổi tên nhiều layer một lượt, gom vào group, bật tắt, xoá, sắp lại thứ tự trong stack, gộp phẳng
toàn bộ. Đây là việc MCP làm nhanh hơn người rất nhiều — đổi tên 200 layer theo quy tắc là chuyện
vài giây.

### Dựng và sửa layout

Tạo layer chữ một dòng hoặc nhiều dòng, sửa nội dung chữ có sẵn, đặt file ảnh vào layer, tạo layer
pixel rỗng, dán từ clipboard. Dịch chuyển, phóng to thu nhỏ, xoay, lật, căn theo vùng chọn.

### Cắt ghép ảnh

Chọn hình chữ nhật, elip, đa giác. **Tự động chọn chủ thể** và **tự động chọn bầu trời**. Đảo vùng
chọn, tô màu, xoá pixel, copy / cut / paste — copy được cả bản gộp mọi layer đang hiện. Tạo layer
mask từ vùng chọn.

### Chỉnh màu và hiệu ứng

Adjustment layer: sáng/tương phản, cân bằng màu, vibrance, đen trắng. Layer style: đổ bóng, viền,
gradient. Filter: Gaussian Blur và Motion Blur.

### AI Firefly

Sinh ảnh mới vào layer, Generative Fill trong vùng chọn, tự tách nền giữ chủ thể, và harmonize —
khớp ánh sáng với tông màu của layer vào nền.

### Xuất

PNG từng layer hoặc nhiều layer một lượt, PNG cả document, save as sang định dạng khác, cắt
document theo vùng chọn.

### Không làm được

Không có tool cho **artboard** (tạo, sửa, đọc khung), **vector path và shape layer**, **smart
object** (không mở hay thay nội dung được), **curves**, **levels**, **hue/saturation**, **layer
comp**. Chỉ có đúng 2 filter.

Có cách vòng: file `mcp/ps-batch-play.py` là một MCP server riêng chạy **batchPlay descriptor bất
kỳ**, mở khoá toàn bộ những thứ trên. Mặc định nó **chưa được đăng ký**. Đăng ký thì Photoshop
cũng thành không giới hạn, đổi lại descriptor rất dễ viết sai và không có lưới an toàn.

---

## After Effects

Chỉ có 4 tool, nhưng một trong số đó chạy **ExtendScript bất kỳ** — tức là phủ trọn AE Scripting
Object Model, thứ lớn hơn 62 tool Photoshop nhiều lần.

### Đã kiểm chứng làm được

Toàn bộ những việc dưới đây được thực hiện trong repo này, qua đúng một tool:

- Tạo composition mới, đặt kích thước, thời lượng, frame rate
- Tạo layer chữ với typography chính xác đến pixel — font, cỡ, leading, tracking, căn lề
- Import ảnh, đặt đúng toạ độ, đổi nguồn của layer có sẵn
- Keyframe position, scale, opacity, và **mask shape**
- Easing bằng `KeyframeEase` trên từng keyframe
- Đọc, sửa, xoá keyframe đã có
- Precompose để cắt (clip) nội dung tràn ra ngoài
- Nhân bản comp thành nhiều phương án, mỗi bản một nguồn riêng
- Đo bbox chữ đã render bằng `sourceRectAtTime`
- Render frame ra PNG để kiểm tra
- Tổ chức thư mục project

Ngoài ra ExtendScript còn làm được hiệu ứng, expression, Render Queue, camera, 3D layer, shape
layer, text animator — tất cả những gì bảng script của AE cho phép.

### Đánh đổi

Phải tự viết JavaScript, và ExtendScript là **ES3 từ 2010** nên có nhiều bẫy: ternary lồng nhau
tính sai, `for...in` không tin được, `catch` mà nối chuỗi với Error thì chính nó ném lỗi, `Scale`
là thuộc tính 3 chiều kể cả với layer 2D. Xem phần "Known traps" trong hai skill
`psd-to-ae-animate` và `psd-to-ae-size-port` — mỗi bẫy ở đó đều đổi bằng thời gian thật.

---

## Illustrator

Cùng mô hình với After Effects: 4 tool cơ bản (liệt kê document, đọc thông tin, mở file `.ai`,
xuất PNG) cộng **ExtendScript bất kỳ**.

Nghĩa là phủ trọn Illustrator Scripting API — pathItem, artboard, symbol, swatch, text frame,
xuất SVG/PDF/EPS. Chưa dùng tới trong repo này nên chưa có bẫy nào được ghi lại, nhưng cùng ES3
nên bẫy của AE nhiều khả năng lặp lại.

---

## Premiere Pro

Nhiều tool nhất sau Photoshop, nhưng là app **duy nhất có trần cứng** — không có `execute_extend_script`,
không có batchPlay. Hết 26 tool là hết.

### Làm được

Tạo project, mở, lưu. Import media, tạo bin và sắp xếp. Tạo sequence từ danh sách media với clip
xếp đúng thứ tự truyền vào. Thêm và gỡ clip khỏi timeline, đặt điểm vào / ra, bật tắt clip, dồn
khít khoảng trống, thêm marker, mute track audio.

Đặt opacity và blend mode cho clip. Chèn transition giữa hai clip kề nhau. Bốn hiệu ứng: Gaussian
Blur, Directional Blur, Tint, đen trắng.

Render sequence ra video, xuất một frame tại timestamp bất kỳ, và trả về JPEG của frame để AI nhìn.

### Không làm được

**Không có keyframe** — opacity và blend mode đặt được nhưng là giá trị tĩnh, không animate được.
Không có **title / text**, không có **color grading hay Lumetri**, không có **speed / time remap**,
không có chỉnh audio ngoài mute cả track. Chỉ 4 hiệu ứng.

Đây mới là app đáng lo về giới hạn, không phải After Effects.

---

## InDesign

Một tool duy nhất: tạo document mới với khổ, số trang, cột, lề.

Không đọc được gì, không sửa được gì, không có cửa thoát. Nối được nhưng thực tế chưa dùng vào
việc gì.

---

## Chọn app theo việc

| Việc | Dùng gì |
| --- | --- |
| Đọc / dọn / sửa PSD hàng loạt | Photoshop — đúng thế mạnh |
| Đọc thiết kế rồi cho AI **nhìn** để đánh giá | Photoshop (`get_document_image`) |
| Dựng animation, keyframe, motion | **After Effects** — Premiere không keyframe được |
| Ghép clip, cắt, transition, render video | Premiere |
| Thao tác Photoshop nằm ngoài 62 tool | Đăng ký thêm `ps-batch-play` |
| Bất cứ việc gì trong AE / Illustrator | `execute_extend_script` |
| InDesign | Chưa dùng được |
