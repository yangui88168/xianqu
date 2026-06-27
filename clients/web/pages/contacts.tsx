import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

// 动态时间描述（从 chat.tsx 复用）
const getLastSeenText = (friend: any) => {
  if (friend.status === 'online') return '在线';
  if (!friend.lastSeen) return '离线';
  const diff = Date.now() - new Date(friend.lastSeen).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚在线';
  if (minutes < 60) return `${minutes}分钟前在线`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前在线`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前在线`;
  return new Date(friend.lastSeen).toLocaleDateString();
};

export default function Contacts() {
  const [friends, setFriends] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // 新增状态：编辑备注和分组
  const [editingFriendId, setEditingFriendId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editGroup, setEditGroup] = useState('');

  // 加载好友列表和请求
  const loadFriends = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API}/contacts/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFriends(await res.json());
  }, []);

  const loadRequests = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API}/contacts/requests/incoming`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    loadFriends();
    loadRequests();
    setLoading(false);
  }, [loadFriends, loadRequests]);

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
    await fetch(`${API}/contacts/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receiverId }),
    });
    alert('好友请求已发送！');
    setSearchResults([]);
  };

  // 接受请求
  const acceptRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: reqId }),
    });
    loadFriends();
    loadRequests();
  };

  // 拒绝请求
  const rejectRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: reqId }),
    });
    loadRequests();
  };

  // 删除好友
  const deleteFriend = async (friendId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/friend/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadFriends();
  };

  // 更新备注
  const updateNote = async (friendId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/friend/${friendId}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ note: editNote }),
    });
    setEditingFriendId(null);
    loadFriends();
  };

  // 更新分组
  const updateGroup = async (friendId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/friend/${friendId}/group`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ groupName: editGroup }),
    });
    setEditingFriendId(null);
    loadFriends();
  };

  // 拉黑用户
  const blockUser = async (blockedId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ blockedId }),
    });
    loadFriends();
  };

  // 跳转到聊天页并选中好友
  const openChat = (friendId: string) => {
    router.push(`/chat?friendId=${friendId}`);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 顶部搜索栏 */}
      <div className="p-4 bg-white border-b">
        <div className="flex gap-2">
          <input
            className="flex-1 p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="搜索用户..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
          />
          <button
            onClick={searchUsers}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm"
          >
            搜索
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-2 bg-white border rounded-lg shadow overflow-y-auto max-h-40">
            {searchResults.map((user: any) => (
              <div key={user.id} className="flex justify-between items-center px-4 py-2 hover:bg-gray-100">
                <span className="text-sm font-medium">
                  {user.nickname || user.username}
                </span>
                <button
                  onClick={() => sendFriendRequest(user.id)}
                  className="text-xs bg-green-500 text-white px-3 py-1 rounded-full"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 好友请求提示 */}
      {requests.length > 0 && (
        <div className="mx-4 mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <h3 className="font-bold text-sm text-yellow-700 mb-2">
            新的好友请求 ({requests.length})
          </h3>
          {requests.map((req: any) => (
            <div key={req.id} className="flex justify-between items-center py-1">
              <span className="text-sm">
                {req.sender?.nickname || req.sender?.username}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => acceptRequest(req.id)}
                  className="text-xs bg-green-500 text-white px-3 py-1 rounded-full"
                >
                  接受
                </button>
                <button
                  onClick={() => rejectRequest(req.id)}
                  className="text-xs bg-red-500 text-white px-3 py-1 rounded-full"
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 好友列表 */}
      <div className="flex-1 overflow-y-auto mt-4">
        {loading ? (
          <p className="text-center text-gray-400 mt-10">加载中...</p>
        ) : friends.length === 0 ? (
          <p className="text-center text-gray-400 mt-10">暂无好友，快去添加吧</p>
        ) : (
          friends.map((friend: any) => (
            <div key={friend.id} className="flex items-center justify-between px-4 py-3 bg-white border-b hover:bg-gray-50 cursor-pointer relative" onClick={() => openChat(friend.id)}>
              <div className="flex items-center gap-3 flex-1">
                <div className="relative">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                    {(friend.nickname || friend.username)[0]}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                      friend.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  ></span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{friend.nickname || friend.username}</p>
                    {friend.note && <span className="text-xs text-gray-400 bg-gray-100 px-1 rounded">备注：{friend.note}</span>}
                  </div>
                  {/* 替换为动态时间描述 */}
                  <p className="text-xs text-gray-500">{friend.groupName || '未分组'} · {getLastSeenText(friend)}</p>
                </div>
              </div>
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setEditingFriendId(friend.id); setEditNote(friend.note || ''); setEditGroup(friend.groupName || ''); }} className="text-xs text-blue-500">编辑</button>
                <button onClick={() => blockUser(friend.id)} className="text-xs text-red-500">拉黑</button>
                <button onClick={() => deleteFriend(friend.id)} className="text-xs text-red-500">删除</button>
              </div>
              {editingFriendId === friend.id && (
                <div className="absolute bg-white p-3 border rounded shadow" style={{ zIndex: 10, top: '100%', right: 0 }}>
                  <input placeholder="备注" value={editNote} onChange={e => setEditNote(e.target.value)} className="border p-1 text-sm mb-1 w-full" />
                  <input placeholder="分组" value={editGroup} onChange={e => setEditGroup(e.target.value)} className="border p-1 text-sm mb-1 w-full" />
                  <div className="flex gap-2">
                    <button onClick={() => updateNote(friend.id)} className="bg-blue-500 text-white px-2 py-1 text-xs rounded">保存备注</button>
                    <button onClick={() => updateGroup(friend.id)} className="bg-green-500 text-white px-2 py-1 text-xs rounded">保存分组</button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
