import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Space() {
  const [userId, setUserId] = useState('');
  const [feed, setFeed] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [permission, setPermission] = useState('public');
  const [showPublish, setShowPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 获取用户ID
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch { router.push('/'); }
  }, [router]);

  // 加载动态流
  const loadFeed = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/star/feed?skip=0&take=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFeed(data);
      }
    } catch (err) {
      console.error('加载动态失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) loadFeed();
  }, [userId, loadFeed]);

  // 发布动态
  const publish = async () => {
    if (!content.trim() && !imageUrl.trim()) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/star/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, imageUrl, permission }),
      });
      if (res.ok) {
        setContent('');
        setImageUrl('');
        setShowPublish(false);
        // 刷新动态列表
        await loadFeed();
      } else {
        const err = await res.json();
        alert(err.error || '发布失败');
      }
    } catch (err) {
      alert('网络错误');
    }
  };

  // 点赞/取消
  const toggleLike = async (postId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/star/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId }),
    });
    if (res.ok) {
      const { liked } = await res.json();
      setFeed(prev =>
        prev.map(p => {
          if (p.id === postId) {
            const likes = p.likes || [];
            return {
              ...p,
              likes: liked ? [...likes, { userId }] : likes.filter((l: any) => l.userId !== userId),
              _count: {
                ...p._count,
                likes: liked ? (p._count?.likes || 0) + 1 : Math.max(0, (p._count?.likes || 0) - 1),
              },
            };
          }
          return p;
        })
      );
    }
  };

  // 评论
  const postComment = async (postId: string, text: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postId, content: text }),
    });
    loadFeed();
  };

  // 删除动态
  const deletePost = async (postId: string) => {
    if (!confirm('确定删除这条动态吗？')) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/star/post/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setFeed(prev => prev.filter(p => p.id !== postId));
    } else {
      const err = await res.json();
      alert(err.error || '删除失败');
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 返回按钮 */}
      <div className="p-3 border-b bg-white flex items-center">
        <Link href="/zhihui" className="text-blue-500 text-sm">← 返回</Link>
        <h2 className="ml-4 font-bold text-lg">个人空间</h2>
      </div>

      {/* 发布区域 */}
      <div className="p-4 bg-white border-b">
        <button
          onClick={() => setShowPublish(!showPublish)}
          className="w-full bg-blue-500 text-white py-2 rounded-full text-sm font-medium"
        >
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
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-500">可见范围：</span>
              <select
                value={permission}
                onChange={e => setPermission(e.target.value)}
                className="border rounded p-1 text-xs"
              >
                <option value="public">公开</option>
                <option value="friends">好友可见</option>
                <option value="private">仅自己</option>
              </select>
              <button
                onClick={publish}
                className="ml-auto bg-green-500 text-white px-4 py-1 rounded-full text-sm"
              >
                发布
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 动态流 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-sm">加载中...</p>
          </div>
        ) : feed.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-sm">暂无动态，快去发布吧</p>
          </div>
        ) : (
          feed.map((post: any) => (
            <div key={post.id} className="bg-white p-4 border-b">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                  {(post.user?.nickname || post.user?.username || '?')[0]}
                </div>
                <span className="font-medium text-sm">
                  {post.user?.nickname || post.user?.username || '未知'}
                </span>
                <span className="text-xs text-gray-400 ml-auto">
                  {post.permission === 'private' && '🔒 '}
                  {post.permission === 'friends' && '👥 '}
                  {new Date(post.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-gray-800">{post.content}</p>
              {post.imageUrl && (
                <img src={post.imageUrl} alt="" className="mt-2 rounded max-w-full max-h-60 object-cover" />
              )}
              <div className="flex items-center gap-4 mt-3 text-gray-500 text-xs">
                <button onClick={() => toggleLike(post.id)} className="flex items-center gap-1">
                  ❤️ {post._count?.likes || 0}
                </button>
                <button
                  onClick={() => {
                    const text = prompt('输入评论：');
                    if (text) postComment(post.id, text);
                  }}
                  className="flex items-center gap-1"
                >
                  💬 {post._count?.comments || 0}
                </button>
                {post.userId === userId && (
                  <button onClick={() => deletePost(post.id)} className="text-red-400 hover:text-red-600">
                    删除
                  </button>
                )}
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
          ))
        )}
      </div>
    </div>
  );
}
