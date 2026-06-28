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

  const router = useRouter();
  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();

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
    <div className="flex flex-col h-full bg-gray-50">
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

      {/* 成长值 + 签到 */}
      <div className="bg-white mt-3 px-6 py-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium">成长值</span>
          <span className="text-gray-400 text-sm">LV{level} · {exp} 经验值</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
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

      {/* 每日任务 */}
      <div className="bg-white mt-3 px-6 py-4">
        <h3 className="text-sm font-medium mb-2">每日任务</h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-400">暂无任务</p>
        ) : (
          tasks.map((task: any) => (
            <div key={task.id} className="flex items-center justify-between py-1 border-b last:border-b-0">
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

      {/* 我的勋章 */}
      <div className="bg-white mt-3 px-6 py-4">
        <h3 className="text-sm font-medium mb-2">我的勋章</h3>
        {badges.length === 0 ? (
          <p className="text-sm text-gray-400">暂无勋章，快去完成目标吧</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge: any) => (
              <div key={badge.id} className="flex flex-col items-center bg-gray-100 rounded-lg p-2 w-16">
                <span className="text-xl">{badge.badge?.icon || '🎖️'}</span>
                <span className="text-xs text-center mt-1">{badge.badge?.name || badge.badgeId}</span>
              </div>
            ))}
          </div>
        )}
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
                <div key={fav.id} className="flex items-center justify-between px-6 py-2 border-b text-sm">
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

      {/* 设置中心 */}
      <div className="bg-white mt-3">
        <button onClick={() => setShowPasswordModal(true)} className="w-full flex items-center justify-between px-6 py-4 border-b hover:bg-gray-50">
          <span className="text-sm">修改密码</span>
          <span className="text-gray-400 text-sm">建议定期更换</span>
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

      <div className="mt-3 bg-white">
        <button onClick={logout} className="w-full text-left px-6 py-4 text-red-500 text-sm hover:bg-gray-50">
          退出登录
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
