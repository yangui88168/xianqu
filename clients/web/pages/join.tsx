import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const API = 'https://xianqu-server.onrender.com';

export default function JoinPage() {
  const router = useRouter();
  const { code } = router.query;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('正在加入群聊...');

  useEffect(() => {
    if (!router.isReady) return;

    const token = localStorage.getItem('token');
    if (!token) {
      // 未登录，跳转登录页并带上邀请码参数，登录后可继续加入
      router.push(`/?redirect=/join?code=${code}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('缺少邀请码');
      return;
    }

    const joinGroup = async () => {
      try {
        const res = await fetch(`${API}/groups/join-by-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ inviteCode: code }),
        });

        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setMessage(`已成功加入群聊「${data.groupName}」`);
          // 3 秒后跳转到聊天页面
          setTimeout(() => {
            router.push('/chat');
          }, 2000);
        } else {
          setStatus('error');
          setMessage(data.error || '加入群聊失败');
        }
      } catch (err) {
        setStatus('error');
        setMessage('网络错误，请重试');
      }
    };

    joinGroup();
  }, [router.isReady, code, router]);

  return (
    <>
      <Head>
        <title>加入群聊 - 闲趣</title>
        <link rel="icon" href="data:," />
      </Head>
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full text-center">
          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">{message}</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="text-4xl mb-4">🎉</div>
              <h2 className="text-xl font-bold text-green-600 mb-2">加入成功</h2>
              <p className="text-gray-600">{message}</p>
              <p className="text-sm text-gray-400 mt-2">即将跳转到聊天页面...</p>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="text-4xl mb-4">😕</div>
              <h2 className="text-xl font-bold text-red-500 mb-2">加入失败</h2>
              <p className="text-gray-600">{message}</p>
              <button
                onClick={() => router.push('/chat')}
                className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-full text-sm hover:bg-blue-600"
              >
                返回聊天
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
