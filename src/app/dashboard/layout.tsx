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
    <div className="flex h-screen bg-slate-950 text-gray-200 font-sans selection:bg-violet-500/30">
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]">
        {children}
      </main>
    </div>
  );
}
