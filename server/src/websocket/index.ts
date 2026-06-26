import { SocketStream } from '@fastify/websocket';
import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { WsEvent } from '../shared-types';

export const onlineUsers = new Map<string, SocketStream['socket']>();

export const wsHandler = (connection: SocketStream, req: FastifyRequest) => {
  const token = (req.query as any).token as string | undefined;
  if (!token) {
    connection.socket.close(1008, 'Token missing');
    return;
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    userId = decoded.userId;
  } catch {
    connection.socket.close(1008, 'Invalid token');
    return;
  }

  onlineUsers.set(userId, connection.socket);
  console.log(`User ${userId} online`);

  // 推送离线消息
  prisma.offlineQueue.findMany({
    where: { userId },
    include: { message: true },
  }).then(queues => {
    queues.forEach(q => {
      connection.socket.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: q.message }));
    });
    return prisma.offlineQueue.deleteMany({ where: { userId } });
  }).catch(console.error);

  // 处理客户端消息
  connection.socket.on('message', async (data: any) => {
    try {
      const parsed = JSON.parse(data.toString());
      switch (parsed.event) {
        case WsEvent.MESSAGE_SEND: {
          const { receiverId, content, type = 'text', replyToId } = parsed.data;
          const senderId = userId;
          const msg = await prisma.message.create({
            data: { senderId, receiverId, content, type, replyToId },
          });
          const receiverWs = onlineUsers.get(receiverId);
          if (receiverWs) {
            receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
            // 送达回执
            if (onlineUsers.has(senderId)) {
              onlineUsers.get(senderId)!.send(JSON.stringify({
                event: 'message:delivered',
                data: { messageId: msg.id },
              }));
            }
          } else {
            await prisma.offlineQueue.create({ data: { userId: receiverId, messageId: msg.id } });
          }
          break;
        }

        // ✅ 已为您精准追加：处理已读事件并推送给发送方
        case 'message:read': {
          const { messageId, senderId } = parsed.data;
          // 更新数据库已读状态
          await prisma.message.updateMany({
            where: { id: messageId },
            data: { status: 'read', readAt: new Date() },
          });
          // 推送给原发送方
          const targetWs = onlineUsers.get(senderId);
          if (targetWs) {
            targetWs.send(JSON.stringify({ event: 'message:read', data: { messageId } }));
          }
          break;
        }

        // 信令转发：call-offer / call-answer / ice-candidate / call-hangup
        case 'call-offer':
        case 'call-answer':
        case 'ice-candidate':
        case 'call-hangup': {
          const targetId = parsed.data.targetId;
          const targetWs = onlineUsers.get(targetId);
          if (targetWs) {
            targetWs.send(JSON.stringify({
              event: parsed.event,
              data: { ...parsed.data, from: userId },
            }));
          }
          break;
        }

        case 'ping':
          connection.socket.send(JSON.stringify({ event: 'pong' }));
          break;

        default:
          connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Unknown event' }));
      }
    } catch {
      connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Invalid format' }));
    }
  });

  connection.socket.on('close', () => {
    onlineUsers.delete(userId);
    console.log(`User ${userId} offline`);
  });
};
