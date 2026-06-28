import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const API = 'https://onrender.com';

export default function Space() {
  const [userId, setUserId] = useState('');
  const [feed, setFeed] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [permission, setPermission] = useState('public');
  const [showPublish, setShowPublish] = useState(false);
  const router = useRouter();

  // 获取用户ID
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/');
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserId(payload.userId);
    } catch {
      router.push('/');
    }
  }, [router]);

  // 加载动态流
  const loadFeed = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API}/star/feed?skip=0&take=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFeed(await res.json());
  }, []);

  useEffect(() => {
    if (userId) loadFeed();
  }, [userId, loadFeed]);

  // 发布动态
  const publish = async () => {
    if (!content.trim() && !imageUrl.trim()) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ content, imageUrl, permission }),
    });
    setContent('');
    setImageUrl('');
    setShowPublish(false);
    loadFeed();
  };

  // 点赞/取消
  const toggleLike = async (postId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/star/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
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
            _count: {
              ...p._count,
              likes: liked ? p._count.likes + 1 : Math.max(0, p._count.likes - 1)
            },
          };
        }
        return p;
      }));
    }
  };

  // 评论
  const postComment = async (postId: string, text: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API}/star/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ postId, content: text }),
    });
    loadFeed();
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 返回按钮 */}
      <div className="p-3 border-b bg-white">
        <Link href="/zhihui" className="text-blue-500 text-sm">← 返回</Link>
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
        {feed.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-sm">暂无动态，快去发布吧</p>
          </div>
        ) : (
          feed.map((post: any) => (
            <div key={post.id} className="bg-white p-4 border-b">
              {/* 用户信息栏 */}
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                  {(post.user?.nickname || post.user?.username || '匿')[0]}
                </div>
                <span className="font-medium text-sm">{post.user?.nickname || post.user?.username}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {post.permission === 'private' && '🔒 '}
                  {post.permission === 'friends' && '👥 '}
                  {new Date(post.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* 动态内容 */}
              <p className="text-sm text-gray-800">{post.content}</p>
              {post.imageUrl && (
                <img src={post.imageUrl} alt="" className="mt-2 rounded max-w-full max-h-60 object-cover" />
              )}

              {/* 操作栏 */}
              <div className="flex items-center gap-4 mt-3 text-gray-500 text-xs">
                <button onClick={() => toggleLike(post.id)} className="flex items-center gap-1">
                  ❤️ {post._count?.likes || 0}
                </button>
                
                {/* 删除按钮：仅在动态拥有者为当前登录用户时显示 */}
                {post.userId === userId && (
                  <button
                    onClick={() => {
                      if (confirm('确定删除这条动态吗？')) {
                        const token = localStorage.getItem('token');
                        fetch(`${API}/star/post/${post.id}`, {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` },
                        }).then((res) => {
                          if (res.ok) {
                            // 从本地状态移除
                            setFeed(prev => prev.filter(p => p.id !== post.id));
                          }
                        });
                      }
                    }}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    删除
                  </button>
                )}

                <button
                  onClick={() => {
                    const text = prompt('输入评论：');
                    if (text) postComment(post.id, text);
                  }}
                  className="flex items-center gap-1 ml-auto"
                >
                  💬 {post._count?.comments || 0}
                </button>
              </div>

              {/* 评论列表 */}
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
