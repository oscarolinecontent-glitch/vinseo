'use client';

import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Settings, Key, RefreshCw, CheckCircle2, AlertCircle, FileArchive, Send, Download, Link as LinkIcon, FolderSync } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import JSZip from 'jszip';

type ImageFile = {
  name: string;
  blob: Blob;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message: string;
};

type ProcessResult = {
  driveUrl: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  message: string;
};

export default function DriveDownloaderPage() {
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'zip_to_wp' | 'drive_to_zip'>('zip_to_wp');
  
  // Tab: Drive to Zip
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [driveUrlsText, setDriveUrlsText] = useState('');
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [driveResults, setDriveResults] = useState<ProcessResult[]>([]);

  // Tab: Zip to WP
  const [loadingType, setLoadingType] = useState<'wp' | null>(null);
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
  const [images, setImages] = useState<ImageFile[]>([]);
  const [globalMessage, setGlobalMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('google_drive_api_key');
    if (savedKey) setGoogleApiKey(savedKey);

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

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGoogleApiKey(val);
    localStorage.setItem('google_drive_api_key', val);
  };

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
       alert('Vui lòng chọn file .zip');
       return;
    }

    setGlobalMessage('Đang giải nén file zip...');
    try {
      const zip = await JSZip.loadAsync(file);
      const extractedImages: ImageFile[] = [];

      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir) {
          const lowerName = filename.toLowerCase();
          if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp') || lowerName.endsWith('.gif')) {
             const blob = await zipEntry.async('blob');
             const shortName = filename.split('/').pop() || filename;
             extractedImages.push({
                name: shortName,
                blob,
                status: 'pending',
                message: 'Chờ tải lên'
             });
          }
        }
      }

      setImages(extractedImages);
      setGlobalMessage(`Đã tìm thấy ${extractedImages.length} ảnh trong file Zip.`);
    } catch (err: any) {
      console.error(err);
      setGlobalMessage(`Lỗi đọc file zip: ${err.message}`);
    }
  };

  const handleUploadToWp = async () => {
    if (!siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      alert('Vui lòng cấu hình kết nối WP!');
      return;
    }

    if (images.length === 0) {
      alert('Chưa có ảnh nào để tải lên. Vui lòng chọn file Zip có chứa ảnh.');
      return;
    }

    setLoadingType('wp');
    setGlobalMessage('Bắt đầu tải lên WordPress...');
    
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.status === 'success') continue;

      setImages(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'uploading', message: 'Đang tải lên...' } : item));

      try {
        const formData = new FormData();
        formData.append('file', img.blob, img.name);
        formData.append('filename', img.name);
        formData.append('siteConfig', JSON.stringify(siteConfig));

        const res = await fetch('/api/wp/upload-media', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (res.ok && data.success) {
          setImages(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'success', message: 'Tải lên thành công' } : item));
          successCount++;
        } else {
          setImages(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: data.message || 'Lỗi từ server' } : item));
          errorCount++;
        }

      } catch (err: any) {
        setImages(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: err.message } : item));
        errorCount++;
      }

      setGlobalMessage(`Tiến độ: ${successCount + errorCount}/${images.length} ảnh... (${successCount} ✓, ${errorCount} ✗)`);
    }

    setLoadingType(null);
    setGlobalMessage(`Hoàn tất: ${successCount} ảnh tải lên thành công, ${errorCount} lỗi.`);
  };

  const extractFolderId = (url: string) => {
    const match = url.match(/folders\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  };

  const handleDownloadZipFromDrive = async () => {
    if (!driveUrlsText.trim()) {
      alert('Vui lòng nhập danh sách link Google Drive!');
      return;
    }

    const driveUrls = driveUrlsText.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    const validUrls = driveUrls.filter(u => extractFolderId(u));

    if (validUrls.length === 0) {
      alert('Không tìm thấy ID thư mục trong các link đã nhập!');
      return;
    }

    const initialResults: ProcessResult[] = validUrls.map(url => ({ driveUrl: url, status: 'pending', message: 'Chờ...' }));
    setDriveResults(initialResults);
    setGlobalMessage('Đang tải ảnh từ Google Drive...');
    setDownloadingZip(true);

    try {
      const apiKeyToUse = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      if (!apiKeyToUse) throw new Error("Chưa cấu hình API Key trong hệ thống.");

      const zip = new JSZip();
      let totalDownloaded = 0;

      for (let i = 0; i < validUrls.length; i++) {
        const url = validUrls[i];
        const folderId = extractFolderId(url);
        if (!folderId) continue;

        setDriveResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'loading', message: 'Đang lấy danh sách ảnh...' } : item));

        try {
          // 1. Get file list
          const query = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
          const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${apiKeyToUse}&fields=files(id,name,mimeType)`;
          const listRes = await fetch(listUrl);
          if (!listRes.ok) throw new Error(`Google API Lỗi: ${listRes.statusText}`);
          const listData = await listRes.json();
          const files = listData.files || [];

          if (files.length === 0) {
            setDriveResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: 'Không có ảnh nào trong thư mục' } : item));
            continue;
          }

          let folderDownloaded = 0;

          // 2. Download each file
          for (let j = 0; j < files.length; j++) {
            const file = files[j];
            setDriveResults(prev => prev.map((item, idx) => idx === i ? { ...item, message: `Đang tải ${j + 1}/${files.length}...` } : item));
            
            try {
              const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKeyToUse}`;
              const dlRes = await fetch(downloadUrl);
              if (!dlRes.ok) throw new Error('Download failed');
              const blob = await dlRes.blob();
              let filename = file.name || `${file.id}.jpg`;
              
              // Đảm bảo không bị trùng tên file gây ghi đè trong zip
              if (zip.file(filename)) {
                const extIndex = filename.lastIndexOf('.');
                if (extIndex !== -1) {
                  filename = `${filename.substring(0, extIndex)}_${file.id.substring(0, 5)}${filename.substring(extIndex)}`;
                } else {
                  filename = `${filename}_${file.id.substring(0, 5)}`;
                }
              }

              zip.file(filename, blob);
              folderDownloaded++;
              totalDownloaded++;
            } catch (err) {
              console.error(`Lỗi tải file ${file.id}:`, err);
            }
          }

          setDriveResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'success', message: `Đã tải ${folderDownloaded} ảnh` } : item));
        } catch (err: any) {
           setDriveResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: err.message } : item));
        }
      }

      if (totalDownloaded > 0) {
        setGlobalMessage('Đang nén thành file Zip...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const downloadUrl = window.URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `drive_images_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
        setGlobalMessage(`Hoàn tất tải và nén ${totalDownloaded} ảnh!`);
      } else {
        setGlobalMessage('Lỗi: Không tải được ảnh nào.');
      }

    } catch (err: any) {
      setGlobalMessage(`Lỗi kết nối: ${err.message}`);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
          <FolderSync className="text-blue-400" />
          Công Cụ Đồng Bộ Ảnh (Drive & WP)
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Quản lý và đồng bộ ảnh từ thư mục Google Drive lên Media Library của WordPress.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-8">
        <button
          onClick={() => { setActiveTab('zip_to_wp'); setGlobalMessage(''); }}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === 'zip_to_wp'
              ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/10'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          }`}
        >
          <UploadCloud size={18} /> Đẩy File Zip Lên WP
        </button>
        <button
          onClick={() => { setActiveTab('drive_to_zip'); setGlobalMessage(''); }}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === 'drive_to_zip'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
          }`}
        >
          <Download size={18} /> Tải Ảnh Từ Drive Về Máy
        </button>
      </div>

      <div className="space-y-8">
        {/* TAB: ĐẨY FILE ZIP LÊN WP */}
        {activeTab === 'zip_to_wp' && (
          <>
            {/* Section 1: WP Config */}
            <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Settings size={18} className="text-violet-400" />
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
                <select value={selectedProjectId} onChange={handleProjectChange} className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition">
                  <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value="">-- Nhập thủ công --</option>
                  {projects.map(p => (
                    <option className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white" key={p.id} value={p.id.toString()}>{p.name} ({p.url})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">URL Website</label>
                  <input type="url" name="wp_url" value={siteConfig.wp_url} onChange={handleConfigChange} placeholder="https://domain.com" className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">Username</label>
                  <input type="text" autoComplete="new-password" name="wp_user" value={siteConfig.wp_user} onChange={handleConfigChange} placeholder="admin" className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Key size={12} /> Application Password
                  </label>
                  <input type="password" name="wp_app_pass" value={siteConfig.wp_app_pass} onChange={handleConfigChange} placeholder="xxxx xxxx xxxx xxxx" className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 transition" />
                </div>
              </div>
            </div>

            {/* Section 2: Upload Zip */}
            <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <FileArchive size={18} className="text-amber-500" />
                2. Tải Lên File Zip
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Cách dễ nhất: Vào Google Drive, click chuột phải vào thư mục ảnh và chọn Tải xuống (Download). Drive sẽ tự nén thành file .zip. Bấm vào dưới đây để upload file .zip đó lên.
              </p>
              
              <input 
                type="file" 
                accept=".zip" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
              />
              <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-violet-500 dark:hover:border-violet-500 rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-colors text-gray-500 hover:text-violet-500 bg-gray-50 dark:bg-white/5 hover:bg-violet-50 dark:hover:bg-violet-900/10"
              >
                 <FileArchive size={48} className="opacity-70" />
                 <span className="font-bold text-base">Bấm để chọn file .zip</span>
              </button>
            </div>

            {/* Results Table */}
            {images.length > 0 && (
              <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    📊 Trạng Thái Upload ({images.filter(i => i.status === 'success').length}/{images.length})
                  </h2>
                </div>
                
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  <div className="hidden md:grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 pb-2 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-[#111111] z-10">
                    <div className="col-span-1 text-center">#</div>
                    <div className="col-span-6">Tên ảnh</div>
                    <div className="col-span-2 text-center">Trạng thái</div>
                    <div className="col-span-3">Ghi chú</div>
                  </div>

                  {images.map((img, index) => (
                    <div key={index} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md px-3 py-2 transition-colors ${
                      img.status === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50'
                        : img.status === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                        : img.status === 'uploading'
                        ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/50'
                        : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
                    }`}>
                      <div className="col-span-1 text-center text-xs text-gray-400 font-mono">{index + 1}</div>
                      <div className="col-span-6 text-xs font-medium truncate" title={img.name}>
                        {img.name}
                      </div>
                      <div className="col-span-2 text-center">
                        {img.status === 'success' ? <span className="text-xs font-semibold text-emerald-500 flex items-center justify-center gap-1"><CheckCircle2 size={12}/> OK</span> :
                         img.status === 'error' ? <span className="text-xs font-semibold text-red-500 flex items-center justify-center gap-1"><AlertCircle size={12}/> Lỗi</span> :
                         img.status === 'uploading' ? <span className="text-xs font-semibold text-blue-500 flex items-center justify-center gap-1"><RefreshCw size={12} className="animate-spin"/> Đang up</span> :
                         <span className="text-gray-400 text-[10px] uppercase">Chờ</span>}
                      </div>
                      <div className="col-span-3 text-[11px] text-gray-500 dark:text-gray-400 truncate" title={img.message}>
                        {img.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions Button */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleUploadToWp}
                disabled={loadingType !== null || images.length === 0}
                className={`flex items-center justify-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
                  loadingType !== null || images.length === 0
                    ? 'bg-gray-400 dark:bg-gray-700 text-white cursor-not-allowed opacity-70'
                    : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all'
                }`}
              >
                {loadingType === 'wp' ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" /> Đang đẩy lên WP...
                  </>
                ) : (
                  <>
                    <Send size={18} /> Bắt Đầu Đẩy {images.length > 0 ? images.length : ''} Ảnh
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* TAB: TẢI TỪ DRIVE VỀ MÁY */}
        {activeTab === 'drive_to_zip' && (
          <>
            {/* Section: Drive Links */}
            <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <LinkIcon size={18} className="text-blue-400" />
                Danh Sách Link Thư Mục Google Drive
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Mỗi dòng 1 link thư mục. (Thư mục phải được set quyền "Anyone with the link can view").
              </p>
              <textarea
                value={driveUrlsText}
                onChange={(e) => setDriveUrlsText(e.target.value)}
                placeholder={`https://drive.google.com/drive/folders/ID1\nhttps://drive.google.com/drive/folders/ID2`}
                rows={6}
                className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-gray-700 rounded-md px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition font-mono"
              />
              <p className="text-xs text-gray-400 mt-2">
                Tổng cộng: <strong className="text-blue-500">{driveUrlsText.split('\n').filter(u => u.trim()).length}</strong> URL
              </p>
            </div>

            {/* Drive Results */}
            {driveResults.length > 0 && (
              <div className="bg-white dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    📊 Trạng Thái
                  </h2>
                </div>
                <div className="space-y-2">
                  {driveResults.map((result, index) => (
                    <div key={index} className={`grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md px-3 py-2 transition-colors ${
                      result.status === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50'
                        : result.status === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                        : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-800'
                    }`}>
                      <div className="col-span-1 text-center text-xs text-gray-400 font-mono">{index + 1}</div>
                      <div className="col-span-7 text-xs font-medium truncate" title={result.driveUrl}>
                        {result.driveUrl}
                      </div>
                      <div className="col-span-4 text-[11px] text-gray-500 dark:text-gray-400 truncate" title={result.message}>
                        {result.status === 'success' ? <span className="text-emerald-500">✓ {result.message}</span> : 
                         result.status === 'error' ? <span className="text-red-500">✗ {result.message}</span> : 
                         <span className="text-gray-400">Chờ...</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleDownloadZipFromDrive}
                disabled={downloadingZip}
                className={`flex items-center justify-center gap-2 px-8 py-3 rounded-md font-bold transition-all ${
                  downloadingZip
                    ? 'bg-gray-400 dark:bg-gray-700 text-white cursor-not-allowed opacity-70'
                    : 'bg-blue-600 hover:bg-blue-500 text-white hover:scale-[1.02] shadow-lg shadow-blue-500/30 transition-all'
                }`}
              >
                {downloadingZip ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" /> Đang lấy ảnh...
                  </>
                ) : (
                  <>
                    <Download size={18} /> Tải Về 1 File Zip
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* Global Message Box for both tabs */}
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

      </div>
    </div>
  );
}
