import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

const EMOJIS = ['😀', '😂', '❤️', '👍', '😢', '😡', '🎉', '🔥', '💯', '✨', '👋', '🙏'];

export default function Chat() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [userId, setUserId] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch { router.push('/'); }
  }, []);

  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setSessions(await res.json());
  }, []);

  const loadGroups = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setGroups(await res.json());
  }, []);

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
      loadGroups();
      loadFriendRequests();
    }
  }, [userId, loadSessions, loadGroups, loadFriendRequests]);

  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem('token');
    const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.event === 'message:receive') {
        const newMsg = msg.data;
        if (selectedChat?.type === 'friend' && selectedChat.data.id === newMsg.senderId) {
          setMessages(prev => [...prev, newMsg]);
        }
        loadSessions();
      }
    };
    setWs(socket);
    return () => socket.close();
  }, [userId, selectedChat, loadSessions]);

  const selectChat = async (type: string, data: any) => {
    setSelectedChat({ type, data });
    setReplyingTo(null);
    const token = localStorage.getItem('token');
    if (type === 'friend') {
      const res = await fetch(`${API}/messages/history/${data.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setMessages(await res.json());
    } else {
      const res = await fetch(`${API}/groups/${data.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setMessages(await res.json());
    }
  };

  const sendMessage = () => {
    if (!input.trim() && !replyingTo) return;
    if (!selectedChat) return;
    const payload: any = {
      content: input,
      type: 'text',
      replyToId: replyingTo?.id || null
    };

    if (selectedChat.type === 'friend') {
      if (!ws) return;
      ws.send(JSON.stringify({
        event: 'message:send',
        data: { ...payload, receiverId: selectedChat.data.id }
      }));
    } else {
      fetch(`${API}/groups/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ ...payload, groupId: selectedChat.data.id })
      }).then(async (res) => {
        if (res.ok) {
          const token = localStorage.getItem('token');
          const fres = await fetch(`${API}/groups/${selectedChat.data.id}/messages`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (fres.ok) setMessages(await fres.json());
        }
      });
    }
    setInput('');
    setReplyingTo(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat) return;
    const reader = new FileReader();
    reader.onload = () => {
      const payload: any = {
        content: reader.result as string,
        type: 'image',
        replyToId: replyingTo?.id || null
      };
      if (selectedChat.type === 'friend') {
        if (!ws) return;
        ws.send(JSON.stringify({
          event: 'message:send',
          data: { ...payload, receiverId: selectedChat.data.id }
        }));
      } else {
        fetch(`${API}/groups/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ ...payload, groupId: selectedChat.data.id })
        }).then(async (res) => {
          if (res.ok) {
            const token = localStorage.getItem('token');
            const fres = await fetch(`${API}/groups/${selectedChat.data.id}/messages`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (fres.ok) setMessages(await fres.json());
          }
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const recallMessage = async (msg: any) => {
    const token = localStorage.getItem('token');
    if (selectedChat?.type === 'friend') {
      await fetch(`${API}/messages/recall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId: msg.id })
      });
      selectChat('friend', selectedChat.data);
    } else {
      await fetch(`${API}/groups/message/recall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId: msg.id })
      });
      const res = await fetch(`${API}/groups/${selectedChat.data.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setMessages(await res.json());
    }
  };

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
    await fetch(`${API}/contacts/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receiverId })
    });
    alert('Request sent!');
    setSearchResults([]);
  };

  const acceptRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: reqId })
    });
    loadSessions(); loadFriendRequests();
  };

  const rejectRequest = async (reqId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: reqId })
    });
    loadFriendRequests();
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newGroupName })
    });
    if (res.ok) {
      setShowGroupModal(false);
      setNewGroupName('');
      loadGroups();
    }
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 左侧栏 */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="flex gap-2 mb-2">
            <input
              className="flex-1 p-2 border rounded text-sm"
              placeholder="Search users..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchUsers()}
            />
            <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">Search</button>
          </div>
          <button
            onClick={() => setShowGroupModal(true)}
            className="w-full bg-green-500 text-white py-1 rounded text-sm"
          >
            + Create Group
          </button>
          {showGroupModal && (
            <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
              <div className="bg-white p-5 rounded shadow-lg w-72">
                <h3 className="font-bold mb-2">Create Group</h3>
                <input
                  className="w-full border p-2 rounded mb-3 text-sm"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowGroupModal(false)} className="px-3 py-1 bg-gray-300 rounded text-sm">Cancel</button>
                  <button onClick={createGroup} className="px-3 py-1 bg-green-500 text-white rounded text-sm">Create</button>
                </div>
              </div>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded p-1">
              {searchResults.map(user => (
                <div key={user.id} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                  <span className="text-sm">{user.username}</span>
                  <button onClick={() => sendFriendRequest(user.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">Add</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {friendRequests.length > 0 && (
          <div className="border-b bg-yellow-50">
            <div className="p-2 text-sm font-bold">Requests</div>
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

        <div className="flex-1 overflow-y-auto">
          <div className="p-2 bg-gray-100 text-sm font-bold">Groups</div>
          {groups.map(g => (
            <div
              key={g.id}
              onClick={() => selectChat('group', g)}
              className={`p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === g.id && selectedChat?.type === 'group' ? 'bg-blue-50' : ''}`}
            >
              <span className="font-medium text-sm"># {g.name}</span>
            </div>
          ))}
          <div className="p-2 bg-gray-100 text-sm font-bold">Friends</div>
          {sessions.map(s => (
            <div
              key={s.friend.id}
              onClick={() => selectChat('friend', s.friend)}
              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === s.friend.id && selectedChat?.type === 'friend' ? 'bg-blue-50' : ''}`}
            >
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">{s.friend.username[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium text-sm truncate">{s.friend.username}</span>
                  {s.lastMessage && <span className="text-xs text-gray-400">{new Date(s.lastMessage.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>}
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500 truncate">{s.lastMessage?.type==='image'?'[Image]':s.lastMessage?.content||''}</span>
                  {s.unreadCount>0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{s.unreadCount}</span>}
                </div>
              </div>
              <span className={`w-2 h-2 rounded-full ${s.friend.status==='online'?'bg-green-500':'bg-gray-300'}`}></span>
            </div>
          ))}
        </div>
        <div className="p-3 border-t">
          <button onClick={() => { localStorage.clear(); router.push('/'); }} className="w-full bg-gray-200 hover:bg-gray-300 text-sm py-2 rounded">Logout</button>
        </div>
      </div>

      {/* 右侧聊天窗 */}
      <div className="flex-1 flex flex-col">
        {selectedChat ? (
          <>
            <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {selectedChat.type === 'group' ? '#' : selectedChat.data.username[0]}
              </div>
              <div>
                <p className="font-bold">{selectedChat.type === 'group' ? selectedChat.data.name : selectedChat.data.username}</p>
                {selectedChat.type === 'friend' && <p className="text-xs text-gray-500">{selectedChat.data.status === 'online' ? 'Online' : 'Offline'}</p>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {messages.map((msg, i) => {
                const isMe = msg.senderId === userId || msg.sender?.id === userId;
                if (msg.deleted) return (
                  <div key={msg.id || i} className="text-center text-gray-400 text-xs py-1">
                    {isMe ? 'You' : (msg.sender?.username || 'Someone')} recalled a message
                  </div>
                );
                return (
                  <div key={msg.id || i} className={`mb-4 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[75%] ${isMe ? 'flex-row-reverse' : ''}`}>
                      <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs">
                        {isMe ? 'Me' : (msg.sender?.username?.[0] || selectedChat.data?.username?.[0] || '?')}
                      </div>
                      <div className="flex flex-col">
                        {msg.replyToId && (
                          <div className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-1 mb-1 border-l-2 border-blue-300">
                            Replying to: {msg.replyTo?.content?.substring(0,30) || 'message'}
                          </div>
                        )}
                        <div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-md' : 'bg-white text-gray-800 rounded-bl-md shadow'}`}>
                          {msg.type === 'image' ? <img src={msg.content} alt="sent" className="max-w-60 rounded" /> : msg.content}
                        </div>
                        <div className={`flex items-center gap-1 mt-1 text-xs ${isMe ? 'justify-end' : 'justify-start'} text-gray-400`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                          {isMe && <button onClick={() => recallMessage(msg)} className="text-red-400 hover:text-red-600 ml-1" title="Recall">↩</button>}
                          <button onClick={() => setReplyingTo(msg)} className="text-gray-400 hover:text-gray-600 ml-1" title="Reply">↪</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {replyingTo && (
              <div className="bg-gray-200 px-4 py-2 text-sm flex justify-between items-center">
                <span>Replying to {replyingTo.sender?.username || 'message'}: {replyingTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyingTo(null)} className="text-red-500">✕</button>
              </div>
            )}

            <div className="p-3 bg-white border-t flex items-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-gray-600 p-2">📷</button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <div className="relative">
                <button onClick={() => setShowEmoji(!showEmoji)} className="text-gray-400 hover:text-gray-600 p-2">😊</button>
                {showEmoji && (
                  <div className="absolute bottom-10 left-0 bg-white border rounded-lg shadow-lg p-2 grid grid-cols-6 gap-1 w-56">
                    {EMOJIS.map(emoji => (
                      <button key={emoji} onClick={() => { setInput(prev => prev + emoji); setShowEmoji(false); }} className="text-xl hover:bg-gray-100 p-1 rounded">{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="flex-1 p-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
              />
              <button onClick={sendMessage} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm">Send</button>
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
