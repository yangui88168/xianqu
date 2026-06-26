import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';

const tabs = [
  { name: '消息', path: '/chat', icon: '💬' },
  { name: '联系人', path: '/contacts', icon: '👥' },
  { name: '智慧星', path: '/zhihui', icon: '✨' },
  { name: '主页', path: '/profile', icon: '👤' },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const currentPath = router.pathname;

  // 登录页不显示底部导航
  if (currentPath === '/') {
    return <Component {...pageProps} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-y-auto">
        <Component {...pageProps} />
      </div>
      <nav className="flex bg-white border-t shadow-lg">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            onClick={() => router.push(tab.path)}
            className={`flex-1 py-3 flex flex-col items-center text-xs ${
              currentPath.startsWith(tab.path) ? 'text-blue-500' : 'text-gray-500'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="mt-1">{tab.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
