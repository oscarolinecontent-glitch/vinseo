import Link from 'next/link';
import { Settings, Server } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Settings className="text-violet-400" /> Cấu hình hệ thống
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Thông tin kết nối và định dạng ảnh được lưu theo từng dự án.</p>
      </header>
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Server size={18} /> Giới hạn đang áp dụng</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt>Kết nối WordPress/Google</dt><dd>45 giây / request</dd>
          <dt>Xử lý một tác vụ</dt><dd>Tối đa 270 giây trên server</dd>
          <dt>Ảnh upload trực tiếp</dt><dd>Tối đa 4 MiB / ảnh</dd>
          <dt>Kích thước ảnh đích</dt><dd>Tối đa 4096 × 4096 px</dd>
        </dl>
        <p className="text-sm text-gray-500 dark:text-gray-400">Các giới hạn này được quản lý trong mã nguồn, không phải thiết lập có thể lưu từ trang này.</p>
        <Link href="/dashboard/projects" className="inline-block text-violet-600 dark:text-violet-400 underline">Quản lý cấu hình dự án WordPress</Link>
      </section>
    </div>
  );
}
