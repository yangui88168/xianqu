import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

const TASK_CONFIG: any = {
  send_message: { desc: '发送一条消息' },
  add_friend: { desc: '添加一个好友' },
  make_call: { desc: '发起一次通话' },
  create_group: { desc: '创建一个群聊' },
  publish_post: { desc: '发布一条动态' },
};

const STATUS_LIST = ['online', 'busy', 'dnd', 'away', 'invisible'];
const STATUS_ICON: Record<string, string> = {
  online: '🟢', busy: '🟠', dnd: '🔴', away: '🟡', invisible: '⚫',
};
const STATUS_TEXT: Record<string, string> = {
  online: '在线', busy: '忙碌', dnd: '勿扰', away: '离开', invisible: '隐身',
};

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [signature, setSignature] = useState('');
  const [avatar, setAvatar] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [signedToday, setSignedToday] = useState(false);
  const [streak, setStreak] = useState(0);
  const [exp, setExp] = useState(0);
  const [level, setLevel] = useState(1);

  const [badges, setBadges] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('online');

  const router = useRouter();
  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();

  const cycleStatus = async () => {
    const idx = STATUS_LIST.indexOf(currentStatus);
    const nextIdx = (idx + 1) % STATUS_LIST.length;
    const newStatus = STATUS_LIST[nextIdx];
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) setCurrentStatus(newStatus);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    fetch(`${API}/user/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setUser(data);
        setNickname(data.nickname || '');
        setSignature(data.signature || '');
        setAvatar(data.avatar || '');
        setCurrentStatus(data.status || 'online');
      })
      .catch(() => router.push('/'));
    fetch(`${API}/user/signin/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setSignedToday(data.signedToday);
        setStreak(data.streak);
        setExp(data.exp);
        setLevel(data.level);
      });
    loadBadges();
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const script = document.createElement('script');
    script.src = 'https://widget.cloudinary.com/v2.0/global/all.js';
    script.async = true;
    script.onload = () => {
      cloudinaryRef.current = (window as any).cloudinary;
      widgetRef.current = cloudinaryRef.current.createUploadWidget(
        {
          cloudName: 'dmfjdnn4f',
          uploadPreset: 'xianqu_preset',
          maxFiles: 1,
          clientAllowedFormats: ['image'],
          maxFileSize: 2000000,
        },
        (error: any, result: any) => {
          if (!error && result && result.event === 'success') {
            const url = result.info.secure_url;
            setAvatar(url);
            const token = localStorage.getItem('token');
            fetch(`${API}/user/profile`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ avatar: url }),
            });
          }
        }
      );
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  const saveProfile = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/user/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nickname, signature, avatar }),
    });
    setUser((prev: any) => ({ ...prev, nickname, signature, avatar }));
    setEditing(false);
  };

  const changePassword = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    if (res.ok) {
      alert('密码修改成功');
      setShowPasswordModal(false);
    } else {
      const err = await res.json();
      alert(err.error || '修改失败');
    }
  };

  const handleSignin = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      alert(`签到成功！获得 ${data.expGain} 经验值，连续签到 ${data.streak} 天`);
      setSignedToday(true);
      setStreak(data.streak);
      setExp(data.totalExp);
      setLevel(data.level);
    } else {
      const err = await res.json();
      alert(err.error || '签到失败');
    }
  };

  const loadBadges = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/badge/my`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setBadges(await res.json());
  };

  const loadFavorites = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorites`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setFavorites(await res.json());
      setShowFavorites(true);
    }
  };

  const deleteFavorite = async (favoriteId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorite/${favoriteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFavorites(prev => prev.filter(fav => fav.id !== favoriteId));
  };

  const logout = () => {
    localStorage.clear();
    router.push('/');
  };

  if (!user) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* 头部信息 */}
      <div className="bg-white p-6 border-b">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden cursor-pointer bg-blue-500"
            onClick={() => widgetRef.current?.open()}
          >
            {avatar ? (
              <img src={avatar} alt="头像" className="w-full h-full object-cover" />
            ) : (
              (user.nickname || user.username)[0]?.toUpperCase()
            )}
          </div>
          <div className="flex-1">
            {editing ? (
              <>
                <input className="w-full p-1 border rounded text-sm mb-1" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="昵称" />
                <input className="w-full p-1 border rounded text-sm" value={signature} onChange={e => setSignature(e.target.value)} placeholder="个性签名" />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveProfile} className="bg-blue-500 text-white px-3 py-1 rounded text-xs">保存</button>
                  <button onClick={() => setEditing(false)} className="bg-gray-300 px-3 py-1 rounded text-xs">取消</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold">{user.nickname || user.username}</h2>
                <p className="text-gray-500 text-sm">{user.signature || '这个人很懒，什么都没写'}</p>
                <p className="text-gray-400 text-xs mt-1">UID: {user.id}</p>
                <div className="mt-2">
                  <button onClick={cycleStatus} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-xs hover:bg-gray-200">
                    <span>{STATUS_ICON[currentStatus]}</span>
                    <span>{STATUS_TEXT[currentStatus]}</span>
                    <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 10l5 5 5-5" />
                    </svg>
                  </button>
                </div>
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
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">⭐</span>
          <div>
            <span className="text-sm font-medium text-gray-700">成长值</span>
            <p className="text-xs text-gray-400">LV{level} · {exp} 经验值</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* 每日签到 */}
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">📅</span>
          <div>
            <span className="text-sm font-medium text-gray-700">每日签到</span>
            <p className="text-xs text-gray-400">{signedToday ? `已签到 · 连续${streak}天` : '今日未签到'}</p>
          </div>
        </div>
        <button
          onClick={handleSignin}
          disabled={signedToday}
          className={`px-3 py-1 rounded-full text-xs font-medium ${signedToday ? 'bg-gray-200 text-gray-400' : 'bg-green-500 text-white'}`}
        >
          {signedToday ? '已签到' : '签到'}
        </button>
      </div>

      {/* 我的勋章 */}
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🏅</span>
          <div>
            <span className="text-sm font-medium text-gray-700">我的勋章</span>
            <p className="text-xs text-gray-400">{badges.length > 0 ? `${badges.length} 枚` : '暂无勋章'}</p>
          </div>
        </div>
        <div className="flex -space-x-2">
          {badges.slice(0, 3).map((badge: any) => (
            <span key={badge.id} className="text-lg" title={badge.name}>{badge.icon || '🎖️'}</span>
          ))}
          {badges.length > 3 && <span className="text-xs text-gray-400 ml-2">+{badges.length - 3}</span>}
        </div>
      </div>

      {/* 我的收藏 */}
      <div className="bg-white mt-3">
        <button
          onClick={loadFavorites}
          className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">❤️</span>
            <span className="text-sm font-medium text-gray-700">我的收藏</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{showFavorites ? `${favorites.length} 条` : '点击查看'}</span>
            <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        {showFavorites && (
          <div className="max-h-40 overflow-y-auto bg-gray-50">
            {favorites.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-4">暂无收藏</p>
            ) : (
              favorites.map((fav: any) => (
                <div key={fav.id} className="flex items-center justify-between px-5 py-2 border-b text-sm">
                  <span className="text-gray-600 truncate flex-1">{fav.content || fav.targetId}</span>
                  <button onClick={() => deleteFavorite(fav.id)} className="text-red-500 text-xs ml-2 hover:underline">删除</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 设置中心 */}
      <div className="bg-white mt-3">
        <button onClick={() => setShowPasswordModal(true)} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">🔒</span>
            <span className="text-sm text-gray-700">修改密码</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button onClick={() => alert('隐私设置开发中')} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">🔐</span>
            <span className="text-sm text-gray-700">隐私设置</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button onClick={() => alert('通知设置开发中')} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">🔔</span>
            <span className="text-sm text-gray-700">通知设置</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="mt-3 bg-white">
        <button onClick={logout} className="w-full px-5 py-3 text-red-500 text-sm font-medium hover:bg-gray-50">
          退出登录
        </button>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50" onClick={() => setShowPasswordModal(false)}>
          <div className="bg-white p-5 rounded shadow-lg w-80" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">修改密码</h3>
            <input type="password" className="w-full border p-2 rounded mb-2 text-sm" placeholder="旧密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
            <input type="password" className="w-full border p-2 rounded mb-3 text-sm" placeholder="新密码（至少6位）" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPasswordModal(false)} className="px-3 py-1 bg-gray-300 rounded text-sm">取消</button>
              <button onClick={changePassword} className="px-3 py-1 bg-blue-500 text-white rounded text-sm">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
