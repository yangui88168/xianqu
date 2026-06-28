import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function ZhihuiStar() {
  const [userId, setUserId] = useState('');
  const [feed, setFeed] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [showPublish, setShowPublish] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch { router.push('/'); }
  }, [router]);

  const loadFeed = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API}/star/feed?skip=0&take=20`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setFeed(await res.json());
  }, []);

  const loadUsers = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API}/star/users`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    if (userId) {
      loadFeed();
      loadUsers();
    }
  }, [userId, loadFeed, loadUsers]);

  const publish = async () => {
    if (!content.trim() && !imageUrl.trim()) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content, imageUrl, permission: 'public' }),
    });
    setContent('');
    setImageUrl('');
    setShowPublish(false);
    loadFeed();
  };

  const toggleLike = async (postId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/star/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId }),
    });
    if (res.ok) {
      const { liked } = await res.json();
      setFeed(prev => prev.map(p => {
        if (p.id === postId) {
          const likes = p.likes || [];
          return {
            ...p,
            likes: liked ? [...likes, { userId }] : likes.filter((l: any) => l.userId !== userId),
            _count: { ...p._count, likes: liked ? p._count.likes + 1 : Math.max(0, p._count.likes - 1) },
          };
        }
        return p;
      }));
    }
  };

  const postComment = async (postId: string, text: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId, content: text }),
    });
    loadFeed();
  };

  const toggleFollow = async (followingId: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ followingId }),
    });
    loadUsers();
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* 发布按钮 */}
      <div className="p-4 bg-white border-b">
        <button onClick={() => setShowPublish(!showPublish)} className="w-full bg-blue-500 text-white py-2 rounded-full text-sm font-medium">
          + 发布动态
        </button>
        {showPublish && (
          <div className="mt-3">
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              placeholder="分享你的想法..."
              value={content}
              onChange={e => setContent(e.target.value)}
            />
            <input
              className="w-full border rounded p-2 mt-2 text-sm"
              placeholder="图片 URL（可选）"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
            />
            <button onClick={publish} className="mt-2 bg-green-500 text-white px-4 py-2 rounded-full text-sm">发布</button>
          </div>
        )}
      </div>

      {/* 动态流 */}
      <div>
        {feed.map((post: any) => (
          <div key={post.id} className="bg-white p-4 border-b">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                {(post.user?.nickname || post.user?.username)[0]}
              </div>
              <span className="font-medium text-sm">{post.user?.nickname || post.user?.username}</span>
              <span className="text-xs text-gray-400 ml-auto">{new Date(post.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="text-sm text-gray-800">{post.content}</p>
            {post.imageUrl && (
              <img src={post.imageUrl} alt="" className="mt-2 rounded max-w-full max-h-60 object-cover" />
            )}
            <div className="flex items-center gap-4 mt-3 text-gray-500 text-xs">
              <button onClick={() => toggleLike(post.id)} className="flex items-center gap-1">
                ❤️ {post._count?.likes || 0}
              </button>
              <button onClick={() => {
                const text = prompt('输入评论：');
                if (text) postComment(post.id, text);
              }} className="flex items-center gap-1">
                💬 {post._count?.comments || 0}
              </button>
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
