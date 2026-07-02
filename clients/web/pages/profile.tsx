import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

const THEMES = [
  { key: 'default', name: '默认青', primary: '#4a9e8f', primaryLight: '#6bb5a8', primaryDark: '#3d8b7d', bubbleSelfBg: 'rgba(74,158,143,0.85)', bubbleSelfText: '#ffffff' },
  { key: 'stargazing', name: '星游记', primary: '#6366f1', primaryLight: '#818cf8', primaryDark: '#4f46e5', bubbleSelfBg: 'rgba(99,102,241,0.85)', bubbleSelfText: '#ffffff' },
  { key: 'doraemon', name: '哆啦A梦', primary: '#3b82f6', primaryLight: '#60a5fa', primaryDark: '#2563eb', bubbleSelfBg: 'rgba(59,130,246,0.85)', bubbleSelfText: '#ffffff' },
  { key: 'sakura', name: '樱花', primary: '#ec4899', primaryLight: '#f472b6', primaryDark: '#db2777', bubbleSelfBg: 'rgba(236,72,153,0.85)', bubbleSelfText: '#ffffff' },
];

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [signature, setSignature] = useState('');
  const [avatar, setAvatar] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // 签到相关
  const [signedToday, setSignedToday] = useState(false);
  const [streak, setStreak] = useState(0);
  const [exp, setExp] = useState(0);
  const [level, setLevel] = useState(1);
  const [tasks, setTasks] = useState<any[]>([]);
  const [badges, setBadges] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('online');

  // 注销账号相关
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 记录当前上传用途：'avatar' 或 'bg'
  const [uploadPurpose, setUploadPurpose] = useState<'avatar' | 'bg'>('avatar');

  const router = useRouter();
  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();

  // 背景透明度状态
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);

  // 主题相关
  const [currentTheme, setCurrentTheme] = useState('default');

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
        setAvatar(data.avatar || '');
        setCurrentStatus(data.status || 'online');
      })
      .catch(() => router.push('/'));
    // 获取签到状态
    fetch(`${API}/user/signin/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setSignedToday(data.signedToday);
        setStreak(data.streak);
        setExp(data.exp);
        setLevel(data.level);
      });
    // 任务、勋章、收藏
    fetch(`${API}/task/daily`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json()).then(setTasks);
    fetch(`${API}/badge/mine`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json()).then(setBadges);
  }, [router]);

  // 读取自定义背景透明度
  useEffect(() => {
    const saved = localStorage.getItem('bgOpacity');
    if (saved) setOverlayOpacity(parseFloat(saved));
  }, []);

  // 读取当前主题
  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'default';
    setCurrentTheme(saved);
  }, []);

  const applyTheme = (key: string) => {
    const theme = THEMES.find(t => t.key === key) || THEMES[0];
    const root = document.documentElement;
    root.style.setProperty('--theme-primary', theme.primary);
    root.style.setProperty('--theme-primary-light', theme.primaryLight);
    root.style.setProperty('--theme-primary-dark', theme.primaryDark);
    root.style.setProperty('--bubble-self-bg', theme.bubbleSelfBg);
    root.style.setProperty('--bubble-self-text', theme.bubbleSelfText);
    localStorage.setItem('theme', key);
    setCurrentTheme(key);
  };

  // 初始化 Cloudinary Widget
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
          maxFileSize: 5000000,
        },
        (error: any, result: any) => {
          if (!error && result && result.event === 'success') {
            const url = result.info.secure_url;
            const token = localStorage.getItem('token');

            if (uploadPurpose === 'avatar') {
              // 保存头像到服务器
              setAvatar(url);
              fetch(`${API}/user/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ avatar: url }),
              });
            } else {
              // 保存背景到 localStorage 并刷新
              localStorage.setItem('customBg', url);
              window.location.reload();
            }
          }
        }
      );
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [uploadPurpose]);

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

  const changeStatus = async (newStatus: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) setCurrentStatus(newStatus);
  };

  const loadFavorites = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorites`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setFavorites(await res.json());
      setShowFavorites(true);
    }
  };

  const deleteFavorite = async (favId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/user/favorite/${favId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setFavorites(prev => prev.filter(f => f.id !== favId));
  };

  const deleteAccount = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      alert('账号已注销');
      localStorage.clear();
      router.push('/');
    } else {
      alert('注销失败，请重试');
    }
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
            onClick={() => {
              setUploadPurpose('avatar');
              widgetRef.current?.open();
            }}
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

      {/* 状态切换 */}
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🟢</span>
          <div>
            <span className="text-sm font-medium text-gray-700">在线状态</span>
            <p className="text-xs text-gray-400">{currentStatus === 'online' ? '在线' : currentStatus === 'busy' ? '忙碌' : currentStatus === 'dnd' ? '勿扰' : currentStatus === 'away' ? '离开' : '隐身'}</p>
          </div>
        </div>
        <select value={currentStatus} onChange={(e) => changeStatus(e.target.value)} className="text-xs border rounded px-2 py-1">
          <option value="online">在线</option>
          <option value="busy">忙碌</option>
          <option value="dnd">勿扰</option>
          <option value="away">离开</option>
          <option value="invisible">隐身</option>
        </select>
      </div>

      {/* 成长值 + 签到 */}
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">⭐</span>
          <div>
            <span className="text-sm font-medium text-gray-700">成长值</span>
            <p className="text-xs text-gray-400">LV{level} · {exp} 经验值</p>
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

      {/* 勋章 */}
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

      {/* 收藏 */}
      <div className="bg-white mt-3 px-5 py-3 flex items-center justify-between cursor-pointer" onClick={loadFavorites}>
        <div className="flex items-center gap-3">
          <span className="text-lg">📌</span>
          <div>
            <span className="text-sm font-medium text-gray-700">我的收藏</span>
            <p className="text-xs text-gray-400">{showFavorites ? `${favorites.length} 条` : '点击查看'}</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {showFavorites && (
        <div className="bg-white px-5 py-2 max-h-40 overflow-y-auto border-t">
          {favorites.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">暂无收藏</p>
          ) : (
            favorites.map((fav: any) => (
              <div key={fav.id} className="flex justify-between items-center py-1 border-b last:border-b-0">
                <span className="text-xs text-gray-600 truncate">{fav.content || fav.targetId}</span>
                <button onClick={() => deleteFavorite(fav.id)} className="text-red-500 text-xs ml-2">删除</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 设置中心 */}
      <div className="bg-white mt-3">
        {/* 我的动态 */}
        <button onClick={() => router.push('/zhihui/space')} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">📝</span>
            <span className="text-sm text-gray-700">我的动态</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
        </button>

        {/* 我的频道 */}
        <button onClick={() => router.push('/zhihui/channel')} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">📺</span>
            <span className="text-sm text-gray-700">我的频道</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
        </button>

        {/* 我的社区 */}
        <button onClick={() => router.push('/zhihui/community')} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">🏘️</span>
            <span className="text-sm text-gray-700">我的社区</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
        </button>

        <button onClick={() => setShowPasswordModal(true)} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-lg">🔒</span>
            <span className="text-sm text-gray-700">修改密码</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 自定义背景上传 */}
        <button
          onClick={() => {
            setUploadPurpose('bg');
            widgetRef.current?.open();
          }}
          className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🎨</span>
            <span className="text-sm text-gray-700">自定义背景</span>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 背景透明度调节 */}
        <div className="mt-3 px-5 py-2 flex items-center gap-3">
          <span className="text-sm text-gray-600">背景浓度</span>
          <input
            type="range"
            min="0.05"
            max="0.8"
            step="0.05"
            defaultValue={overlayOpacity}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              localStorage.setItem('bgOpacity', val.toString());
              // 触发自定义事件，让 _app.tsx 直接更新遮罩，不刷新页面
              window.dispatchEvent(new CustomEvent('bgOpacityChange', { detail: val }));
            }}
            className="flex-1"
          />
          <span className="text-xs text-gray-500">{Math.round(overlayOpacity * 100)}%</span>
        </div>

        {/* 主题风格选择 */}
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold mb-3 text-gray-700">主题风格</h3>
          <div className="flex gap-3 flex-wrap mb-3">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => applyTheme(t.key)}
                className="flex flex-col items-center gap-1"
              >
                <div
                  className={`w-10 h-10 rounded-full border-2 ${currentTheme === t.key ? 'border-gray-700 ring-2 ring-offset-1 ring-gray-400' : 'border-transparent hover:border-gray-400'}`}
                  style={{ backgroundColor: t.primary }}
                />
                <span className={`text-xs ${currentTheme === t.key ? 'font-bold text-gray-800' : 'text-gray-600'}`}>{t.name}</span>
              </button>
            ))}
          </div>
          
          {/* 自定义气泡颜色 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">自定义聊天气泡颜色</label>
            <input
              type="color"
              onChange={(e) => {
                const color = e.target.value;
                localStorage.setItem('customBubbleColor', color);
                document.documentElement.style.setProperty('--bubble-self-bg', color);
              }}
              className="w-8 h-8 rounded border"
            />
          </div>
        </div>

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

      {/* 注销账号 */}
      <div className="bg-white mt-3">
        <button onClick={() => setShowDeleteModal(true)} className="w-full px-5 py-3 text-red-500 text-sm font-medium hover:bg-gray-50">
          注销账号
        </button>
      </div>

      {/* 退出登录 */}
      <div className="mt-3 bg-white">
        <button onClick={logout} className="w-full px-5 py-3 text-red-500 text-sm font-medium hover:bg-gray-50">
          退出登录
        </button>
      </div>

      {/* 注销确认弹窗 */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-white p-5 rounded shadow-lg w-80" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">确定注销账号？</h3>
            <p className="text-sm text-gray-600 mb-4">注销后所有数据将永久删除，无法恢复。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 bg-gray-200 rounded text-sm">取消</button>
              <button onClick={deleteAccount} className="px-4 py-2 bg-red-500 text-white rounded text-sm">确定注销</button>
            </div>
          </div>
        </div>
      )}

      {/* 密码修改弹窗 */}
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
