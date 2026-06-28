export default function ZhihuiHome() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4">
      <h1 className="text-xl font-bold text-center mb-6">智慧星</h1>
      <div className="grid grid-cols-2 gap-4">
        <a href="/zhihui/space" className="bg-white rounded-2xl shadow p-6 flex flex-col items-center hover:shadow-md">
          <span className="text-4xl mb-3">🏠</span>
          <h2 className="text-lg font-bold text-gray-800">个人空间</h2>
          <p className="text-xs text-gray-500 mt-1">动态、相册、留言板</p>
        </a>
        <a href="/zhihui/channel" className="bg-white rounded-2xl shadow p-6 flex flex-col items-center hover:shadow-md">
          <span className="text-4xl mb-3">📺</span>
          <h2 className="text-lg font-bold text-gray-800">频道系统</h2>
          <p className="text-xs text-gray-500 mt-1">创建频道、订阅、发帖</p>
        </a>
        <a href="/zhihui/community" className="bg-white rounded-2xl shadow p-6 flex flex-col items-center hover:shadow-md">
          <span className="text-4xl mb-3">🏘️</span>
          <h2 className="text-lg font-bold text-gray-800">社区系统</h2>
          <p className="text-xs text-gray-500 mt-1">社区、话题、精华</p>
        </a>
        <a href="/zhihui/discover" className="bg-white rounded-2xl shadow p-6 flex flex-col items-center hover:shadow-md">
          <span className="text-4xl mb-3">🔍</span>
          <h2 className="text-lg font-bold text-gray-800">发现</h2>
          <p className="text-xs text-gray-500 mt-1">热门、推荐、搜索</p>
        </a>
      </div>
    </div>
  );
}
