'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react'; // Đổi sang LogIn vì bản lucide hiện tại không có icon Chrome

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Nếu đã đăng nhập thì tự động đá vào dashboard
    if (user && !loading) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) return null; // Hoặc spinner

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] relative overflow-hidden">
      {/* Vòng sáng trang trí với hiệu ứng nhịp thở (pulse) */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-violet-600/20 rounded-full blur-[120px] pointer-events-none animate-[pulse_4s_ease-in-out_infinite]"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-fuchsia-600/20 rounded-full blur-[100px] pointer-events-none animate-[pulse_5s_ease-in-out_infinite_alternate]"></div>

      <div className="max-w-md w-full p-10 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.5)] text-center relative z-10">
        <h1 className="text-3xl font-bold text-white mb-2">VinSEO</h1>
        <p className="text-gray-400 mb-8">Đăng nhập để tiếp cận Tools tốt nhất</p>

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white text-black py-3.5 px-4 rounded-xl hover:bg-gray-100 hover:scale-[1.02] transition-all duration-300 font-bold shadow-lg shadow-white/5"
        >
          <LogIn size={20} className="text-violet-600" />
          Đăng nhập bằng tài khoản Google
        </button>

        <p className="mt-6 text-xs text-gray-500">
          Dễ dàng sử dụng, bảo mật tuyệt đối
          <br />@copyright by AH Vincent
        </p>
      </div>
    </div>
  );
}
