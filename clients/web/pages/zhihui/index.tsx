import { useRouter } from 'next/router';

const modules = [
  { title: '个人空间', desc: '动态、相册、留言板', path: '/zhihui/space', icon: '🏠' },
  { title: '频道系统', desc: '创建频道、订阅、发帖', path: '/zhihui/channel', icon: '📺' },
  { title: '社区系统', desc: '社区、话题、精华', path: '/zhihui/community', icon: '🏘️' },
  { title: '发现', desc: '热门、推荐、搜索', path: '/zhihui/discover', icon: '🔍' },
];

export default function ZhihuiHome() {
  const router = useRouter();
  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4">
      <h1 className="text-xl font-bold text-center mb-6">智慧星</h1>
      <div className="grid grid-cols-2 gap-4">
        {modules.map((mod) => (
          <button
            key={mod.path}
            onClick={() => router.push(mod.path)}
            className="bg-white rounded-2xl shadow p-6 flex flex-col items-center justify-center hover:shadow-md transition active:scale-95"
          >
            <span className="text-4xl mb-3">{mod.icon}</span>
            <h2 className="text-lg font-bold text-gray-800">{mod.title}</h2>
            <p className="text-xs text-gray-500 mt-1">{mod.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
