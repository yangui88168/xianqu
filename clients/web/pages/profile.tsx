import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [signature, setSignature] = useState('');
  const [favorites, setFavorites] = useState<any[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    // 获取用户资料
    fetch(`${API}/user/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setUser(data);
        setNickname(data.nickname || '');
        setSignature(data.signature || '');
      })
      .catch(() => router.push('/'));
  }, [router]);

  // 保存资料
  const saveProfile = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/user/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nickname, signature }),
    });
    setUser((prev: any) => ({ ...prev, nickname, signature }));
    setEditing(false);
  };

  // 加载收藏
  const loadFavorites = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorites`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setFavorites(await res.json());
      setShowFavorites(true);
    }
  };

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
            {(user.nickname || user.username)[0]?.toUpperCase()}
          </div>
          <div className="flex-1">
            {editing ? (
              <>
                <input
                  className="w-full p-1 border rounded text-sm mb-1"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="昵称"
                />
                <input
                  className="w-full p-1 border rounded text-sm"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="个性签名"
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveProfile} className="bg-blue-500 text-white px-3 py-1 rounded text-xs">保存</button>
                  <button onClick={() => setEditing(false)} className="bg-gray-300 px-3 py-1 rounded text-xs">取消</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold">{user.nickname || user.username}</h2>
                <p className="text-gray-500 text-sm">{user.signature || '这个人很懒，什么都没写'}</p>
              </>
            )}
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} className="mt-3 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm">
            编辑个人资料
          </button>
        )}
      </div>

      {/* 成长值 */}
      <div className="bg-white mt-3 px-6 py-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium">成长值</span>
          <span className="text-gray-400 text-sm">LV{user.level} · {user.exp} 经验值</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min((user.exp % 1000) / 10, 100)}%` }}></div>
        </div>
      </div>

      {/* 收藏中心 */}
      <div className="bg-white mt-3">
        <button
          onClick={loadFavorites}
          className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50"
        >
          <span className="text-sm">我的收藏</span>
          <span className="text-gray-400 text-sm">{showFavorites ? `${favorites.length} 条` : '点击查看'}</span>
        </button>
        {showFavorites && (
          <div className="max-h-40 overflow-y-auto">
            {favorites.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-4">暂无收藏</p>
            ) : (
              favorites.map((fav: any) => (
                <div key={fav.id} className="px-6 py-2 border-b text-sm text-gray-600">
                  {fav.content || fav.targetId}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 设置中心 */}
      <div className="bg-white mt-3">
        <button onClick={() => alert('账号安全设置开发中')} className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50">
          <span className="text-sm">账号安全</span>
          <span className="text-gray-400 text-sm">修改密码</span>
        </button>
        <button onClick={() => alert('隐私设置开发中')} className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50">
          <span className="text-sm">隐私设置</span>
          <span className="text-gray-400 text-sm">谁可以加我、看我</span>
        </button>
        <button onClick={() => alert('通知设置开发中')} className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50">
          <span className="text-sm">通知设置</span>
          <span className="text-gray-400 text-sm">消息提醒</span>
        </button>
      </div>

      {/* 退出 */}
      <div className="mt-3 bg-white">
        <button onClick={logout} className="w-full text-left px-6 py-4 text-red-500 text-sm hover:bg-gray-50">
          退出登录
        </button>
      </div>
    </div>
  );
}
