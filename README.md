Thu thập dữ liệu doanh nghiệp từ `thongtindoanhnghiep.co` (gọi API ngay trong một tab đã vượt qua Cloudflare), bọc vào envelope chuẩn rồi đẩy thẳng lên Kafka gateway.
Phần POST do background service worker thực hiện nên không bị dính CORS.

## Cài đặt
1. Mở `chrome://extensions/`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `extension_thongtindoanhnghiep`
4. Bấm biểu tượng extension để mở **Side Panel**

## Cách dùng
1. Mở `https://thongtindoanhnghiep.co` và vượt qua Cloudflare.
2. Giữ nguyên tab đó và chọn Extensions, rồi mở Side Panel.
3. Điền các ô (đã có sẵn giá trị mặc định):
   - **Province (slug)**: tỉnh cần lấy, ví dụ `bac-can`
   - **Limit**: `-1` = lấy tất cả
   - **Delay**: thời gian chờ giữa các request (mili giây)
   - **Batch size**: số doanh nghiệp gửi mỗi lần POST
   - **Gateway URL**: địa chỉ gateway (không kèm apikey)
   - **API Key**: dán khóa vào đây — **bắt buộc**, để trống sẽ không chạy
   - **Topic**: tên topic Kafka
4. Bấm **Start** và theo dõi log.
   - **Stop**: dừng giữa chừng (tiến độ đã gửi được giữ lại).
   - **Start** lại sau khi Stop hoặc bị Cloudflare chặn (403): tự bỏ qua các mã đã gửi, chạy tiếp từ chỗ dở.
   - **Reset**: xóa tiến độ của tỉnh đang chọn để làm lại từ đầu.

## Luồng hoạt động
1. **content.js** chạy trong tab TTDN, gọi API danh sách `/api/company` để lấy mã số thuế (MST) theo tỉnh, từng trang.
2. Với mỗi MST, gọi API chi tiết `/api/company/{mst}` lấy dữ liệu raw.
3. Mỗi doanh nghiệp được bọc vào envelope: `url` (ghép từ `SolrID`), `entry_rowkey` = MST,
   `inserted_time`/`created_time` = thời điểm thu thập (ms), `information` = object raw từ API,
   cùng các trường cố định trong khối `META`.
4. Gom đủ **Batch size** rồi gửi sang **background.js** để POST lên gateway.
5. Tiến độ (danh sách MST đã gửi theo từng tỉnh) lưu trong **IndexedDB** nên Stop/403 không mất dữ liệu.

## Ghi chú
- Dữ liệu `information` là **raw** nguyên từ API; chống trùng theo `tax_code` do phía nhận (Elasticsearch) xử lý.
- Các ID cố định (`author_id`, `owner_id`, `tenant_ids`...) nằm trong khối `META` ở đầu `content.js`,
  sửa tại đó nếu hệ thống của bạn khác.

## Các file
- `manifest.json`: cấu hình extension, quyền, host.
- `background.js`: nhận batch rồi POST lên gateway (không CORS).
- `content.js`: chạy trong tab TTDN — fetch raw, bọc envelope, chia batch, lưu tiến độ (IndexedDB).
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js`: giao diện, nút Start/Stop/Reset, log.
