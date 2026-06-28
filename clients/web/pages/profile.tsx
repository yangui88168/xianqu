import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

// 任务类型描述（与后端一致）
const TASK_CONFIG: any = {
  send_message: { desc: '发送一条消息' },
  add_friend: { desc: '添加一个好友' },
  make_call: { desc: '发起一次通话' },
  create_group: { desc: '创建一个群聊' },
  publish_post: { desc: '发布一条动态' },
};

// 状态配置
const STATUS_LIST = ['online', 'busy', 'dnd', 'away', 'invisible'];
const STATUS_ICON: Record<string, string> = {
  online: '🟢',
  busy: '🟠',
  dnd: '🔴',
  away: '🟡',
  invisible: '⚫',
};
const STATUS_TEXT: Record<string, string> = {
  online: '在线',
  busy: '忙碌',
  dnd: '勿扰',
  away: '离开',
  invisible: '隐身',
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

  // 签到相关
  const [signedToday, setSignedToday] = useState(false);
  const [streak, setStreak] = useState(0);
  const [exp, setExp] = useState(0);
  const [level, setLevel] = useState(1);

  // 每日任务
  const [tasks, setTasks] = useState<any[]>([]);

  // 勋章
  const [badges, setBadges] = useState<any[]>([]);

  // 收藏
  const [favorites, setFavorites] = useState<any[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  // 隐私与通知设置
  const [settings, setSettings] = useState({
    allowFriendRequest: true,
    allowSearch: true,
    notifyMessage: true,
    notifyCall: true,
    notifyPost: true,
  });

  // 在线状态
  const [currentStatus, setCurrentStatus] = useState('online');

  // 展开/折叠面板
  const [showGrowth, setShowGrowth] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showBadges, setShowBadges] = useState(false);

  const router = useRouter();
  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();

  // 加载设置
  const loadSettings = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/settings`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setSettings(await res.json());
  };

  // 更新单个设置并同步后端
  const updateSetting = async (key: string, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    const token = localStorage.getItem('token');
    await fetch(`${API}/user/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newSettings),
    });
  };

  // 切换在线状态（循环切换）
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
    if (res.ok) {
      setCurrentStatus(newStatus);
    }
  };

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
    // 获取每日任务
    loadTasks();
    // 获取勋章
    loadBadges();
    // 获取隐私设置
    loadSettings();
  }, [router]);

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
      body: JSON.stringify({}),   // 发送空 JSON 对象
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

  const loadTasks = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/task/daily`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setTasks(await res.json());
  };

  const loadBadges = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/badge/my`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setBadges(await res.json());
  };

  // 加载收藏列表
  const loadFavorites = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorites`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setFavorites(await res.json());
      setShowFavorites(true);
    }
  };

  // 删除收藏
  const deleteFavorite = async (favoriteId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/favorite/${favoriteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setFavorites(prev => prev.filter(fav => fav.id !== favoriteId));
    }
  };

  const logout = () => {
    localStorage.clear();
    router.push('/');
  };

  if (!user) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-gray-50">
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
                {/* 状态切换按钮 */}
                <div className="mt-2">
                  <button
                    onClick={cycleStatus}
                    className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-xs hover:bg-gray-200"
                  >
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

      {/* 成长值 & 签到 */}
      <div className="bg-white mt-3">
        <button
          onClick={() => setShowGrowth(!showGrowth)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">⭐</span>
            <span className="text-sm font-medium text-gray-700">成长值</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">LV{level} · {exp} 经验值</span>
            <svg className={`w-4 h-4 text-gray-300 transition-transform ${showGrowth ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        {showGrowth && (
          <div className="px-5 py-4 bg-gray-50">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min((exp % 100) / 100 * 100, 100)}%` }}></div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {signedToday ? `已签到 · 连续${streak}天` : '今日未签到'}
              </span>
              <button
                onClick={handleSignin}
                disabled={signedToday}
                className={`px-4 py-1 rounded-full text-sm ${signedToday ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-500 text-white hover:bg-green-600'}`}
              >
                {signedToday ? '已签到' : '签到'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 每日任务 */}
      <div className="bg-white">
        <button
          onClick={() => { setShowTasks(!showTasks); if (!showTasks) loadTasks(); }}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">📋</span>
            <span className="text-sm font-medium text-gray-700">每日任务</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{tasks.filter(t => t.completed).length}/{tasks.length} 完成</span>
            <svg className={`w-4 h-4 text-gray-300 transition-transform ${showTasks ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        {showTasks && (
          <div className="px-5 py-3 bg-gray-50">
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-400">暂无任务</p>
            ) : (
              tasks.map((task: any) => (
                <div key={task.id} className="flex items-center justify-between py-1">
                  <span className="text-sm">
                    {TASK_CONFIG[task.taskType]?.desc || task.taskType} ({task.progress}/{task.target})
                  </span>
                  {task.completed ? (
                    <span className="text-green-500 text-sm">已完成</span>
                  ) : (
                    <span className="text-gray-400 text-sm">进行中</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 我的勋章 */}
      <div className="bg-white">
        <button
          onClick={() => { setShowBadges(!showBadges); if (!showBadges) loadBadges(); }}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🏅</span>
            <span className="text-sm font-medium text-gray-700">我的勋章</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{badges.length} 枚</span>
            <svg className={`w-4 h-4 text-gray-300 transition-transform ${showBadges ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        {showBadges && (
          <div className="px-5 py-3 bg-gray-50">
            {badges.length === 0 ? (
              <p className="text-sm text-gray-400">暂无勋章，快去完成目标吧</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {badges.map((badge: any) => (
                  <div key={badge.id} className="flex flex-col items-center bg-white rounded-lg p-2 w-16 shadow-sm">
                    <span className="text-xl">{badge.badge?.icon || '🎖️'}</span>
                    <span className="text-xs text-center mt-1">{badge.badge?.name || badge.badgeId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 收藏中心 */}
      <div className="bg-white mt-3">
        <button
          onClick={loadFavorites}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50"
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
                  <button
                    onClick={() => deleteFavorite(fav.id)}
                    className="text-red-500 text-xs ml-2 hover:underline"
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 修改密码 */}
      <div className="bg-white mt-3">
        <button
          onClick={() => setShowPasswordModal(true)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🔒</span>
            <span className="text-sm font-medium text-gray-700">修改密码</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">建议定期更换</span>
            <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>

      {/* 隐私设置 */}
      <div className="bg-white mt-3 px-5 py-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
          <span className="text-lg">🔐</span>隐私设置
        </h3>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-600">允许任何人加我为好友</span>
          <button
            onClick={() => updateSetting('allowFriendRequest', !settings.allowFriendRequest)}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.allowFriendRequest ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.allowFriendRequest ? 'translate-x-5' : ''}`}></div>
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-600">允许通过搜索找到我</span>
          <button
            onClick={() => updateSetting('allowSearch', !settings.allowSearch)}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.allowSearch ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.allowSearch ? 'translate-x-5' : ''}`}></div>
          </button>
        </div>
      </div>

      {/* 通知设置 */}
      <div className="bg-white mt-3 px-5 py-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
          <span className="text-lg">🔔</span>通知设置
        </h3>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-600">消息通知</span>
          <button
            onClick={() => updateSetting('notifyMessage', !settings.notifyMessage)}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.notifyMessage ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.notifyMessage ? 'translate-x-5' : ''}`}></div>
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-600">通话通知</span>
          <button
            onClick={() => updateSetting('notifyCall', !settings.notifyCall)}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.notifyCall ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.notifyCall ? 'translate-x-5' : ''}`}></div>
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-600">动态通知</span>
          <button
            onClick={() => updateSetting('notifyPost', !settings.notifyPost)}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.notifyPost ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.notifyPost ? 'translate-x-5' : ''}`}></div>
          </button>
        </div>
      </div>

      {/* 退出登录 */}
      <div className="mt-3 bg-white">
        <button
          onClick={logout}
          className="w-full flex items-center justify-between px-5 py-4 text-red-500 hover:bg-red-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🚪</span>
            <span className="text-sm font-medium">退出登录</span>
          </div>
          <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

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
