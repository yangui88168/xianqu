import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '@xianqu/db-schema';
import { WsEvent } from '@xianqu/shared-types';
import { onlineUsers } from '../../websocket';

function authMiddleware(request: any, reply: any, done: any) {
  const token = (request.headers.authorization || '').replace('Bearer ', '');
  if (!token) { reply.status(401).send({ error: 'No token' }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    request.userId = decoded.userId;
    done();
  } catch { reply.status(401).send({ error: 'Invalid token' }); }
}

export async function messageRoutes(fastify: FastifyInstance) {
  fastify.post('/send', { preHandler: authMiddleware }, async (request, reply) => {
    const { receiverId, content, type = 'text' } = request.body as any;
    const senderId = (request as any).userId;

    const msg = await prisma.message.create({ data: { senderId, receiverId, content, type } });

    const receiverWs = onlineUsers.get(receiverId);
    if (receiverWs) {
      receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
    } else {
      await prisma.offlineQueue.create({ data: { userId: receiverId, messageId: msg.id } });
    }
    reply.send(msg);
  });

  fastify.get('/history/:userId', { preHandler: authMiddleware }, async (request, reply) => {
    const currentUserId = (request as any).userId;
    const otherUserId = (request.params as any).userId;
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: 50
    });
    reply.send(messages);
  });
}
