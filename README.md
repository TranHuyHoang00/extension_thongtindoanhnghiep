# Thong Tin Doanh Nghiep Extractor (Chrome extension)

Thu thập dữ liệu doanh nghiệp từ thongtindoanhnghiep.co (qua API, bên trong một tab đã qua được Cloudflare)
và gửi thẳng lên Kafka gateway. Background service worker thực hiện POST nên không dính CORS.

## Cài đặt
1. Mở `chrome://extensions/`
2. Bật Developer mode (Chế độ nhà phát triển)
3. Load unpacked (Tải tiện ích đã giải nén) -> chọn thư mục này (extension_thongtindoanhnghiep)
4. Bấm biểu tượng extension để mở Side Panel (bảng bên)

## Sử dụng
1. Mở https://thongtindoanhnghiep.co và vượt qua Cloudflare (mở /api/city, thấy JSON là được)
2. Giữ nguyên tab đó đang mở, mở Side Panel
3. Điền: slug tỉnh (ví dụ bac-can), limit (-1 = lấy tất cả), delay (ms), batch, Gateway URL, Topic
4. Bấm Start. Theo dõi log.
   - Dừng: bấm nút Stop
   - Chạy tiếp sau khi dừng/403: bấm Start lại (bỏ qua các mã đã gửi, đã lưu trong IndexedDB)
   - Làm lại một tỉnh từ đầu: bấm Reset

## Các file
manifest.json    cấu hình extension, quyền, host
background.js    nhận batch -> POST lên gateway (không CORS)
content.js       chạy trong tab TTDN: fetch dữ liệu raw, gom batch, lưu tiến độ (IndexedDB)
sidepanel.*      giao diện, Start/Stop, log

# Cách extension hoạt động

Extension chạy gồm 3 phần phối hợp với nhau.

## 1. Content script

Chạy bên trong tab thongtindoanhnghiep.co (tab này đã qua được Cloudflare rồi). Nó dùng chính phiên đăng nhập của trình duyệt để gọi API:

- Gọi API danh sách để lấy các mã số thuế (MST) theo tỉnh, từng trang.
- Với mỗi MST, gọi API chi tiết `/api/company/{mst}` lấy dữ liệu raw.
- Gom đủ số công ty bằng **batch size** rồi gửi cả cụm sang background.

Vì chạy trong tab thật nên không bị Cloudflare chặn và không dính CORS khi gọi API cùng domain.

## 2. Background service worker

Nhận batch từ content script rồi POST thẳng lên Kafka gateway:

```
POST {gatewayUrl}
body: { topic, message: JSON.stringify(items) }
```

Background không bị ràng buộc CORS như code chạy trong trang, nên đẩy trực tiếp lên gateway được, không cần thêm bước trung gian.

## 3. Side panel

Bảng điều khiển: nhập tỉnh, limit, delay, batch, gateway URL, topic; có nút Start / Stop / Reset và khung log. Cấu hình lưu trong `chrome.storage.local`.

## Chống dừng giữa chừng

Mỗi tỉnh lưu danh sách MST đã gửi trong IndexedDB. Nếu bị Cloudflare chặn (403) hoặc bấm Stop, lần Start sau nó bỏ qua các MST đã gửi và chạy tiếp từ chỗ dở.

## Dữ liệu gửi đi

Dữ liệu gửi đi là **raw** nguyên từ API. Chống trùng thật sự (theo tax_code) nên để phía nhận (Elasticsearch) xử lý upsert.

## Tóm tắt luồng

```
tab TTDN (content) -> background -> Kafka gateway
```

Tiến độ ghi ở IndexedDB để chạy tiếp được.