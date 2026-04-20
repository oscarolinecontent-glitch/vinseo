import React from 'react';
import { Settings, Save, Server } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
          <Settings className="text-violet-400" />
          Cài đặt Cấu hình chung
        </h1>
        <p className="text-sm text-gray-400 mt-1">Các cấu hình chung của hệ thống VinSeo.</p>
      </header>

      <div className="bg-white/5 backdrop-blur-md border border-gray-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server size={18} className="text-blue-400" />
          Hệ thống Background
        </h2>
        
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium text-gray-300">Timeout kết nối WP API (giây)</label>
            <input type="number" defaultValue={60} className="w-full mt-2 bg-black/20 border border-gray-700 rounded-md px-4 py-2 text-white focus:outline-none focus:border-violet-500 transition" />
            <p className="text-xs text-gray-500 mt-1">Thời gian chờ tối đa khi Upload file nặng lên Host.</p>
          </div>
          
          <div className="flex items-center justify-between border-t border-gray-800 pt-6">
            <div>
              <p className="text-sm font-medium text-white">Chế độ Debug</p>
              <p className="text-xs text-gray-500 mt-1">Hiển thị raw payload trong response API.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
            </label>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-black font-bold px-6 py-2 rounded transition-colors">
            <Save size={18} /> Lưu Cài Đặt
          </button>
        </div>
      </div>
    </div>
  );
}
