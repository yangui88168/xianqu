export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'voice';
  status: 'sent' | 'delivered' | 'read';
  createdAt: string;
}

export enum WsEvent {
  MESSAGE_SEND = 'message:send',
  MESSAGE_RECEIVE = 'message:receive',
  GROUP_MESSAGE_RECEIVE = 'group-message:receive',   // ✅ 已成功添加
  ERROR = 'error',
}
