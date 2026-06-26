import { useState } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Home() {
  const [username, setUsername] = useState('');     // 账号
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');     // 昵称（仅注册时）
  const [isLogin, setIsLogin] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    setErrorMsg('');
    setLoading(true);

    const url = isLogin ? `${API}/auth/login` : `${API}/auth/register`;
    const body = isLogin
      ? { username, password }
      : { username, password, nickname };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          router.push('/chat');
        } else {
          // 注册成功，切换到登录
          alert('注册成功！请登录');
          setIsLogin(true);
        }
      } else {
        const err = await res.json();
        setErrorMsg(err.error || '请求失败');
      }
    } catch (e: any) {
      setErrorMsg('网络错误，无法连接服务器');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-80">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-indigo-600">《闲趣》</h1>
          <p className="text-gray-400 text-sm mt-1">XianQu Messenger</p>
        </div>

        {errorMsg && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-3 text-sm">
            {errorMsg}
          </div>
        )}

        {/* 注册时显示昵称输入框 */}
        {!isLogin && (
          <input
            className="w-full p-2 mb-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 text-sm"
            placeholder="昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        )}

        <input
          className="w-full p-2 mb-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 text-sm"
          placeholder="账号"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          className="w-full p-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 text-sm"
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className={`w-full text-white py-2 rounded-lg transition ${
            loading ? 'bg-gray-400' : 'bg-indigo-500 hover:bg-indigo-600'
          }`}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? '处理中...' : isLogin ? '登录' : '注册'}
        </button>

        <p className="mt-3 text-center text-sm text-gray-500">
          {isLogin ? '还没有账号？' : '已有账号？'}
          <button
            className="text-indigo-500 underline ml-1"
            onClick={() => {
              setIsLogin(!isLogin);
              setErrorMsg('');
            }}
          >
            {isLogin ? '去注册' : '去登录'}
          </button>
        </p>
      </div>
    </div>
  );
}
