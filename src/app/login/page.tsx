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
    <div className="min-h-screen flex items-center justify-center bg-[#0b111a]">
      <div className="max-w-md w-full p-8 bg-[#141b25] border border-gray-800 rounded-2xl shadow-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-2">VinSEO</h1>
        <p className="text-gray-400 mb-8">Đăng nhập để tiếp cận Tools tốt nhất</p>

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 px-4 rounded-xl hover:bg-gray-100 transition duration-200 font-medium"
        >
          <LogIn size={20} className="text-blue-500" />
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
