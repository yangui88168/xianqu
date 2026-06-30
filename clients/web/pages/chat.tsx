// @ts-nocheck

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import CallModal from '../components/CallModal';

// 动态加载提示音（仅客户端）
let MessageSound: any = null;
if (typeof window !== 'undefined') {
  import('../utils/sound').then(mod => { MessageSound = mod.MessageSound; });
}

const API = 'https://xianqu-server.onrender.com';
const PAGE_SIZE = 10;
const MAX_CACHE_SIZE = 50;
const MAX_CHAT_CACHES = 50;
const EMOJIS = ['😀', '😂', '❤️', '👍', '😢', '😡', '🎉', '🔥', '💯', '✨', '👋', '🙏'];

const getLastSeenText = (friend: any) => {
  if (friend.status === 'invisible') return '离线';
  const map: Record<string, string> = { online: '在线', busy: '忙碌', dnd: '勿扰', away: '离开' };
  if (friend.status && map[friend.status]) return map[friend.status];
  if (!friend.lastSeen) return '离线';
  const diff = Date.now() - new Date(friend.lastSeen).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚在线';
  if (mins < 60) return `${mins}分钟前在线`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前在线`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前在线`;
  return new Date(friend.lastSeen).toLocaleDateString();
};

class LRUCache {
  private capacity: number;
  private map = new Map<string, any[]>();
  private order: string[] = [];
  constructor(capacity: number) { this.capacity = capacity; }
  get(key: string) {
    if (!this.map.has(key)) return undefined;
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    return this.map.get(key);
  }
  set(key: string, value: any[]) {
    if (this.map.has(key)) this.order = this.order.filter(k => k !== key);
    else if (this.order.length >= this.capacity) {
      const oldest = this.order.shift();
      if (oldest) this.map.delete(oldest);
    }
    this.order.push(key);
    this.map.set(key, value);
  }
  delete(key: string) { this.map.delete(key); this.order = this.order.filter(k => k !== key); }
}

const bubbleStyle = {
  maxWidth: '70%',
  wordBreak: 'break-word' as const,
  overflowWrap: 'anywhere' as const,
  whiteSpace: 'pre-wrap' as const,
  overflow: 'hidden' as const,
};

const imageStyle = {
  maxWidth: '280px',
  maxHeight: '320px',
  objectFit: 'cover' as const,
  display: 'block' as const,
  borderRadius: '8px',
};

