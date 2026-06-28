import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = 'https://xianqu-server.onrender.com';

// 社区列表
function CommunityList({ onSelect }: { onSelect: (id: string) => void }) {
  const [communities, setCommunities] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${API}/community/list`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setCommunities);
  }, []);

  const createCommunity = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/community/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      setShowCreate(false);
      setName('');
      setDescription('');
      const listRes = await fetch(`${API}/community/list`, { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.ok) setCommunities(await listRes.json());
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">社区列表</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="text-sm bg-blue-500 text-white px-3 py-1 rounded-full">创建社区</button>
      </div>
      {showCreate && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="社区名称" value={name} onChange={e => setName(e.target.value)} />
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="简介" value={description} onChange={e => setDescription(e.target.value)} />
          <button onClick={createCommunity} className="bg-green-500 text-white px-4 py-1 rounded-full text-sm">确认创建</button>
        </div>
      )}
      {communities.map((c: any) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className="w-full text-left bg-white rounded-xl shadow p-4 mb-3"
        >
          <p className="font-bold text-sm">{c.name}</p>
          <p className="text-xs text-gray-500">{c.description || '暂无简介'}</p>
          <p className="text-xs text-gray-400 mt-1">{c._count?.channels} 个频道</p>
        </button>
      ))}
    </div>
  );
}

// 社区详情（频道列表）
function CommunityDetail({ communityId, onBack }: { communityId: string; onBack: () => void }) {
  const [community, setCommunity] = useState<any>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const loadCommunity = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/community/${communityId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setCommunity(await res.json());
  };

  useEffect(() => { loadCommunity(); }, [communityId]);

  const createChannel = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/community/${communityId}/channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: channelName, description: channelDesc }),
    });
    setShowCreateChannel(false);
    setChannelName('');
    setChannelDesc('');
    loadCommunity();
  };

  // 如果选中了频道，进入频道帖子视图（复用频道详情）
  if (selectedChannel) {
    return <ChannelView channelId={selectedChannel} onBack={() => setSelectedChannel(null)} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-white flex items-center justify-between">
        <button onClick={onBack} className="text-blue-500 text-sm">← 返回社区列表</button>
        <h2 className="font-bold text-lg">{community?.name}</h2>
        <button onClick={() => setShowCreateChannel(!showCreateChannel)} className="text-sm text-blue-500">创建频道</button>
      </div>
      {showCreateChannel && (
        <div className="p-4 bg-white border-b">
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="频道名称" value={channelName} onChange={e => setChannelName(e.target.value)} />
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="简介" value={channelDesc} onChange={e => setChannelDesc(e.target.value)} />
          <button onClick={createChannel} className="bg-green-500 text-white px-4 py-1 rounded-full text-sm">确认</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {community?.channels?.map((ch: any) => (
          <button
            key={ch.id}
            onClick={() => setSelectedChannel(ch.id)}
            className="w-full text-left bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center"
          >
            <div>
              <p className="font-bold text-sm"># {ch.name}</p>
              <p className="text-xs text-gray-500">{ch.description || '暂无简介'}</p>
            </div>
            <span className="text-xs text-gray-400">{ch._count?.posts} 帖子</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 频道帖子视图（简化版，复用频道系统逻辑，但这里为避免冲突，简单展示帖子列表）
function ChannelView({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${API}/channel/${channelId}/posts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setPosts);
  }, [channelId]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-white">
        <button onClick={onBack} className="text-blue-500 text-sm">← 返回频道列表</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {posts.map((post: any) => (
          <div key={post.id} className="bg-white rounded-xl shadow p-4 mb-3">
            <p className="text-sm font-medium">{post.author?.nickname}</p>
            <p className="text-sm mt-1">{post.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// 主社区页面
export default function CommunityPage() {
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-3 border-b bg-white">
        <Link href="/zhihui" className="text-blue-500 text-sm">← 返回智慧星</Link>
      </div>
      {selectedCommunity ? (
        <CommunityDetail communityId={selectedCommunity} onBack={() => setSelectedCommunity(null)} />
      ) : (
        <CommunityList onSelect={setSelectedCommunity} />
      )}
    </div>
  );
}
