import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Discover() {
  const [feed, setFeed] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [communities, setCommunities] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'posts' | 'channels' | 'communities' | 'users'>('all');

  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };

    // 获取最新动态
    fetch(`${API}/star/feed?skip=0&take=10`, { headers })
      .then(res => res.json())
      .then(setFeed)
      .catch(() => {});

    // 获取最新频道
    fetch(`${API}/channel/list`, { headers })
      .then(res => res.json())
      .then(setChannels)
      .catch(() => {});

    // 获取最新社区
    fetch(`${API}/community/list`, { headers })
      .then(res => res.json())
      .then(setCommunities)
      .catch(() => {});

    // 获取推荐用户（最新注册）
    fetch(`${API}/star/users`, { headers })
      .then(res => res.json())
      .then(setUsers)
      .catch(() => {});
  }, []);

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    // 简单实现：跳转到聊天页的搜索功能（如果有），或直接提示
    alert('搜索功能整合中，请使用聊天页的全局搜索');
  };

  // 动态渲染卡片
  const renderPost = (post: any) => (
    <div key={post.id} className="bg-white rounded-xl shadow p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
          {(post.user?.nickname || post.user?.username || '?')[0]}
        </div>
        <span className="text-sm font-medium">{post.user?.nickname || post.user?.username}</span>
      </div>
      <p className="text-sm text-gray-800">{post.content}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="" className="mt-2 rounded max-w-full max-h-40 object-cover" />}
      <div className="flex items-center gap-4 mt-2 text-gray-500 text-xs">
        <span>❤️ {post._count?.likes || 0}</span>
        <span>💬 {post._count?.comments || 0}</span>
      </div>
    </div>
  );

  const renderChannel = (ch: any) => (
    <div key={ch.id} className="bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center">
      <div>
        <p className="font-bold text-sm">📺 {ch.name}</p>
        <p className="text-xs text-gray-500">{ch.description || '暂无简介'}</p>
      </div>
      <span className="text-xs text-gray-400">{ch._count?.subscribers || 0} 订阅</span>
    </div>
  );

  const renderCommunity = (c: any) => (
    <div key={c.id} className="bg-white rounded-xl shadow p-4 mb-3 flex justify-between items-center">
      <div>
        <p className="font-bold text-sm">🏘️ {c.name}</p>
        <p className="text-xs text-gray-500">{c.description || '暂无简介'}</p>
      </div>
      <span className="text-xs text-gray-400">{c._count?.homesteads || c._count?.channels || 0} 个家园</span>
    </div>
  );

  const renderUser = (user: any) => (
    <div key={user.id} className="bg-white rounded-xl shadow p-4 mb-3 flex items-center gap-3">
      <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center text-white font-bold">
        {(user.nickname || user.username)[0]}
      </div>
      <div>
        <p className="font-medium text-sm">{user.nickname || user.username}</p>
        <p className="text-xs text-gray-500">新加入</p>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* 返回按钮 + 搜索栏 */}
      <div className="p-3 border-b bg-white">
        <div className="flex items-center gap-2 mb-2">
          <Link href="/zhihui" className="text-blue-500 text-sm">← 返回</Link>
          <h2 className="font-bold text-lg">发现</h2>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="搜索动态、频道、社区..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm">搜索</button>
        </div>
      </div>

      {/* 标签切换 */}
      <div className="flex bg-white border-b overflow-x-auto">
        {[
          { key: 'all', label: '推荐' },
          { key: 'posts', label: '动态' },
          { key: 'channels', label: '频道' },
          { key: 'communities', label: '社区' },
          { key: 'users', label: '用户' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${
              activeTab === tab.key ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="p-4">
        {(activeTab === 'all' || activeTab === 'posts') && (
          <>
            {activeTab === 'posts' && <h3 className="text-sm font-bold text-gray-500 mb-3">最新动态</h3>}
            {feed.map(renderPost)}
          </>
        )}
        {(activeTab === 'all' || activeTab === 'channels') && (
          <>
            {activeTab === 'channels' && <h3 className="text-sm font-bold text-gray-500 mb-3">最新频道</h3>}
            {channels.map(renderChannel)}
          </>
        )}
        {(activeTab === 'all' || activeTab === 'communities') && (
          <>
            {activeTab === 'communities' && <h3 className="text-sm font-bold text-gray-500 mb-3">最新社区</h3>}
            {communities.map(renderCommunity)}
          </>
        )}
        {(activeTab === 'all' || activeTab === 'users') && (
          <>
            {activeTab === 'users' && <h3 className="text-sm font-bold text-gray-500 mb-3">推荐用户</h3>}
            {users.map(renderUser)}
          </>
        )}
      </div>
    </div>
  );
}
