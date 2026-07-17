'use client';

import React, { useState, useEffect } from 'react';
import { Send, FileText, Settings, Key, Link as LinkIcon, CheckCircle2, AlertCircle, Plus, Trash2, RefreshCw, Edit3, PlusCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

type PostItem = {
  id: string;
  gdoc_url: string;
  postType: 'post' | 'page' | 'category';
  categoryId: string;
  status: 'draft' | 'publish';
  title: string;
  meta_desc: string;
  keyword?: string;
  resultStatus?: 'pending' | 'loading' | 'success' | 'error';
  resultMessage?: string;
  resultUrl?: string;
};

type UpdateItem = {
  id: string;
  wp_post_url: string;
  gdoc_url: string;
  keyword?: string;
  meta_desc?: string;
  resultStatus?: 'pending' | 'loading' | 'success' | 'error';
  resultMessage?: string;
  resultUrl?: string;
  thumbnailUpdated?: boolean;
  errorCode?: string;
};

export default function CreatePostPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'create' | 'update' | 'sync'>('create');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{success: boolean, message: string, user?: string} | null>(null);
  const [siteCategories, setSiteCategories] = useState<{id: number, name: string}[]>([]);
  const [excelText, setExcelText] = useState('');

  // State riêng cho mode Update
  const [updateItems, setUpdateItems] = useState<UpdateItem[]>([
    { id: Date.now().toString(), wp_post_url: '', gdoc_url: '', keyword: '', meta_desc: '' }
  ]);
  const [updateExcelText, setUpdateExcelText] = useState('');

  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [siteConfig, setSiteConfig] = useState({
    wp_url: '',
    wp_user: '',
    wp_app_pass: '',
    wp_password: '',
    wp_login_path: '',
    image_format: 'webp',
    image_width: '',
    image_height: ''
  });

  const [imageType, setImageType] = useState<'key' | 'caption'>('key');

  const [posts, setPosts] = useState<PostItem[]>([
    { id: Date.now().toString(), gdoc_url: '', postType: 'post', categoryId: '1', status: 'draft', title: '', meta_desc: '' }
  ]);

  useEffect(() => {
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
    fetchProjects();
  }, [user]);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    setSelectedProjectId(pId);
    setCheckResult(null);
    
    if (pId) {
      const p = projects.find(x => x.id.toString() === pId);
      if (p) {
        setSiteConfig({ wp_url: p.url, wp_user: p.wp_user, wp_app_pass: p.wp_app_pass, wp_password: p.wp_password || '', wp_login_path: p.wp_login_path || '', image_format: p.image_format || 'webp', image_width: p.image_width || '', image_height: p.image_height || '' });
      }
    } else {
      setSiteConfig({ wp_url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '', image_format: 'webp', image_width: '', image_height: '' });
    }
  };

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSiteConfig({ ...siteConfig, [e.target.name]: e.target.value });
    setCheckResult(null);
  };

  const checkConnection = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      setCheckResult({ success: false, message: "Vui lòng nhập đủ thông tin WP" });
      return;
    }
    setChecking(true);
    try {
      const res = await fetch('/api/wp/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteConfig })
      });
      const data = await res.json();
      setCheckResult(data);

      // Nếu kết nối thành công, lấy danh sách categories luôn
      if (data.success) {
        try {
          const catRes = await fetch('/api/wp/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteConfig })
          });
          const catData = await catRes.json();
          if (catData.success && catData.categories) {
            setSiteCategories(catData.categories);
          }
        } catch (e) {
          console.error("Lỗi lấy danh mục", e);
        }
      }
    } catch (err: any) {
      setCheckResult({ success: false, message: err.message });
    } finally {
      setChecking(false);
    }
  };

  const updatePost = (id: string, field: keyof PostItem, value: any) => {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const addPost = () => {
    setPosts([...posts, { id: Date.now().toString(), gdoc_url: '', postType: 'post', categoryId: '1', status: 'draft', title: '', meta_desc: '', keyword: '' }]);
  };

  const removePost = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
  };

  const clearAllPosts = () => {
    setPosts([]);
  };

  const handleExcelImport = () => {
    if (!excelText.trim()) return;
    const rows = excelText.split('\n').filter(r => r.trim());
    const newPosts: PostItem[] = [];

    rows.forEach((row, i) => {
      const cols = row.split('\t').map(c => c.trim());
      if (cols.length >= 1 && cols[0].includes('docs.google.com')) {
        newPosts.push({
          id: Date.now().toString() + i,
          gdoc_url: cols[0],
          keyword: cols[1] || '',
          postType: 'post',
          categoryId: siteCategories.length > 0 ? siteCategories[0].id.toString() : '1',
          status: 'draft',
          title: '',
          meta_desc: cols[2] || ''
        });
      }
    });

    if (newPosts.length > 0) {
      // Remove empty initial post if it's there
      const currentPosts = posts.filter(p => p.gdoc_url.trim() !== '');
      setPosts([...currentPosts, ...newPosts]);
      setExcelText('');
    }
  };

  // ---- Handlers cho Update Mode ----
  const updateUpdateItem = (id: string, field: keyof UpdateItem, value: any) => {
    setUpdateItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const addUpdateItem = () => {
    setUpdateItems(prev => [...prev, { id: Date.now().toString(), wp_post_url: '', gdoc_url: '', keyword: '', meta_desc: '' }]);
  };

  const removeUpdateItem = (id: string) => {
    setUpdateItems(prev => prev.filter(item => item.id !== id));
  };

  const clearAllUpdateItems = () => {
    setUpdateItems([]);
  };

  const handleUpdateExcelImport = () => {
    if (!updateExcelText.trim()) return;
    const rows = updateExcelText.split('\n').filter(r => r.trim());
    const newItems: UpdateItem[] = [];

    rows.forEach((row, i) => {
      const cols = row.split('\t').map(c => c.trim());
      // Cột 1: Link WP, Cột 2: Link GDocs, Cột 3: Keyword, Cột 4: Meta Desc
      const wpUrl = cols[0] || '';
      const gdocUrl = cols[1] || '';
      if (wpUrl && gdocUrl.includes('docs.google.com')) {
        newItems.push({
          id: Date.now().toString() + i,
          wp_post_url: wpUrl,
          gdoc_url: gdocUrl,
          keyword: cols[2] || '',
          meta_desc: cols[3] || '',
        });
      }
    });

    if (newItems.length > 0) {
      const current = updateItems.filter(u => u.wp_post_url.trim() !== '' || u.gdoc_url.trim() !== '');
      setUpdateItems([...current, ...newItems]);
      setUpdateExcelText('');
    }
  };

  const handleBulkUpdate = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      alert('Vui lòng cấu hình kết nối WP ở Bước 1!');
      return;
    }

    setLoading(true);

    for (let i = 0; i < updateItems.length; i++) {
      const item = updateItems[i];
      if (!item.wp_post_url || !item.gdoc_url) continue;

      updateUpdateItem(item.id, 'resultStatus', 'loading');

      let attempt = 1;
      let success = false;
      const maxAttempts = 2;

      while (attempt <= maxAttempts && !success) {
        if (attempt === 2) {
          updateUpdateItem(item.id, 'resultMessage', 'Lỗi lần 1, đang thử lại lần 2...');
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 150000);

          const res = await fetch('/api/wp/update-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              siteConfig,
              postData: {
                wp_post_url: item.wp_post_url,
                gdoc_url: item.gdoc_url,
                keyword: item.keyword,
                meta_desc: item.meta_desc,
                imageType: imageType,
              },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const data = await res.json();

          if (data.success) {
            setUpdateItems(prev => prev.map(u => u.id === item.id ? {
              ...u,
              resultStatus: 'success',
              resultMessage: data.thumbnailUpdated === false
                ? 'Không có thumbnail — vui lòng thêm thủ công'
                : 'Đã cập nhật!',
              resultUrl: data.url,
              thumbnailUpdated: data.thumbnailUpdated !== false,
            } : u));
            success = true;
          } else {
            if (attempt === maxAttempts) {
              setUpdateItems(prev => prev.map(u => u.id === item.id ? {
                ...u,
                resultStatus: 'error',
                resultMessage: data.message,
                errorCode: data.errorCode || '',
              } : u));
            }
          }
        } catch (err: any) {
          if (attempt === maxAttempts) {
            if (err.name === 'AbortError') {
              setUpdateItems(prev => prev.map(u => u.id === item.id ? { ...u, resultStatus: 'error', resultMessage: 'Lỗi: Thời gian chờ quá lâu (Timeout).' } : u));
            } else {
              setUpdateItems(prev => prev.map(u => u.id === item.id ? { ...u, resultStatus: 'error', resultMessage: err.message } : u));
            }
          }
        }

        if (!success) {
          attempt++;
          if (attempt <= maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 3500));
          }
        }
      }

      if (i < updateItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3500));
      }
    }

    setLoading(false);
  };

  // ---- Handlers cho Sync ảnh Mode ----
  type SyncItem = {
    id: string; wp_post_url: string; gdoc_url: string; keyword?: string;
    resultStatus?: 'pending' | 'loading' | 'success' | 'error';
    resultMessage?: string; resultUrl?: string;
    thumbnailUpdated?: boolean; imagesInjected?: number; errorCode?: string;
  };
  const [syncItems, setSyncItems] = React.useState<SyncItem[]>([
    { id: Date.now().toString(), wp_post_url: '', gdoc_url: '', keyword: '' }
  ]);
  const [syncExcelText, setSyncExcelText] = React.useState('');

  const updateSyncItem = (id: string, field: keyof SyncItem, value: any) =>
    setSyncItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  const addSyncItem = () =>
    setSyncItems(prev => [...prev, { id: Date.now().toString(), wp_post_url: '', gdoc_url: '', keyword: '' }]);
  const removeSyncItem = (id: string) =>
    setSyncItems(prev => prev.filter(item => item.id !== id));
  const clearAllSyncItems = () => setSyncItems([]);
  const handleSyncExcelImport = () => {
    if (!syncExcelText.trim()) return;
    const rows = syncExcelText.split('\n').filter(r => r.trim());
    const newItems: SyncItem[] = [];
    rows.forEach((row, i) => {
      const cols = row.split('\t').map(c => c.trim());
      const wpUrl = cols[0] || ''; const gdocUrl = cols[1] || ''; const keyword = cols[2] || '';
      if (wpUrl && gdocUrl.includes('docs.google.com'))
        newItems.push({ id: Date.now().toString() + i, wp_post_url: wpUrl, gdoc_url: gdocUrl, keyword });
    });
    if (newItems.length > 0) {
      setSyncItems([...syncItems.filter(s => s.wp_post_url || s.gdoc_url), ...newItems]);
      setSyncExcelText('');
    }
  };
  const handleBulkSync = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      alert('Vui lòng cấu hình kết nối WP ở Bước 1!'); return;
    }
    setLoading(true);
    for (let i = 0; i < syncItems.length; i++) {
      const item = syncItems[i];
      if (!item.wp_post_url || !item.gdoc_url) continue;
      updateSyncItem(item.id, 'resultStatus', 'loading');
      let attempt = 1; let success = false; const maxAttempts = 2;
      while (attempt <= maxAttempts && !success) {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 150000);
          const res = await fetch('/api/wp/sync-images', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteConfig, postData: { wp_post_url: item.wp_post_url, gdoc_url: item.gdoc_url, keyword: item.keyword, imageType } }),
            signal: controller.signal,
          });
          clearTimeout(tid);
          const data = await res.json();
          if (data.success) {
            setSyncItems(prev => prev.map(s => s.id === item.id ? {
              ...s, resultStatus: 'success', resultUrl: data.url,
              thumbnailUpdated: data.thumbnailUpdated !== false, imagesInjected: data.imagesInjected || 0,
            } : s));
            success = true;
          } else if (attempt === maxAttempts) {
            setSyncItems(prev => prev.map(s => s.id === item.id ? {
              ...s, resultStatus: 'error', resultMessage: data.message, errorCode: data.errorCode || '',
            } : s));
          }
        } catch (err: any) {
          if (attempt === maxAttempts) setSyncItems(prev => prev.map(s => s.id === item.id ? {
            ...s, resultStatus: 'error',
            resultMessage: err.name === 'AbortError' ? 'Timeout' : err.message,
          } : s));
        }
        if (!success) { attempt++; if (attempt <= maxAttempts) await new Promise(r => setTimeout(r, 3500)); }
      }
      if (i < syncItems.length - 1) await new Promise(r => setTimeout(r, 3500));
    }
    setLoading(false);
  };

  const applyAllFormat = (val: string) => {
    if (!val) return;
    setPosts(prev => prev.map(p => ({ ...p, postType: val as 'post' | 'page' | 'category' })));
  };

  const applyAllStatus = (val: string) => {
    if (!val) return;
    setPosts(prev => prev.map(p => ({ ...p, status: val as 'draft' | 'publish' })));
  };

  const handleBulkSubmit = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      alert("Vui lòng cấu hình kết nối WP ở Bước 1!");
      return;
    }

    setLoading(true);

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      if (!p.gdoc_url) continue;

      // Update status to loading
      updatePost(p.id, 'resultStatus', 'loading');

      let attempt = 1;
      let success = false;
      const maxAttempts = 2;

      while (attempt <= maxAttempts && !success) {
        if (attempt === 2) {
          updatePost(p.id, 'resultMessage', 'Lỗi lần 1, đang thử lại lần 2...');
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 150000);

          const res = await fetch('/api/wp/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              siteConfig,
              postData: {
                gdoc_url: p.gdoc_url,
                title: p.title, 
                postType: p.postType,
                status: p.status,
                categoryId: parseInt(p.categoryId),
                meta_desc: p.meta_desc,
                keyword: p.keyword,
                imageType: imageType
              }
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);

          const data = await res.json();
          
          if (data.success) {
            setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'success', resultMessage: 'Đăng thành công!', resultUrl: data.url } : item));
            success = true;
          } else {
            if (attempt === maxAttempts) {
              setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'error', resultMessage: data.message } : item));
            }
          }

        } catch (err: any) {
          if (attempt === maxAttempts) {
            if (err.name === 'AbortError') {
              setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'error', resultMessage: 'Lỗi: Thời gian chờ quá lâu (Timeout). Server WP không phản hồi.' } : item));
            } else {
              setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'error', resultMessage: err.message } : item));
            }
          }
        }

        if (!success) {
          attempt++;
          if (attempt <= maxAttempts) {
             // Nghỉ 3.5 giây trước khi thử lại để xả tài nguyên
             await new Promise(resolve => setTimeout(resolve, 3500));
          }
        }
      }

      // Thêm thời gian nghỉ (delay 3.5 giây) giữa các bài viết để chống Firewall block IP (ngoại trừ bài cuối)
      if (i < posts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3500));
      }
    }

    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-8 pt-10">
      <header className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
              <FileText className="text-violet-400" />
              {mode === 'create' ? 'Đăng Bài & Nội Dung Hàng Loạt' : 'Cập Nhật Nội Dung Bài Viết'}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {mode === 'create'
                ? 'Cấu hình WordPress và nhập danh sách link Google Docs để parse & post tự động.'
                : 'Nhập link bài đã đăng và link Google Docs mới để cập nhật nội dung mà giữ nguyên slug/URL.'}
            </p>
          </div>
          {/* Mode Toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-800/80 p-1 rounded-lg gap-1 border border-gray-200 dark:border-gray-700 self-start">
            <button
              onClick={() => setMode('create')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === 'create'
                  ? 'bg-white dark:bg-violet-600 text-violet-600 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <PlusCircle size={15} /> Đăng mới
            </button>
            <button
              onClick={() => setMode('update')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === 'update'
                  ? 'bg-white dark:bg-amber-500 text-amber-600 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Edit3 size={15} /> Cập nhật
            </button>
            <button
              onClick={() => setMode('sync')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === 'sync'
                  ? 'bg-white dark:bg-teal-500 text-teal-600 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <RefreshCw size={15} /> Sync ảnh
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-8">
        
        {/* Section 1: WP Config */}
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Settings size={18} className="text-blue-400" />
              1. Cấu hình WordPress Destination
            </h2>
            <button onClick={checkConnection} disabled={checking} className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-800 dark:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 transition">
              {checking ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} className={checkResult?.success ? 'text-violet-500 dark:text-violet-400' : ''} />}
              {checking ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
            </button>
          </div>

          {checkResult && (
            <div className={`mb-4 p-3 rounded text-sm flex items-start gap-2 ${checkResult.success ? 'bg-violet-900/20 text-violet-400' : 'bg-red-950/40 text-red-400'}`}>
              {checkResult.success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
              <span>{checkResult.message} {checkResult.user && `(User: ${checkResult.user})`}</span>
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2 block">Chọn Website đã lưu (Hoặc nhập thủ công)</label>
            <select 
              value={selectedProjectId} 
              onChange={handleProjectChange} 
              className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition"
            >
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="">-- Nhập thủ công bên dưới --</option>
              {projects.map(p => (
                <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" key={p.id} value={p.id.toString()}>{p.name} ({p.url})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">URL Website</label>
              <input type="url" name="wp_url" value={siteConfig.wp_url} onChange={handleConfigChange} placeholder="https://domain.com" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Username</label>
              <input type="text" autoComplete="new-password" name="wp_user" value={siteConfig.wp_user} onChange={handleConfigChange} placeholder="admin" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                 <Key size={12} /> Application Password
              </label>
              <input type="password" name="wp_app_pass" value={siteConfig.wp_app_pass} onChange={handleConfigChange} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Định dạng ảnh tải lên</label>
              <select name="image_format" value={siteConfig.image_format || 'webp'} onChange={handleConfigChange as any} className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition">
                <option value="webp">WebP (Khuyên dùng - Nén siêu nhẹ)</option>
                <option value="jpeg">JPEG (Phổ thông)</option>
                <option value="png">PNG (Giữ nguyên nền trong suốt)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Mật khẩu đăng nhập WP</label>
              <input type="password" name="wp_password" value={siteConfig.wp_password || ''} onChange={handleConfigChange} placeholder="Mật khẩu tài khoản (để auto fill SEO)" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Đường dẫn đăng nhập</label>
              <input type="text" name="wp_login_path" value={siteConfig.wp_login_path || ''} onChange={handleConfigChange} placeholder="/wp-login.php" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
          </div>
        </div>


        {/* Section 2: Google Docs & Content List - chỉ hiện ở mode Đăng mới */}
        {mode === 'create' && <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <LinkIcon size={18} className="text-violet-400" />
                2. Danh sách Nội Dung
              </h2>
              <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg flex gap-1 border border-gray-200 dark:border-gray-700">
                <button 
                  onClick={() => setImageType('key')} 
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${imageType === 'key' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Ảnh dạng key
                </button>
                <button 
                  onClick={() => setImageType('caption')} 
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${imageType === 'caption' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Ảnh dạng chú thích
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addPost} className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-800 dark:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 transition">
                <Plus size={14} /> Thêm 1 dòng
              </button>
              <button onClick={clearAllPosts} className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1.5 rounded border border-red-200 dark:border-red-800 transition">
                <Trash2 size={14} /> Xóa tất cả
              </button>
            </div>
          </div>

          <div className="mb-6 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
            <label className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-2 block">Nhập hàng loạt từ Excel / Google Sheets</label>
            <p className="text-xs text-gray-500 mb-2">Copy các cột từ Excel và dán vào ô dưới đây. (Cột 1: Link Docs, Cột 2: Từ khóa chính, Cột 3: Meta Desc).</p>
            <div className="flex gap-2">
                <textarea 
                value={excelText} 
                onChange={(e) => setExcelText(e.target.value)} 
                placeholder="https://docs.google.com/document/d/... &#9;  thể thao" 
                className="flex-1 h-16 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition"
              />
              <button onClick={handleExcelImport} className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-4 py-2 rounded-md transition-colors whitespace-nowrap">
                Nhập Data
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {/* Table Header */}
            <div className={`hidden md:grid gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 pb-2 border-b border-gray-200 dark:border-gray-800 grid-cols-12`}>
              <div className="col-span-3">Link Google Docs</div>
              <div className="col-span-2">Từ khóa chính</div>
              <div className="col-span-2">Chuyên mục</div>
              <div className="col-span-2 flex flex-col justify-end pb-1 pr-2">
                <span className="mb-1">Format / Trạng thái</span>
                <div className="flex gap-1">
                  <select onChange={(e) => { applyAllFormat(e.target.value); e.target.value = ''; }} className="w-1/2 bg-transparent border border-gray-300 dark:border-gray-700 rounded text-[9px] px-1 py-0.5 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 cursor-pointer">
                    <option className="bg-white dark:bg-slate-900" value="">Set All</option>
                    <option className="bg-white dark:bg-slate-900" value="post">Post</option>
                    <option className="bg-white dark:bg-slate-900" value="page">Page</option>
                    <option className="bg-white dark:bg-slate-900" value="category">Category</option>
                  </select>
                  <select onChange={(e) => { applyAllStatus(e.target.value); e.target.value = ''; }} className="w-1/2 bg-transparent border border-gray-300 dark:border-gray-700 rounded text-[9px] px-1 py-0.5 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 cursor-pointer">
                    <option className="bg-white dark:bg-slate-900" value="">Set All</option>
                    <option className="bg-white dark:bg-slate-900" value="draft">Nháp</option>
                    <option className="bg-white dark:bg-slate-900" value="publish">Public</option>
                  </select>
                </div>
              </div>
              <div className="col-span-1 text-center">Kết quả</div>
              <div className="col-span-1 text-center">Link</div>
              <div className="col-span-1 text-center">Xóa</div>
            </div>

            {posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                <p className="text-gray-400 dark:text-gray-500 text-sm mb-3">Chưa có dòng nào. Thêm link hoặc nhập từ Excel.</p>
              </div>
            ) : posts.map((post, index) => (
              <div key={post.id} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 transition-colors ${
                post.resultStatus === 'error' 
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700' 
                  : post.resultStatus === 'success'
                  ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/50'
                  : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
              }`}>
                <div className="col-span-3">
                  <input type="url" value={post.gdoc_url} onChange={(e) => updatePost(post.id, 'gdoc_url', e.target.value)} placeholder="Link Google Docs..." className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
                </div>
                <div className="col-span-2">
                  <input type="text" value={post.keyword || ''} onChange={(e) => updatePost(post.id, 'keyword', e.target.value)} placeholder="Từ khóa..." className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
                </div>
                <div className="col-span-2">
                  {post.postType === 'post' ? (
                    siteCategories.length > 0 ? (
                      <select value={post.categoryId} onChange={(e) => updatePost(post.id, 'categoryId', e.target.value)} className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500">
                        {siteCategories.map(cat => (
                          <option key={cat.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value={cat.id.toString()}>{cat.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="number" value={post.categoryId} onChange={(e) => updatePost(post.id, 'categoryId', e.target.value)} placeholder="ID CM" className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500" />
                    )
                  ) : (
                     <span className="text-xs text-gray-400 italic px-2">Không hỗ trợ</span>
                  )}
                </div>
                <div className="col-span-2 flex gap-1">
                  <select value={post.postType} onChange={(e) => updatePost(post.id, 'postType', e.target.value)} className="w-1/2 bg-transparent border border-gray-300 dark:border-gray-700 rounded px-1 py-1 text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-violet-500">
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="post">Post</option>
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="page">Page</option>
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="category">Category</option>
                  </select>
                  <select value={post.status} onChange={(e) => updatePost(post.id, 'status', e.target.value)} className="w-1/2 bg-transparent border border-gray-300 dark:border-gray-700 rounded px-1 py-1 text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-violet-500">
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="draft">Nháp</option>
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="publish">Public</option>
                  </select>
                </div>
                <div className="col-span-1 text-center">
                   {post.resultStatus === 'success' ? <CheckCircle2 size={16} className="inline text-green-500" /> : 
                    post.resultStatus === 'error' ? (
                      <span title={post.resultMessage || 'Lỗi không xác định'} className="cursor-help inline-flex items-center justify-center">
                        <AlertCircle size={16} className="text-red-500 hover:text-red-400 transition-colors" />
                      </span>
                    ) :
                    post.resultStatus === 'loading' ? <RefreshCw size={12} className="animate-spin inline text-blue-500" /> :
                    <span className="text-gray-400 text-xs">Chờ</span>}
                </div>
                <div className="col-span-1 text-center flex items-center justify-center gap-1">
                   {post.resultStatus === 'success' && post.resultUrl ? (
                      <a href={post.resultUrl} target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400 transition" title="Xem bài đăng">
                        <LinkIcon size={16} className="inline" />
                      </a>
                   ) : null}
                   {post.resultStatus === 'error' ? (
                      <button
                        title={`Thử lại: ${post.resultMessage || ''}`}
                        onClick={() => {
                          updatePost(post.id, 'resultStatus', 'pending');
                          updatePost(post.id, 'resultMessage', '');
                        }}
                        className="text-orange-400 hover:text-orange-300 transition-colors"
                      >
                        <RefreshCw size={14} />
                      </button>
                   ) : null}
                </div>
                <div className="col-span-1 text-center flex justify-center">
                  <button onClick={() => removePost(post.id)} className="text-gray-400 hover:text-red-400 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>}

        {/* Submit Button - Create Mode */}
        {mode === 'create' && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleBulkSubmit}
              disabled={loading}
              className={`flex items-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
                loading
                  ? 'bg-gray-600 text-slate-900 dark:text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all'
              }`}
            >
              {loading ? 'Hệ thống đang chạy...' : `Đăng Hàng Loạt (${posts.length} Mục)`}
              {!loading && <Send size={18} />}
            </button>
          </div>
        )}

      </div>

      {/* ===================== UPDATE MODE SECTION ===================== */}
      {mode === 'update' && (
        <div className="space-y-6 mt-2">

          {/* Excel Import for Update */}
          <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 size={18} className="text-amber-400" />
                2. Danh sách Bài cần Cập Nhật
              </h2>
              <div className="flex gap-2">
                {/* Image type toggle */}
                <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg flex gap-1 border border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setImageType('key')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${imageType === 'key' ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  >
                    Ảnh dạng key
                  </button>
                  <button
                    onClick={() => setImageType('caption')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${imageType === 'caption' ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  >
                    Ảnh dạng chú thích
                  </button>
                </div>
                <button onClick={addUpdateItem} className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-800 dark:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 transition">
                  <Plus size={14} /> Thêm dòng
                </button>
                <button onClick={clearAllUpdateItems} className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1.5 rounded border border-red-200 dark:border-red-800 transition">
                  <Trash2 size={14} /> Xóa tất cả
                </button>
              </div>
            </div>

            {/* Excel Import */}
            <div className="mb-6 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
              <label className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 block">Nhập hàng loạt từ Excel / Google Sheets</label>
              <p className="text-xs text-gray-500 mb-2">Copy các cột từ Excel và dán vào ô dưới đây. (Cột 1: Link WP bài cũ, Cột 2: Link Docs mới, Cột 3: Từ khóa, Cột 4: Meta Desc)</p>
              <div className="flex gap-2">
                <textarea
                  value={updateExcelText}
                  onChange={(e) => setUpdateExcelText(e.target.value)}
                  placeholder="https://domain.com/bai-viet/&#9;https://docs.google.com/...&#9;từ khóa"
                  className="flex-1 h-16 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 transition"
                />
                <button onClick={handleUpdateExcelImport} className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold px-4 py-2 rounded-md transition-colors whitespace-nowrap">
                  Nhập Data
                </button>
              </div>
            </div>

            {/* Table Header */}
            <div className="hidden md:grid gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 pb-2 border-b border-gray-200 dark:border-gray-800 grid-cols-12">
              <div className="col-span-4">Link WP (bài cũ)</div>
              <div className="col-span-4">Link Google Docs (mới)</div>
              <div className="col-span-2">Từ khóa</div>
              <div className="col-span-1 text-center">Kết quả</div>
              <div className="col-span-1 text-center">Xóa</div>
            </div>

            <div className="space-y-2 mt-2">
              {updateItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                  <p className="text-gray-400 dark:text-gray-500 text-sm mb-3">Chưa có dòng nào. Thêm hoặc nhập từ Excel.</p>
                </div>
              ) : updateItems.map((item) => (
                <div key={item.id} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 transition-colors ${
                  item.resultStatus === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                    : item.resultStatus === 'success'
                    ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/50'
                    : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
                }`}>
                  <div className="col-span-4">
                    <input
                      type="url"
                      value={item.wp_post_url}
                      onChange={(e) => updateUpdateItem(item.id, 'wp_post_url', e.target.value)}
                      placeholder="https://domain.com/bai-viet/..."
                      className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="url"
                      value={item.gdoc_url}
                      onChange={(e) => updateUpdateItem(item.id, 'gdoc_url', e.target.value)}
                      placeholder="https://docs.google.com/..."
                      className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      value={item.keyword || ''}
                      onChange={(e) => updateUpdateItem(item.id, 'keyword', e.target.value)}
                      placeholder="Từ khóa..."
                      className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="col-span-1 text-center">
                    {item.resultStatus === 'success' ? (
                      <span className="inline-flex items-center justify-center gap-1">
                        {item.thumbnailUpdated === false && (
                          <span
                            title="Không có thumbnail — thêm Featured Image thủ công trong WP"
                            className="cursor-help"
                          >⚠️</span>
                        )}
                        {item.resultUrl && (
                          <a href={item.resultUrl} target="_blank" rel="noreferrer" title="Xem bài viết" className="text-amber-500 hover:text-amber-400 transition">
                            <LinkIcon size={14} />
                          </a>
                        )}
                      </span>
                    ) : item.resultStatus === 'error' ? (
                      <span className="inline-flex flex-col items-center gap-0.5">
                        <span title={item.resultMessage || 'Lỗi không xác định'} className="cursor-help">
                          <AlertCircle size={16} className="text-red-500" />
                        </span>
                        {item.errorCode === 'URL_NOT_FOUND' && (
                          <span className="text-[10px] text-orange-400 leading-tight">Kiểm tra lại URL</span>
                        )}
                      </span>
                    ) : item.resultStatus === 'loading' ? (
                      <RefreshCw size={12} className="animate-spin inline text-amber-500" />
                    ) : (
                      <span className="text-gray-400 text-xs">Chờ</span>
                    )}
                  </div>
                  <div className="col-span-1 text-center flex justify-center">
                    <button onClick={() => removeUpdateItem(item.id)} className="text-gray-400 hover:text-red-400 transition-colors p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Submit Button - Update Mode */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleBulkUpdate}
              disabled={loading}
              className={`flex items-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
                loading
                  ? 'bg-gray-600 text-slate-900 dark:text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white hover:scale-[1.02] shadow-lg shadow-amber-500/30 transition-all'
              }`}
            >
              {loading ? 'Đang cập nhật...' : `Cập Nhật Hàng Loạt (${updateItems.length} Mục)`}
              {!loading && <Edit3 size={18} />}
            </button>
          </div>
        </div>
      )}
      {/* ===== SECTION: SYNC ẢNH ===== */}
      {mode === 'sync' && (
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <RefreshCw size={18} className="text-teal-400" />
                2. Danh sách Bài cần Sync Ảnh
              </h2>
              <span className="text-[11px] bg-teal-500/10 text-teal-500 border border-teal-500/20 rounded px-2 py-0.5 font-medium">
                Không đổi text · Chỉ cập nhật ảnh
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={addSyncItem} className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-800 dark:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 transition">
                <Plus size={14} /> Thêm dòng
              </button>
              <button onClick={clearAllSyncItems} className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1.5 rounded border border-red-200 dark:border-red-800 transition">
                <Trash2 size={14} /> Xóa tất cả
              </button>
            </div>
          </div>

          <div className="mb-6 p-4 bg-teal-500/5 border border-teal-500/20 rounded-lg">
            <label className="text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-2 block">Nhập hàng loạt từ Excel / Google Sheets</label>
            <p className="text-xs text-gray-500 mb-2">Copy 3 cột: Cột 1: Link WP, Cột 2: Link Docs, Cột 3: Từ khóa.</p>
            <div className="flex gap-2">
              <textarea value={syncExcelText} onChange={(e) => setSyncExcelText(e.target.value)}
                placeholder={"https://domain.com/bai-viet/\thttps://docs.google.com/..."}
                className="flex-1 h-16 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 transition" />
              <button onClick={handleSyncExcelImport} className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold px-4 py-2 rounded-md transition-colors whitespace-nowrap">
                Nhập Data
              </button>
            </div>
          </div>

          <div className="hidden md:grid gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 pb-2 border-b border-gray-200 dark:border-gray-800 grid-cols-12">
            <div className="col-span-4">Link WP (bài cần sync ảnh)</div>
            <div className="col-span-4">Link Google Docs (có ảnh)</div>
            <div className="col-span-2">Từ khóa</div>
            <div className="col-span-1 text-center">Kết quả</div>
            <div className="col-span-1 text-center">Xóa</div>
          </div>

          <div className="space-y-2 mt-2">
            {syncItems.length === 0 ? (
              <div className="flex items-center justify-center py-12 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                <p className="text-gray-400 text-sm">Chưa có dòng nào. Thêm hoặc nhập từ Excel.</p>
              </div>
            ) : syncItems.map((item) => (
              <div key={item.id} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 transition-colors ${
                item.resultStatus === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                  : item.resultStatus === 'success' ? 'bg-teal-50 dark:bg-teal-900/10 border-teal-200 dark:border-teal-800/50'
                  : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
              }`}>
                <div className="col-span-4">
                  <input type="url" value={item.wp_post_url} onChange={(e) => updateSyncItem(item.id, 'wp_post_url', e.target.value)}
                    placeholder="https://domain.com/bai-viet/..."
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-teal-500" />
                </div>
                <div className="col-span-4">
                  <input type="url" value={item.gdoc_url} onChange={(e) => updateSyncItem(item.id, 'gdoc_url', e.target.value)}
                    placeholder="https://docs.google.com/..."
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-teal-500" />
                </div>
                <div className="col-span-2">
                  <input type="text" value={item.keyword || ''} onChange={(e) => updateSyncItem(item.id, 'keyword', e.target.value)}
                    placeholder="Từ khóa..."
                    className="w-full bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-teal-500" />
                </div>
                <div className="col-span-1 text-center">
                  {item.resultStatus === 'success' ? (
                    <span className="inline-flex items-center justify-center gap-1">
                      {item.thumbnailUpdated === false && <span title="Không có thumbnail — thêm thủ công" className="cursor-help">⚠️</span>}
                      {item.resultUrl && (
                        <a href={item.resultUrl} target="_blank" rel="noreferrer" title={`Xem bài (${item.imagesInjected ?? 0} ảnh đã sync)`} className="text-teal-500 hover:text-teal-400 transition">
                          <LinkIcon size={14} />
                        </a>
                      )}
                    </span>
                  ) : item.resultStatus === 'error' ? (
                    <span className="inline-flex flex-col items-center gap-0.5">
                      <span title={item.resultMessage || 'Lỗi không xác định'} className="cursor-help">
                        <AlertCircle size={16} className="text-red-500" />
                      </span>
                      {item.errorCode === 'URL_NOT_FOUND' && <span className="text-[10px] text-orange-400 leading-tight">Kiểm tra lại URL</span>}
                      {item.errorCode === 'UPLOAD_FAILED' && <span className="text-[10px] text-orange-400 leading-tight">Ảnh lỗi — xem hover</span>}
                    </span>
                  ) : item.resultStatus === 'loading' ? (
                    <RefreshCw size={12} className="animate-spin inline text-teal-500" />
                  ) : (
                    <span className="text-gray-400 text-xs">Chờ</span>
                  )}
                </div>
                <div className="col-span-1 text-center flex justify-center">
                  <button onClick={() => removeSyncItem(item.id)} className="text-gray-400 hover:text-red-400 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4">
            <button onClick={handleBulkSync} disabled={loading}
              className={`flex items-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
                loading ? 'bg-gray-600 text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-white hover:scale-[1.02] shadow-lg shadow-teal-500/30'
              }`}
            >
              {loading ? 'Đang sync ảnh...' : `Sync Ảnh Hàng Loạt (${syncItems.length} Bài)`}
              {!loading && <RefreshCw size={18} />}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
