import React from 'react';
import Link from 'next/link';
import { Puzzle, ArrowRight, FileText, Image as ImageIcon } from 'lucide-react';

export default function ToolsPage() {
  const tools = [
    {
      id: 'auto-post',
      name: 'Auto Post WordPress',
      desc: 'Công cụ lấy nội dung từ Google Docs, xử lý HTML và đăng bài tự động lên WordPress.',
      icon: <FileText className="text-[#12b981]" size={24} />,
      link: '/dashboard/create-post',
      status: 'Sẵn sàng'
    },
    {
      id: 'image-optimizer',
      name: 'Tối ưu ảnh WebP (Đang phát triển)',
      desc: 'Tự động tải ảnh từ Google Docs, nén sang WebP và Upload lên Media Library WordPress.',
      icon: <ImageIcon className="text-blue-400" size={24} />,
      link: '#',
      status: 'Sắp ra mắt'
    }
  ];

  return (
    <div className="max-w-6xl mx-auto p-8 pt-10">
      <header className="mb-8 border-b border-gray-800 pb-6">
        <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
          <Puzzle className="text-[#12b981]" />
          Hệ Thống Công Cụ (Tools)
        </h1>
        <p className="text-sm text-gray-400 mt-1">Các công cụ tự động hóa quá trình làm SEO và đăng bài.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tools.map(tool => (
          <div key={tool.id} className="bg-[#141b25] border border-gray-800 rounded-xl p-6 flex flex-col justify-between hover:border-gray-600 transition-colors">
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  {tool.icon}
                </div>
                <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${tool.status === 'Sẵn sàng' ? 'bg-[#12b981]/20 text-[#12b981]' : 'bg-gray-800 text-gray-400'}`}>
                  {tool.status}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{tool.name}</h3>
              <p className="text-sm text-gray-400 mb-6 line-clamp-3">{tool.desc}</p>
            </div>
            
            {tool.status === 'Sẵn sàng' ? (
              <Link href={tool.link} className="flex items-center text-sm font-semibold text-[#12b981] hover:text-[#0ea271]">
                Sử dụng công cụ <ArrowRight size={16} className="ml-1" />
              </Link>
            ) : (
              <span className="flex items-center text-sm font-semibold text-gray-500 cursor-not-allowed">
                Chưa mở khóa <ArrowRight size={16} className="ml-1" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