const MessageItem = React.memo(({ msg, userId, selectedChat, onContextMenu, onTouchStart, onTouchEnd, onTouchMove, onReply, onRecall, onEdit, editingMessage, editInput, setEditInput, submitEdit }: any) => {
  const isMe = msg.senderId === userId || msg.sender?.id === userId;
  const isForwarded = msg.content?.startsWith('[转发]');
  const displayContent = isForwarded ? msg.content.replace('[转发] ', '') : msg.content;
  if (msg.deleted) return null;
  if (msg.recalled) return (
    <div className="text-center text-gray-400 text-xs py-1">
      {isMe ? '你' : (msg.sender?.nickname || msg.sender?.username || '对方')} 撤回了一条消息
    </div>
  );
  return (
    <div
      className={`mb-4 flex ${isMe ? 'justify-end' : 'justify-start'}`}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      <div className={`flex items-end gap-2 max-w-[75%] ${isMe ? 'flex-row-reverse' : ''}`}>
        <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs">
          {isMe ? '我' : ((msg.sender?.nickname || msg.sender?.username || selectedChat?.data?.nickname || selectedChat?.data?.username)?.[0] || '?')}
        </div>
        <div className="flex flex-col min-w-0">
          {msg.replyToId && (
            <div className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-1 mb-1 border-l-2 border-blue-300" style={bubbleStyle}>
              回复：{msg.replyTo?.content?.substring(0, 30) || '消息'}
            </div>
          )}
          {editingMessage?.id === msg.id ? (
            <div className="flex gap-2">
              <input
                className="flex-1 border p-1 rounded text-sm"
                value={editInput}
                onChange={e => setEditInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitEdit();
                  if (e.key === 'Escape') { onEdit(null, ''); }
                }}
                autoFocus
              />
              <button onClick={submitEdit} className="text-blue-500 text-xs">保存</button>
            </div>
          ) : (
            <div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-md' : 'bg-white text-gray-800 rounded-bl-md shadow'}`} style={bubbleStyle}>
              {msg.type === 'image' ? (
                <img src={msg.content} alt="图片" style={imageStyle} loading="lazy" />
              ) : msg.type === 'voice' ? (
                <audio controls style={{ maxWidth: '220px' }}>
                  <source src={msg.content} type="audio/webm" />
                </audio>
              ) : (
                <>
                  {displayContent}
                  {msg.edited && <span className="text-xs ml-1 opacity-60">(已编辑)</span>}
                </>
              )}
            </div>
          )}
          <div className={`flex items-center gap-1 mt-1 text-xs ${isMe ? 'justify-end' : 'justify-start'} text-gray-400`}>
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {isForwarded && <span className="text-gray-400">来自转发</span>}
            {isMe && (
              <span className="ml-1">
                {msg.status === 'sent' && <span className="text-gray-400 text-[10px]">✓</span>}
                {msg.status === 'delivered' && <span className="text-gray-400 text-[10px]">✓✓</span>}
                {msg.status === 'read' && <span className="text-blue-500 text-[10px]">✓✓</span>}
              </span>
            )}
            {isMe && msg.status !== 'sending' && <button onClick={() => onRecall(msg)} className="text-red-400 hover:text-red-600 ml-1" title="撤回">↩</button>}
            <button onClick={() => onReply(msg)} className="text-gray-400 hover:text-gray-600 ml-1" title="回复">↪</button>
          </div>
        </div>
      </div>
    </div>
  );
});

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
  const recordStartY = useRef(0);
  const [callState, setCallState] = useState<any>(null);
  const [pendingCall, setPendingCall] = useState<any>(null);
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  const selectedChatRef = useRef(selectedChat);
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const messageCache = useRef<LRUCache>(new LRUCache(MAX_CHAT_CACHES));
  const loadingChatRef = useRef<Set<string>>(new Set());
  const cloudinaryRef = useRef<any>();
  const widgetRef = useRef<any>();
  const shouldAutoScroll = useRef(true);
  const prevScrollHeight = useRef(0);

  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [editInput, setEditInput] = useState('');
  const [forwardModal, setForwardModal] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<any>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState(false);
  const [searchMessageResults, setSearchMessageResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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
    const res = await fetch(`${API}/messages/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setSessions(await res.json());
  }, []);
  const loadGroups = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/list`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setGroups(await res.json());
  }, []);
  const loadFriendRequests = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/requests/incoming`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setFriendRequests(await res.json());
  }, []);

  useEffect(() => {
    if (userId) { loadSessions(); loadGroups(); loadFriendRequests(); }
  }, [userId, loadSessions, loadGroups, loadFriendRequests]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const script = document.createElement('script');
    script.src = 'https://widget.cloudinary.com/v2.0/global/all.js';
    script.async = true;
    script.onload = () => {
      cloudinaryRef.current = (window as any).cloudinary;
      widgetRef.current = cloudinaryRef.current.createUploadWidget(
        { cloudName: 'dmfjdnn4f', uploadPreset: 'xianqu_preset', maxFiles: 1, clientAllowedFormats: ['image', 'video'], maxFileSize: 10000000 },
        (error: any, result: any) => {
          if (!error && result && result.event === 'success') {
            sendMessageWithUrl(result.info.secure_url, 'image');
          }
        }
      );
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
      widgetRef.current?.destroy();
      widgetRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let reconnectTimer: NodeJS.Timeout;
    let heartbeatTimer: NodeJS.Timeout;
    let socket: WebSocket;

    const connect = () => {
      if (socket) {
        socket.close();
        socket.onopen = socket.onmessage = socket.onclose = null;
      }
      const token = localStorage.getItem('token');
      socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws?token=${token}`);
      socket.onopen = () => {
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping' }));
        }, 30000);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const cur = selectedChatRef.current;

        if (msg.event === 'message:receive') {
          const newMsg = msg.data;
          if (cur?.type === 'friend' && cur.data.id === newMsg.senderId) {
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id?.startsWith('temp-') && m.senderId === userId && m.content === newMsg.content);
              if (idx !== -1) { const n = [...prev]; n[idx] = newMsg; return n; }
              if (prev.find(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            shouldAutoScroll.current = isNearBottom();
            fetch(`${API}/messages/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ senderId: newMsg.senderId }) });
          } else {
            MessageSound?.play();
            updateSessionInCache(newMsg);
          }
          addToCache(`friend-${newMsg.senderId}`, newMsg);
          loadSessions();
        } else if (msg.event === 'group-message:receive') {
          const newMsg = msg.data;
          if (cur?.type === 'group' && cur.data.id === newMsg.groupId) {
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id?.startsWith('temp-') && m.senderId === userId && m.content === newMsg.content);
              if (idx !== -1) { const n = [...prev]; n[idx] = newMsg; return n; }
              if (prev.find(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            shouldAutoScroll.current = isNearBottom();
          } else {
            MessageSound?.play();
          }
          addToCache(`group-${newMsg.groupId}`, newMsg);
          loadGroups();
        } else if (msg.event === 'call-offer') {
          setPendingCall({ type: msg.data.type || 'audio', friendId: msg.data.from, sdp: msg.data.sdp });
        } else if (msg.event === 'call-accepted') {
          if (callStateRef.current && callStateRef.current.friendId === msg.data.from && !callStateRef.current.incoming) {
            setCallState((prev: any) => prev ? { ...prev, accepted: true } : null);
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
      if (socket) {
        socket.close();
        socket.onopen = socket.onmessage = socket.onclose = null;
      }
    };
  }, [userId, loadSessions, loadGroups]);

  const isNearBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 100;
  };

  const addToCache = (key: string, msg: any) => {
    const cache = messageCache.current;
    let arr = cache.get(key) || [];
    if (arr.find((m: any) => m.id === msg.id)) return;
    arr = [...arr, msg];
    if (arr.length > MAX_CACHE_SIZE) arr = arr.slice(arr.length - MAX_CACHE_SIZE);
    cache.set(key, arr);
  };

  const updateSessionInCache = (newMsg: any) => {
    setSessions(prev => prev.map(s => s.friend.id === newMsg.senderId ? {
      ...s,
      lastMessage: { id: newMsg.id, content: newMsg.content, type: newMsg.type, createdAt: newMsg.createdAt, senderId: newMsg.senderId },
      unreadCount: (s.unreadCount || 0) + 1,
    } : s));
  };

  const selectChat = useCallback(async (type: string, data: any) => {
    setSelectedChat({ type, data });
    setReplyingTo(null);
    setMobileView('chat');
    shouldAutoScroll.current = false;
    const cacheKey = `${type}-${data.id}`;
    const cached = messageCache.current.get(cacheKey);
    if (cached && cached.length) {
      setMessages(cached);
      setHasMore(cached.length >= PAGE_SIZE);
    } else {
      setMessages([]);
      setIsLoadingChat(true);
    }
    if (loadingChatRef.current.has(cacheKey)) return;
    loadingChatRef.current.add(cacheKey);
    try {
      const token = localStorage.getItem('token');
      const url = type === 'friend' ? `${API}/messages/history/${data.id}?skip=0&take=${PAGE_SIZE}` : `${API}/groups/${data.id}/messages?skip=0&take=${PAGE_SIZE}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs);
        addToCache(cacheKey, ...msgs);
        if (msgs.length < PAGE_SIZE) setHasMore(false);
      }
    } catch (e) { console.error(e); }
    finally { loadingChatRef.current.delete(cacheKey); setIsLoadingChat(false); }
    if (type === 'friend') {
      fetch(`${API}/messages/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ senderId: data.id }) }).catch(()=>{});
      setSessions(prev => prev.map(s => s.friend.id === data.id ? { ...s, unreadCount: 0 } : s));
    }
    if (type === 'group') loadGroupInfoById(data.id);
  }, []);

  const loadGroupInfoById = async (groupId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/${groupId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      setGroupInfo(data);
      setGroupAnnouncement(data.announcement || '');
    }
  };

  const loadGroupInfo = () => { if (selectedChat?.type === 'group') loadGroupInfoById(selectedChat.data.id); };

  const loadMoreMessages = async () => {
    if (!selectedChat || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const container = scrollContainerRef.current;
    if (container) prevScrollHeight.current = container.scrollHeight;
    const key = `${selectedChat.type}-${selectedChat.data.id}`;
    const token = localStorage.getItem('token');
    const skip = messages.length;
    const url = selectedChat.type === 'friend' ? `${API}/messages/history/${selectedChat.data.id}?skip=${skip}&take=${PAGE_SIZE}` : `${API}/groups/${selectedChat.data.id}/messages?skip=${skip}&take=${PAGE_SIZE}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const older = await res.json();
        if (older.length < PAGE_SIZE) setHasMore(false);
        const updated = [...older, ...messages];
        setMessages(updated);
        const cached = messageCache.current.get(key) || [];
        messageCache.current.set(key, [...older, ...cached].slice(0, MAX_CACHE_SIZE));
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight.current;
        });
      }
    } catch (e) { console.error(e); }
    finally { setLoadingMore(false); }
  };

  const handleScroll = () => {
    if (scrollContainerRef.current?.scrollTop === 0 && hasMore && !loadingMore) loadMoreMessages();
  };

  const updateSession = (friendId: string, content: string, type: string) => {
    setSessions(prev => {
      const updated = prev.map(s => s.friend.id === friendId ? { ...s, lastMessage: { id: `temp-${Date.now()}`, content, type, createdAt: new Date().toISOString(), senderId: userId }, unreadCount: 0 } : s);
      const target = updated.find(s => s.friend.id === friendId);
      return target ? [target, ...updated.filter(s => s.friend.id !== friendId)] : updated;
    });
  };

  const sendMessageWithUrl = (url: string, type: string) => {
    if (!selectedChat || !ws) return;
    const payload: any = { content: url, type, replyToId: replyingTo?.id || null, chatType: selectedChat.type };
    if (selectedChat.type === 'friend') { payload.receiverId = selectedChat.data.id; updateSession(selectedChat.data.id, '[图片]', 'image'); }
    else payload.groupId = selectedChat.data.id;
    ws.send(JSON.stringify({ event: 'message:send', data: payload }));
    shouldAutoScroll.current = true;
  };

  const sendMessage = () => {
    if (!input.trim() && !replyingTo) return;
    if (!selectedChat || !ws) return;
    const payload: any = { content: input, type: 'text', replyToId: replyingTo?.id || null, chatType: selectedChat.type };
    if (selectedChat.type === 'friend') {
      payload.receiverId = selectedChat.data.id;
      const tempId = `temp-${Date.now()}`;
      const tempMsg = { id: tempId, senderId: userId, content: input, type: 'text', status: 'sent', createdAt: new Date().toISOString(), replyToId: replyingTo?.id || null, replyTo: replyingTo ? { content: replyingTo.content, sender: replyingTo.sender } : null };
      setMessages(prev => [...prev, tempMsg]);
      updateSession(selectedChat.data.id, input, 'text');
      const key = `friend-${selectedChat.data.id}`;
      const cached = messageCache.current.get(key) || [];
      messageCache.current.set(key, [...cached, tempMsg].slice(0, MAX_CACHE_SIZE));
    } else payload.groupId = selectedChat.data.id;
    ws.send(JSON.stringify({ event: 'message:send', data: payload }));
    setInput(''); setReplyingTo(null);
    shouldAutoScroll.current = true;
  };

  const startRecording = async (clientY: number) => {
    recordStartY.current = clientY; setRecordingCancel(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        if (recordingCancel) { setMediaRecorder(null); return; }
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (ws && selectedChat) {
            const msgData: any = { content: reader.result, type: 'voice', replyToId: replyingTo?.id || null, chatType: selectedChat.type };
            if (selectedChat.type === 'friend') { msgData.receiverId = selectedChat.data.id; updateSession(selectedChat.data.id, '[语音]', 'voice'); }
            else msgData.groupId = selectedChat.data.id;
            ws.send(JSON.stringify({ event: 'message:send', data: msgData }));
            shouldAutoScroll.current = true;
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
        setMediaRecorder(null);
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch { alert('无法访问麦克风'); }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.stop(); setIsRecording(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat || !ws) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 1200; let w = img.width, h = img.height;
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        canvas.toBlob(async blob => {
          if (!blob) return;
          const base64 = await new Promise<string>(res => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(blob); });
          const payload: any = { content: base64, type: 'image', replyToId: replyingTo?.id || null, chatType: selectedChat.type };
          if (selectedChat.type === 'friend') {
            payload.receiverId = selectedChat.data.id;
            const tempId = `temp-${Date.now()}`;
            const tempMsg = { id: tempId, senderId: userId, content: base64, type: 'image', status: 'sending', createdAt: new Date().toISOString() };
            setMessages(prev => [...prev, tempMsg]);
            updateSession(selectedChat.data.id, '[图片]', 'image');
            const key = `friend-${selectedChat.data.id}`;
            const c = messageCache.current.get(key) || [];
            messageCache.current.set(key, [...c, tempMsg].slice(0, MAX_CACHE_SIZE));
          } else payload.groupId = selectedChat.data.id;
          ws.send(JSON.stringify({ event: 'message:send', data: payload }));
          shouldAutoScroll.current = true;
        }, 'image/jpeg', 0.8);
      };
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const recallMessage = async (msg: any) => {
    const token = localStorage.getItem('token');
    if (selectedChat?.type === 'friend') {
      await fetch(`${API}/messages/recall`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: msg.id }) });
      selectChat('friend', selectedChat.data);
    } else {
      await fetch(`${API}/groups/message/recall`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: msg.id }) });
      const res = await fetch(`${API}/groups/${selectedChat.data.id}/messages?skip=0&take=${PAGE_SIZE}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setMessages(await res.json());
    }
  };

  const deleteMessage = async (msg: any) => {
    const token = localStorage.getItem('token');
    if (selectedChat?.type === 'friend') {
      await fetch(`${API}/messages/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: msg.id }) });
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      const key = `friend-${selectedChat.data.id}`;
      const c = messageCache.current.get(key) || [];
      messageCache.current.set(key, c.filter(m => m.id !== msg.id));
    } else {
      await fetch(`${API}/groups/message/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: msg.id }) });
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    }
  };

  const submitEdit = async () => {
    if (!editingMessage || !editInput.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/messages/edit`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: editingMessage.id, content: editInput }) });
    if (res.ok) {
      const { content } = await res.json();
      setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, content, edited: true } : m));
      setEditingMessage(null); setEditInput('');
    } else alert('编辑失败');
  };

  const confirmForward = async () => {
    if (!forwardMessage || !selectedTargets.length) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/messages/forward`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId: forwardMessage.id, targetIds: selectedTargets }) });
    alert('转发成功'); loadSessions(); loadGroups(); setForwardModal(false); setForwardMessage(null); setSelectedTargets([]);
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); alert('已复制'); };

  const handleContextMenu = (e: React.MouseEvent, msg: any) => {
    e.preventDefault();
    setContextMenu({ msg, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) });
  };
  const handleTouchStart = (msg: any) => { longPressTimer.current = setTimeout(() => setContextMenu({ msg, x: 10, y: 10 }), 500); };
  const handleTouchEnd = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); };

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/contacts/search?q=${encodeURIComponent(searchQuery)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setSearchResults(await res.json());
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchMode(true);
    await searchUsers();
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/search/messages?q=${encodeURIComponent(searchQuery)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setSearchMessageResults(await res.json());
  };

  const openSearchResult = (item: any) => {
    if (item.chatType === 'friend') {
      const friend = sessions.find(s => s.friend.id === item.id || s.friend.nickname === item.chatName);
      if (friend) selectChat('friend', friend.friend);
    } else {
      const group = groups.find(g => g.name === item.chatName);
      if (group) selectChat('group', group);
    }
    setSearchMessageResults([]); setSearchMode(false); setSearchQuery('');
  };

  const sendFriendRequest = async (receiverId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/contacts/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ receiverId }) });
    alert('好友请求已发送'); setSearchResults([]);
  };
  const acceptRequest = async (reqId: string) => {
    await fetch(`${API}/contacts/request/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ requestId: reqId }) });
    loadSessions(); loadFriendRequests();
  };
  const rejectRequest = async (reqId: string) => {
    await fetch(`${API}/contacts/request/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ requestId: reqId }) });
    loadFriendRequests();
  };
  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/groups/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: newGroupName, memberIds: selectedFriends }) });
    if (res.ok) { setShowGroupModal(false); setNewGroupName(''); setSelectedFriends([]); loadGroups(); } else alert('创建失败');
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (shouldAutoScroll.current && container) {
      container.scrollTop = container.scrollHeight;
      shouldAutoScroll.current = false;
    }
  }, [messages]);

  const allConversations = [
    ...sessions.map((s: any) => ({ type: 'friend', data: s.friend, lastTime: s.lastMessage?.createdAt || 0, unreadCount: s.unreadCount || 0 })),
    ...groups.map((g: any) => ({ type: 'group', data: g, lastTime: g.lastMessage?.createdAt || g.createdAt || 0 })),
  ].sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime());

  const goBack = () => setMobileView('sidebar');

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden relative bg-white">
      {/* 左侧栏：桌面端始终可见，移动端用 translateX 控制 */}
      <div
        className={`w-full md:w-80 border-r flex flex-col min-h-0 absolute md:relative z-10 transition-transform duration-300 ${
          mobileView === 'sidebar' ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
        style={{ height: '100%' }}
      >
        {/* 搜索与菜单 */}
        <div className="flex-shrink-0 p-3 border-b">
          <div className="flex items-center gap-2">
            {showSearch ? (
              <div className="flex-1 flex gap-2">
                <input className="flex-1 p-2 border rounded text-sm" placeholder="搜索用户..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchUsers()} autoFocus />
                <button onClick={searchUsers} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">搜索</button>
                <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} className="text-gray-500 text-sm whitespace-nowrap">取消</button>
              </div>
            ) : (
              <button onClick={() => setShowSearch(true)} className="flex-1 flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-200">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                搜索
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} className="flex-shrink-0 bg-gray-100 hover:bg-gray-200 rounded-lg p-2 text-gray-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
              </button>
              {showMenu && (
                <div className="absolute left-0 top-10 bg-white border rounded-xl shadow-lg py-1 w-40 z-50">
                  <button onClick={() => { setShowMenu(false); setShowGroupModal(true); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    创建群聊
                  </button>
                  <button onClick={() => { setShowMenu(false); setShowSearch(true); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    添加好友
                  </button>
                </div>
              )}
            </div>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto border rounded p-1 mt-2">
              {searchResults.map((user: any) => (
                <div key={user.id} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                  <span className="text-sm">{user.nickname || user.username}</span>
                  <button onClick={() => sendFriendRequest(user.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">添加</button>
                </div>
              ))}
            </div>
          )}
          {searchMode && searchMessageResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded p-1">
              <p className="text-xs text-gray-500 mb-1">消息搜索结果</p>
              {searchMessageResults.map((item: any, i: number) => (
                <div key={i} className="p-2 hover:bg-gray-100 rounded text-xs cursor-pointer" onClick={() => openSearchResult(item)}>
                  <span className="font-medium">{item.chatName}</span>：{item.content.substring(0, 30)}
                </div>
              ))}
            </div>
          )}
        </div>

        {friendRequests.length > 0 && (
          <div className="flex-shrink-0 border-b bg-yellow-50">
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

        <div className="flex-1 min-h-0 overflow-y-auto">
          {allConversations.map((conv: any) => (
            <div key={conv.type + conv.data.id} onClick={() => selectChat(conv.type, conv.data)}
              className={`p-3 cursor-pointer hover:bg-gray-50 border-b ${selectedChat?.data?.id === conv.data.id && selectedChat?.type === conv.type ? 'bg-blue-50' : ''}`}>
              {conv.type === 'group' ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center text-white text-sm font-bold">#</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <span className="font-medium text-sm truncate">{conv.data.name}</span>
                      {conv.lastTime && <span className="text-xs text-gray-400">{new Date(conv.lastTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">群聊</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">{(conv.data.nickname || conv.data.username)[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <span className="font-medium text-sm truncate">{conv.data.nickname || conv.data.username}</span>
                      {conv.lastTime && <span className="text-xs text-gray-400">{new Date(conv.lastTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500 truncate">{conv.lastMessage?.type === 'image' ? '[图片]' : conv.lastMessage?.type === 'voice' ? '[语音]' : conv.lastMessage?.content || ''}</span>
                      {conv.unreadCount > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{conv.unreadCount}</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{getLastSeenText(conv.data)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div
        className={`flex-1 flex flex-col min-h-0 overflow-hidden transition-transform duration-300 ${
          mobileView === 'chat' ? 'translate-x-0' : 'translate-x-full'
        } md:translate-x-0`}
      >
        {selectedChat ? (
          <>
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b px-4 py-3 flex items-center gap-3" style={{ height: '56px' }}>
              <button onClick={goBack} className="md:hidden text-gray-500 mr-2">←</button>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {selectedChat.type === 'group' ? '#' : (selectedChat.data.nickname || selectedChat.data.username)[0]}
              </div>
              <div className="flex-1">
                <p className="font-bold">{selectedChat.type === 'group' ? selectedChat.data.name : (selectedChat.data.nickname || selectedChat.data.username)}</p>
                {selectedChat.type === 'friend' && <p className="text-xs text-gray-500">{getLastSeenText(selectedChat.data)}</p>}
              </div>
              <div className="flex items-center gap-1">
                {selectedChat.type === 'friend' && (
                  <>
                    <button onClick={() => { if (!ws) return; setCallState({ type: 'audio', friendId: selectedChat.data.id, friendName: selectedChat.data.nickname || selectedChat.data.username, incoming: false }); }} className="text-gray-500 hover:text-gray-700 p-1" title="语音通话">
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    </button>
                    <button onClick={() => { if (!ws) return; setCallState({ type: 'video', friendId: selectedChat.data.id, friendName: selectedChat.data.nickname || selectedChat.data.username, incoming: false }); }} className="text-gray-500 hover:text-gray-700 p-1" title="视频通话">
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                  </>
                )}
                {selectedChat.type === 'group' && (
                  <button onClick={() => { loadGroupInfo(); setShowGroupInfo(true); }} className="text-gray-500 hover:text-gray-700 p-1" title="群信息">
                    <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </button>
                )}
                <button onClick={() => { setSelectedChat(null); setMessages([]); }} className="text-gray-400 hover:text-gray-600 p-1 ml-1" title="关闭">
                  <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* ReplyBar（独立，不参与滚动） */}
            {replyingTo && (
              <div className="flex-shrink-0 bg-gray-200 px-4 py-2 text-sm flex justify-between items-center" style={bubbleStyle}>
                <span>回复 {(replyingTo.sender?.nickname || replyingTo.sender?.username || '用户')}：{replyingTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyingTo(null)} className="text-red-500">✕</button>
              </div>
            )}

            {/* ChatBody：唯一高度分配容器 */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {/* MessageList：唯一滚动容器 */}
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4"
                style={{ height: 0 }}
              >
                {isLoadingChat ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                    <span className="text-gray-400 text-sm">加载中...</span>
                  </div>
                ) : (
                  <>
                    {loadingMore && <div className="text-center text-gray-400 text-xs py-2">加载中...</div>}
                    {!hasMore && messages.length > 0 && <div className="text-center text-gray-400 text-xs py-2">没有更多消息了</div>}
                    {messages.map((msg: any, i: number) => (
                      <MessageItem
                        key={msg.id || i}
                        msg={msg}
                        userId={userId}
                        selectedChat={selectedChat}
                        onContextMenu={(e: any) => handleContextMenu(e, msg)}
                        onTouchStart={() => handleTouchStart(msg)}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchEnd}
                        onReply={setReplyingTo}
                        onRecall={recallMessage}
                        onEdit={setEditingMessage}
                        editingMessage={editingMessage}
                        editInput={editInput}
                        setEditInput={setEditInput}
                        submitEdit={submitEdit}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Input：固定高度 */}
            <div className="flex-shrink-0 bg-white border-t p-3" style={{ minHeight: '64px', maxHeight: '64px' }}>
              <div className="flex items-center gap-2 h-full">
                <button onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')} className="text-gray-400 hover:text-gray-600 p-2">
                  {inputMode === 'text' ? (
                    <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  ) : (
                    <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                  )}
                </button>
                {inputMode === 'text' ? (
                  <>
                    <button onClick={() => widgetRef.current?.open()} className="text-gray-400 hover:text-gray-600 p-2">
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-gray-600 p-2">
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>
                    {selectedChat?.type === 'group' && (
                      <div className="relative">
                        <button onClick={async () => { if (!groupInfo) await loadGroupInfo(); setShowMentionList(!showMentionList); }} className="text-gray-400 hover:text-gray-600 p-2">@</button>
                        {showMentionList && (
                          <div className="absolute bottom-10 left-0 bg-white border rounded shadow p-2 z-10 min-w-[120px]">
                            <button onClick={() => { setInput(prev => prev + '@all '); setShowMentionList(false); }} className="block w-full text-left text-sm hover:bg-gray-100 px-2 py-1 rounded">@全体成员</button>
                            {groupInfo?.members?.filter((m: any) => m.userId !== userId).map((m: any) => (
                              <button key={m.userId} onClick={() => { setInput(prev => prev + `@${m.user?.nickname || m.user?.username} `); setShowMentionList(false); }} className="block w-full text-left text-sm hover:bg-gray-100 px-2 py-1 rounded">{m.user?.nickname || m.user?.username}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="relative">
                      <button onClick={() => setShowEmoji(!showEmoji)} className="text-gray-400 hover:text-gray-600 p-2" type="button">
                        <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </button>
                      {showEmoji && (
                        <div className="absolute bottom-10 left-0 bg-white border rounded-xl shadow-lg p-2 grid grid-cols-6 gap-1 w-56 z-50">
                          {EMOJIS.map((emoji: string) => (
                            <button key={emoji} onClick={() => { setInput((prev: string) => prev + emoji); setShowEmoji(false); }} className="text-xl hover:bg-gray-100 p-1 rounded">{emoji}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      className="flex-1 p-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300 text-sm"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
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
                {isRecording && !recordingCancel && <div className="absolute -top-6 left-0 right-0 text-center text-xs text-gray-400">上滑取消</div>}
              </div>
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

      {/* ========== 弹窗部分 ========== */}
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
                  <input type="checkbox" checked={selectedFriends.includes(s.friend.id)} onChange={e => { if (e.target.checked) setSelectedFriends(prev => [...prev, s.friend.id]); else setSelectedFriends(prev => prev.filter(id => id !== s.friend.id)); }} />
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
            <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold">群信息</h3><button onClick={() => setShowGroupInfo(false)} className="text-gray-500">✕</button></div>
            <p className="font-medium">群名称：{groupInfo.name}</p>
            <p className="text-sm text-gray-500 mt-1">成员 {groupInfo.members?.length} 人</p>
            {groupInfo.inviteCode && (
              <div className="mt-3">
                <label className="text-sm font-medium">群邀请链接</label>
                <div className="flex items-center gap-2 mt-1">
                  <input readOnly value={`https://xianqu.pages.dev/join?code=${groupInfo.inviteCode}`} className="flex-1 text-xs border p-1 rounded bg-gray-50" />
                  <button onClick={() => { navigator.clipboard.writeText(`https://xianqu.pages.dev/join?code=${groupInfo.inviteCode}`); alert('链接已复制'); }} className="text-xs bg-blue-500 text-white px-3 py-1 rounded">复制</button>
                </div>
              </div>
            )}
            <button onClick={() => { setInviteGroupId(groupInfo.id); setSelectedFriends([]); setInviteModal(true); }} className="w-full bg-blue-500 text-white py-2 rounded text-sm mt-3">邀请好友加入</button>
            <div className="mt-3">
              <label className="text-sm font-medium">群公告</label>
              {(groupInfo.ownerId === userId || groupInfo.members?.find((m: any) => m.userId === userId && m.role === 'admin')) ? (
                <div className="flex gap-2 mt-1">
                  <input value={groupAnnouncement} onChange={e => setGroupAnnouncement(e.target.value)} className="flex-1 border p-1 rounded text-sm" placeholder="编辑公告" />
                  <button onClick={async () => { const token = localStorage.getItem('token'); await fetch(`${API}/groups/${groupInfo.id}/announcement`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ announcement: groupAnnouncement }) }); alert('公告已更新'); }} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">保存</button>
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
              <button onClick={async () => { if (selectedFriends.length === 0) return; const token = localStorage.getItem('token'); const res = await fetch(`${API}/groups/${inviteGroupId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userIds: selectedFriends }) }); if (res.ok) { alert('邀请成功'); setInviteModal(false); setSelectedFriends([]); loadGroupInfo(); } else alert('邀请失败'); }} className="px-3 py-1 bg-green-500 text-white rounded text-sm">邀请</button>
            </div>
          </div>
        </div>
      )}

      {/* 消息操作菜单 */}
      {contextMenu && (
        <div className="fixed bg-white border rounded shadow-lg py-1 z-50" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
          <button onClick={() => { copyToClipboard(contextMenu.msg.content); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">复制</button>
          <button onClick={() => { setReplyingTo(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">引用回复</button>
          <button onClick={() => { setForwardMessage(contextMenu.msg); setForwardModal(true); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">转发</button>
          {contextMenu.msg.senderId === userId && (
            <>
              <button onClick={() => { setEditingMessage(contextMenu.msg); setEditInput(contextMenu.msg.content); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">编辑</button>
              <button onClick={() => { recallMessage(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">撤回</button>
            </>
          )}
          <button onClick={() => { const token = localStorage.getItem('token'); fetch(`${API}/user/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'message', targetId: contextMenu.msg.id, content: contextMenu.msg.content }) }).finally(() => setContextMenu(null)); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100">收藏</button>
          {contextMenu.msg.senderId === userId && (
            <button onClick={() => { deleteMessage(contextMenu.msg); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-red-500">删除</button>
          )}
        </div>
      )}

      {/* 被叫方接听/拒绝弹窗 */}
      {pendingCall && (() => {
        const friendSession = sessions.find(s => s.friend.id === pendingCall.friendId);
        const friendName = friendSession?.friend?.nickname || friendSession?.friend?.username || '好友';
        return (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 text-center w-72">
              <div className="text-4xl mb-3">{pendingCall.type === 'video' ? (
                <svg className="w-10 h-10 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              ) : (
                <svg className="w-10 h-10 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
              )}</div>
              <p className="font-bold text-lg mb-1">{friendName}</p>
              <p className="text-gray-500 text-sm mb-6">邀请你进行{pendingCall.type === 'video' ? '视频' : '语音'}通话</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => { ws?.send(JSON.stringify({ event: 'call-hangup', data: { targetId: pendingCall.friendId } })); setPendingCall(null); }} className="px-6 py-3 bg-red-500 text-white rounded-full font-medium">拒绝</button>
                <button onClick={() => { setCallState({ type: pendingCall.type, friendId: pendingCall.friendId, friendName, incoming: true, offerSdp: pendingCall.sdp }); setPendingCall(null); }} className="px-6 py-3 bg-green-500 text-white rounded-full font-medium">接听</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 转发弹窗 */}
      {forwardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50" onClick={() => setForwardModal(false)}>
          <div className="bg-white p-5 rounded shadow-lg w-80 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">转发消息</h3>
            <div className="flex-1 overflow-y-auto border rounded p-2 mb-3">
              <p className="text-xs text-gray-500 mb-2">好友</p>
              {sessions.map((s: any) => (
                <label key={s.friend.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={selectedTargets.includes(s.friend.id)} onChange={e => { if (e.target.checked) setSelectedTargets(prev => [...prev, s.friend.id]); else setSelectedTargets(prev => prev.filter(id => id !== s.friend.id)); }} />
                  <span className="text-sm">{s.friend.nickname || s.friend.username}</span>
                </label>
              ))}
              <p className="text-xs text-gray-500 mt-3 mb-2">群聊</p>
              {groups.map((g: any) => (
                <label key={g.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={selectedTargets.includes(`group-${g.id}`)} onChange={e => { if (e.target.checked) setSelectedTargets(prev => [...prev, `group-${g.id}`]); else setSelectedTargets(prev => prev.filter(id => id !== `group-${g.id}`)); }} />
                  <span className="text-sm"># {g.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setForwardModal(false); setSelectedTargets([]); }} className="px-3 py-1 bg-gray-300 rounded text-sm">取消</button>
              <button onClick={confirmForward} className="px-3 py-1 bg-green-500 text-white rounded text-sm">转发</button>
            </div>
          </div>
        </div>
      )}

      {/* 通话弹窗 */}
      {callState && ws && (
        <CallModal ws={ws} userId={userId} friendId={callState.friendId} friendName={callState.friendName} type={callState.type} incoming={callState.incoming} accepted={callState.accepted} offerSdp={callState.offerSdp} onHangup={() => setCallState(null)} />
      )}
    </div>
  );
}
