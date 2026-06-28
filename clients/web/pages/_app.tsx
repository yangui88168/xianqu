import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import Head from 'next/head';

const tabs = [
  { name: '消息', path: '/chat', icon: '💬' },
  { name: '联系人', path: '/contacts', icon: '👥' },
  { name: '智慧星', path: '/zhihui', icon: '✨' },
  { name: '主页', path: '/profile', icon: '👤' },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const currentPath = router.pathname;

  // 登录页不显示底部导航和居中容器
  if (currentPath === '/') {
    return (
      <>
        <Head>
          <link rel="icon" href="data:," />
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/twemoji-colr-font@14.0.2/twemoji.css" />
        </Head>
        <Component {...pageProps} />
      </>
    );
  }

  return (
    <>
      <Head>
        <link rel="icon" href="data:," />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/twemoji-colr-font@14.0.2/twemoji.css" />
      </Head>
      {/* 修复高度继承：强制 html、body、#__next 占满全高 */}
      <style jsx global>{`
        html,
        body,
        #__next {
          height: 100%;
          margin: 0;
          padding: 0;
        }
      `}</style>
      <div className="max-w-5xl mx-auto h-dvh flex flex-col shadow-2xl bg-white relative">
        <div className="flex-1 min-h-0 overflow-hidden">
          <Component {...pageProps} />
        </div>
        <nav className="flex bg-white border-t shadow-lg flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              className={`flex-1 py-3 flex flex-col items-center text-xs ${
                currentPath.startsWith(tab.path)
                  ? 'text-blue-500'
                  : 'text-gray-500'
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="mt-1">{tab.name}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
