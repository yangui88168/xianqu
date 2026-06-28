import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = 'https://xianqu-server.onrender.com';

// 社区列表
function CommunityList({ onSelect }: { onSelect: (id: string) => void }) {
  const [communities, setCommunities] = useState<any[]>([]);
  const [userId, setUserId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const loadCommunities = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/community/list`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setCommunities(await res.json());
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserId(payload.userId || '');
      } catch {}
    }
    loadCommunities();
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
      loadCommunities();
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">社区列表</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="text-sm bg-blue-500 text-white px-3 py-1 rounded-full">+ 新社区</button>
      </div>
      {showCreate && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="社区名称" value={name} onChange={e => setName(e.target.value)} />
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="简介" value={description} onChange={e => setDescription(e.target.value)} />
          <button onClick={createCommunity} className="bg-green-500 text-white px-4 py-1 rounded-full text-sm">确认创建</button>
        </div>
      )}
      {communities.map((c: any) => (
        <div key={c.id} className="bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center">
          <button onClick={() => onSelect(c.id)} className="text-left flex-1">
            <p className="font-bold text-sm">{c.name}</p>
            <p className="text-xs text-gray-500">{c.description || '暂无简介'}</p>
            <p className="text-xs text-gray-400 mt-1">{c._count?.homesteads} 个家园</p>
          </button>
          {/* 删除按钮：仅所有者可见 */}
          {userId && c.ownerId === userId && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (confirm('确定删除此社区吗？内部家园也将被删除')) {
                  const token = localStorage.getItem('token');
                  await fetch(`${API}/community/${c.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  loadCommunities();
                }
              }}
              className="text-red-500 text-xs px-2 ml-2"
            >
              删除
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// 社区详情（家园列表）
function CommunityDetail({ communityId, onBack }: { communityId: string; onBack: () => void }) {
  const [community, setCommunity] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedHomestead, setSelectedHomestead] = useState<string | null>(null);

  const loadCommunity = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/community/${communityId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setCommunity(await res.json());
  };

  useEffect(() => { loadCommunity(); }, [communityId]);

  const createHomestead = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/community/${communityId}/homestead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description }),
    });
    setShowCreate(false);
    setName('');
    setDescription('');
    loadCommunity();
  };

  if (selectedHomestead) {
    return <HomesteadDetail homesteadId={selectedHomestead} communityId={communityId} onBack={() => setSelectedHomestead(null)} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-white flex items-center justify-between">
        <button onClick={onBack} className="text-blue-500 text-sm">← 返回</button>
        <h2 className="font-bold text-lg">{community?.name}</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="text-sm text-blue-500">+ 家园</button>
      </div>
      {showCreate && (
        <div className="p-4 bg-white border-b">
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="家园名称" value={name} onChange={e => setName(e.target.value)} />
          <input className="w-full border p-2 rounded mb-2 text-sm" placeholder="简介" value={description} onChange={e => setDescription(e.target.value)} />
          <button onClick={createHomestead} className="bg-green-500 text-white px-4 py-1 rounded-full text-sm">确认</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {community?.homesteads?.map((h: any) => (
          <button
            key={h.id}
            onClick={() => setSelectedHomestead(h.id)}
            className="w-full text-left bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center"
          >
            <div>
              <p className="font-bold text-sm">{h.name}</p>
              <p className="text-xs text-gray-500">{h.description || '暂无简介'}</p>
            </div>
            <span className="text-xs text-gray-400">{h._count?.posts} 帖子</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 家园详情（帖子列表 + 发帖）
function HomesteadDetail({ homesteadId, communityId, onBack }: { homesteadId: string; communityId: string; onBack: () => void }) {
  const [homestead, setHomestead] = useState<any>(null);
  const [content, setContent] = useState('');

  const loadHomestead = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/community/${communityId}/homestead/${homesteadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setHomestead(await res.json());
  };

  useEffect(() => { loadHomestead(); }, [homesteadId]);

  const publishPost = async () => {
    if (!content.trim()) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/community/${communityId}/homestead/${homesteadId}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
    });
    setContent('');
    loadHomestead();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-white flex items-center">
        <button onClick={onBack} className="text-blue-500 text-sm mr-3">← 返回</button>
        <h2 className="font-bold text-lg">{homestead?.name}</h2>
      </div>
      <div className="p-4 bg-white border-b">
        <textarea
          className="w-full border rounded p-2 text-sm"
          rows={2}
          placeholder="发帖..."
          value={content}
          onChange={e => setContent(e.target.value)}
        />
        <button onClick={publishPost} className="mt-2 bg-blue-500 text-white px-4 py-1 rounded-full text-sm">发布</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {homestead?.posts?.map((post: any) => (
          <div key={post.id} className="bg-white rounded-xl shadow p-4 mb-3">
            <p className="text-sm font-medium">{post.author?.nickname || post.author?.username}</p>
            <p className="text-sm mt-1">{post.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// 主页面
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
