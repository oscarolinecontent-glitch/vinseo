# 🧠 VINSEO SAAS - AI MEMORY 

Tài liệu này được AI đọc vào mỗi đầu phiên làm việc để nắm bắt toàn bộ ngữ cảnh, tiến độ và cấu trúc của dự án. Không xóa file này. Nhưng nhớ cập nhật nó sau mỗi phiên làm việc.

## 1. Thông tin Dự Án
- **Tên dự án:** VinSEO SaaS
- **Mục tiêu:** Hệ thống phần mềm dạng SaaS giúp khách hàng quản lý và tự động hóa việc đăng bài viết (post) lên hàng loạt Website WordPress.
- **Tech Stack:** 
  - Frontend: Next.js 14, Tailwind CSS, Lucide React.
  - Backend/DB: Firebase Authentication (Google Login), Firestore Database.
  - Deployment: Vercel (CI/CD qua GitHub: `oscarolinecontent-glitch/vinseo`).

## 2. Tiến Độ Hiện Tại (Đã Hoàn Thành)
- [x] Khởi tạo giao diện Next.js chuẩn (Dark mode, Sidebar).
- [x] Thiết lập Firebase (Config, `.env.local`).
- [x] Tích hợp Đăng nhập bằng Google (`/login`).
- [x] Chuyển đổi dữ liệu từ LocalStorage sang Cloud Firestore.
- [x] Bảo vệ Route (Chưa đăng nhập thì đá về `/login`).
- [x] Setup GitHub Repo và Vercel Auto-deploy.
- [x] Tùy chỉnh thành công nội dung giao diện Login và Dashboard.

## 3. Cấu trúc Database (Firestore)
- **Rules:** Đang ở chế độ Test Mode.
- **Data Tree:** `users / {uid} / projects / {projectID}` (Bảo mật: Mỗi user chỉ thấy data của chính họ).

## 4. Các Vấn Đề Đang Xử Lý & Cần Lưu Ý
- Vừa thiết lập xong Git & Vercel. Nếu user thay đổi ảnh/icon trong thư mục `public/` mà web không cập nhật, có thể do cache trình duyệt (cần nhấn Ctrl + F5) hoặc user quên chạy `git add . -> git commit -> git push`.

## 5. Lộ Trình Tiếp Theo (Next Steps)
- **Giai đoạn 1:** Xây dựng module trích xuất dữ liệu từ Google Docs / Google Sheets.
- **Giai đoạn 2:** Viết API/Script tự động push Nội dung + Hình ảnh (Media) lên WordPress qua Application Passwords (REST API).
- **Giai đoạn 3:** Hoàn thiện giao diện quản lý tiến trình đăng bài (Dashboard UI).
 
 