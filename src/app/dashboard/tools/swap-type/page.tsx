'use client';

import React, { useState } from 'react';
import { Plus, Trash2, ArrowLeftRight, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { apiFetch } from '@/lib/apiClient';
import { errorMessage } from '@/lib/types';

type PostType = 'post' | 'page' | 'category' | 'news';
type RowStatus = 'idle' | 'loading' | 'success' | 'error';

interface SwapRow {
  id: string;
  wpUrl: string;
  targetType: PostType;
  categoryId: string;
  status: 'draft' | 'publish';
  rowStatus: RowStatus;
  resultMessage?: string;
  resultUrl?: string;
}

const TYPE_LABELS: Record<PostType, string> = {
  post: 'Post (Bài viết)',
  page: 'Page (Trang)',
  category: 'Category (Chuyên mục)',
  news: 'News (Tin tức)',
};

export default function SwapTypePage() {
  const { projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [siteConfig, setSiteConfig] = useState({
    wp_url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '',
    image_format: 'webp', image_width: '', image_height: '',
  });
  const [siteCategories, setSiteCategories] = useState<{ id: number; name: string }[]>([]);
  const [rows, setRows] = useState<SwapRow[]>([
    { id: '1', wpUrl: '', targetType: 'post', categoryId: '1', status: 'draft', rowStatus: 'idle' },
  ]);
  const [running, setRunning] = useState(false);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    setSelectedProjectId(pId);
    if (!pId) { setSiteConfig({ wp_url: '', wp_user: '', wp_app_pass: '', wp_password: '', wp_login_path: '', image_format: 'webp', image_width: '', image_height: '' }); return; }
    const p = projects.find(x => x.id.toString() === pId);
    if (p) setSiteConfig({ wp_url: p.url, wp_user: p.wp_user, wp_app_pass: p.wp_app_pass, wp_password: p.wp_password || '', wp_login_path: p.wp_login_path || '', image_format: p.image_format || 'webp', image_width: p.image_width || '', image_height: p.image_height || '' });
  };

  // Lấy categories khi chọn project
  const loadCategories = async () => {
    if (!siteConfig.wp_url) return;
    try {
      const res = await apiFetch('/api/wp/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteConfig }) });
      const data = await res.json();
      if (data.success && data.categories) setSiteCategories(data.categories);
    } catch { /* ignore */ }
  };

  const updateRow = <K extends keyof SwapRow>(id: string, field: K, value: SwapRow[K]) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

  const addRow = () => setRows(prev => [
    ...prev,
    { id: Date.now().toString(), wpUrl: '', targetType: 'post', categoryId: siteCategories[0]?.id.toString() || '1', status: 'draft', rowStatus: 'idle' },
  ]);

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  const runSwap = async () => {
    const pending = rows.filter(r => r.wpUrl.trim() && r.rowStatus !== 'success');
    if (!pending.length) return;
    setRunning(true);

    for (const row of pending) {
      updateRow(row.id, 'rowStatus', 'loading');
      try {
        const res = await apiFetch('/api/wp/swap-type', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteConfig,
            wpUrl: row.wpUrl.trim(),
            targetType: row.targetType,
            categoryId: row.categoryId || undefined,
            status: row.status,
          }),
        });
        const data = await res.json();
        if (data.success) {
          updateRow(row.id, 'rowStatus', 'success');
          updateRow(row.id, 'resultMessage', `✓ Đã swap → ${data.newUrl}`);
          updateRow(row.id, 'resultUrl', data.newUrl);
        } else {
          updateRow(row.id, 'rowStatus', 'error');
          updateRow(row.id, 'resultMessage', data.message || 'Lỗi không xác định');
        }
      } catch (e) {
        updateRow(row.id, 'rowStatus', 'error');
        updateRow(row.id, 'resultMessage', errorMessage(e));
      }
    }
    setRunning(false);
  };

  const pendingCount = rows.filter(r => r.wpUrl.trim() && r.rowStatus !== 'success').length;

  return (
    <div className="max-w-6xl mx-auto p-6 pt-8 space-y-6">
      <header className="border-b border-gray-200 dark:border-gray-800 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ArrowLeftRight className="text-violet-400" size={22} />
          Swap Post Type
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Chuyển đổi loại bài viết WordPress: Post ↔ Page ↔ Category ↔ News. Bài gốc sẽ bị xoá sau khi swap thành công.
        </p>
      </header>

      {/* ── PROJECT SELECTOR ── */}
      <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">1. Chọn Website</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Project</label>
            <select
              value={selectedProjectId}
              onChange={handleProjectChange}
              className="w-full text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
            >
              <option value="">-- Chọn Project --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.url})</option>)}
            </select>
          </div>
          <button
            onClick={loadCategories}
            disabled={!siteConfig.wp_url}
            className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-slate-800 dark:text-white rounded-lg disabled:opacity-40 transition-colors"
          >
            Tải Danh Mục
          </button>
        </div>
      </div>

      {/* ── ROWS ── */}
      <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">2. Danh Sách Swap</h2>
          <button onClick={addRow} className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 font-medium">
            <Plus size={14} /> Thêm dòng
          </button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto_auto] gap-2 text-xs text-gray-400 font-semibold px-1 hidden md:grid">
          <span>URL Bài Gốc (WordPress)</span>
          <span>Chuyển sang</span>
          <span>Danh mục (nếu Post)</span>
          <span>Trạng thái</span>
          <span>Kết quả</span>
          <span></span>
        </div>

        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto] gap-2 items-center">
            {/* URL */}
            <input
              type="url"
              placeholder="https://example.com/category/slug/"
              value={row.wpUrl}
              onChange={e => updateRow(row.id, 'wpUrl', e.target.value)}
              disabled={row.rowStatus === 'loading'}
              className="w-full text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
            />

            {/* Target type */}
            <select
              value={row.targetType}
              onChange={e => updateRow(row.id, 'targetType', e.target.value as PostType)}
              disabled={row.rowStatus === 'loading'}
              className="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-2 text-slate-900 dark:text-white"
            >
              {(Object.entries(TYPE_LABELS) as [PostType, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>

            {/* Category (chỉ hiện khi target = post/news) */}
            <div>
              {(row.targetType === 'post' || row.targetType === 'news') ? (
                siteCategories.length > 0 ? (
                  <select
                    value={row.categoryId}
                    onChange={e => updateRow(row.id, 'categoryId', e.target.value)}
                    disabled={row.rowStatus === 'loading'}
                    className="w-full text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-2 text-slate-900 dark:text-white"
                  >
                    {siteCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Category ID"
                    value={row.categoryId}
                    onChange={e => updateRow(row.id, 'categoryId', e.target.value)}
                    className="w-full text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  />
                )
              ) : (
                <span className="text-xs text-gray-400 px-2">—</span>
              )}
            </div>

            {/* Status */}
            <select
              value={row.status}
              onChange={e => updateRow(row.id, 'status', e.target.value as 'draft' | 'publish')}
              disabled={row.rowStatus === 'loading'}
              className="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-2 text-slate-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="publish">Public</option>
            </select>

            {/* Result */}
            <div className="flex items-center gap-1 min-w-[120px]">
              {row.rowStatus === 'idle' && <span className="text-xs text-gray-400">—</span>}
              {row.rowStatus === 'loading' && <RefreshCw size={14} className="animate-spin text-violet-400" />}
              {row.rowStatus === 'success' && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                  <CheckCircle2 size={14} />
                  {row.resultUrl ? (
                    <a href={row.resultUrl} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
                      Xem bài <ExternalLink size={11} />
                    </a>
                  ) : 'Thành công'}
                </span>
              )}
              {row.rowStatus === 'error' && (
                <span title={row.resultMessage} className="flex items-center gap-1 text-xs text-red-500 font-medium cursor-help">
                  <AlertCircle size={14} />
                  {(row.resultMessage || '').slice(0, 40)}{(row.resultMessage || '').length > 40 ? '…' : ''}
                </span>
              )}
            </div>

            {/* Delete row */}
            <button
              onClick={() => removeRow(row.id)}
              disabled={row.rowStatus === 'loading'}
              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* ── RUN BUTTON ── */}
      <div className="flex justify-end">
        <button
          onClick={runSwap}
          disabled={running || !pendingCount || !siteConfig.wp_url}
          className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm"
        >
          {running ? <RefreshCw size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
          {running ? 'Đang swap...' : `Swap ${pendingCount} mục`}
        </button>
      </div>

      {/* ── WARNING NOTE ── */}
      <p className="text-xs text-amber-500 dark:text-amber-400 text-center">
        ⚠ Sau khi swap thành công, bài gốc sẽ bị <strong>xoá vĩnh viễn</strong> khỏi WordPress (không vào Trash). Hãy chắc chắn trước khi chạy.
      </p>
    </div>
  );
}
