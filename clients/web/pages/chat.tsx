import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import CallModal from '../components/CallModal';

const API = 'https://xianqu-server.onrender.com';
const PAGE_SIZE = 10;

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

  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCancel, setRecordingCancel] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartY = useRef<number>(0);

  const [callState, setCallState] = useState<any>(null);
  const [pendingCall, setPendingCall] = useState<{ type: 'audio' | 'video'; friendId: string; friendName: string } | null>(null);
  const callStateRef = useRef(callState);
  callStateRef.current = callState;

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>('sidebar');

  const [contextMenu, setContextMenu] = useState<{ msg: any; x: number; y: number } | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupAnnouncement, setGroupAnnouncement] = useState('');
  const [showMentionList, setShowMentionList] = useState(false);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteGroupId, setInviteGroupId] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);

  const messageCache = useRef<Map<string, any[]>>(new Map());
  const loadingChatRef = useRef<Set<string>>(new Set());

  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();

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

  // 初始化 Cloudinary Widget
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const script = document.createElement('script');
    script.src = 'https://widget.cloudinary.com/v2.0/global/all.js';
    script.async = true;
    script.onload = () => {
      cloudinaryRef.current = (window as any).cloudinary;
      widgetRef.current = cloudinaryRef.current.createUploadWidget(
        {
          cloudName: 'dmfjdnn4f',
          uploadPreset: 'xianqu_preset',
          maxFiles: 1,
          clientAllowedFormats: ['image', 'video'],
          maxFileSize: 5000000,
        },
        (error: any, result: any) => {
          if (!error && result && result.event === 'success') {
            const url = result.info.secure_url;
            sendMessageWithUrl(url, 'image');
          }
        }
      );
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // WebSocket 连接（心跳、重连、消息/信令处理）
  useEffect(() => {
    if (!userId) return;
    let reconnectTimer: NodeJS.Timeout;
    let heartbeatTimer: NodeJS.Timeout;
    const token = localStorage.getItem('token');
    const connect = () => {
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
      socket.onopen = () => {
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
            fetch(`${API}/messages/read`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ senderId: newMsg.senderId })
            });
          }
          const cacheKey = `friend-${newMsg.senderId}`;
          const cached = messageCache.current.get(cacheKey) || [];
          if (!cached.find(m => m.id === newMsg.id)) {
            messageCache.current.set(cacheKey, [...cached, newMsg]);
          }
          loadSessions();
        } else if (msg.event === 'group-message:receive') {
          const newMsg = msg.data;
          setMessages(prev => {
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          const cacheKey = `group-${newMsg.groupId}`;
          const cached = messageCache.current.get(cacheKey) || [];
          if (!cached.find(m => m.id === newMsg.id)) {
            messageCache.current.set(cacheKey, [...cached, newMsg]);
          }
          loadGroups();
        } else if (msg.event === 'call-offer') {
          // 被叫方：弹出接听/拒绝提示
          setPendingCall({
            type: msg.data.type || 'audio',
            friendId: msg.data.from,
            friendName: msg.data.fromName || '好友',
          });
        } else if (msg.event === 'call-accepted') {
          // 主叫方收到对方接听，标记 accepted=true
          const currentCall = callStateRef.current;
          if (currentCall && currentCall.friendId === msg.data.from && currentCall.incoming === false) {
            setCallState(prev => prev ? { ...prev, accepted: true } : null);
          }
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
  }, [userId, selectedChat?.data?.id, loadSessions]);

  const selectChat = async (type: string, data: any) => {
    setSelectedChat({ type, data });
    setReplyingTo(null);
    setMobileView('chat');
    const cacheKey = `${type}-${data.id}`;
    const cachedMessages = messageCache.current.get(cacheKey);
    if (cachedMessages && cachedMessages.length > 0) {
      setMessages(cachedMessages);
      setHasMore(cachedMessages.length >= PAGE_SIZE);
    } else {
      setMessages([]);
      setIsLoadingChat(true);
    }
    if (loadingChatRef.current.has(cacheKey)) return;
    loadingChatRef.current.add(cacheKey);
    try {
      const token = localStorage.getItem('token');
      let url = type === 'friend'
        ? `${API}/messages/history/${data.id}?skip=0&take=${PAGE_SIZE}`
        : `${API}/groups/${data.id}/messages?skip=0&take=${PAGE_SIZE}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs);
        messageCache.current.set(cacheKey, msgs);
        if (msgs.length < PAGE_SIZE) setHasMore(false);
      }
    } catch (err) {
      console.error('加载消息失败', err);
    } finally {
      loadingChatRef.current.delete(cacheKey);
      setIsLoadingChat(false);
    }
    if (type === 'friend') {
      fetch(`${API}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ senderId: data.id })
      }).catch(() => {});
      setSessions(prev => prev.map(s => s.friend.id === data.id ? { ...s, unreadCount: 0 } : s));
    }
  };

  const loadMoreMessages = async () => {
    if (!selectedChat || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const cacheKey = `${selectedChat.type}-${selectedChat.data.id}`;
    const token = localStorage.getItem('token');
    const currentCount = messages.length;
    let url = selectedChat.type === 'friend'
      ? `${API}/messages/history/${selectedChat.data.id}?skip=${currentCount}&take=${PAGE_SIZE}`
      : `${API}/groups/${selectedChat.data.id}/messages?skip=${currentCount}&take=${PAGE_SIZE}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const older = await res.json();
        if (older.length < PAGE_SIZE) setHasMore(false);
        const updatedMessages = [...older, ...messages];
        setMessages(updatedMessages);
        messageCache.current.set(cacheKey, updatedMessages);
      }
    } catch (err) {
      console.error('加载更多消息失败', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleScroll = () => {
    if (scrollContainerRef.current?.scrollTop === 0 && hasMore && !loadingMore) {
      loadMoreMessages();
    }
  };

  const updateSession = (friendId: string, content: string, type: string) => {
    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.friend.id === friendId) {
          return { ...s, lastMessage: { id: `temp-${Date.now()}`, content, type, createdAt: new Date().toISOString(), senderId: userId }, unreadCount: 0 };
        }
        return s;
      });
      const target = updated.find(s => s.friend.id === friendId);
      if (target) return [target, ...updated.filter(s => s.friend.id !== friendId)];
      return updated;
    });
  };

  const sendMessageWithUrl = (url: string, type: string) => {
    if (!selectedChat || !ws) return;
    const payload: any = {
      content: url,
      type,
      replyToId: replyingTo?.id || null,
      chatType: selectedChat.type,
    };
    if (selectedChat.type === 'friend') {
      payload.receiverId = selectedChat.data.id;
      updateSession(selectedChat.data.id, '[图片]', 'image');
    } else {
      payload.groupId = selectedChat.data.id;
    }
    ws.send(JSON.stringify({ event: 'message:send', data: payload }));
  };

  const sendMessage = () => {
    if (!input.trim() && !replyingTo) return;
    if (!selectedChat || !ws) return;
    const payload: any = {
      content: input,
      type: 'text',
      replyToId: replyingTo?.id || null,
      chatType: selectedChat.type,
    };
    if (selectedChat.type === 'friend') {
      payload.receiverId = selectedChat.data.id;
      const tempId = `temp-${Date.now()}`;
      const tempMsg = {
        id: tempId, senderId: userId, content: input, type: 'text',
        status: 'sent', createdAt: new Date().toISOString(),
        replyToId: replyingTo?.id || null,
        replyTo: replyingTo ? { content: replyingTo.content, sender: replyingTo.sender } : null,
      };
      setMessages(prev => [...prev, tempMsg]);
      updateSession(selectedChat.data.id, input, 'text');
      const cacheKey = `friend-${selectedChat.data.id}`;
      const cached = messageCache.current.get(cacheKey) || [];
      messageCache.current.set(cacheKey, [...cached, tempMsg]);
    } else {
      payload.groupId = selectedChat.data.id;
    }
    ws.send(JSON.stringify({ event: 'message:send', data: payload }));
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
      recorder.ondataavailable = (e) => { audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        if (recordingCancel) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (ws && selectedChat) {
            const msgData: any = {
              content: reader.result,
              type: 'voice',
              replyToId: replyingTo?.id || null,
              chatType: selectedChat.type,
            };
            if (selectedChat.type === 'friend') {
              msgData.receiverId = selectedChat.data.id;
              updateSession(selectedChat.data.id, '[语音]', 'voice');
            } else {
              msgData.groupId = selectedChat.data.id;
            }
            ws.send(JSON.stringify({ event: 'message:send', data: msgData }));
          }
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch { alert('无法访问麦克风'); }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
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

  const deleteMessage = async (msg: any) => {
    const token = localStorage.getItem('token');
    if (selectedChat?.type === 'friend') {
      await fetch(`${API}/messages/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId: msg.id })
      });
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      const cacheKey = `friend-${selectedChat.data.id}`;
      const cached = messageCache.current.get(cacheKey) || [];
      messageCache.current.set(cacheKey, cached.filter(m => m.id !== msg.id));
    } else {
      await fetch(`${API}/groups/message/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId: msg.id })
      });
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制');
  };

  const handleContextMenu = (e: React.MouseEvent, msg: any) => {
    e.preventDefault();
    setContextMenu({ msg, x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (msg: any) => {
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ msg, x: 0, y: 0 });
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const loadGroupInfo = async () => {
    if (!selectedChat || selectedChat.type !== 'group') return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/${selectedChat.data.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setGroupInfo(data);
      setGroupAnnouncement(data.announcement || '');
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
      body: JSON.stringify({
        name: newGroupName,
        memberIds: selectedFriends,
      }),
    });
    if (res.ok) {
      setShowGroupModal(false);
      setNewGroupName('');
      setSelectedFriends([]);
      loadGroups();
    } else {
      alert('创建失败');
    }
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const goBack = () => setMobileView('sidebar');

  return (
    <div className="flex h-dvh bg-gray-100 relative overflow-hidden" onClick={() => { setContextMenu(null); setShowMentionList(false); }}>
      {/* 左侧栏 */}
      <div className={`${mobileView === 'sidebar' ? 'block' : 'hidden'} md:block md:w-80 w-full bg-white border-r flex flex-col absolute md:relative z-10 h-dvh md:h-full`}>
        <div className="p-3 border-b">
          <div className="flex gap-2 mb-2">
            <input className="flex-1 p-2 border rounded text-sm" placeholder="搜索用户..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchUsers()} />
            <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">搜索</button>
          </div>
          <button onClick={() => setShowGroupModal(true)} className="w-full bg-green-500 text-white py-1 rounded text-sm mb-2">+ 创建群聊</button>
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto border rounded p-1">
              {searchResults.map((user: any) => (
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
            {friendRequests.map((req: any) => (
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
          {groups.map((g: any) => (
            <div key={g.id} onClick={() => selectChat('group', g)} className={`p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === g.id && selectedChat?.type === 'group' ? 'bg-blue-50' : ''}`}>
              <span className="font-medium text-sm"># {g.name}</span>
            </div>
          ))}
          <div className="p-2 bg-gray-100 text-sm font-bold">好友</div>
          {sessions.map((s: any) => (
            <div key={s.friend.id} onClick={() => selectChat('friend', s.friend)} className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === s.friend.id && selectedChat?.type === 'friend' ? 'bg-blue-50' : ''}`}>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">{(s.friend.nickname || s.friend.username)[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium text-sm truncate">{s.friend.nickname || s.friend.username}</span>
                  {s.lastMessage && <span className="text-xs text-gray-400">{new Date(s.lastMessage.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>}
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500 truncate">{s.lastMessage?.type === 'image' ? '[图片]' : s.lastMessage?.type === 'voice' ? '[语音]' : s.lastMessage?.content || ''}</span>
                  {s.unreadCount > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{s.unreadCount}</span>}
                </div>
              </div>
              <span className={`w-2 h-2 rounded-full ${s.friend.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`}></span>
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
              <div className="flex items-center gap-1">
                {selectedChat.type === 'friend' && (
                  <>
                    <button
                      onClick={() => {
                        if (!ws) return;
                        ws.send(JSON.stringify({
                          event: 'call-offer',
                          data: { targetId: selectedChat.data.id, type: 'audio' }
                        }));
                        setCallState({
                          type: 'audio',
                          friendId: selectedChat.data.id,
                          friendName: selectedChat.data.nickname || selectedChat.data.username,
                          incoming: false,
                          accepted: false,
                        });
                      }}
                      className="text-gray-500 hover:text-gray-700 p-1"
                      title="语音通话"
                    >📞</button>
                    <button
                      onClick={() => {
                        if (!ws) return;
                        ws.send(JSON.stringify({
                          event: 'call-offer',
                          data: { targetId: selectedChat.data.id, type: 'video' }
                        }));
                        setCallState({
                          type: 'video',
                          friendId: selectedChat.data.id,
                          friendName: selectedChat.data.nickname || selectedChat.data.username,
                          incoming: false,
                          accepted: false,
                        });
                      }}
                      className="text-gray-500 hover:text-gray-700 p-1"
                      title="视频通话"
                    >📹</button>
                  </>
                )}
                {selectedChat.type === 'group' && (
                  <button onClick={() => { loadGroupInfo(); setShowGroupInfo(true); }} className="text-gray-500 hover:text-gray-700 p-1" title="群信息">ℹ️</button>
                )}
                <button
                  onClick={() => { setSelectedChat(null); setMessages([]); }}
                  className="text-gray-400 hover:text-gray-600 p-1 ml-1"
                  title="关闭"
                >✕</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-gray-50" ref={scrollContainerRef} onScroll={handleScroll}>
              {isLoadingChat ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                    <span className="text-gray-400 text-sm">加载中...</span>
                  </div>
                </div>
              ) : (
                <>
                  {loadingMore && <div className="text-center text-gray-400 text-xs py-2">加载中...</div>}
                  {!hasMore && messages.length > 0 && <div className="text-center text-gray-400 text-xs py-2">没有更多消息了</div>}
                  {messages.map((msg: any, i: number) => {
                    const isMe = msg.senderId === userId || msg.sender?.id === userId;
                    if (msg.deleted) return null;
                    if (msg.recalled) return (
                      <div key={msg.id || i} className="text-center text-gray-400 text-xs py-1">
                        {isMe ? '你' : (msg.sender?.nickname || msg.sender?.username || '对方')} 撤回了一条消息
                      </div>
                    );
                    return (
                      <div
                        key={msg.id || i}
                        className={`mb-4 flex ${isMe ? 'justify-end' : 'justify-start'}`}
                        onContextMenu={(e) => handleContextMenu(e, msg)}
                        onTouchStart={() => handleTouchStart(msg)}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchEnd}
                      >
                        <div className={`flex items-end gap-2 max-w-[75%] ${isMe ? 'flex-row-reverse' : ''}`}>
                          <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs">
                            {isMe ? '我' : ((msg.sender?.nickname || msg.sender?.username || selectedChat.data?.nickname || selectedChat.data?.username)?.[0] || '?')}
                          </div>
                          <div className="flex flex-col">
                            {msg.replyToId && (
                              <div className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-1 mb-1 border-l-2 border-blue-300">
                                回复：{msg.replyTo?.content?.substring(0, 30) || '消息'}
                              </div>
                            )}
                            <div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-md' : 'bg-white text-gray-800 rounded-bl-md shadow'}`}>
                              {msg.type === 'image' ? (
                                <img src={msg.content} alt="图片" className="max-w-60 rounded" loading="lazy" />
                              ) : msg.type === 'voice' ? (
                                <audio controls className="max-w-60">
                                  <source src={msg.content} type="audio/webm" />
                                </audio>
                              ) : (
                                msg.content
                              )}
                            </div>
                            <div className={`flex items-center gap-1 mt-1 text-xs ${isMe ? 'justify-end' : 'justify-start'} text-gray-400`}>
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                              {isMe && msg.status !== 'sending' && <button onClick={() => recallMessage(msg)} className="text-red-400 hover:text-red-600 ml-1" title="撤回">↩</button>}
                              <button onClick={() => setReplyingTo(msg)} className="text-gray-400 hover:text-gray-600 ml-1" title="回复">↪</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {replyingTo && (
              <div className="bg-gray-200 px-4 py-2 text-sm flex justify-between items-center">
                <span>回复 {(replyingTo.sender?.nickname || replyingTo.sender?.username || '用户')}：{replyingTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyingTo(null)} className="text-red-500">✕</button>
              </div>
            )}

            <div className="p-3 bg-white border-t">
              <div className="flex items-center gap-2">
                <button onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')} className="text-gray-400 hover:text-gray-600 p-2">
                  {inputMode === 'text' ? '🎤' : '⌨️'}
                </button>
                {inputMode === 'text' ? (
                  <>
                    <button onClick={() => widgetRef.current?.open()} className="text-gray-400 hover:text-gray-600 p-2">📷</button>
                    {selectedChat?.type === 'group' && (
                      <button onClick={async () => {
                        const token = localStorage.getItem('token');
                        const res = await fetch(`${API}/groups/${selectedChat.data.id}`, {
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        if (res.ok) {
                          const g = await res.json();
                          const member = g.members?.find((m: any) => m.userId !== userId);
                          if (member) {
                            setInput(prev => prev + `@${member.user?.nickname || member.user?.username} `);
                          } else {
                            alert('没有其他成员可@');
                          }
                        }
                      }} className="text-gray-400 hover:text-gray-600 p-2">@</button>
                    )}
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="输入消息..."
                    />
                    <button onClick={sendMessage} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm">发送</button>
                  </>
                ) : (
                  <div className="flex-1 flex justify-center">
                    <button
                      onMouseDown={e => { e.preventDefault(); startRecording(e.clientY); }}
                      onMouseMove={e => { if (isRecording) setRecordingCancel(recordStartY.current - e.clientY > 50); }}
                      onMouseUp={e => { e.preventDefault(); stopRecording(); }}
                      onMouseLeave={e => { if (isRecording) stopRecording(); }}
                      onTouchStart={e => { e.preventDefault(); startRecording(e.touches[0].clientY); }}
                      onTouchMove={e => { if (isRecording) setRecordingCancel(recordStartY.current - e.touches[0].clientY > 50); }}
                      onTouchEnd={e => { e.preventDefault(); stopRecording(); }}
                      className={`w-full py-3 rounded-full text-center font-medium select-none ${isRecording ? (recordingCancel ? 'bg-red-500 text-white' : 'bg-blue-600 text-white') : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                    >
                      {isRecording ? (recordingCancel ? '松开取消' : '正在录音...') : '按住说话'}
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

      {/* 创建群聊弹窗 */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded shadow-lg w-80 max-h-[70vh] flex flex-col">
            <h3 className="font-bold mb-3">创建群聊</h3>
            <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="群名称" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            <p className="text-sm font-medium mb-2">邀请好友（可选）</p>
            <div className="flex-1 overflow-y-auto border rounded p-2 mb-3">
              {sessions.length === 0 && <p className="text-xs text-gray-400">暂无好友</p>}
              {sessions.map((s: any) => (
                <label key={s.friend.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={selectedFriends.includes(s.friend.id)} onChange={e => {
                    if (e.target.checked) setSelectedFriends(prev => [...prev, s.friend.id]);
                    else setSelectedFriends(prev => prev.filter(id => id !== s.friend.id));
                  }} />
                  <span className="text-sm">{s.friend.nickname || s.friend.username}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowGroupModal(false); setSelectedFriends([]); }} className="px-3 py-1 bg-gray-300 rounded text-sm">取消</button>
              <button onClick={createGroup} className="px-3 py-1 bg-green-500 text-white rounded text-sm">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 群信息面板 */}
      {showGroupInfo && groupInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50" onClick={() => setShowGroupInfo(false)}>
          <div className="bg-white rounded-xl shadow-xl w-96 max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">群信息</h3>
              <button onClick={() => setShowGroupInfo(false)} className="text-gray-500">✕</button>
            </div>
            <p className="font-medium">群名称：{groupInfo.name}</p>
            <p className="text-sm text-gray-500 mt-1">成员 {groupInfo.members?.length} 人</p>
            <button
              onClick={() => { setInviteGroupId(groupInfo.id); setSelectedFriends([]); setInviteModal(true); }}
              className="w-full bg-blue-500 text-white py-2 rounded text-sm mt-3"
            >
              邀请好友加入
            </button>
            <div className="mt-3">
              <label className="text-sm font-medium">群公告</label>
              {(groupInfo.ownerId === userId || groupInfo.members?.find((m: any) => m.userId === userId && m.role === 'admin')) ? (
                <div className="flex gap-2 mt-1">
                  <input value={groupAnnouncement} onChange={e => setGroupAnnouncement(e.target.value)} className="flex-1 border p-1 rounded text-sm" placeholder="编辑公告" />
                  <button onClick={async () => {
                    const token = localStorage.getItem('token');
                    await fetch(`${API}/groups/${groupInfo.id}/announcement`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ announcement: groupAnnouncement }) });
                    alert('公告已更新');
                  }} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">保存</button>
                </div>
              ) : (
                <p className="text-sm text-gray-600 mt-1 bg-gray-50 p-2 rounded">{groupInfo.announcement || '暂无公告'}</p>
              )}
            </div>
            <div className="mt-4">
              <h4 className="font-medium text-sm mb-2">成员列表</h4>
              {groupInfo.members?.map((m: any) => (
                <div key={m.userId} className="flex justify-between items-center py-1 border-b text-sm">
                  <span>{m.user?.nickname || m.user?.username} {m.role === 'owner' ? '👑' : m.role === 'admin' ? '⭐' : ''}</span>
                  <div className="flex gap-1">
                    {m.userId !== userId && groupInfo.ownerId === userId && (
                      <>
                        <button onClick={async () => { const token = localStorage.getItem('token'); await fetch(`${API}/groups/${groupInfo.id}/admin`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ targetUserId: m.userId, role: m.role === 'admin' ? 'member' : 'admin' }) }); loadGroupInfo(); }} className="text-xs text-blue-500">{m.role === 'admin' ? '取消管理' : '设为管理'}</button>
                        <button onClick={async () => { const minutes = prompt('禁言分钟数：'); if (!minutes) return; const token = localStorage.getItem('token'); await fetch(`${API}/groups/${groupInfo.id}/mute`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ targetUserId: m.userId, minutes: parseInt(minutes) }) }); alert('已禁言'); }} className="text-xs text-red-500">禁言</button>
                      </>
                    )}
                    {m.userId !== userId && groupInfo.ownerId === userId && (
                      <button onClick={async () => { if (confirm('转让群主给该成员？')) { const token = localStorage.getItem('token'); await fetch(`${API}/groups/${groupInfo.id}/transfer`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ newOwnerId: m.userId }) }); loadGroupInfo(); } }} className="text-xs text-orange-500">转让</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowGroupInfo(false)} className="mt-4 w-full bg-gray-200 py-2 rounded">关闭</button>
          </div>
        </div>
      )}

      {/* 邀请好友弹窗 */}
      {inviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded shadow-lg w-80 max-h-[70vh] flex flex-col">
            <h3 className="font-bold mb-3">邀请好友</h3>
            <div className="flex-1 overflow-y-auto border rounded p-2 mb-3">
              {sessions.filter((s: any) => !groupInfo?.members?.find((m: any) => m.userId === s.friend.id)).length === 0 && <p className="text-xs text-gray-400">没有可邀请的好友</p>}
              {sessions.filter((s: any) => !groupInfo?.members?.find((m: any) => m.userId === s.friend.id)).map((s: any) => (
                <label key={s.friend.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={selectedFriends.includes(s.friend.id)} onChange={e => { if (e.target.checked) setSelectedFriends(prev => [...prev, s.friend.id]); else setSelectedFriends(prev => prev.filter(id => id !== s.friend.id)); }} />
                  <span className="text-sm">{s.friend.nickname || s.friend.username}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setInviteModal(false); setSelectedFriends([]); }} className="px-3 py-1 bg-gray-300 rounded text-sm">取消</button>
              <button onClick={async () => { if (selectedFriends.length === 0) return; const token = localStorage.getItem('token'); const res = await fetch(`${API}/groups/${inviteGroupId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userIds: selectedFriends }) }); if (res.ok) { alert('邀请成功'); setInviteModal(false); setSelectedFriends([]); loadGroupInfo(); } else { alert('邀请失败'); } }} className="px-3 py-1 bg-green-500 text-white rounded text-sm">邀请</button>
            </div>
          </div>
        </div>
      )}

      {/* 消息操作菜单（右键/长按） */}
      {contextMenu && (
        <div className="fixed bg-white border rounded shadow-lg py-1 z-50" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
          <button onClick={() => { copyToClipboard(contextMenu.msg.content); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">复制</button>
          <button onClick={() => { setReplyingTo(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">引用回复</button>
          {contextMenu.msg.senderId === userId && (
            <>
              <button onClick={() => { recallMessage(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">撤回</button>
              <button onClick={() => { deleteMessage(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-red-500">删除</button>
            </>
          )}
        </div>
      )}

      {/* 被叫方接听/拒绝弹窗 */}
      {pendingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 text-center w-72">
            <div className="text-4xl mb-3">{pendingCall.type === 'video' ? '📹' : '📞'}</div>
            <p className="font-bold text-lg mb-1">{pendingCall.friendName}</p>
            <p className="text-gray-500 text-sm mb-6">邀请你进行{pendingCall.type === 'video' ? '视频' : '语音'}通话</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  // 拒绝：发送挂断信令
                  ws?.send(JSON.stringify({ event: 'call-hangup', data: { targetId: pendingCall.friendId } }));
                  setPendingCall(null);
                }}
                className="px-6 py-3 bg-red-500 text-white rounded-full font-medium"
              >
                拒绝
              </button>
              <button
                onClick={() => {
                  // 接听：发送 call-accepted 信令 + 打开 CallModal
                  ws?.send(JSON.stringify({ event: 'call-accepted', data: { targetId: pendingCall.friendId } }));
                  setCallState({
                    type: pendingCall.type,
                    friendId: pendingCall.friendId,
                    friendName: pendingCall.friendName,
                    incoming: true,
                  });
                  setPendingCall(null);
                }}
                className="px-6 py-3 bg-green-500 text-white rounded-full font-medium"
              >
                接听
              </button>
            </div>
          </div>
        </div>
      )}

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
          accepted={callState.accepted}
          onHangup={() => setCallState(null)}
        />
      )}
    </div>
  );
}
