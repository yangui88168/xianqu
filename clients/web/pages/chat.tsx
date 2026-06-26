import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import CallModal from '../components/CallModal';

const API = 'https://xianqu-server.onrender.com';
const PAGE_SIZE = 50;

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

  // 录音相关
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCancel, setRecordingCancel] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartY = useRef<number>(0);

  const [callState, setCallState] = useState<{ type: 'audio' | 'video'; friendId: string; friendName: string; incoming?: boolean; offerSdp?: any } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>('sidebar');

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
    let reconnectTimer: NodeJS.Timeout;
    let heartbeatTimer: NodeJS.Timeout;
    const token = localStorage.getItem('token');
    const connect = () => {
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
      socket.onopen = () => {
        console.log('WebSocket connected');
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping' }));
        }, 30000);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event === 'message:receive') {
          const newMsg = msg.data;
          setMessages(prev => {
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (selectedChat?.type === 'friend' && selectedChat.data.id === newMsg.senderId) {
            loadSessions();
          }
        } else if (msg.event === 'message:delivered') {
          setMessages(prev => prev.map(m => m.id === msg.data.messageId ? { ...m, status: 'delivered' } : m));
        } else if (msg.event === 'call-offer') {
          setCallState({
            type: msg.data.type || 'audio',
            friendId: msg.data.from,
            friendName: msg.data.fromName || '好友',
            incoming: true,
            offerSdp: msg.data.sdp,
          });
        }
      };
      socket.onclose = () => {
        clearInterval(heartbeatTimer);
        reconnectTimer = setTimeout(connect, 3000);
      };
      setWs(socket);
    };
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
    };
  }, [userId, selectedChat?.data?.id]);

  const selectChat = async (type: string, data: any) => {
    setSelectedChat({ type, data });
    setReplyingTo(null);
    setHasMore(true);
    setMessages([]);
    const token = localStorage.getItem('token');
    let url = '';
    if (type === 'friend') {
      url = `${API}/messages/history/${data.id}?skip=0&take=${PAGE_SIZE}`;
    } else {
      url = `${API}/groups/${data.id}/messages?skip=0&take=${PAGE_SIZE}`;
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const msgs = await res.json();
      setMessages(msgs);
      if (msgs.length < PAGE_SIZE) setHasMore(false);
    }
    setMobileView('chat');
  };

  const loadMoreMessages = async () => {
    if (!selectedChat || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const token = localStorage.getItem('token');
    const currentCount = messages.length;
    let url = '';
    if (selectedChat.type === 'friend') {
      url = `${API}/messages/history/${selectedChat.data.id}?skip=${currentCount}&take=${PAGE_SIZE}`;
    } else {
      url = `${API}/groups/${selectedChat.data.id}/messages?skip=${currentCount}&take=${PAGE_SIZE}`;
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const olderMsgs = await res.json();
      if (olderMsgs.length < PAGE_SIZE) setHasMore(false);
      setMessages(prev => [...olderMsgs, ...prev]);
    }
    setLoadingMore(false);
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (container && container.scrollTop === 0 && hasMore && !loadingMore) {
      loadMoreMessages();
    }
  };

  const sendMessage = () => {
    if (!input.trim() && !replyingTo) return;
    if (!selectedChat || !ws) return;
    const payload: any = {
      content: input,
      type: 'text',
      replyToId: replyingTo?.id || null,
    };
    if (selectedChat.type === 'friend') {
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
          const fres = await fetch(`${API}/groups/${selectedChat.data.id}/messages?skip=0&take=${PAGE_SIZE}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (fres.ok) setMessages(await fres.json());
        }
      });
    }
    setInput('');
    setReplyingTo(null);
  };

  const startRecording = async (clientY: number) => {
    recordStartY.current = clientY;
    setRecordingCancel(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (recordingCancel) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (ws && selectedChat) {
            const msgData: any = {
              content: reader.result as string,
              type: 'voice',
              replyToId: replyingTo?.id || null,
            };
            if (selectedChat.type === 'friend') {
              msgData.receiverId = selectedChat.data.id;
              ws.send(JSON.stringify({ event: 'message:send', data: msgData }));
            } else {
              msgData.groupId = selectedChat.data.id;
              fetch(`${API}/groups/message`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(msgData)
              }).then(async (res) => {
                if (res.ok) {
                  const token = localStorage.getItem('token');
                  const fres = await fetch(`${API}/groups/${selectedChat.data.id}/messages?skip=0&take=${PAGE_SIZE}`, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  if (fres.ok) setMessages(await fres.json());
                }
              });
            }
          }
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      alert('无法访问麦克风，请检查权限');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const handleRecordStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startRecording(clientY);
  };

  const handleRecordMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isRecording) return;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setRecordingCancel(recordStartY.current - clientY > 50);
  };

  const handleRecordEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    stopRecording();
  };

  // 修复图片上传发送
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat || !ws) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const payload: any = {
        content: content,
        type: 'image',
        replyToId: replyingTo?.id || null,
      };

      if (selectedChat.type === 'friend') {
        payload.receiverId = selectedChat.data.id;
        ws.send(JSON.stringify({ event: 'message:send', data: payload }));
        // 本地立即显示
        const tempMsg = {
          id: Date.now().toString(),
          senderId: userId,
          content: content,
          type: 'image',
          status: 'sent',
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, tempMsg]);
      } else {
        payload.groupId = selectedChat.data.id;
        fetch(`${API}/groups/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(payload)
        }).then(async (res) => {
          if (res.ok) {
            const token = localStorage.getItem('token');
            const fres = await fetch(`${API}/groups/${selectedChat.data.id}/messages?skip=0&take=${PAGE_SIZE}`, {
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
      const res = await fetch(`${API}/groups/${selectedChat.data.id}/messages?skip=0&take=${PAGE_SIZE}`, {
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
    alert('好友请求已发送！');
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

  const goBack = () => setMobileView('sidebar');

  return (
    <div className="flex h-screen bg-gray-100 relative">
      {/* 左侧栏 */}
      <div className={`${mobileView === 'sidebar' ? 'block' : 'hidden'} md:block md:w-80 w-full bg-white border-r flex flex-col absolute md:relative z-10 h-full`}>
        <div className="p-3 border-b">
          <div className="flex gap-2 mb-2">
            <input className="flex-1 p-2 border rounded text-sm" placeholder="搜索用户..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchUsers()} />
            <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">搜索</button>
          </div>
          <button onClick={() => setShowGroupModal(true)} className="w-full bg-green-500 text-white py-1 rounded text-sm">+ 创建群聊</button>
          {showGroupModal && (
            <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
              <div className="bg-white p-5 rounded shadow-lg w-72">
                <h3 className="font-bold mb-2">创建群聊</h3>
                <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="群名称" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowGroupModal(false)} className="px-3 py-1 bg-gray-300 rounded text-sm">取消</button>
                  <button onClick={createGroup} className="px-3 py-1 bg-green-500 text-white rounded text-sm">创建</button>
                </div>
              </div>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded p-1">
              {searchResults.map(user => (
                <div key={user.id} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                  <span className="text-sm">{user.nickname || user.username}</span>
                  <button onClick={() => sendFriendRequest(user.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">添加</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {friendRequests.length > 0 && (
          <div className="border-b bg-yellow-50">
            <div className="p-2 text-sm font-bold">好友请求</div>
            {friendRequests.map(req => (
              <div key={req.id} className="flex justify-between items-center px-3 py-2">
                <span className="text-sm">{req.sender?.nickname || req.sender?.username}</span>
                <div className="flex gap-1">
                  <button onClick={() => acceptRequest(req.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">接受</button>
                  <button onClick={() => rejectRequest(req.id)} className="text-xs bg-red-500 text-white px-2 py-1 rounded">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 bg-gray-100 text-sm font-bold">群聊</div>
          {groups.map(g => (
            <div key={g.id} onClick={() => selectChat('group', g)} className={`p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === g.id && selectedChat?.type === 'group' ? 'bg-blue-50' : ''}`}>
              <span className="font-medium text-sm"># {g.name}</span>
            </div>
          ))}
          <div className="p-2 bg-gray-100 text-sm font-bold">好友</div>
          {sessions.map(s => (
            <div key={s.friend.id} onClick={() => selectChat('friend', s.friend)} className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === s.friend.id && selectedChat?.type === 'friend' ? 'bg-blue-50' : ''}`}>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">{(s.friend.nickname || s.friend.username)[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium text-sm truncate">{s.friend.nickname || s.friend.username}</span>
                  {s.lastMessage && <span className="text-xs text-gray-400">{new Date(s.lastMessage.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>}
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500 truncate">{s.lastMessage?.type==='image'?'[图片]':s.lastMessage?.type==='voice'?'[语音]':s.lastMessage?.content||''}</span>
                  {s.unreadCount>0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{s.unreadCount}</span>}
                </div>
              </div>
              <span className={`w-2 h-2 rounded-full ${s.friend.status==='online'?'bg-green-500':'bg-gray-300'}`}></span>
            </div>
          ))}
        </div>
        <div className="p-3 border-t">
          <button onClick={() => { localStorage.clear(); router.push('/'); }} className="w-full bg-gray-200 hover:bg-gray-300 text-sm py-2 rounded">退出登录</button>
        </div>
      </div>

      {/* 右侧聊天窗 */}
      <div className={`${mobileView === 'chat' ? 'block' : 'hidden'} md:block flex-1 flex flex-col`}>
        {selectedChat ? (
          <>
            <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
              <button onClick={goBack} className="md:hidden text-gray-500 mr-2">←</button>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {selectedChat.type === 'group' ? '#' : (selectedChat.data.nickname || selectedChat.data.username)[0]}
              </div>
              <div className="flex-1">
                <p className="font-bold">{selectedChat.type === 'group' ? selectedChat.data.name : (selectedChat.data.nickname || selectedChat.data.username)}</p>
                {selectedChat.type === 'friend' && <p className="text-xs text-gray-500">{selectedChat.data.status === 'online' ? '在线' : '离线'}</p>}
              </div>
              {selectedChat.type === 'friend' && (
                <div className="flex gap-1">
                  <button onClick={() => setCallState({ type: 'audio', friendId: selectedChat.data.id, friendName: selectedChat.data.nickname || selectedChat.data.username })}
                    className="text-gray-500 hover:text-gray-700 p-1" title="语音通话">📞</button>
                  <button onClick={() => setCallState({ type: 'video', friendId: selectedChat.data.id, friendName: selectedChat.data.nickname || selectedChat.data.username })}
                    className="text-gray-500 hover:text-gray-700 p-1" title="视频通话">📹</button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-gray-50" ref={scrollContainerRef} onScroll={handleScroll}>
              {loadingMore && <div className="text-center text-gray-400 text-xs py-2">加载中...</div>}
              {!hasMore && messages.length > 0 && <div className="text-center text-gray-400 text-xs py-2">没有更多消息了</div>}
              {messages.map((msg, i) => {
                const isMe = msg.senderId === userId || msg.sender?.id === userId;
                if (msg.deleted) return (
                  <div key={msg.id || i} className="text-center text-gray-400 text-xs py-1">
                    {isMe ? '你' : (msg.sender?.nickname || msg.sender?.username || '对方')}撤回了一条消息
                  </div>
                );
                return (
                  <div key={msg.id || i} className={`mb-4 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[75%] ${isMe ? 'flex-row-reverse' : ''}`}>
                      <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs">
                        {isMe ? '我' : ((msg.sender?.nickname || msg.sender?.username)?.[0] || selectedChat.data?.nickname?.[0] || selectedChat.data?.username?.[0] || '?')}
                      </div>
                      <div className="flex flex-col">
                        {msg.replyToId && (
                          <div className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-1 mb-1 border-l-2 border-blue-300">
                            回复：{msg.replyTo?.content?.substring(0,30) || '消息'}
                          </div>
                        )}
                        <div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-md' : 'bg-white text-gray-800 rounded-bl-md shadow'}`}>
                          {msg.type === 'image' ? (
                            <img src={msg.content} alt="图片" className="max-w-60 rounded" />
                          ) : msg.type === 'voice' ? (
                            <audio controls className="max-w-60">
                              <source src={msg.content} type="audio/webm" />
                              您的浏览器不支持音频播放。
                            </audio>
                          ) : (
                            msg.content
                          )}
                        </div>
                        <div className={`flex items-center gap-1 mt-1 text-xs ${isMe ? 'justify-end' : 'justify-start'} text-gray-400`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                          {isMe && <button onClick={() => recallMessage(msg)} className="text-red-400 hover:text-red-600 ml-1" title="撤回">↩</button>}
                          <button onClick={() => setReplyingTo(msg)} className="text-gray-400 hover:text-gray-600 ml-1" title="回复">↪</button>
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
                <span>回复 {(replyingTo.sender?.nickname || replyingTo.sender?.username || '用户')}：{replyingTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyingTo(null)} className="text-red-500">✕</button>
              </div>
            )}

            <div className="p-3 bg-white border-t">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}
                  className="text-gray-400 hover:text-gray-600 p-2"
                  title={inputMode === 'text' ? '切换到语音' : '切换到文字'}
                >
                  {inputMode === 'text' ? '🎤' : '⌨️'}
                </button>

                {inputMode === 'text' ? (
                  <>
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
                    <input className="flex-1 p-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="输入消息..." />
                    <button onClick={sendMessage} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm">发送</button>
                  </>
                ) : (
                  <div className="flex-1 flex justify-center">
                    <button
                      onMouseDown={handleRecordStart}
                      onMouseMove={handleRecordMove}
                      onMouseUp={handleRecordEnd}
                      onMouseLeave={handleRecordEnd}
                      onTouchStart={handleRecordStart}
                      onTouchMove={handleRecordMove}
                      onTouchEnd={handleRecordEnd}
                      className={`w-full py-3 rounded-full text-center font-medium select-none ${
                        isRecording
                          ? recordingCancel
                            ? 'bg-red-500 text-white'
                            : 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      {isRecording
                        ? recordingCancel
                          ? '松开取消'
                          : '正在录音...'
                        : '按住说话'}
                    </button>
                  </div>
                )}
              </div>
              {isRecording && !recordingCancel && (
                <div className="text-center text-xs text-gray-400 mt-1">上滑取消</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg">选择一个会话开始聊天</p>
            </div>
          </div>
        )}
      </div>

      {/* 通话弹窗 */}
      {callState && ws && (
        <CallModal
          ws={ws}
          userId={userId}
          friendId={callState.friendId}
          friendName={callState.friendName}
          type={callState.type}
          incoming={callState.incoming}
          offerSdp={callState.offerSdp}
          onHangup={() => setCallState(null)}
        />
      )}
    </div>
  );
}
