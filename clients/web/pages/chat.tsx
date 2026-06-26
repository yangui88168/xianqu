import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Chat() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [userId, setUserId] = useState('');
  const [friends, setFriends] = useState<any[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 初始化：获取 token 和用户 ID
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/');
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch {
      router.push('/');
    }
  }, []);

  // 加载好友列表和请求
  const loadFriends = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setFriends(data);
    }
    setLoading(false);
  }, []);

  const loadFriendRequests = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/requests/incoming`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setFriendRequests(await res.json());
    }
  }, []);

  useEffect(() => {
    if (userId) {
      loadFriends();
      loadFriendRequests();
    }
  }, [userId, loadFriends, loadFriendRequests]);

  // WebSocket 连接
  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem('token');
    const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'message:receive') {
        const newMsg = msg.data;
        setMessages((prev) => {
          // 避免重复添加
          if (prev.find((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        // 更新好友列表中的最后消息（简化：直接刷新好友列表）
        loadFriends();
      }
    };
    setWs(socket);
    return () => {
      socket.close();
    };
  }, [userId, loadFriends]);

  // 选择好友并加载历史消息
  const selectFriend = async (friend: any) => {
    setSelectedFriend(friend);
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/history/${friend.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMessages(await res.json());
    }
  };

  // 发送消息
  const sendMessage = () => {
    if (!ws || !input.trim() || !selectedFriend) return;
    ws.send(
      JSON.stringify({
        event: 'message:send',
        data: {
          receiverId: selectedFriend.id,
          content: input,
          type: 'text',
        },
      })
    );
    setInput('');
  };

  // 搜索用户
  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/search?q=${encodeURIComponent(searchQuery)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setSearchResults(await res.json());
  };

  // 发送好友请求
  const sendFriendRequest = async (receiverId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ receiverId }),
    });
    if (res.ok) {
      alert('Friend request sent!');
      setSearchResults([]);
    } else {
      const err = await res.json();
      alert(err.error || 'Failed');
    }
  };

  // 接受请求
  const acceptRequest = async (requestId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId }),
    });
    loadFriends();
    loadFriendRequests();
  };

  // 拒绝请求
  const rejectRequest = async (requestId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId }),
    });
    loadFriendRequests();
  };

  // 删除好友
  const deleteFriend = async (friendId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/friend/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (selectedFriend?.id === friendId) {
      setSelectedFriend(null);
      setMessages([]);
    }
    loadFriends();
  };

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-screen bg-gray-200">
      {/* 左侧边栏 */}
      <div className="w-80 bg-white border-r flex flex-col">
        {/* 搜索栏 */}
        <div className="p-3 border-b">
          <div className="flex gap-2">
            <input
              className="flex-1 p-2 border rounded text-sm"
              placeholder="Search by email or name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
            />
            <button
              onClick={searchUsers}
              className="bg-blue-500 text-white px-3 py-1 rounded text-sm"
            >
              Search
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded p-1">
              {searchResults.map((user) => (
                <div
                  key={user.id}
                  className="flex justify-between items-center p-2 hover:bg-gray-100 rounded"
                >
                  <span className="text-sm">
                    {user.username} ({user.email})
                  </span>
                  <button
                    onClick={() => sendFriendRequest(user.id)}
                    className="text-xs bg-green-500 text-white px-2 py-1 rounded"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 好友请求 */}
        {friendRequests.length > 0 && (
          <div className="border-b">
            <div className="p-2 bg-yellow-50 text-sm font-bold">
              Friend Requests ({friendRequests.length})
            </div>
            {friendRequests.map((req) => (
              <div
                key={req.id}
                className="flex justify-between items-center p-2 px-3"
              >
                <span className="text-sm">
                  {req.sender?.username || req.sender?.email}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => acceptRequest(req.id)}
                    className="text-xs bg-green-500 text-white px-2 py-1 rounded"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => rejectRequest(req.id)}
                    className="text-xs bg-red-500 text-white px-2 py-1 rounded"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 好友列表 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 bg-gray-100 text-sm font-bold border-b">
            Friends
          </div>
          {loading ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              Loading...
            </div>
          ) : friends.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              No friends yet. Search above to add friends.
            </div>
          ) : (
            friends.map((friend) => (
              <div
                key={friend.id}
                onClick={() => selectFriend(friend)}
                className={`flex justify-between items-center p-3 cursor-pointer hover:bg-blue-50 border-b ${
                  selectedFriend?.id === friend.id ? 'bg-blue-100' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {friend.username}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {friend.status === 'online' ? 'Online' : 'Offline'}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      friend.status === 'online'
                        ? 'bg-green-500'
                        : 'bg-gray-400'
                    }`}
                  ></span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFriend(friend.id);
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Del
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部 */}
        <div className="p-3 border-t">
          <button
            onClick={() => {
              localStorage.clear();
              router.push('/');
            }}
            className="w-full bg-gray-200 hover:bg-gray-300 text-sm py-2 rounded"
          >
            Logout
          </button>
        </div>
      </div>

      {/* 右侧聊天窗口 */}
      <div className="flex-1 flex flex-col">
        {selectedFriend ? (
          <>
            {/* 聊天头部 */}
            <div className="bg-blue-500 text-white p-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-blue-500 font-bold text-sm">
                {selectedFriend.username?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <p className="font-bold">{selectedFriend.username}</p>
                <p className="text-xs opacity-80">
                  {selectedFriend.status === 'online' ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-10">
                  No messages yet. Say hello!
                </div>
              )}
              {messages.map((msg, i) => {
                const isMe = msg.senderId === userId;
                return (
                  <div
                    key={msg.id || i}
                    className={`mb-3 flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="flex items-end gap-2 max-w-[70%]">
                      {!isMe && (
                        <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
                          {selectedFriend.username?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div
                        className={`px-3 py-2 rounded-lg text-sm ${
                          isMe
                            ? 'bg-blue-500 text-white rounded-br-none'
                            : 'bg-white text-gray-800 rounded-bl-none shadow'
                        }`}
                      >
                        <p>{msg.content}</p>
                        <p
                          className={`text-xs mt-1 ${
                            isMe ? 'text-blue-100' : 'text-gray-400'
                          }`}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      {isMe && (
                        <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0">
                          Me
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入框 */}
            <div className="p-3 bg-white border-t flex gap-2">
              <input
                className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
              />
              <button
                onClick={sendMessage}
                className="bg-blue-500 hover:bg-blue-600 text-white px-5 py-2 rounded-lg transition"
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg">Select a friend to start chatting</p>
              <p className="text-sm mt-2">
                Add friends using the search box on the left
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
