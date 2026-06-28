export default function ZhihuiHome() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-3xl font-bold mb-8">智慧星</h1>
      <div className="grid grid-cols-2 gap-4 w-80">
        <a href="/zhihui/space" className="bg-white p-8 rounded-2xl shadow text-center">
          <span className="text-4xl">🏠</span>
          <p className="font-bold mt-2">个人空间</p>
        </a>
        <a href="/zhihui/channel" className="bg-white p-8 rounded-2xl shadow text-center">
          <span className="text-4xl">📺</span>
          <p className="font-bold mt-2">频道系统</p>
        </a>
        <a href="/zhihui/community" className="bg-white p-8 rounded-2xl shadow text-center">
          <span className="text-4xl">🏘️</span>
          <p className="font-bold mt-2">社区系统</p>
        </a>
        <a href="/zhihui/discover" className="bg-white p-8 rounded-2xl shadow text-center">
          <span className="text-4xl">🔍</span>
          <p className="font-bold mt-2">发现</p>
        </a>
      </div>
    </div>
  );
}
