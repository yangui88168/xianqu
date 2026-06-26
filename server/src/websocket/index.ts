import { SocketStream } from '@fastify/websocket';
import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { WsEvent } from '../shared-types';

export const onlineUsers = new Map<string, SocketStream['socket']>();

export const wsHandler = (connection: SocketStream, req: FastifyRequest) => {
  // 从查询参数获取 token
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

  // 保存在线用户连接
  onlineUsers.set(userId, connection.socket);
  console.log(`User ${userId} online`);

  // 推送离线消息
  prisma.offlineQueue.findMany({
    where: { userId },
    include: { message: true },
  })
    .then((queues) => {
      queues.forEach((q) => {
        connection.socket.send(
          JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: q.message })
        );
      });
      return prisma.offlineQueue.deleteMany({ where: { userId } });
    })
    .catch(console.error);

  // 处理客户端发来的消息
  connection.socket.on('message', (data: any) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.event === WsEvent.MESSAGE_SEND) {
        const { receiverId, content, type = 'text' } = parsed.data;
        const senderId = userId;
        prisma.message
          .create({ data: { senderId, receiverId, content, type } })
          .then((msg) => {
            const receiverWs = onlineUsers.get(receiverId);
            if (receiverWs) {
              receiverWs.send(
                JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg })
              );
            } else {
              prisma.offlineQueue.create({
                data: { userId: receiverId, messageId: msg.id },
              }).catch(console.error);
            }

            // ✅ 已为您精准追加：发送已送达回执给发送方（如果在线）
            const senderWs = onlineUsers.get(senderId);
            if (senderWs) {
              senderWs.send(JSON.stringify({
                event: 'message:delivered',
                data: { messageId: msg.id }
              }));
            }
          })
          .catch(console.error);
      }
    } catch {
      connection.socket.send(
        JSON.stringify({ event: WsEvent.ERROR, data: 'Invalid format' })
      );
    }
  });

  // 断开连接
  connection.socket.on('close', () => {
    onlineUsers.delete(userId);
    console.log(`User ${userId} offline`);
  });
};
