import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const API = 'https://xianqu-server.onrender.com';

export default function Space() {
  const [feed, setFeed] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    fetch(`${API}/star/feed?skip=0&take=20`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setFeed)
      .catch(() => {});
  }, [router]);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4">
      <h2 className="text-lg font-bold mb-4">个人空间</h2>
      {feed.map((post: any) => (
        <div key={post.id} className="bg-white p-4 mb-3 rounded shadow">
          <p className="text-sm font-medium">{post.user?.nickname}</p>
          <p className="text-sm text-gray-700 mt-1">{post.content}</p>
        </div>
      ))}
    </div>
  );
}
