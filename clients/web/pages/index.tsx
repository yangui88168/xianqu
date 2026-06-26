import { useState } from 'react';
import { useRouter } from 'next/router';

// 硬编码后端地址（解决环境变量读取失败的问题）
const API = 'https://xianqu-server.onrender.com';

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    setErrorMsg('');
    setLoading(true);

    // 构造请求地址和参数
    const url = isLogin ? `${API}/auth/login` : `${API}/auth/register`;
    const body = isLogin
      ? { email, password }
      : { email, username, password };

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
          // 注册成功（没有 token）则切换到登录
          alert('Registration successful! Please login.');
          setIsLogin(true);
        }
      } else {
        const err = await res.json();
        setErrorMsg(err.error || 'Request failed');
      }
    } catch (e: any) {
      setErrorMsg('Network error: could not connect to server');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 仅登录时使用邮箱+密码，注册时额外需要用户名
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded shadow-md w-80">
        <h1 className="text-2xl font-bold mb-4">
          {isLogin ? 'Login to XianQu' : 'Register'}
        </h1>

        {errorMsg && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-3 text-sm">
            {errorMsg}
          </div>
        )}

        {!isLogin && (
          <input
            className="w-full p-2 mb-2 border rounded"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}

        <input
          className="w-full p-2 mb-2 border rounded"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full p-2 mb-4 border rounded"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className={`w-full text-white p-2 rounded ${
            loading ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
          }`}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Processing...' : isLogin ? 'Login' : 'Register'}
        </button>

        <p className="mt-2 text-center text-sm text-gray-600">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="text-blue-500 underline"
            onClick={() => {
              setIsLogin(!isLogin);
              setErrorMsg('');
            }}
          >
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
}
