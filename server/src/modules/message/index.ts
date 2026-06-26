import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';
import { WsEvent } from '../shared-types';
import { onlineUsers } from '../../websocket';

function authMiddleware(request: any, reply: any, done: any) {
  const token = (request.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    reply.status(401).send({ error: 'No token' });
    return;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    request.userId = decoded.userId;
    done();
  } catch {
    reply.status(401).send({ error: 'Invalid token' });
  }
}

export async function messageRoutes(fastify: FastifyInstance) {
  // 发送私聊消息
  fastify.post('/send', { preHandler: authMiddleware }, async (request, reply) => {
    const { receiverId, content, type = 'text', replyToId } = request.body as any;
    const senderId = (request as any).userId;

    const msg = await prisma.message.create({
      data: { senderId, receiverId, content, type, replyToId },
    });

    // 实时推送
    const receiverWs = onlineUsers.get(receiverId);
    if (receiverWs) {
      receiverWs.send(
        JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg })
      );
    } else {
      await prisma.offlineQueue.create({
        data: { userId: receiverId, messageId: msg.id },
      });
    }

    reply.send(msg);
  });

  // 获取与某用户的聊天历史
  fastify.get('/history/:userId', { preHandler: authMiddleware }, async (request, reply) => {
    const currentUserId = (request as any).userId;
    const otherUserId = (request.params as any).userId;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    reply.send(messages);
  });

  // 标记消息为已读
  fastify.post('/read', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { senderId } = request.body as any;
    if (!senderId) return reply.status(400).send({ error: 'senderId required' });

    await prisma.message.updateMany({
      where: {
        senderId,
        receiverId: userId,
        status: { not: 'read' },
      },
      data: { status: 'read', readAt: new Date() },
    });
    reply.send({ success: true });
  });

  // 撤回私聊消息
  fastify.put('/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: 'Permission denied' });

    await prisma.message.update({
      where: { id: messageId },
      data: { deleted: true, updatedAt: new Date() },
    });
    reply.send({ success: true });
  });

  // 获取会话列表（含好友信息、最后一条消息、未读计数）
  fastify.get('/sessions', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;

    // 查询所有好友
    const friendships = await prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            status: true,
          },
        },
      },
    });

    // 对每个好友，查询最后一条消息和未读计数
    const sessions = await Promise.all(
      friendships.map(async (f) => {
        const lastMessage = await prisma.message.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: f.friendId },
              { senderId: f.friendId, receiverId: userId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, content: true, type: true, createdAt: true, senderId: true },
        });

        const unreadCount = await prisma.message.count({
          where: {
            senderId: f.friendId,
            receiverId: userId,
            status: { not: 'read' },
          },
        });

        return {
          friend: f.friend,
          lastMessage,
          unreadCount,
        };
      })
    );

    // 按最后消息时间降序排序
    sessions.sort((a, b) => {
      const timeA = a.lastMessage?.createdAt?.getTime() || 0;
      const timeB = b.lastMessage?.createdAt?.getTime() || 0;
      return timeB - timeA;
    });

    reply.send(sessions);
  });
}
