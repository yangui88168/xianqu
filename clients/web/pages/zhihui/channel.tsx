import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

// 频道列表组件
function ChannelList({ onSelect }: { onSelect: (id: string) => void }) {
  const [channels, setChannels] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${API}/channel/list`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setChannels);
  }, []);

  const createChannel = async () => {
    if (!name.trim()) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/channel/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      setShowCreate(false);
      setName('');
      setDescription('');
      // 刷新频道列表
      const listRes = await fetch(`${API}/channel/list`, { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.ok) setChannels(await listRes.json());
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">频道列表</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-sm bg-blue-500 text-white px-3 py-1 rounded-full"
        >
          创建
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <input
            className="w-full border p-2 rounded mb-2 text-sm"
            placeholder="频道名称"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            className="w-full border p-2 rounded mb-2 text-sm"
            placeholder="简介（可选）"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <button
            onClick={createChannel}
            className="bg-green-500 text-white px-4 py-1 rounded-full text-sm"
          >
            确认创建
          </button>
        </div>
      )}

      {channels.map((ch: any) => (
        <button
          key={ch.id}
          onClick={() => onSelect(ch.id)}
          className="w-full text-left bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center"
        >
          <div>
            <p className="font-bold text-sm">{ch.name}</p>
            <p className="text-xs text-gray-500">{ch.description || '暂无简介'}</p>
          </div>
          <div className="text-xs text-gray-400">
            {ch._count?.subscribers} 订阅 | {ch._count?.posts} 帖子
          </div>
        </button>
      ))}
    </div>
  );
}

// 频道详情组件
function ChannelDetail({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const [channel, setChannel] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState('');
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    // 获取频道信息
    fetch(`${API}/channel/${channelId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setChannel);
    // 获取帖子
    fetch(`${API}/channel/${channelId}/posts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setPosts);
  }, [channelId]);

  // 订阅
  const toggleSubscribe = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/channel/${channelId}/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setChannel((prev: any) => ({ ...prev, isSubscribed: data.subscribed }));
    }
  };

  // 发帖
  const publishPost = async () => {
    if (!content.trim()) return;
    const token = localStorage.getItem('token');
    const body: any = { content };
    if (showPoll && pollOptions.trim()) {
      body.pollOptions = pollOptions.split(',').map((s: string) => s.trim());
    }
    await fetch(`${API}/channel/${channelId}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setContent('');
    setShowPoll(false);
    setPollOptions('');
    // 刷新帖子
    const res = await fetch(`${API}/channel/${channelId}/posts`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setPosts(await res.json());
  };

  // 投票
  const vote = async (postId: string, optionIndex: number) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/channel/${channelId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId, optionIndex }),
    });
    if (res.ok) {
      const data = await res.json();
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, pollVotes: data.votes } : p));
    }
  };

  // 评论
  const commentPost = async (postId: string, text: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/channel/${channelId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId, content: text }),
    });
    const res = await fetch(`${API}/channel/${channelId}/posts`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setPosts(await res.json());
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-white flex items-center justify-between">
        <button onClick={onBack} className="text-blue-500 text-sm">← 返回</button>
        <h2 className="font-bold text-lg">{channel?.name}</h2>
        <button
          onClick={toggleSubscribe}
          className={`text-sm px-3 py-1 rounded-full ${channel?.isSubscribed ? 'bg-gray-200' : 'bg-blue-500 text-white'}`}
        >
          {channel?.isSubscribed ? '已订阅' : '订阅'}
        </button>
      </div>

      {/* 发帖区 */}
      <div className="p-4 bg-white border-b">
        <textarea
          className="w-full border rounded p-2 text-sm"
          rows={2}
          placeholder="分享到频道..."
          value={content}
          onChange={e => setContent(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setShowPoll(!showPoll)} className="text-xs text-blue-500">
            {showPoll ? '取消投票' : '添加投票'}
          </button>
          <button onClick={publishPost} className="ml-auto bg-blue-500 text-white px-4 py-1 rounded-full text-sm">发布</button>
        </div>
        {showPoll && (
          <input
            className="w-full border rounded p-2 mt-2 text-sm"
            placeholder="选项用逗号分隔，如：是,否,不确定"
            value={pollOptions}
            onChange={e => setPollOptions(e.target.value)}
          />
        )}
      </div>

      {/* 帖子列表 */}
      <div className="flex-1 overflow-y-auto">
        {posts.map((post: any) => (
          <div key={post.id} className={`bg-white p-4 border-b ${post.pinned ? 'bg-yellow-50' : ''}`}>
            {post.pinned && <div className="text-xs text-yellow-600 mb-1">📌 置顶</div>}
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                {(post.author?.nickname || post.author?.username)[0]}
              </div>
              <span className="text-sm font-medium">{post.author?.nickname || post.author?.username}</span>
              <span className="text-xs text-gray-400 ml-auto">{new Date(post.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="text-sm text-gray-800">{post.content}</p>
            {post.pollOptions && (
              <div className="mt-3">
                {post.pollOptions.map((opt: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => vote(post.id, idx)}
                    className="block w-full text-left text-sm py-1 px-3 rounded bg-gray-50 mb-1 hover:bg-gray-100"
                  >
                    {opt} ({post.pollVotes?.[idx] || 0} 票)
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-4 mt-3 text-gray-500 text-xs">
              <button onClick={() => {
                const text = prompt('输入评论：');
                if (text) commentPost(post.id, text);
              }}>💬 {post._count?.comments || 0}</button>
            </div>
            {post.comments?.length > 0 && (
              <div className="mt-2 bg-gray-50 rounded p-2">
                {post.comments.map((c: any) => (
                  <p key={c.id} className="text-xs text-gray-600">
                    <span className="font-medium">{c.user?.nickname || c.user?.username}:</span> {c.content}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// 主频道页面
export default function ChannelPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-3 border-b bg-white">
        <Link href="/zhihui" className="text-blue-500 text-sm">← 返回智慧星</Link>
      </div>
      {selectedChannel ? (
        <ChannelDetail
          channelId={selectedChannel}
          onBack={() => setSelectedChannel(null)}
        />
      ) : (
        <ChannelList onSelect={setSelectedChannel} />
      )}
    </div>
  );
}
