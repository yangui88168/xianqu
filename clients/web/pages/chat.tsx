import { useEffect, useState, useRef } from 'react';
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
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 获取 token，建立 WebSocket
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch {}

    const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'message:receive') {
        const newMsg = msg.data;
        // 如果当前正在与发送者聊天，则直接更新消息列表
        if (selectedFriend && newMsg.senderId === selectedFriend.id) {
          setMessages(prev => [...prev, newMsg]);
        }
        // 可添加通知提醒
      }
    };
    setWs(socket);
    return () => socket.close();
  }, [selectedFriend]);

  // 加载好友列表
  const loadFriends = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/friends`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setFriends(await res.json());
  };

  // 加载收到的好友请求
  const loadFriendRequests = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/requests/incoming`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setFriendRequests(await res.json());
  };

  // 初始加载
  useEffect(() => {
    if (userId) {
      loadFriends();
      loadFriendRequests();
    }
  }, [userId]);

  // 选择好友并加载聊天记录
  const selectFriend = async (friend: any) => {
    setSelectedFriend(friend);
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/history/${friend.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setMessages(await res.json());
  };

  // 发送消息
  const sendMessage = () => {
    if (!ws || !input.trim() || !selectedFriend) return;
    ws.send(JSON.stringify({
      event: 'message:send',
      data: { receiverId: selectedFriend.id, content: input, type: 'text' }
    }));
    setInput('');
  };

  // 搜索用户
  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/search?q=${searchQuery}`, {
      headers: { Authorization: `Bearer ${token}` }
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
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ receiverId })
    });
    if (res.ok) {
      alert('Friend request sent!');
      setSearchResults([]);
    } else {
      const err = await res.json();
      alert(err.error);
    }
  };

  // 接受好友请求
  const acceptRequest = async (requestId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/request/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ requestId })
    });
    if (res.ok) {
      loadFriends();
      loadFriendRequests();
    }
  };

  // 拒绝好友请求
  const rejectRequest = async (requestId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/request/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ requestId })
    });
    if (res.ok) loadFriendRequests();
  };

  // 删除好友
  const deleteFriend = async (friendId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/friend/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      if (selectedFriend?.id === friendId) setSelectedFriend(null);
      loadFriends();
    }
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
              placeholder="Search users by email/name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
            />
            <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">
              Search
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto">
              {searchResults.map((user) => (
                <div key={user.id} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                  <span className="text-sm">{user.username} ({user.email})</span>
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

        {/* 好友请求通知 */}
        {friendRequests.length > 0 && (
          <div className="border-b">
            <div className="p-2 bg-yellow-50 text-sm font-bold">Friend Requests ({friendRequests.length})</div>
            {friendRequests.map((req) => (
              <div key={req.id} className="flex justify-between items-center p-2 px-3">
                <span className="text-sm">{req.sender?.username || req.sender?.email}</span>
                <div className="flex gap-1">
                  <button onClick={() => acceptRequest(req.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">Accept</button>
                  <button onClick={() => rejectRequest(req.id)} className="text-xs bg-red-500 text-white px-2 py-1 rounded">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 好友列表 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 bg-gray-100 text-sm font-bold">Friends</div>
          {friends.map((friend) => (
            <div
              key={friend.id}
              onClick={() => selectFriend(friend)}
              className={`flex justify-between items-center p-3 cursor-pointer hover:bg-blue-50 ${
                selectedFriend?.id === friend.id ? 'bg-blue-100' : ''
              }`}
            >
              <div>
                <p className="font-medium text-sm">{friend.username}</p>
                <p className="text-xs text-gray-500">{friend.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${friend.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFriend(friend.id); }}
                  className="text-xs text-red-500 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 底部用户信息 & 退出 */}
        <div className="p-3 border-t">
          <button
            onClick={() => { localStorage.clear(); router.push('/'); }}
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
            <div className="bg-blue-500 text-white p-3 font-bold">
              {selectedFriend.username} ({selectedFriend.email})
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-white">
              {messages.map((msg, i) => (
                <div key={i} className={`mb-2 ${msg.senderId === userId ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block p-2 rounded-lg max-w-xs ${
                    msg.senderId === userId ? 'bg-blue-500 text-white' : 'bg-gray-200'
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                    <span className="text-xs opacity-75">
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t bg-white flex gap-2">
              <input
                className="flex-1 p-2 border rounded"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
              />
              <button onClick={sendMessage} className="bg-blue-500 text-white px-4 py-2 rounded">
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a friend to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
