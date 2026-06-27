import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function Profile() {
  const [user, setUser] = useState<{ userId: string; username: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/');
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser({ userId: payload.userId, username: payload.username || '' });
    } catch {
      router.push('/');
    }
  }, [router]);

  // 退出登录
  const logout = () => {
    localStorage.clear();
    router.push('/');
  };

  if (!user) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 头部信息 */}
      <div className="bg-white p-6 border-b">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {user.username[0]?.toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold">{user.username}</h2>
            <p className="text-gray-500 text-sm">账号：{user.userId}</p>
          </div>
        </div>
        {/* 编辑资料按钮 */}
        <button
          onClick={() => alert('功能开发中')}
          className="mt-3 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm"
        >
          编辑个人资料
        </button>
      </div>

      {/* 功能入口列表 */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white mt-3">
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">成长值</span>
            <span className="text-gray-400 text-sm">LV1 新人</span>
          </button>
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">我的勋章</span>
            <span className="text-gray-400 text-sm">0 枚</span>
          </button>
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">每日签到</span>
            <span className="text-gray-400 text-sm">未签到</span>
          </button>
        </div>

        <div className="bg-white mt-3">
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">我的收藏</span>
            <span className="text-gray-400 text-sm">0 条</span>
          </button>
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">云盘</span>
            <span className="text-gray-400 text-sm">0 个文件</span>
          </button>
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">我的频道 & 社区</span>
            <span className="text-gray-400 text-sm">0 个</span>
          </button>
        </div>

        <div className="bg-white mt-3">
          <button
            onClick={() => alert('功能开发中')}
            className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
          >
            <span className="text-sm">设置</span>
            <span className="text-gray-400 text-sm">账号、隐私、通知</span>
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50"
          >
            <span className="text-sm text-red-500">退出登录</span>
          </button>
        </div>
      </div>
    </div>
  );
}
