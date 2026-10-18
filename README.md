# VinSEO

Ứng dụng Next.js quản lý website và đăng/cập nhật nội dung Google Docs lên WordPress, kèm công cụ xử lý ảnh.

## Chạy dự án

Yêu cầu Node.js >= 22.13 (đã kiểm tra với Node 24). Sao chép `.env.example` thành `.env.local`, điền cấu hình Firebase của dự án; không commit mật khẩu hoặc file môi trường thực.

```sh
npm ci
npm run dev
```

Firebase cần bật Google sign-in và thêm domain triển khai vào danh sách Authorized domains. Google Docs/thư mục Drive cần quyền chia sẻ phù hợp. Công cụ Drive hỗ trợ API key riêng qua `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY`; khóa dùng ở trình duyệt phải giới hạn HTTP referrer và chỉ bật API cần thiết.

## Kiểm tra trước khi triển khai

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Build tải font Google theo cấu hình `next/font`, vì vậy cần mạng. Test dùng dữ liệu giả và chữ ký JWT cục bộ, không đăng/xoá dữ liệu WordPress thật.

## An toàn và giới hạn vận hành

- Tất cả 7 API WordPress yêu cầu Firebase ID token. Client gửi token qua `apiFetch`; server xác thực chữ ký, issuer, audience và thời hạn.
- Request WordPress chỉ tới HTTP/HTTPS công khai, cổng 80/443; kiểm tra DNS tại lúc kết nối và chặn chuyển hướng mang thông tin đăng nhập sang origin khác. Website nội bộ hoặc dùng cổng riêng không được hỗ trợ.
- Chuẩn hoá URL website trước khi sử dụng. URL bài viết phải cùng origin với cấu hình; dùng đúng bản có/không có `www` và giao thức canonical của WordPress.
- Timeout mỗi request ngoài: 45 giây; tổng tác vụ server: 270 giây, client: 280 giây. Không tự retry các thao tác tạo bài/upload media khi kết quả không chắc chắn.
- JSON tối đa 512 KiB; tải về tối đa 20 MiB/request; Sharp tối đa 40 triệu pixel đầu vào và kích thước đích 4096 px. Mỗi bài đăng tối đa 100 ảnh, mỗi lượt resize tối đa 50 URL.
- ZIP đầu vào tối đa 50 MiB, tối đa 200 ảnh; mỗi ảnh upload trực tiếp tối đa 4 MiB, tổng giải nén tối đa 100 MiB. Drive xuất ZIP tối đa 200 ảnh/100 MiB.
- Tạo Post/Page/News ở trạng thái nháp; chỉ publish sau khi lưu nội dung thành công. Khi có lỗi sau bước tạo, giữ ID để tiếp tục bằng chế độ Cập nhật. Nếu kết nối bị ngắt và chưa nhận được ID, kiểm tra WordPress trước khi thử lại.
- Resize giữ ảnh cũ mặc định. Khi bật xoá, chỉ xoá sau khi bài cập nhật thành công; ảnh dùng chung ở bài khác vẫn có thể bị ảnh hưởng.
- Đồng bộ ảnh giữ bảng/video/đoạn văn; dùng ánh xạ nguồn ảnh và nội dung làm mốc. Nếu không tìm được mốc đáng tin cậy thì dừng, không ghi đè bài. Chế độ chú thích tìm ảnh theo các chú thích hiện có trên WordPress.
- Quy tắc nghiệp vụ của cộng tác viên: loại ảnh cuối phần nội dung Google Docs và các ảnh còn nằm sau đoạn văn bản cuối trước khi upload, để ảnh check spin không bị đẩy lên WordPress. Thumbnail đã tách riêng không bị ảnh hưởng. Đây là quy tắc theo vị trí, không nhận diện nội dung ảnh; cộng tác viên cần đặt ảnh check đúng cuối bài.

## Cần làm trước production

1. **Publish Firestore rules** từ `firestore.rules` vào đúng Firebase project sau khi kiểm tra môi trường. Rule chỉ cho mỗi UID truy cập `users/{uid}/projects/*`, từ chối các đường dẫn khác. File mới chưa được deploy và chưa xác minh rules đang chạy trên Firebase. Lọc UID trên giao diện không thay thế security rules.
2. **Thông tin WP hiện vẫn được lưu dạng rõ trong Firestore**, người dùng chủ sở hữu có thể đọc. Nên chuyển sang kho bí mật phía server/mã hoá với quản lý khoá và migration riêng trước khi mở rộng cho khách hàng. Chưa thực hiện migration này.
3. Bổ sung quota/rate limit phân tán, kiểm soát tài khoản được phép sử dụng và giám sát chi phí nếu mở đăng ký công khai. Giới hạn dung lượng/timeout hiện tại không thay thế rate limit.
4. Kiểm tra end-to-end trên WordPress staging: quyền tài khoản, RankMath, login path, WordPress trong thư mục con, tạo nháp/publish, cập nhật, resize và đồng bộ. Các fallback RankMath/category phụ thuộc plugin/quyền WP; unit test không xác minh toàn bộ tích hợp này.

## Dọn dẹp và tối ưu

Đã bỏ `googleapis` (không được sử dụng), các script chỉnh mã một lần, file lệnh Git rời và 5 SVG mẫu. Các file đã theo dõi có thể phục hồi từ lịch sử Git. Không xoá dữ liệu Firebase/WordPress.

Firestore Lite được tách khỏi Firebase Auth; JSZip chỉ tải khi cần. Dùng hook dự án chung, aggregate count cho dashboard và hỗ trợ reduced motion.
