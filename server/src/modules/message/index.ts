import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';
import { WsEvent } from '../../shared-types';
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
  // 发送私聊消息
  fastify.post('/send', { preHandler: authMiddleware }, async (request, reply) => {
    const { receiverId, content, type = 'text', replyToId } = request.body as any;
    const senderId = (request as any).userId;
    const msg = await prisma.message.create({ data: { senderId, receiverId, content, type, replyToId } });
    const receiverWs = onlineUsers.get(receiverId);
    if (receiverWs) {
      receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
      const senderWs = onlineUsers.get(senderId);
      if (senderWs) {
        senderWs.send(JSON.stringify({ event: 'message:delivered', data: { messageId: msg.id } }));
      }
    } else {
      await prisma.offlineQueue.create({ data: { userId: receiverId, messageId: msg.id } });
    }
    reply.send(msg);
  });

  // 获取聊天历史（过滤已删除的消息）
  fastify.get('/history/:userId', { preHandler: authMiddleware }, async (request, reply) => {
    const currentUserId = (request as any).userId;
    const otherUserId = (request.params as any).userId;
    const skip = parseInt((request.query as any).skip || '0', 10);
    const take = Math.min(parseInt((request.query as any).take || '50', 10), 50);
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId },
        ],
        deleted: false,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    reply.send(messages.reverse());
  });

  // 标记已读
  fastify.post('/read', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { senderId } = request.body as any;
    await prisma.message.updateMany({
      where: { senderId, receiverId: userId, status: { not: 'read' } },
      data: { status: 'read', readAt: new Date() },
    });
    reply.send({ success: true });
  });

  // 撤回消息（设置 recalled = true）
  fastify.put('/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: 'Permission denied' });
    await prisma.message.update({ where: { id: messageId }, data: { recalled: true, updatedAt: new Date() } });
    reply.send({ success: true });
  });

  // 双向删除消息（仅发送者可调用）
  fastify.delete('/delete', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: 'Only sender can delete' });
    await prisma.message.update({ where: { id: messageId }, data: { deleted: true, updatedAt: new Date() } });
    reply.send({ success: true });
  });

  // 会话列表
  fastify.get('/sessions', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const friendships = await prisma.friendship.findMany({
      where: { userId },
      include: { friend: { select: { id: true, username: true, nickname: true, avatar: true, status: true } } },
    });
    const sessions = await Promise.all(
      friendships.map(async (f) => {
        const lastMessage = await prisma.message.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: f.friendId },
              { senderId: f.friendId, receiverId: userId },
            ],
            deleted: false,
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, content: true, type: true, createdAt: true, senderId: true, recalled: true },
        });
        const unreadCount = await prisma.message.count({
          where: { senderId: f.friendId, receiverId: userId, status: { not: 'read' }, deleted: false },
        });
        return { friend: f.friend, lastMessage, unreadCount };
      })
    );
    sessions.sort((a, b) => (b.lastMessage?.createdAt?.getTime() || 0) - (a.lastMessage?.createdAt?.getTime() || 0));
    reply.send(sessions);
  });
}
