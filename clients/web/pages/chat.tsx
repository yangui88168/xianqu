import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function Chat() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [receiverId, setReceiverId] = useState('');
  const [userId, setUserId] = useState('');
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 建立 WebSocket 连接
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/');
      return;
    }

    const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
    socket.onopen = () => console.log('WebSocket connected');
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'message:receive') {
        setMessages((prev) => [...prev, msg.data]);
      }
    };
    setWs(socket);

    // 从 token 中解析自己的用户 ID
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch {}

    return () => {
      socket.close();
    };
  }, [router]);

  // 加载与指定用户的历史消息
  const loadHistory = async (id: string) => {
    if (!id) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/history/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  };

  // 发送消息
  const send = () => {
    if (!ws || !input.trim() || !receiverId.trim()) return;
    ws.send(
      JSON.stringify({
        event: 'message:send',
        data: {
          receiverId,
          content: input,
          type: 'text',
        },
      })
    );
    setInput('');
  };

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部栏 */}
      <div className="bg-blue-500 text-white p-2 flex gap-2 items-center">
        <span className="font-bold">XianQu Chat</span>
        <input
          className="text-black p-1 rounded flex-1"
          placeholder="Receiver's User ID"
          value={receiverId}
          onChange={(e) => {
            setReceiverId(e.target.value);
            loadHistory(e.target.value);
          }}
        />
        <button
          onClick={() => {
            localStorage.clear();
            router.push('/');
          }}
          className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded"
        >
          Logout
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-100">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-2 ${msg.senderId === userId ? 'text-right' : 'text-left'}`}
          >
            <div
              className={`inline-block p-2 rounded-lg max-w-xs ${
                msg.senderId === userId
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-800'
              }`}
            >
              <p className="text-sm">{msg.content}</p>
              <span className="text-xs text-gray-300">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="p-2 bg-white border-t flex gap-2">
        <input
          className="flex-1 p-2 border rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type a message..."
        />
        <button
          onClick={send}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Send
        </button>
      </div>
    </div>
  );
}
