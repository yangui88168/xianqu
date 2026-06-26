import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { prisma } from '@xianqu/db-schema';
import { WsEvent } from '@xianqu/shared-types';

export const onlineUsers = new Map<string, WebSocket>();

export const wsHandler = (connection: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url!, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) { connection.close(1008, 'Token missing'); return; }

  let userId: string;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    userId = decoded.userId;
  } catch { connection.close(1008, 'Invalid token'); return; }

  onlineUsers.set(userId, connection);
  console.log(`User ${userId} online`);

  prisma.offlineQueue.findMany({ where: { userId }, include: { message: true } })
    .then(queues => {
      queues.forEach(q => connection.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: q.message })));
      return prisma.offlineQueue.deleteMany({ where: { userId } });
    }).catch(console.error);

  connection.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.event === WsEvent.MESSAGE_SEND) {
        const { receiverId, content, type = 'text' } = parsed.data;
        const senderId = userId;
        const msg = await prisma.message.create({ data: { senderId, receiverId, content, type } });
        const receiverWs = onlineUsers.get(receiverId);
        if (receiverWs) {
          receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
        } else {
          await prisma.offlineQueue.create({ data: { userId: receiverId, messageId: msg.id } });
        }
      }
    } catch { connection.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Invalid format' })); }
  });

  connection.on('close', () => {
    onlineUsers.delete(userId);
    console.log(`User ${userId} offline`);
  });
};
