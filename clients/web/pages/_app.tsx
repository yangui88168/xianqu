import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
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
  const [overlayOpacity, setOverlayOpacity] = useState(0.15); // 从 0.25 调整为 0.15

  useEffect(() => {
    setMounted(true);
    try {
      const bg = localStorage.getItem('customBg');
      if (bg) setCustomBg(bg);
      const opacity = localStorage.getItem('bgOpacity');
      if (opacity) setOverlayOpacity(parseFloat(opacity));
    } catch (e) {}
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => setOverlayOpacity(e.detail);
    window.addEventListener('bgOpacityChange', handler as EventListener);
    return () => window.removeEventListener('bgOpacityChange', handler as EventListener);
  }, []);

  if (router.pathname === '/') return <Component {...pageProps} />;
  if (!mounted) return <div className="h-dvh flex items-center justify-center bg-gray-50"><p>加载中...</p></div>;

  const isActive = (path: string) => router.pathname.startsWith(path);

  return (
    <>
      {/* 独立背景层，不影响布局 */}
      {customBg && (
        <>
          <div className="fixed inset-0 z-0 pointer-events-none bg-cover bg-center bg-fixed"
               style={{ backgroundImage: `url(${customBg})`, filter: 'blur(20px)' }} />
          <div className="fixed inset-0 z-[1] pointer-events-none"
               style={{ backgroundColor: `rgba(255,255,255,${overlayOpacity})` }} />
        </>
      )}

      {/* 应用主容器：全屏高度，弹性列布局，禁止溢出 */}
      <div className="w-full max-w-5xl mx-auto h-dvh flex flex-col shadow-2xl bg-white/70 backdrop-blur-sm overflow-hidden relative z-10">
        {/* 唯一内容区域：弹性填充，高度受控，不可撑开 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Component {...pageProps} />
        </div>

        {/* 底部导航栏：固定高度，绝不滚动，始终在最前 */}
        <nav className="z-50 flex-shrink-0 flex items-center justify-around bg-white/80 backdrop-blur-md border-t" style={{ height: '56px' }}>
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
    </>
  );
}
