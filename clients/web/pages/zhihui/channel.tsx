import Link from 'next/link';

export default function Channel() {
  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-3 border-b bg-white">
        <Link href="/zhihui" className="text-blue-500 text-sm">← 返回</Link>
      </div>
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-6xl mb-4">📺</div>
          <p className="text-lg">频道系统开发中</p>
        </div>
      </div>
    </div>
  );
}
