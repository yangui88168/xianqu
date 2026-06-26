import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

// 简易 Emoji 列表
const EMOJIS = ['😀', '😂', '❤️', '👍', '😢', '😡', '🎉', '🔥', '💯', '✨', '👋', '🙏'];

export default function Chat() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [userId, setUserId] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化用户
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch { router.push('/'); }
  }, []);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setSessions(await res.json());
  }, []);

  // 加载好友请求
  const loadFriendRequests = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/requests/incoming`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setFriendRequests(await res.json());
  }, []);

  useEffect(() => {
    if (userId) {
      loadSessions();
      loadFriendRequests();
    }
  }, [userId, loadSessions, loadFriendRequests]);

  // WebSocket 连接 + 消息监听
  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem('token');
    const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'message:receive') {
        const newMsg = msg.data;
        // 如果当前正在与该好友聊天，直接添加到消息列表并标记已读
        if (selectedFriend?.id === newMsg.senderId || selectedFriend?.id === newMsg.receiverId) {
          setMessages(prev => [...prev, newMsg]);
          // 标记已读
          fetch(`${API}/messages/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ senderId: newMsg.senderId })
          });
        }
        // 更新会话列表
        loadSessions();
      } else if (msg.event === 'message:delivered') {
        // 更新消息状态为 delivered
        setMessages(prev => prev.map(m => m.id === msg.data.messageId ? { ...m, status: 'delivered' } : m));
      }
    };
    setWs(socket);
    return () => socket.close();
  }, [userId, selectedFriend, loadSessions]);

  // 选择会话并加载消息 + 标记已读
  const selectFriend = async (friend: any) => {
    setSelectedFriend(friend);
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/history/${friend.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const msgs = await res.json();
      setMessages(msgs);
      // 标记对方发来的未读消息为已读
      fetch(`${API}/messages/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ senderId: friend.id })
      });
      // 更新未读计数
      loadSessions();
    }
  };

  // 发送文字消息
  const sendText = () => {
    if (!ws || !input.trim() || !selectedFriend) return;
    ws.send(JSON.stringify({
      event: 'message:send',
      data: { receiverId: selectedFriend.id, content: input, type: 'text' }
    }));
    setInput('');
  };

  // 处理图片发送（先用 base64 模拟，后续接入 R2）
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 简单实现：转 base64 发送
    const reader = new FileReader();
    reader.onload = () => {
      if (ws && selectedFriend) {
        ws.send(JSON.stringify({
          event: 'message:send',
          data: {
            receiverId: selectedFriend.id,
            content: reader.result as string,
            type: 'image'
          }
        }));
      }
    };
    reader.readAsDataURL(file);
    // 清空 input
    e.target.value = '';
  };

  // 搜索用户
  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/search?q=${encodeURIComponent(searchQuery)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setSearchResults(await res.json());
  };

  const sendFriendRequest = async (receiverId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ receiverId })
    });
    if (res.ok) { alert('Request sent!'); setSearchResults([]); }
    else alert((await res.json()).error);
  };

  const acceptRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ requestId: reqId })
    });
    loadSessions();
    loadFriendRequests();
  };

  const rejectRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ requestId: reqId })
    });
    loadFriendRequests();
  };

  const deleteFriend = async (friendId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/friend/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (selectedFriend?.id === friendId) {
      setSelectedFriend(null);
      setMessages([]);
    }
    loadSessions();
  };

  // 自动滚动
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 左侧会话列表 */}
      <div className="w-80 bg-white border-r flex flex-col">
        {/* 搜索添加好友 */}
        <div className="p-3 border-b">
          <div className="flex gap-2">
            <input
              className="flex-1 p-2 border rounded text-sm"
              placeholder="Search users..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchUsers()}
            />
            <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">Search</button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded p-1">
              {searchResults.map(user => (
                <div key={user.id} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                  <span className="text-sm">{user.username} ({user.email})</span>
                  <button onClick={() => sendFriendRequest(user.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">Add</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 好友请求 */}
        {friendRequests.length > 0 && (
          <div className="border-b bg-yellow-50">
            <div className="p-2 text-sm font-bold">Requests ({friendRequests.length})</div>
            {friendRequests.map(req => (
              <div key={req.id} className="flex justify-between items-center px-3 py-2">
                <span className="text-sm">{req.sender?.username}</span>
                <div className="flex gap-1">
                  <button onClick={() => acceptRequest(req.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">✓</button>
                  <button onClick={() => rejectRequest(req.id)} className="text-xs bg-red-500 text-white px-2 py-1 rounded">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">No conversations yet</div>
          ) : (
            sessions.map(s => (
              <div
                key={s.friend.id}
                onClick={() => selectFriend(s.friend)}
                className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 border-b ${
                  selectedFriend?.id === s.friend.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                  {s.friend.username?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <span className="font-medium text-sm truncate">{s.friend.username}</span>
                    {s.lastMessage && (
                      <span className="text-xs text-gray-400">
                        {new Date(s.lastMessage.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500 truncate">
                      {s.lastMessage?.type === 'image' ? '[Image]' : s.lastMessage?.content || ''}
                    </span>
                    {s.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{s.unreadCount}</span>
                    )}
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full ${s.friend.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`}></span>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t">
          <button onClick={() => { localStorage.clear(); router.push('/'); }} className="w-full bg-gray-200 hover:bg-gray-300 text-sm py-2 rounded">Logout</button>
        </div>
      </div>

      {/* 右侧聊天窗 */}
      <div className="flex-1 flex flex-col">
        {selectedFriend ? (
          <>
            {/* 聊天头部 */}
            <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {selectedFriend.username?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="font-bold">{selectedFriend.username}</p>
                <p className="text-xs text-gray-500">{selectedFriend.status === 'online' ? 'Online' : 'Offline'}</p>
              </div>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-20">No messages yet. Say hello!</div>
              )}
              {messages.map((msg, i) => {
                const isMe = msg.senderId === userId;
                return (
                  <div key={msg.id || i} className={`mb-4 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[75%] ${isMe ? 'flex-row-reverse' : ''}`}>
                      <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
                        {isMe ? 'Me' : selectedFriend.username?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <div className={`px-3 py-2 rounded-2xl text-sm ${
                          isMe
                            ? 'bg-blue-500 text-white rounded-br-md'
                            : 'bg-white text-gray-800 rounded-bl-md shadow'
                        }`}>
                          {msg.type === 'image' ? (
                            <img src={msg.content} alt="sent" className="max-w-60 rounded" />
                          ) : (
                            <p>{msg.content}</p>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 mt-1 text-xs ${isMe ? 'justify-end' : 'justify-start'} text-gray-400`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                          {isMe && (
                            <span>
                              {msg.status === 'sent' && '✓'}
                              {msg.status === 'delivered' && '✓✓'}
                              {msg.status === 'read' && <span className="text-blue-500">✓✓</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="p-3 bg-white border-t">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  📷
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="relative">
                  <button
                    onClick={() => setShowEmoji(!showEmoji)}
                    className="text-gray-400 hover:text-gray-600 p-2"
                  >
                    😊
                  </button>
                  {showEmoji && (
                    <div className="absolute bottom-10 left-0 bg-white border rounded-lg shadow-lg p-2 grid grid-cols-6 gap-1 w-56">
                      {EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => { setInput(prev => prev + emoji); setShowEmoji(false); }}
                          className="text-xl hover:bg-gray-100 p-1 rounded"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  className="flex-1 p-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendText()}
                  placeholder="Type a message..."
                />
                <button
                  onClick={sendText}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg">Select a conversation</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
