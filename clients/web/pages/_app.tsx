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
    return <Component {...pageProps} />;
  }

  return (
    <>
      <Head>
        <link rel="icon" href="data:," />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/twemoji-colr-font@14.0.2/twemoji.css" />
      </Head>
      <div style={{ paddingBottom: '56px' }} className="min-h-screen">
        <Component {...pageProps} />
      </div>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-white border-t shadow-lg"
        style={{ height: '56px' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.path}
            onClick={() => router.push(tab.path)}
            className={`flex-1 py-3 flex flex-col items-center text-xs ${
              router.pathname.startsWith(tab.path) ? 'text-blue-500' : 'text-gray-500'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="mt-1">{tab.name}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
