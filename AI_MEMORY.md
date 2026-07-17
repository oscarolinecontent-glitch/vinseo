# 🧠 VINSEO SAAS - AI MEMORY 

Tài liệu này được AI đọc vào mỗi đầu phiên làm việc để nắm bắt toàn bộ ngữ cảnh, tiến độ và cấu trúc của dự án. Không xóa file này. Nhưng nhớ cập nhật nó sau mỗi phiên làm việc.

## 1. Thông tin Dự Án
- **Tên dự án:** VinSEO SaaS
- **Mục tiêu:** Hệ thống phần mềm dạng SaaS giúp khách hàng quản lý và tự động hóa việc đăng bài viết (post) lên hàng loạt Website WordPress.
- **Tech Stack:** 
  - Frontend: Next.js 16 (Turbopack), Tailwind CSS, Lucide React.
  - Backend/DB: Firebase Authentication (Google Login), Firestore Database.
  - Image Processing: Sharp (resize, convert format WebP/JPEG/PNG).
  - Deployment: Vercel (CI/CD qua GitHub: `oscarolinecontent-glitch/vinseo`).

## 2. Tiến Độ Hiện Tại (Đã Hoàn Thành)
- [x] Khởi tạo giao diện Next.js chuẩn (Dark mode, Sidebar).
- [x] Thiết lập Firebase (Config, `.env.local`).
- [x] Tích hợp Đăng nhập bằng Google (`/login`).
- [x] Chuyển đổi dữ liệu từ LocalStorage sang Cloud Firestore.
- [x] Bảo vệ Route (Chưa đăng nhập thì đá về `/login`).
- [x] Setup GitHub Repo và Vercel Auto-deploy.
- [x] Tùy chỉnh thành công nội dung giao diện sáng tối Login và Dashboard.
- [x] **Module Google Docs Parser** (`src/lib/googleApi.ts`): Bóc tách HTML từ Google Docs → Title, Meta Desc, Thumbnail, Content. Xử lý bold/italic từ CSS classes, caption ảnh, căn lề.
- [x] **Module Auto Post WordPress** (`src/app/api/wp/post/route.ts`): Đăng bài hàng loạt (Post/Page/Category) lên WP qua REST API. Hỗ trợ cả Basic Auth và Cookie Auth fallback (bypass WAF).
- [x] **Module Xử Lý Ảnh** (`src/lib/imageProcessor.ts`): 2 chế độ - (1) Ảnh dạng key: download ảnh từ Google Docs → convert format → upload WP, (2) Ảnh dạng chú thích: tìm ảnh đã upload sẵn trên WP theo slug caption. Hỗ trợ **resize tự động** theo kích thước tuỳ chỉnh (`image_width` x `image_height`).
- [x] **Module WP Auth** (`src/lib/wpAuth.ts`): Giả lập browser đăng nhập WP → lấy session cookie + nonce. Cache session 2 tiếng.
- [x] **RankMath SEO Integration**: Cập nhật meta SEO (title, desc, focus keyword, primary category) qua Admin Session API.
- [x] **Tool Resize Ảnh Hàng Loạt** (`/dashboard/tools/resize-images`): Download ảnh từ bài đã đăng → resize bằng Sharp → xoá media cũ → upload mới → cập nhật nội dung bài (thay src, width, height, media ID, featured_media).
- [x] **Trang Tools Hub** (`/dashboard/tools`): Danh sách các công cụ với status cards.

## 3. Cấu Trúc Source Code

### API Routes (`src/app/api/wp/`)
| Route | Chức năng |
|-------|-----------|
| `check/route.ts` | Kiểm tra kết nối WP (Basic Auth + Cookie fallback) |
| `categories/route.ts` | Lấy danh sách categories từ WP |
| `post/route.ts` | Đăng bài Post/Page/Category hàng loạt |
| `update-post/route.ts` | Cập nhật content bài đã đăng (resolve ID từ URL, giữ nguyên slug) |
| `resize-images/route.ts` | Resize ảnh trên bài đã đăng |

### Lib (`src/lib/`)
| File | Chức năng |
|------|-----------|
| `googleApi.ts` | Parse Google Docs → HTML sạch |
| `imageProcessor.ts` | Xử lý ảnh (resize + convert + upload WP). Dùng helper `buildSharpOutput()` |
| `wpAuth.ts` | Đăng nhập WP Admin → lấy session cookie + nonce |
| `wpHelper.ts` | Utils build WP headers |
| `firebase.ts` | Firebase config |

### Pages (`src/app/dashboard/`)
| Page | Chức năng |
|------|-----------|
| `create-post/page.tsx` | UI đăng bài hàng loạt (mode: Đăng mới / Cập nhật). Mode cập nhật nhận Link WP cũ + Link GDocs mới → update content giữ nguyên slug |
| `tools/page.tsx` | Hub công cụ |
| `tools/resize-images/page.tsx` | UI resize ảnh hàng loạt (nhập kích thước + danh sách URL bài) |
| `projects/` | Quản lý dự án website |
| `settings/` | Cài đặt |
| `docs/` | Hướng dẫn API |

## 4. Cấu trúc Database (Firestore)
- **Rules:** Đang ở chế độ Test Mode.
- **Data Tree:** `users / {uid} / projects / {projectID}` (Bảo mật: Mỗi user chỉ thấy data của chính họ).

## 5. Các Vấn Đề Cần Lưu Ý
- Nếu user thay đổi ảnh/icon trong `public/` mà web không cập nhật → cache trình duyệt (Ctrl + F5) hoặc quên `git push`.
- `imageProcessor.ts` dùng helper chung `buildSharpOutput()` cho cả 2 hàm `processAndUploadImages` và `uploadImageToWp`. Nếu sửa logic ảnh, chỉ cần sửa 1 chỗ.
- WP Auth (`wpAuth.ts`) cache session 2 tiếng. Nếu user đổi mật khẩu WP, cache cũ sẽ tự hết hạn.
- API routes có `maxDuration = 300` (5 phút) cho Vercel serverless functions.
- Khi đăng bài, tạo post với nội dung tạm trước để chiếm slug, rồi mới xử lý ảnh và cập nhật lại.
- **WP Image Captions:** Chú ý `parseGoogleDoc` đã tự động bóc tách text chú thích của ảnh và lưu vào thuộc tính `data-temp-caption`, đồng thời **xóa luôn node chứa chú thích đó** khỏi HTML. Khi xử lý chèn ảnh (ở `sync-images` hay `update-post`), PHẢI lấy chú thích từ `data-temp-caption` của thẻ `<img>`. Nếu tạo shortcode `[caption]...[/caption]` mà bị thiếu phần text chú thích, WordPress Editor sẽ tự động **xóa luôn thẻ `[caption]` đó** và chỉ giữ lại ảnh (dẫn đến lỗi mất căn giữa).

## 6. Lộ Trình Tiếp Theo (Next Steps)
- Hoàn thiện giao diện quản lý tiến trình đăng bài (Dashboard UI thống kê).
- Xây dựng thêm các Tools mới (Tối ưu ảnh WebP, Replace Domain...).
- Nâng cấp bảo mật Firestore Rules từ Test Mode sang Production.