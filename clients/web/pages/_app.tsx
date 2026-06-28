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
  const [mounted, setMounted] = useState(false);
  const [customBg, setCustomBg] = useState('');

  // ✅ 客户端挂载标志，防止服务端执行任何渲染
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      try {
        const bg = localStorage.getItem('customBg');
        if (bg) setCustomBg(bg);
      } catch (e) {}
    }
  }, []);

  // 登录页直接渲染（不影响构建）
  if (router.pathname === '/') {
    return <Component {...pageProps} />;
  }

  // 服务端或未挂载时返回占位（避免预渲染错误）
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
