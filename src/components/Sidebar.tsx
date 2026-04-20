'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Target, Briefcase, Puzzle, FileText, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from './ThemeToggle';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-64 bg-slate-50 dark:bg-slate-950/40 backdrop-blur-2xl border-r border-gray-200 dark:border-white/5 flex flex-col justify-between relative overflow-hidden">
      {/* Vệt sáng chạy mờ ảo trên cùng Sidebar */}
      <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-violet-500/10 via-fuchsia-500/5 to-transparent pointer-events-none"></div>
      
      <div className="relative z-10">
        {/* Logo App */}
        <div className="h-20 flex items-center gap-3 px-6 text-violet-500 border-b border-gray-200 dark:border-white/5">
          {/* Thay Hexagon bằng Logo thực tế + Hiệu ứng phát sáng nhịp nhàng */}
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-lg blur opacity-50 animate-pulse"></div>
            <img src="/favicon.ico" alt="VinSEO Logo" className="relative w-8 h-8 rounded drop-shadow-xl bg-slate-900" />
          </div>
          <span className="font-bold text-2xl text-transparent bg-clip-text bg-gradient-to-r from-violet-700 to-fuchsia-700 dark:from-white dark:to-gray-400 tracking-wide drop-shadow-md">VinSEO</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-800 px-1.5 rounded uppercase mt-1">v1.0</span>
        </div>

        {/* Navigation Links */}
        <nav className="mt-6 flex flex-col px-4 gap-1">
          <NavItem href="/dashboard" icon={<LayoutDashboard size={18} />} text="Tổng quan" active={pathname === '/dashboard'} />
          <NavItem href="/dashboard/projects" icon={<Target size={18} />} text="Dự án Website" active={pathname === '/dashboard/projects'} />
          <NavItem href="/dashboard/create-post" icon={<Briefcase size={18} />} text="Công việc Post bài" active={pathname === '/dashboard/create-post'} />
          <NavItem href="/dashboard/tools" icon={<Puzzle size={18} />} text="Hệ Công Cụ Tools" isNew active={pathname === '/dashboard/tools'} />
          <div className="border-t border-gray-200 dark:border-gray-800 my-4" />
          <NavItem href="/dashboard/docs" icon={<FileText size={18} />} text="Hướng dẫn API" active={pathname === '/dashboard/docs'} />
          <NavItem href="/dashboard/settings" icon={<Settings size={18} />} text="Cài đặt Cấu hình" active={pathname === '/dashboard/settings'} />
        </nav>
      </div>
      {/* User Profile & Logout */}
      {user && (
        <div className="p-4 border-t border-gray-200 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src={user.photoURL || 'https://via.placeholder.com/40'} alt="Avatar" className="w-9 h-9 shrink-0 rounded-full object-cover border border-gray-200 dark:border-white/10 shadow-lg" />
            <div className="flex flex-col truncate">
              <span className="text-sm text-slate-900 dark:text-white font-medium truncate">{user.displayName}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button onClick={logout} className="p-2 text-gray-600 dark:text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="Đăng xuất">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function NavItem({ icon, text, active = false, isNew = false, href }: { icon: React.ReactNode, text: string, active?: boolean, isNew?: boolean, href: string }) {
  return (
    <Link href={href} className={`flex justify-between items-center p-3 rounded-xl cursor-pointer mb-1 transition-all duration-500 relative overflow-hidden group ${active ? 'bg-violet-500/15 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.15)] border border-violet-500/30' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/5 hover:text-slate-900 dark:text-white'}`}>
      
      {/* Glow effect khi Hover & Active */}
      <div className={`absolute inset-0 bg-gradient-to-r from-violet-500/0 via-violet-500/5 to-transparent translate-x-[-100%] transition-transform duration-700 ${active ? 'translate-x-0' : 'group-hover:translate-x-0'}`}></div>

      <div className="flex items-center gap-3 relative z-10">
        {icon}
        <span className="text-[13px] font-medium">{text}</span>
      </div>
      {isNew && (
        <span className="bg-gradient-to-r from-fuchsia-500 to-violet-500 text-slate-900 dark:text-white text-[9px] px-1.5 py-[2px] rounded font-bold uppercase leading-none mt-px tracking-wider shadow-lg">HOT</span>
      )}
    </Link>
  );
}
