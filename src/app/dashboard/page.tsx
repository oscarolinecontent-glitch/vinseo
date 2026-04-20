'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, PlayCircle, CheckCircle2, Clock, AlertCircle, Briefcase, Target } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function DashboardOverview() {
  const [projectCount, setProjectCount] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    const fetchProjectCount = async () => {
      if (!user) return;
      const q = collection(db, 'users', user.uid, 'projects');
      const snap = await getDocs(q);
      setProjectCount(snap.size);
    };
    fetchProjectCount();
  }, [user]);

  return (
    <div className="max-w-6xl mx-auto p-8 pt-10">
      
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Dashboard Điều Khiển</h1>
          <p className="text-sm text-gray-400">Tổng quan Hệ Thống Tự Động SEO</p>
        </div>
        <Link href="/dashboard/docs">
          <button className="flex gap-2 items-center bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition">
             <FileText size={16} /> Hướng dẫn tích hợp WP
          </button>
        </Link>
      </header>

      {/* BANNER Tương Tự Bản GenSeo NHƯNG LÀM MỚI */}
      <div className="w-full h-[220px] mb-8 bg-gradient-to-br from-violet-900/40 via-fuchsia-900/10 to-slate-900 border border-white/10 rounded-3xl flex items-center justify-between p-12 overflow-hidden relative group shadow-2xl">
        {/* Background elements */}
        <div className="absolute right-[-10%] top-[-20%] h-[400px] w-[400px] rounded-full bg-violet-500/25 blur-[100px] group-hover:scale-110 transition-transform duration-1000 animate-[pulse_6s_ease-in-out_infinite]"></div>
        <div className="absolute left-[20%] bottom-[-50%] h-[300px] w-[300px] rounded-full bg-fuchsia-500/15 blur-[90px] animate-[pulse_4s_ease-in-out_infinite_reverse]"></div>
        
        <div className="z-10 max-w-xl">
           <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400 uppercase drop-shadow-md tracking-tight mb-2">VinSEO Auto-Tool Kit</h2>
           <h3 className="text-2xl text-white font-medium mb-4">Kết xuất & Chuyển hoá Docs Lên WordPress 100% tự động.</h3>
           <Link href="/dashboard/create-post">
             <button className="bg-white text-black px-6 py-3 font-bold rounded-xl shadow-lg shadow-white/10 hover:shadow-white/20 hover:scale-[1.02] transition-all flex items-center gap-2">
               Khởi Tạo Dòng Flow Đăng Mới <PlayCircle size={20}/>
             </button>
           </Link>
        </div>
        
        <div className="z-10 bg-black/40 backdrop-blur-xl rounded-2xl p-5 border border-white/10 rotate-2 mr-10 shadow-2xl">
           <pre className="text-violet-400 font-mono text-[11px] leading-relaxed">
             <span className="text-fuchsia-400">&gt;</span> Parse doc file... [OK]<br/>
             <span className="text-fuchsia-400">&gt;</span> Setup Auto Webp... [DONE]<br/>
             <span className="text-fuchsia-400">&gt;</span> Send to REST API wp-json.. [SUCCESS]
           </pre>
        </div>
      </div>

      {/* Quick Setup Block */}
      <Link href="/dashboard/projects">
        <div className="mb-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/5 p-4 px-6 flex justify-between items-center hover:bg-white/10 hover:border-white/10 transition-all cursor-pointer">
          <div className="flex gap-4 items-center">
            <div className="p-2.5 rounded-xl bg-violet-500/20 text-violet-400">
              <Target size={24} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Setup Mật khẩu Ứng dụng & Nối Site Mới</h4>
              <p className="text-xs text-gray-400 mt-1">Sử dụng Google Docs Auth thay vì Sheet - Cài trong 2 phút.</p>
            </div>
          </div>
          <span className="text-gray-500 font-bold">&gt;</span>
        </div>
      </Link>

      {/* KPI CARDS - Stats (Đang chạy, Chờ Xử Lý, Thành công, Lỗi) */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        <KPICard title="Dự Án Đã Kết Nối" value={projectCount.toString()} icon={<Target size={22} className="text-blue-400"/>} active borderCl="#60a5fa"/>
        <KPICard title="Chờ Gửi API Xử Lý" value="0" icon={<Clock size={22} className="text-gray-400"/>} />
        <KPICard title="Đã Xong Hôm Nay" value="0" icon={<CheckCircle2 size={22} className="text-emerald-400"/>} active borderCl="#34d399"/>
        <KPICard title="WP Lỗi Cổng/Time Out" value="0" icon={<AlertCircle size={22} className="text-rose-400"/>} active borderCl="#fb7185" />
      </div>

      {/* Recent Operations Section - Empty State */}
      <div className="flex gap-6 w-full mt-4">
         {/* Left - Activity list */}
         <div className="flex-[3]">
           <div className="flex justify-between text-sm text-gray-400 font-medium border-b border-gray-800 pb-2 mb-4">
             <span>LOG GẦN ĐÂY NHẤT</span>
             <button className="text-violet-400 hover:underline">Xem Tất cả Bảng điều khiển Sheets cũ</button>
           </div>
           
           <div className="h-[200px] w-full rounded-xl bg-gray-900/40 border border-gray-800/80 flex items-center justify-center flex-col text-gray-500">
             <Briefcase size={32} className="opacity-20 mb-3" />
             <p className="text-sm font-medium">Bạn chưa đẩy link Document mới nào cả.</p>
             <Link href="/dashboard/create-post">
               <button className="text-xs text-violet-400 mt-2 underline">Hãy bắt đầu Paste link vào ngay Tool Post Auto WP</button>
             </Link>
           </div>
         </div>
      </div>
      
    </div>
  );
}

function KPICard({ title, value, icon, active, borderCl }: { title: string, value: string, icon: React.ReactNode, active?: boolean, borderCl?: string }) {
  return (
    <div className={`p-6 rounded-2xl flex items-center justify-between border bg-white/5 backdrop-blur-sm shadow-lg hover:-translate-y-1 transition-all duration-300
         ${active ? 'border-b-[4px]' : 'border-white/5'}
         `}
         style={{ borderBottomColor: active ? borderCl : '', boxShadow: active ? `0 10px 30px -10px ${borderCl}40` : '' }}>
      <div>
         <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">{title}</h4>
         <div className="text-3xl font-semibold text-white tracking-tight">{value}</div>
      </div>
      <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 shadow-inner">{icon}</div>
    </div>
  )
}
