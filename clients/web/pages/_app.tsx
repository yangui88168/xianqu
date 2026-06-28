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

  if (router.pathname === '/') {
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
      <div className="max-w-5xl mx-auto h-dvh flex flex-col shadow-2xl bg-white overflow-hidden">
        <div className="flex-1 min-h-0 relative">
          <Component {...pageProps} />
        </div>
        <nav
          className="flex-shrink-0 flex items-center justify-around bg-white border-t"
          style={{ height: '56px' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              className={`flex-1 py-3 flex flex-col items-center text-xs ${
                router.pathname.startsWith(tab.path)
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
