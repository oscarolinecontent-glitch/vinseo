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

      {/* BANNER Tương Tự Bản GenSeo */}
      <div className="w-full h-[220px] mb-8 bg-[#152e25] border border-[#1f3f31] rounded-2xl flex items-center justify-between p-12 overflow-hidden relative group">
        {/* Background elements */}
        <div className="absolute right-[-10%] top-[-20%] h-[300px] w-[300px] rounded-full bg-[#12b981]/20 blur-3xl group-hover:scale-110 transition-transform duration-1000"></div>
        
        <div className="z-10 max-w-xl">
           <h2 className="text-4xl font-extrabold text-[#12b981] uppercase drop-shadow-md tracking-tight mb-2">MySEO Auto-Tool Kit</h2>
           <h3 className="text-2xl text-white font-medium mb-4">Kết xuất & Chuyển hoá Docs Lên WordPress 100% tự động.</h3>
           <Link href="/dashboard/create-post">
             <button className="bg-gradient-to-r from-[#12b981] to-[#0ea271] text-black px-6 py-3 font-bold rounded shadow-lg shadow-[#12b981]/30 hover:shadow-[#12b981]/50 hover:-translate-y-0.5 transition-all flex items-center gap-2">
               Khởi Tạo Dòng Flow Đăng Mới <PlayCircle size={20}/>
             </button>
           </Link>
        </div>
        
        <div className="z-10 bg-black/30 backdrop-blur-md rounded-xl p-4 border border-white/5 rotate-3 mr-10 shadow-2xl">
           <pre className="text-[#12b981] font-mono text-[10px]">&gt; Parse doc file... [OK]<br/>&gt; Setup Auto Webp... [DONE]<br/>&gt; Send to REST API wp-json..[SUCCESS]</pre>
        </div>
      </div>

      {/* Quick Setup Block */}
      <Link href="/dashboard/projects">
        <div className="mb-6 rounded-lg bg-gray-900/50 border border-gray-800 p-4 px-6 flex justify-between items-center hover:border-gray-700 transition cursor-pointer">
          <div className="flex gap-4 items-center">
            <div className="p-2 rounded bg-gray-800 text-yellow-400">
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
      <div className="grid grid-cols-4 gap-4 mb-8">
        <KPICard title="Dự Án Đã Kết Nối" value={projectCount.toString()} icon={<Target size={20} className="text-[#3b82f6]"/>} active borderCl="#3b82f6"/>
        <KPICard title="Chờ Gửi API Xử Lý" value="0" icon={<Clock size={20} className="text-gray-500"/>} />
        <KPICard title="Đã Xong Hôm Nay" value="0" icon={<CheckCircle2 size={20} className="text-[#12b981]"/>} active borderCl="#12b981"/>
        <KPICard title="WP Lỗi Cổng/Time Out" value="0" icon={<AlertCircle size={20} className="text-[#ef4444]"/>} active borderCl="#ef4444" />
      </div>

      {/* Recent Operations Section - Empty State */}
      <div className="flex gap-6 w-full mt-4">
         {/* Left - Activity list */}
         <div className="flex-[3]">
           <div className="flex justify-between text-sm text-gray-400 font-medium border-b border-gray-800 pb-2 mb-4">
             <span>LOG GẦN ĐÂY NHẤT</span>
             <button className="text-[#12b981] hover:underline">Xem Tất cả Bảng điều khiển Sheets cũ</button>
           </div>
           
           <div className="h-[200px] w-full rounded-xl bg-gray-900/40 border border-gray-800/80 flex items-center justify-center flex-col text-gray-500">
             <Briefcase size={32} className="opacity-20 mb-3" />
             <p className="text-sm font-medium">Bạn chưa đẩy link Document mới nào cả.</p>
             <Link href="/dashboard/create-post">
               <button className="text-xs text-[#12b981] mt-2 underline">Hãy bắt đầu Paste link vào ngay Tool Post Auto WP</button>
             </Link>
           </div>
         </div>
      </div>
      
    </div>
  );
}

function KPICard({ title, value, icon, active, borderCl }: { title: string, value: string, icon: React.ReactNode, active?: boolean, borderCl?: string }) {
  return (
    <div className={`p-5 rounded-xl flex items-center justify-between border bg-gray-900/60 
         ${active ? 'bg-gradient-to-br border-b-[3px]' : 'border-gray-800'}
         `}
         style={{ borderBottomColor: active ? borderCl : '' }}>
      <div>
         <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{title}</h4>
         <div className="text-4xl font-light text-white mt-1.5">{value}</div>
      </div>
      <div className="p-3 bg-gray-800/50 rounded-lg">{icon}</div>
    </div>
  )
}
