'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Target, Briefcase, Puzzle, FileText, Settings, Hexagon, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-64 bg-[#141b25] border-r border-gray-800 flex flex-col justify-between">
      <div>
        {/* Logo App */}
        <div className="h-16 flex items-center gap-3 px-6 text-[#12b981] border-b border-gray-800">
          <Hexagon size={28} className="fill-[#12b981]/20 stroke-[#12b981]" />
          <span className="font-bold text-xl text-white tracking-wide">MySEOApp</span>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 rounded uppercase mt-1">v1.0</span>
        </div>

        {/* Navigation Links */}
        <nav className="mt-6 flex flex-col px-4 gap-1">
          <NavItem href="/dashboard" icon={<LayoutDashboard size={18} />} text="Tổng quan" active={pathname === '/dashboard'} />
          <NavItem href="/dashboard/projects" icon={<Target size={18} />} text="Dự án Website" active={pathname === '/dashboard/projects'} />
          <NavItem href="/dashboard/create-post" icon={<Briefcase size={18} />} text="Công việc Post bài" active={pathname === '/dashboard/create-post'} />
          <NavItem href="/dashboard/tools" icon={<Puzzle size={18} />} text="Hệ Công Cụ Tools" isNew active={pathname === '/dashboard/tools'} />
          <div className="border-t border-gray-800 my-4" />
          <NavItem href="/dashboard/docs" icon={<FileText size={18} />} text="Hướng dẫn API" active={pathname === '/dashboard/docs'} />
          <NavItem href="/dashboard/settings" icon={<Settings size={18} />} text="Cài đặt Cấu hình" active={pathname === '/dashboard/settings'} />
        </nav>
      </div>
      {/* User Profile & Logout */}
      {user && (
        <div className="p-4 border-t border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src={user.photoURL || 'https://via.placeholder.com/40'} alt="Avatar" className="w-9 h-9 shrink-0 rounded-full object-cover border border-gray-700" />
            <div className="flex flex-col truncate">
              <span className="text-sm text-white font-medium truncate">{user.displayName}</span>
              <span className="text-xs text-gray-500 truncate">{user.email}</span>
            </div>
          </div>
          <button onClick={logout} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="Đăng xuất">
            <LogOut size={18} />
          </button>
        </div>
      )}
    </aside>
  );
}

function NavItem({ icon, text, active = false, isNew = false, href }: { icon: React.ReactNode, text: string, active?: boolean, isNew?: boolean, href: string }) {
  return (
    <Link href={href} className={`flex justify-between items-center p-3 rounded-lg cursor-pointer mb-1 transition-all ${active ? 'bg-[#12b981]/10 text-[#12b981]' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-[13px] font-medium">{text}</span>
      </div>
      {isNew && (
        <span className="bg-[#12b981] text-black text-[9px] px-1.5 py-[2px] rounded font-bold uppercase leading-none mt-px tracking-wider shadow">HOT</span>
      )}
    </Link>
  );
}
