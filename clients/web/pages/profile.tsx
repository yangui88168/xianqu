import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [signature, setSignature] = useState('');
  const [avatar, setAvatar] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const router = useRouter();

  // 签到相关
  const [signinStatus, setSigninStatus] = useState<any>(null);
  const [showSigninModal, setShowSigninModal] = useState(false);
  const [signinResult, setSigninResult] = useState<any>(null);

  // Cloudinary Widget 引用
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
      .then(data => setSigninStatus(data))
      .catch(() => {});
  }, [router]);

  // 签到
  const handleSignin = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setSigninResult(data);
      setShowSigninModal(true);
      // 刷新签到状态
      const statusRes = await fetch(`${API}/user/signin/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (statusRes.ok) setSigninStatus(await statusRes.json());
    } else {
      alert('签到失败，可能已经签到过了');
    }
  };

  // 初始化 Cloudinary Widget（用于上传头像）
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
            // 自动保存头像
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
      setOldPassword('');
      setNewPassword('');
    } else {
      const err = await res.json();
      alert(err.error || '修改失败');
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

      {/* 签到卡片 */}
      <div className="bg-white mt-3 px-6 py-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">每日签到</span>
          {signinStatus?.signedToday ? (
            <span className="text-gray-400 text-xs">今日已签到</span>
          ) : (
            <button onClick={handleSignin} className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm">签到领经验</button>
          )}
        </div>
        {/* 连续签到进度 */}
        <div className="flex items-center gap-1 mt-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-2 rounded-full ${i < (signinStatus?.streak || 0) ? 'bg-blue-500' : 'bg-gray-200'}`}
            ></div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1 text-right">连续签到 {signinStatus?.streak || 0} 天</p>
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

      {/* 签到结果弹窗 */}
      {showSigninModal && signinResult && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50" onClick={() => setShowSigninModal(false)}>
          <div className="bg-white p-5 rounded shadow-lg w-80 text-center" onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">✅</div>
            <h3 className="font-bold mb-1">签到成功！</h3>
            <p className="text-gray-500 text-sm mb-2">连续签到 {signinResult.streak} 天</p>
            <p className="text-blue-500 text-lg font-bold">+{signinResult.expGain} 经验</p>
            <p className="text-xs text-gray-400 mt-1">总经验 {signinResult.totalExp}</p>
            <button onClick={() => setShowSigninModal(false)} className="mt-4 w-full bg-blue-500 text-white py-2 rounded">确定</button>
          </div>
        </div>
      )}
    </div>
  );
}
