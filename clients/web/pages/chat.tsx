// @ts-nocheck
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import CallModal from '../components/CallModal';

const API = 'https://xianqu-server.onrender.com';
const PAGE_SIZE = 10;

const EMOJIS = ['😀', '😂', '❤️', '👍', '😢', '😡', '🎉', '🔥', '💯', '✨', '👋', '🙏'];

// 根据用户状态和 lastSeen 生成描述文字（支持多状态）
const getLastSeenText = (friend: any) => {
  if (friend.status === 'invisible') return '离线';
  const statusTextMap: Record<string, string> = {
    online: '在线',
    busy: '忙碌',
    dnd: '勿扰',
    away: '离开',
  };
  if (friend.status && statusTextMap[friend.status]) {
    return statusTextMap[friend.status];
  }
  if (!friend.lastSeen) return '离线';
  const diff = Date.now() - new Date(friend.lastSeen).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚在线';
  if (minutes < 60) return `${minutes}分钟前在线`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前在线`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前在线`;
  return new Date(friend.lastSeen).toLocaleDateString();
};

export default function Chat() {
  // ... 所有状态和 hooks 保持不变（与之前代码完全一致）...

  return (
    <div className="flex flex-1 min-h-0 bg-gray-100 relative overflow-hidden" onClick={() => { setContextMenu(null); setShowMentionList(false); }}>
      {/* 左侧栏 */}
      <div className={`${mobileView === 'sidebar' ? 'block' : 'hidden'} md:block md:w-80 w-full bg-white border-r flex flex-col absolute md:relative z-10 h-full`}>
        {/* 左侧栏内容保持不变 */}
        <div className="p-3 border-b">
          {/* 搜索、创建群聊等 */}
          {/* ... 保持不变 ... */}
        </div>
        {/* 好友请求、会话列表、退出按钮等保持不变 */}
        {/* ... */}
      </div>

      {/* 右侧聊天窗 - 标准 Flex 布局 */}
      <div className={`${mobileView === 'chat' ? 'block' : 'hidden'} md:block flex-1 flex flex-col`}>
        {selectedChat ? (
          <>
            {/* 顶部栏 */}
            <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ height: '64px' }}>
              <button onClick={goBack} className="md:hidden text-gray-500 mr-2">←</button>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {selectedChat.type === 'group' ? '#' : (selectedChat.data.nickname || selectedChat.data.username)[0]}
              </div>
              <div className="flex-1">
                <p className="font-bold">{selectedChat.type === 'group' ? selectedChat.data.name : (selectedChat.data.nickname || selectedChat.data.username)}</p>
                {selectedChat.type === 'friend' && <p className="text-xs text-gray-500">{getLastSeenText(selectedChat.data)}</p>}
              </div>
              <div className="flex items-center gap-1">
                {/* 通话、群信息、关闭按钮 */}
                {/* ... 保持不变 ... */}
              </div>
            </div>

            {/* 消息列表 - 可滚动区域 */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-y-auto p-4 bg-gray-50"
            >
              {/* 消息渲染逻辑保持不变 */}
              {/* ... */}
            </div>

            {/* 回复提示栏 */}
            {replyingTo && (
              <div className="bg-gray-200 px-4 py-2 text-sm flex justify-between items-center flex-shrink-0">
                <span>回复 {(replyingTo.sender?.nickname || replyingTo.sender?.username || '用户')}：{replyingTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyingTo(null)} className="text-red-500">✕</button>
              </div>
            )}

            {/* 底部输入栏 */}
            <div className="bg-white border-t flex-shrink-0" style={{ height: '64px' }}>
              <div className="p-3 h-full flex items-center gap-2">
                {/* 输入模式切换、图片上传、表情、输入框、发送按钮 */}
                {/* ... 保持不变 ... */}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-lg">选择一个会话开始聊天</p>
            </div>
          </div>
        )}
      </div>

      {/* 弹窗（创建群聊、群信息、邀请、菜单、通话）保持不变 */}
      {/* ... */}
    </div>
  );
}
