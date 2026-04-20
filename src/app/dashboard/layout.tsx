'use client';

import React, { useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) return null; // Hoặc loading spinner

  if (!user) return null; // Tránh nháy UI

  return (
    <div className="flex h-screen bg-[#0d1218] text-gray-200 font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative bg-gradient-to-br from-[#0d1218] to-[#121820]">
        {children}
      </main>
    </div>
  );
}
