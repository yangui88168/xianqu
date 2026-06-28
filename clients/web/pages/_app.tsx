import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useEffect, useState } from 'react';

const tabs = [
  { name: '消息', path: '/chat' },
  { name: '联系人', path: '/contacts' },
  { name: '智慧星', path: '/zhihui' },
  { name: '主页', path: '/profile' },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [customBg, setCustomBg] = useState('');

  // ✅ 所有客户端 API 都在 useEffect 中安全访问
  useEffect(() => {
    setMounted(true);
    try {
      const bg = localStorage.getItem('customBg');
      if (bg) setCustomBg(bg);
    } catch (e) {}
  }, []);

  // 登录页直接渲染（不影响构建）
  if (router.pathname === '/') {
    return <Component {...pageProps} />;
  }

  // 服务端返回加载占位，避免预渲染错误
  if (!mounted) {
    return (
      <div className="h-dvh flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  const isActive = (path: string) => router.pathname.startsWith(path);

  return (
    <div className="max-w-5xl mx-auto h-dvh flex flex-col shadow-soft bg-white/80 backdrop-blur-md overflow-hidden relative">
      {/* 自定义背景（仅客户端渲染） */}
      {customBg && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-10 pointer-events-none z-0"
          style={{ backgroundImage: `url(${customBg})` }}
        />
      )}
      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 relative">
          <Component {...pageProps} />
        </div>
        <nav className="flex-shrink-0 flex items-center justify-around bg-white border-t" style={{ height: '56px' }}>
          {tabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              className={`flex-1 py-2 flex flex-col items-center justify-center text-xs ${isActive(tab.path) ? 'text-blue-500' : 'text-gray-500'}`}
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {tab.path === '/chat' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />}
                {tab.path === '/contacts' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />}
                {tab.path === '/zhihui' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />}
                {tab.path === '/profile' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />}
              </svg>
              <span>{tab.name}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
