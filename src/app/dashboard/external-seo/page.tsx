'use client';

import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Link as LinkIcon, 
  FolderRoot, 
  Plus, 
  Trash2, 
  Send, 
  RefreshCw, 
  ExternalLink, 
  Key,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

interface PostItem {
  id: string;
  gdoc_url: string;
  drive_url: string;
  keyword: string;
  categoryId: string;
  postType: string;
  status: string;
  resultStatus?: 'waiting' | 'loading' | 'success' | 'error';
  resultMsg?: string;
  resultUrl?: string;
}

export default function ExternalSEOPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [siteConfig, setSiteConfig] = useState({
    wp_url: '',
    wp_user: '',
    wp_app_pass: '',
    wp_password: ''
  });
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [imageFormat, setImageFormat] = useState('webp');
  const [siteCategories, setSiteCategories] = useState<any[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);

  const [posts, setPosts] = useState<PostItem[]>([
    { id: Date.now().toString(), gdoc_url: '', drive_url: '', keyword: '', postType: 'post', categoryId: '1', status: 'draft' }
  ]);
  const [excelText, setExcelText] = useState('');

  // Load projects
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

  // Load categories when project selected
  useEffect(() => {
    if (selectedProjectId && siteConfig.wp_url) {
      fetchCategories();
    }
  }, [selectedProjectId, siteConfig.wp_url]);

  const fetchCategories = async () => {
    setLoadingCats(true);
    try {
      const res = await fetch('/api/wp/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteConfig })
      });
      const data = await res.json();
      if (data.success) setSiteCategories(data.categories);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCats(false);
    }
  };

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    setSelectedProjectId(pId);
    if (pId) {
      const p = projects.find(x => x.id === pId);
      if (p) {
        setSiteConfig({ 
          wp_url: p.url, 
          wp_user: p.wp_user, 
          wp_app_pass: p.wp_app_pass,
          wp_password: p.wp_password || ''
        });
      }
    }
  };

  const addPost = () => {
    setPosts([...posts, { 
      id: Date.now().toString(), 
      gdoc_url: '', 
      drive_url: '',
      keyword: '', 
      postType: 'post', 
      categoryId: siteCategories[0]?.id?.toString() || '1', 
      status: 'draft' 
    }]);
  };

  const removePost = (id: string) => {
    if (posts.length > 1) setPosts(posts.filter(p => p.id !== id));
  };

  const updatePost = (id: string, field: keyof PostItem, value: string) => {
    setPosts(posts.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleExcelImport = () => {
    if (!excelText.trim()) return;
    const lines = excelText.split('\n');
    const newPosts: PostItem[] = lines.map(line => {
      const parts = line.split('\t');
      return {
        id: Math.random().toString(36).substr(2, 9),
        gdoc_url: parts[0]?.trim() || '',
        drive_url: parts[1]?.trim() || '',
        keyword: parts[2]?.trim() || '',
        categoryId: siteCategories[0]?.id?.toString() || '1',
        postType: 'post',
        status: 'draft'
      };
    }).filter(p => p.gdoc_url);

    if (newPosts.length > 0) {
      setPosts(newPosts);
      setExcelText('');
    }
  };

  const runPost = async (id: string) => {
    const post = posts.find(p => p.id === id);
    if (!post || !siteConfig.wp_url || !googleApiKey) return;

    updatePost(id, 'resultStatus', 'loading');

    try {
      const res = await fetch('/api/wp/external-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteConfig,
          googleApiKey,
          postData: {
            gdoc_url: post.gdoc_url,
            drive_folder_url: post.drive_url,
            keyword: post.keyword,
            categoryId: post.categoryId,
            postType: post.postType,
            status: post.status,
            imageFormat: imageFormat
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        setPosts(prev => prev.map(p => p.id === id ? { 
          ...p, 
          resultStatus: 'success', 
          resultUrl: data.url,
          resultMsg: 'Đã đăng thành công!' 
        } : p));
      } else {
        setPosts(prev => prev.map(p => p.id === id ? { 
          ...p, 
          resultStatus: 'error', 
          resultMsg: data.message 
        } : p));
      }
    } catch (e: any) {
      setPosts(prev => prev.map(p => p.id === id ? { 
        ...p, 
        resultStatus: 'error', 
        resultMsg: e.message 
      } : p));
    }
  };

  const runAll = async () => {
    for (const post of posts) {
      if (post.resultStatus !== 'success') {
        await runPost(post.id);
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
            External SEO Automation
          </h1>
          <p className="text-slate-500 dark:text-gray-400 mt-1">Tool chuyên dụng: Bóc ảnh từ Drive & Đăng bài theo quy trình SEO ngoại.</p>
        </div>
        <div className="flex gap-2">
           <button onClick={addPost} className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white rounded-lg transition-all text-sm font-semibold">
            <Plus size={18} /> Thêm bài
          </button>
          <button onClick={runAll} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg transition-all shadow-lg shadow-violet-500/25 text-sm font-bold">
            <Send size={18} /> Chạy tất cả
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {/* Project Selection */}
        <div className="lg:col-span-1 bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <FolderRoot size={14} className="text-violet-500" /> Chọn Dự Án Đích
          </label>
          <select 
            value={selectedProjectId} 
            onChange={handleProjectChange}
            className="w-full bg-slate-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
          >
            <option value="">-- Chọn website --</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {siteConfig.wp_url && (
            <div className="mt-3 p-3 bg-violet-50 dark:bg-violet-500/10 rounded-lg border border-violet-100 dark:border-violet-500/20">
              <p className="text-[10px] text-violet-600 dark:text-violet-300 font-medium break-all">{siteConfig.wp_url}</p>
              <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-1 uppercase">User: {siteConfig.wp_user}</p>
            </div>
          )}
        </div>

        {/* Google API Key */}
        <div className="lg:col-span-1 bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <Key size={14} className="text-amber-500" /> Google Drive API Key
          </label>
          <input 
            type="password"
            value={googleApiKey}
            onChange={(e) => setGoogleApiKey(e.target.value)}
            placeholder="Dán API Key từ Google Cloud..."
            className="w-full bg-slate-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
          />
          <div className="mt-2 flex items-start gap-1 text-[10px] text-gray-500">
            <Info size={10} className="mt-0.5" />
            <span>Cần thiết để quét danh sách file trong Folder Drive.</span>
          </div>
        </div>

        {/* Image Format */}
        <div className="lg:col-span-1 bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            🖼️ Định dạng ảnh
          </label>
          <select 
            value={imageFormat} 
            onChange={(e) => setImageFormat(e.target.value)}
            className="w-full bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-lg px-3 py-2.5 text-sm text-violet-700 dark:text-violet-300 font-bold focus:outline-none focus:border-violet-500 transition-all"
          >
            <option value="webp">⚡ WebP (Siêu nhẹ)</option>
            <option value="jpeg">🖼️ JPG (Chất lượng cao)</option>
            <option value="png">🎨 PNG (Trong suốt)</option>
          </select>
        </div>

        {/* Bulk Import */}
        <div className="lg:col-span-1 bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <FileText size={14} className="text-emerald-500" /> Nhập nhanh từ Excel (Doc [Tab] Drive [Tab] Key)
          </label>
          <div className="flex gap-2">
            <textarea 
              value={excelText} 
              onChange={(e) => setExcelText(e.target.value)} 
              placeholder="Paste data from Excel here..." 
              className="flex-1 h-[42px] bg-slate-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all resize-none"
            />
            <button onClick={handleExcelImport} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg text-xs font-bold hover:opacity-80 transition-all">
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Posts Table */}
      <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-white/5 border-b border-gray-200 dark:border-gray-800">
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[25%]">Google Doc URL</th>
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[20%]">Folder Drive URL</th>
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[15%]">Từ khóa</th>
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[15%]">Chuyên mục</th>
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[10%]">Trạng thái</th>
                <th className="px-4 py-4 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-4">
                    <div className="relative">
                      <LinkIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="url" 
                        value={post.gdoc_url} 
                        onChange={(e) => updatePost(post.id, 'gdoc_url', e.target.value)}
                        placeholder="https://docs.google.com/..."
                        className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="relative">
                      <FolderRoot size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="url" 
                        value={post.drive_url} 
                        onChange={(e) => updatePost(post.id, 'drive_url', e.target.value)}
                        placeholder="https://drive.google.com/..."
                        className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <input 
                      type="text" 
                      value={post.keyword} 
                      onChange={(e) => updatePost(post.id, 'keyword', e.target.value)}
                      placeholder="Slug/Keyword..."
                      className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
                    />
                  </td>
                  <td className="px-4 py-4">
                    <select 
                      value={post.categoryId} 
                      onChange={(e) => updatePost(post.id, 'categoryId', e.target.value)}
                      className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition-all"
                    >
                      {siteCategories.length > 0 ? (
                        siteCategories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))
                      ) : (
                        <option value="1">Mặc định (1)</option>
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      <select 
                        value={post.status} 
                        onChange={(e) => updatePost(post.id, 'status', e.target.value)}
                        className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1 py-1 text-[10px] text-slate-900 dark:text-white focus:outline-none"
                      >
                        <option value="draft">Bản nháp</option>
                        <option value="publish">Công khai</option>
                      </select>
                      <div className="flex items-center justify-center">
                        {post.resultStatus === 'loading' && <RefreshCw size={14} className="animate-spin text-blue-500" />}
                        {post.resultStatus === 'success' && <CheckCircle2 size={14} className="text-emerald-500" />}
                        {post.resultStatus === 'error' && <AlertCircle size={14} className="text-red-500" />}
                        {(!post.resultStatus || post.resultStatus === 'waiting') && <span className="text-[10px] text-gray-400">Sẵn sàng</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button 
                        onClick={() => runPost(post.id)}
                        disabled={post.resultStatus === 'loading'}
                        className="p-2 hover:bg-violet-50 dark:hover:bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-lg transition-all disabled:opacity-50"
                      >
                        <Send size={16} />
                      </button>
                      <button 
                        onClick={() => removePost(post.id)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                      {post.resultUrl && (
                        <a href={post.resultUrl} target="_blank" className="p-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg transition-all">
                          <ExternalLink size={16} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Error Message Display Area */}
        {posts.some(p => p.resultMsg) && (
          <div className="p-4 bg-slate-50 dark:bg-white/5 border-t border-gray-200 dark:border-gray-800">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Nhật ký lỗi / Trạng thái:</h4>
            <div className="space-y-1">
              {posts.map(p => p.resultMsg && (
                <p key={p.id} className={`text-[10px] ${p.resultStatus === 'error' ? 'text-red-500' : 'text-emerald-500'}`}>
                   • {p.keyword || p.id}: {p.resultMsg}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl p-5">
        <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2 mb-2">
          <Info size={16} /> Hướng dẫn quy trình SEO Ngoại
        </h4>
        <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-2 list-disc pl-4">
          <li><b>Caption:</b> Hệ thống sẽ quét các <b>Heading (H2, H3, H4)</b>. Nếu có 1 câu văn nằm ngay trên hoặc dưới Heading, câu đó sẽ được coi là Chú thích ảnh.</li>
          <li><b>Ảnh:</b> Hệ thống tìm ảnh <b>WebP</b> trong Drive có tên file trùng với Slug của Chú thích.</li>
          <li><b>Google API:</b> Bạn cần bật Drive API trong Google Cloud Console và tạo API Key để tool có quyền quét folder.</li>
        </ul>
      </div>
    </div>
  );
}
