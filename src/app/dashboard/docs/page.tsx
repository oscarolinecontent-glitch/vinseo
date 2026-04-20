import React from 'react';
import { FileText, Code, Check } from 'lucide-react';

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
          <FileText className="text-violet-400" />
          Hướng Dẫn API & Tích Hợp
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Tài liệu tham khảo cách tạo Mật khẩu ứng dụng WordPress và share Google Docs.</p>
      </header>

      <div className="space-y-8">

        {/* Section 1 */}
        <section className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all text-sm font-bold">1</span>
            Tạo Application Password trên WordPress
          </h2>
          <div className="text-gray-600 dark:text-gray-400 text-sm space-y-3 leading-relaxed">
            <p>Để bảo mật, hệ thống không lưu mật khẩu chính của tài khoản quản trị WP, thay vào đó bạn hãy dùng <strong>Application Passwords</strong>.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Đăng nhập vào trang quản trị WordPress (wp-admin).</li>
              <li>Truy cập menu <strong>Users</strong> (Thành viên) &gt; <strong>Profile</strong> (Hồ sơ).</li>
              <li>Cuộn xuống mục <strong>Application Passwords</strong> (Mật khẩu ứng dụng).</li>
              <li>Nhập tên bất kỳ (VD: "Auto SEO Tool") và nhấn <strong>Add New Application Password</strong>.</li>
              <li>Copy chuỗi mật khẩu gồm 24 ký tự (VD: <code className="bg-gray-800 px-1 py-0.5 rounded text-violet-400">xxxx xxxx xxxx xxxx xxxx xxxx</code>) và dán vào form trên App.</li>
            </ul>
          </div>
        </section>

        {/* Section 2 */}
        <section className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all text-sm font-bold">2</span>
            Cấp Quyền Chia Sẻ Google Docs
          </h2>
          <div className="text-gray-600 dark:text-gray-400 text-sm space-y-3 leading-relaxed">
            <p>Tool hiện không yêu cầu cấp quyền Google OAuth rườm rà. Bạn chỉ cần bật Share link là tool đọc được.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Mở file Google Docs cần đăng bài.</li>
              <li>Nhấn nút <strong>Share</strong> (Chia sẻ) ở góc phải phía trên.</li>
              <li>Ở phần General access (Quyền truy cập chung), đổi từ <em>Restricted</em> (Bị hạn chế) sang <strong>Anyone with the link</strong> (Bất kỳ ai có liên kết).</li>
              <li>Vai trò có thể để là <em>Viewer</em> (Người xem) là đủ.</li>
              <li>Copy link (Có định dạng <code className="bg-gray-800 px-1 py-0.5 rounded text-violet-400">https://docs.google.com/document/d/...</code>) và dán vào Tool.</li>
            </ul>
          </div>
        </section>

      </div>
    </div>
  );
}
