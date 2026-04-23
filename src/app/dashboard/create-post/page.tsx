'use client';

import React, { useState, useEffect } from 'react';
import { Send, FileText, Settings, Key, Link as LinkIcon, CheckCircle2, AlertCircle, Plus, Trash2, RefreshCw } from 'lucide-react';
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

export default function CreatePostPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{success: boolean, message: string, user?: string} | null>(null);
  const [siteCategories, setSiteCategories] = useState<{id: number, name: string}[]>([]);
  const [excelText, setExcelText] = useState('');
  
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [siteConfig, setSiteConfig] = useState({
    wp_url: '',
    wp_user: '',
    wp_app_pass: '',
    wp_password: '',
    wp_login_path: ''
  });

  const [posts, setPosts] = useState<PostItem[]>([
    { id: Date.now().toString(), gdoc_url: '', postType: 'post', categoryId: '1', status: 'draft', title: '', meta_desc: '' }
  ]);
  const [imageFormat, setImageFormat] = useState('webp');

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
        setSiteConfig({ wp_url: p.url, wp_user: p.wp_user, wp_app_pass: p.wp_app_pass, wp_password: p.wp_password || '', wp_login_path: p.wp_login_path || '' });
      }
    } else {
      setSiteConfig({ wp_url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '' });
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

  const updatePost = (id: string, field: keyof PostItem, value: string) => {
    setPosts(posts.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const addPost = () => {
    setPosts([...posts, { id: Date.now().toString(), gdoc_url: '', postType: 'post', categoryId: '1', status: 'draft', title: '', meta_desc: '', keyword: '' }]);
  };

  const removePost = (id: string) => {
    if (posts.length > 1) {
      setPosts(posts.filter(p => p.id !== id));
    }
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

      try {
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
              imageFormat: imageFormat,
            }
          })
        });

        const data = await res.json();
        
        if (data.success) {
          setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'success', resultMessage: 'Đăng thành công!', resultUrl: data.url } : item));
        } else {
          setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'error', resultMessage: data.message } : item));
        }

      } catch (err: any) {
        setPosts(prev => prev.map(item => item.id === p.id ? { ...item, resultStatus: 'error', resultMessage: err.message } : item));
      }
    }

    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
          <FileText className="text-violet-400" />
          Đăng Bài & Nội Dung Hàng Loạt
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Cấu hình WordPress và nhập danh sách link Google Docs để parse & post tự động.</p>
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
              <input type="text" name="wp_user" value={siteConfig.wp_user} onChange={handleConfigChange} placeholder="admin" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                 <Key size={12} /> Application Password
              </label>
              <input type="password" name="wp_app_pass" value={siteConfig.wp_app_pass} onChange={handleConfigChange} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                 <Settings size={12} /> Mật khẩu đăng nhập WP <span className="text-violet-500">(để tự động điền RankMath)</span>
              </label>
              <input type="password" name="wp_password" value={siteConfig.wp_password} onChange={handleConfigChange} placeholder="Mật khẩu thật dùng để đăng nhập vào web" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
              <p className="text-[10px] text-gray-500 italic">Đây là mật khẩu dùng để đăng nhập vào trang wp-admin, không phải App Password.</p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                 🖼️ Định dạng ảnh bài viết
              </label>
              <select 
                value={imageFormat} 
                onChange={(e) => setImageFormat(e.target.value)} 
                className="w-full bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-md px-4 py-2 text-sm text-violet-700 dark:text-violet-300 font-bold focus:outline-none focus:border-violet-500 transition"
              >
                <option value="webp">⚡ WebP (Siêu nhẹ - Khuyên dùng)</option>
                <option value="jpeg">🖼️ JPG (Chất lượng cao)</option>
                <option value="png">🎨 PNG (Trong suốt / Lossless)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Google Docs & Content List */}
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <LinkIcon size={18} className="text-violet-400" />
              2. Danh sách Nội Dung (Google Docs)
            </h2>
            <button onClick={addPost} className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-800 dark:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 transition">
              <Plus size={14} /> Thêm 1 dòng
            </button>
          </div>

          <div className="mb-6 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
            <label className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-2 block">Nhập hàng loạt từ Excel / Google Sheets</label>
            <p className="text-xs text-gray-500 mb-2">Copy 2 cột từ Excel và dán vào ô dưới đây. (Cột 1: Link Docs, Cột 2: Từ khóa chính).</p>
            <div className="flex gap-2">
              <textarea 
                value={excelText} 
                onChange={(e) => setExcelText(e.target.value)} 
                placeholder="https://docs.google.com/document/d/... &#9; the-thao" 
                className="flex-1 h-16 bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition"
              />
              <button onClick={handleExcelImport} className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-4 py-2 rounded-md transition-colors whitespace-nowrap">
                Nhập Data
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 pb-2 border-b border-gray-200 dark:border-gray-800">
              <div className="col-span-4">Link Google Docs</div>
              <div className="col-span-2">Từ khóa chính</div>
              <div className="col-span-2">Chuyên mục</div>
              <div className="col-span-2">Format / Trạng thái</div>
              <div className="col-span-1 text-center">Kết quả</div>
              <div className="col-span-1 text-center">Xóa</div>
            </div>

            {posts.map((post, index) => (
              <div key={post.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-md p-2">
                <div className="col-span-4">
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
                   {post.resultStatus === 'success' ? <span className="text-violet-500 font-bold text-xs">☑️</span> : 
                    post.resultStatus === 'error' ? <span className="text-red-500 font-bold text-xs">Lỗi</span> :
                    post.resultStatus === 'loading' ? <RefreshCw size={12} className="animate-spin inline text-blue-500" /> :
                    <span className="text-gray-400 text-xs">Chờ</span>}
                </div>
                <div className="col-span-1 text-center flex justify-center">
                  <button onClick={() => removePost(post.id)} className="text-gray-400 hover:text-red-400 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Status/Error Message Row */}
                {post.resultStatus && (
                  <div className="col-span-12 mt-1 text-[11px] text-gray-500 pl-2">
                    {post.resultStatus === 'success' ? <a href={post.resultUrl} target="_blank" rel="noreferrer" className="text-violet-500 hover:underline">🔗 Xem bài đăng &rarr;</a> : post.resultMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
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

      </div>

    </div>
  );
}
