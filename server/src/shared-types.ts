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
  ERROR = 'error',
  CALL_OFFER = 'call-offer',
  CALL_ANSWER = 'call-answer',
  ICE_CANDIDATE = 'ice-candidate',
  CALL_HANGUP = 'call-hangup',
}
