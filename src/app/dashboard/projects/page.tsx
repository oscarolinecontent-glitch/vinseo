'use client';

import React, { useState, useEffect } from 'react';
import { Target, Plus, Trash2, Globe } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [newProject, setNewProject] = useState({ name: '', url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '', image_format: 'webp' });
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const fetchProjects = async () => {
    if (!user) return;
    const q = collection(db, 'users', user.uid, 'projects');
    const querySnapshot = await getDocs(q);
    const loaded: any[] = [];
    querySnapshot.forEach((doc) => {
      loaded.push({ id: doc.id, ...doc.data() });
    });
    setProjects(loaded);
  };

  useEffect(() => {
    fetchProjects();
  }, [user]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name || !newProject.url || !user) return;
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'users', user.uid, 'projects'), newProject);
      await fetchProjects();
      setNewProject({ name: '', url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '', image_format: 'webp' });
    } catch (error) {
      console.error("Error adding document: ", error);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'projects', id));
      await fetchProjects();
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
          <Target className="text-violet-400" />
          Quản Lý Dự Án
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Lưu trữ thông tin các website WordPress để cấu hình tool tự động.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm text-gray-600 dark:text-gray-400">
              <thead className="bg-white dark:bg-black/20 text-xs uppercase border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Website</th>
                  <th className="px-6 py-4">Tài khoản WP</th>
                  <th className="px-6 py-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">Chưa có dự án nào. Hãy thêm mới bên phải.</td>
                  </tr>
                ) : (
                  projects.map((p) => (
                    <tr key={p.id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-800/20">
                      <td className="px-6 py-4 flex items-center gap-3">
                        <Globe size={16} className="text-blue-400" />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{p.name}</p>
                          <p className="text-xs">{p.url}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">{p.wp_user}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-300">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <form onSubmit={handleAdd} className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Thêm Dự Án Mới</h3>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">Tên Dự Án</label>
              <input required value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="VD: Blog SEO..." />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">URL Website</label>
              <input required type="url" value={newProject.url} onChange={e => setNewProject({...newProject, url: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="https://..." />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">WP Username</label>
              <input required value={newProject.wp_user} onChange={e => setNewProject({...newProject, wp_user: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">App Password (REST API)</label>
              <input required type="password" value={newProject.wp_app_pass} onChange={e => setNewProject({...newProject, wp_app_pass: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">
                Mật khẩu đăng nhập WP <span className="text-violet-500">(để tự động điền RankMath)</span>
              </label>
              <input type="password" value={newProject.wp_password} onChange={e => setNewProject({...newProject, wp_password: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="Mật khẩu thường dùng để đăng nhập" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">
                Đường dẫn đăng nhập WP <span className="text-violet-400 font-mono">(mặc định: /wp-login.php)</span>
              </label>
              <input type="text" value={newProject.wp_login_path} onChange={e => setNewProject({...newProject, wp_login_path: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none" placeholder="/wp-login.php hoặc /dang-nhap" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">Định dạng ảnh tự động chuyển đổi</label>
              <select value={newProject.image_format || 'webp'} onChange={e => setNewProject({...newProject, image_format: e.target.value})} className="w-full mt-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-violet-500 focus:outline-none">
                <option value="webp">WebP (Khuyên dùng - Nén siêu nhẹ)</option>
                <option value="jpeg">JPEG (Phổ thông)</option>
                <option value="png">PNG (Giữ nền trong suốt)</option>
              </select>
            </div>
            <button type="submit" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all font-bold py-2.5 rounded-xl hover:bg-gray-100 transition-all duration-300 mt-4">
              <Plus size={16} /> Thêm Dự Án
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
