import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useEffect, useState } from 'react';

const tabs = [
  { name: '消息', path: '/chat', icon: '💬' },
  { name: '联系人', path: '/contacts', icon: '👥' },
  { name: '智慧星', path: '/zhihui', icon: '✨' },
  { name: '主页', path: '/profile', icon: '👤' },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [customBg, setCustomBg] = useState('');

  // 客户端获取自定义背景
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCustomBg(localStorage.getItem('customBg') || '');
    }
  }, []);

  if (router.pathname === '/') {
    return <Component {...pageProps} />;
  }

  const isActive = (path: string) => router.pathname.startsWith(path);

  return (
    <div className="max-w-5xl mx-auto h-dvh flex flex-col shadow-soft bg-white/80 backdrop-blur-md overflow-hidden relative">
      {/* 自定义背景图层（仅客户端生效） */}
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
              <span className="text-xl">{tab.icon}</span>
              <span className="mt-1">{tab.name}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
