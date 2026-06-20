'use client';

import React, { useState, useEffect } from 'react';
import { Scaling, Settings, Key, RefreshCw, CheckCircle2, AlertCircle, Link as LinkIcon, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

type PostResult = {
  postUrl: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  message: string;
  resizedCount?: number;
};

export default function ResizeImagesPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{success: boolean, message: string, user?: string} | null>(null);

  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [siteConfig, setSiteConfig] = useState({
    wp_url: '',
    wp_user: '',
    wp_app_pass: '',
    wp_password: '',
    wp_login_path: ''
  });

  const [targetWidth, setTargetWidth] = useState('800');
  const [targetHeight, setTargetHeight] = useState('450');
  const [imageFormat, setImageFormat] = useState('webp');
  const [deleteOldMedia, setDeleteOldMedia] = useState(false);
  const [postUrlsText, setPostUrlsText] = useState('');
  const [results, setResults] = useState<PostResult[]>([]);
  const [globalMessage, setGlobalMessage] = useState('');

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
        setSiteConfig({
          wp_url: p.url,
          wp_user: p.wp_user,
          wp_app_pass: p.wp_app_pass,
          wp_password: p.wp_password || '',
          wp_login_path: p.wp_login_path || ''
        });
        if (p.image_format) setImageFormat(p.image_format);
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
      setCheckResult({ success: false, message: 'Vui lòng nhập đủ thông tin WP' });
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
    } catch (err: any) {
      setCheckResult({ success: false, message: err.message });
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      alert('Vui lòng cấu hình kết nối WP!');
      return;
    }
    if (!targetWidth || !targetHeight) {
      alert('Vui lòng nhập kích thước đích!');
      return;
    }
    if (!postUrlsText.trim()) {
      alert('Vui lòng nhập danh sách URL bài viết!');
      return;
    }

    const postUrls = postUrlsText.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (postUrls.length === 0) {
      alert('Không có URL hợp lệ!');
      return;
    }

    const initialResults: PostResult[] = postUrls.map(url => ({ postUrl: url, status: 'pending', message: 'Chờ...' }));
    setResults(initialResults);
    setGlobalMessage('');
    setLoading(true);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < postUrls.length; i++) {
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'loading', message: 'Đang xử lý...' } : r));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        const res = await fetch('/api/wp/resize-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteConfig,
            postUrls: [postUrls[i]],
            targetWidth: parseInt(targetWidth, 10),
            targetHeight: parseInt(targetHeight, 10),
            imageFormat,
            deleteOldMedia
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await res.json();

        if (data.success && data.results?.[0]) {
          const r = data.results[0];
          setResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: r.status, message: r.message, resizedCount: r.resizedCount } : item));
          if (r.status === 'success') successCount++; else errorCount++;
        } else {
          setResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: data.message || 'Lỗi' } : item));
          errorCount++;
        }
      } catch (err: any) {
        const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
        setResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: msg } : item));
        errorCount++;
      }

      setGlobalMessage(`Đang xử lý: ${i + 1}/${postUrls.length} (${successCount} ✓, ${errorCount} ✗)`);
    }

    setGlobalMessage(`Hoàn tất: ${successCount} thành công, ${errorCount} lỗi.`);
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
          <Scaling className="text-emerald-400" />
          Resize Ảnh Bài Đã Đăng
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Thay đổi kích thước tất cả ảnh trong bài viết đã publish. Ảnh cũ sẽ bị xoá và thay bằng ảnh mới đã resize.
        </p>
      </header>

      <div className="space-y-8">

        {/* Section 1: WP Config */}
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Settings size={18} className="text-blue-400" />
              1. Cấu hình WordPress
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
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2 block">Chọn Website đã lưu</label>
            <select value={selectedProjectId} onChange={handleProjectChange} className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition">
              <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="">-- Nhập thủ công --</option>
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
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Key size={12} /> Application Password
              </label>
              <input type="password" name="wp_app_pass" value={siteConfig.wp_app_pass} onChange={handleConfigChange} placeholder="xxxx xxxx xxxx xxxx" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Mật khẩu đăng nhập WP</label>
              <input type="password" name="wp_password" value={siteConfig.wp_password || ''} onChange={handleConfigChange} placeholder="Mật khẩu tài khoản" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Đường dẫn đăng nhập</label>
              <input type="text" name="wp_login_path" value={siteConfig.wp_login_path || ''} onChange={handleConfigChange} placeholder="/wp-login.php" className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
            </div>
          </div>
        </div>

        {/* Section 2: Kích thước mục tiêu */}
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <Scaling size={18} className="text-emerald-400" />
            2. Kích Thước Mục Tiêu
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Tất cả ảnh trong bài viết sẽ được resize về kích thước này. Sử dụng <code className="text-emerald-400">fit: cover</code> (crop thông minh, giữ tâm) để đảm bảo đúng tỉ lệ.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Chiều rộng (px)</label>
              <input
                type="number"
                value={targetWidth}
                onChange={(e) => setTargetWidth(e.target.value)}
                placeholder="800"
                className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 transition text-lg font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Chiều cao (px)</label>
              <input
                type="number"
                value={targetHeight}
                onChange={(e) => setTargetHeight(e.target.value)}
                placeholder="450"
                className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 transition text-lg font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Định dạng ảnh</label>
              <select
                value={imageFormat}
                onChange={(e) => setImageFormat(e.target.value)}
                className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 transition"
              >
                <option value="webp">WebP</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
          </div>

          {/* Preview kích thước */}
          {targetWidth && targetHeight && (
            <div className="mt-4 flex items-center gap-3">
              <div
                className="border-2 border-dashed border-emerald-500/50 rounded-md flex items-center justify-center text-xs text-emerald-400 font-mono"
                style={{
                  width: `${Math.min(parseInt(targetWidth) / 4, 200)}px`,
                  height: `${Math.min(parseInt(targetHeight) / 4, 120)}px`,
                  minWidth: '60px',
                  minHeight: '30px'
                }}
              >
                {targetWidth}×{targetHeight}
              </div>
              <div className="text-xs text-gray-400">
                <span className="text-emerald-400 font-semibold">Tỉ lệ:</span>{' '}
                {(parseInt(targetWidth) / parseInt(targetHeight)).toFixed(2)}:1
                {parseInt(targetWidth) === 800 && parseInt(targetHeight) === 450 && (
                  <span className="ml-2 text-emerald-400">✓ Chuẩn SEO</span>
                )}
              </div>
            </div>
          )}

          {/* Tuỳ chọn xoá ảnh cũ */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center mt-0.5">
                <input
                  type="checkbox"
                  checked={deleteOldMedia}
                  onChange={(e) => setDeleteOldMedia(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-md peer-checked:bg-red-500 peer-checked:border-red-500 transition-all flex items-center justify-center group-hover:border-red-400">
                  <CheckCircle2 size={14} className="text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Xoá ảnh gốc sau khi resize (Nguy hiểm!)</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Nếu chọn, tool sẽ xoá vĩnh viễn ảnh cũ trên WordPress để tiết kiệm dung lượng. <strong className="text-red-500 dark:text-red-400">Chỉ chọn nếu bạn chắc chắn ảnh đó không được dùng chung cho bất kỳ bài viết nào khác</strong> (nếu không các bài dùng chung sẽ bị lỗi trắng trang).
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Section 3: Danh sách URL */}
        <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <LinkIcon size={18} className="text-violet-400" />
            3. Danh Sách Bài Viết Cần Resize Ảnh
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Mỗi dòng 1 URL bài viết. Hệ thống sẽ tải ảnh trong bài → resize về {targetWidth}×{targetHeight} → upload lại và cập nhật bài.
          </p>
          <textarea
            value={postUrlsText}
            onChange={(e) => setPostUrlsText(e.target.value)}
            placeholder={`https://domain.com/bai-viet-1/\nhttps://domain.com/bai-viet-2/\nhttps://domain.com/bai-viet-3/`}
            rows={8}
            className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition font-mono"
          />
          <p className="text-xs text-gray-400 mt-2">
            Tổng: <strong className="text-violet-400">{postUrlsText.split('\n').filter(u => u.trim()).length}</strong> URL
          </p>
        </div>

        {/* Global Message */}
        {globalMessage && (
          <div className={`p-4 rounded-xl text-sm font-medium flex items-start gap-2 ${
            globalMessage.includes('Lỗi')
              ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
              : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
          }`}>
            {globalMessage.includes('Lỗi') ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            {globalMessage}
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              📊 Kết Quả Resize
            </h2>
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-5">URL Bài Viết</div>
                <div className="col-span-1 text-center">TT</div>
                <div className="col-span-1 text-center">Số ảnh</div>
                <div className="col-span-4">Ghi chú</div>
              </div>

              {results.map((result, index) => (
                <div key={index} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md px-3 py-2 transition-colors ${
                  result.status === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50'
                    : result.status === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                    : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
                }`}>
                  <div className="col-span-1 text-center text-xs text-gray-400 font-mono">{index + 1}</div>
                  <div className="col-span-5">
                    <a href={result.postUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:text-blue-400 truncate block" title={result.postUrl}>
                      {result.postUrl.length > 55 ? result.postUrl.substring(0, 55) + '...' : result.postUrl}
                    </a>
                  </div>
                  <div className="col-span-1 text-center">
                    {result.status === 'success' ? <CheckCircle2 size={16} className="inline text-emerald-500" /> :
                     result.status === 'error' ? <AlertCircle size={16} className="inline text-red-500" /> :
                     result.status === 'loading' ? <RefreshCw size={14} className="animate-spin inline text-blue-500" /> :
                     <span className="text-gray-400 text-xs">Chờ</span>}
                  </div>
                  <div className="col-span-1 text-center text-xs font-semibold">
                    {result.resizedCount !== undefined ? (
                      <span className="text-emerald-400">{result.resizedCount}</span>
                    ) : '-'}
                  </div>
                  <div className="col-span-4 text-[11px] text-gray-500 dark:text-gray-400 truncate" title={result.message}>
                    {result.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`flex items-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
              loading
                ? 'bg-gray-600 text-white cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:scale-[1.02] shadow-lg shadow-emerald-500/30 transition-all'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Đang resize...
              </>
            ) : (
              <>
                Bắt Đầu Resize ({postUrlsText.split('\n').filter(u => u.trim()).length} bài)
                <Send size={18} />
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
