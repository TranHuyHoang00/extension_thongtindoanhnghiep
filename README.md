# Thong Tin Doanh Nghiep Extractor (Chrome extension)

Thu thập dữ liệu doanh nghiệp từ `thongtindoanhnghiep.co` (gọi API ngay trong một tab
đã vượt qua Cloudflare), bọc vào envelope chuẩn rồi đẩy thẳng lên Kafka gateway.
Phần POST do background service worker thực hiện nên không bị dính CORS.

## Cài đặt
1. Mở `chrome://extensions/`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `extension_thongtindoanhnghiep`
4. Bấm biểu tượng extension để mở **Side Panel**

## Cách dùng
1. Mở `https://thongtindoanhnghiep.co` và vượt qua Cloudflare (mở thử `/api/city`, thấy JSON là đã qua).
2. Giữ nguyên tab đó ở trạng thái **đang chọn (active)**, rồi mở Side Panel.
3. Điền các ô (đã có sẵn giá trị mặc định):
   - **Province (slug)**: tỉnh cần lấy, ví dụ `bac-can`
   - **Limit**: `-1` = lấy tất cả
   - **Delay**: thời gian chờ giữa các request (mili giây)
   - **Batch size**: số doanh nghiệp gửi mỗi lần POST
   - **Gateway URL**: địa chỉ gateway (không kèm apikey)
   - **API Key**: dán khóa vào đây — **bắt buộc**, để trống sẽ không chạy
   - **Topic**: tên topic Kafka
4. Bấm **Start** và theo dõi log.
   - **Stop**: dừng giữa chừng.
   - **Start** lại sau khi Stop hoặc bị Cloudflare chặn (403): chạy tiếp từ **trang** còn dở.
   - **Reset**: xóa tiến độ của tỉnh đang chọn để làm lại từ đầu.

## Bảo mật
- Extension **không lưu cấu hình** vào máy. API Key chỉ nằm trong ô nhập khi panel đang mở;
  đóng panel hoặc tải lại là mất, **không ghi xuống đĩa**. Mỗi lần dùng phải dán lại API Key.

## Luồng hoạt động (xử lý theo từng trang)
1. **content.js** chạy trong tab TTDN. Xử lý **lần lượt từng trang** danh sách của tỉnh:
   với mỗi trang, lấy 100 mã số thuế (MST), rồi gọi ngay chi tiết `/api/company/{mst}` cho từng MST.
2. Mỗi doanh nghiệp được bọc vào envelope: `url` (ghép từ `SolrID`), `entry_rowkey` = MST,
   `inserted_time`/`created_time` = thời điểm thu thập (ms), `information` = object raw từ API,
   cùng các trường cố định trong khối `META`.
3. Gom đủ **Batch size** rồi gửi sang **background.js** để POST lên gateway.
4. Chạy xong hết một trang mới ghi **số trang đã xong** vào **IndexedDB** (chỉ một con số/tỉnh).
   Bắt đầu gửi dữ liệu ngay từ trang 1, không phải quét hết danh sách trước — hợp cả tỉnh rất lớn.

## Dừng và chạy tiếp
- Bị 403 hoặc bấm Stop → Start lại sẽ tiếp từ **trang còn dở** (đọc số trang trong IndexedDB).
- Nếu dừng **giữa một trang**, lần sau trang đó chạy lại từ đầu → có thể gửi **trùng tối đa ~100 item**
  (phần của trang đó đã gửi trước khi dừng). Phía nhận chống trùng theo `tax_code` (upsert) nên trùng vô hại.

## Ghi chú
- Dữ liệu `information` là **raw** nguyên từ API; chống trùng theo `tax_code` do phía nhận (Elasticsearch) xử lý.
- Các ID cố định (`author_id`, `owner_id`, `tenant_ids`...) nằm trong khối `META` ở đầu `content.js`,
  sửa tại đó nếu hệ thống của bạn khác.

## Các file
- `manifest.json`: cấu hình extension, quyền, host.
- `background.js`: nhận batch rồi POST lên gateway (không CORS).
- `content.js`: chạy trong tab TTDN — fetch raw, bọc envelope, chia batch, lưu tiến độ (IndexedDB).
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js`: giao diện, nút Start/Stop/Reset, log.