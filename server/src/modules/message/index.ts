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
  // 发送私聊消息（已添加拉黑检查）
  fastify.post('/send', { preHandler: authMiddleware }, async (request, reply) => {
    const { receiverId, content, type = 'text', replyToId } = request.body as any;
    const senderId = (request as any).userId;

    // 拉黑检查
    const isBlocked = await prisma.blocked.findFirst({
      where: { OR: [{ userId: senderId, blockedId: receiverId }, { userId: receiverId, blockedId: senderId }] },
    });
    if (isBlocked) return reply.status(403).send({ error: '无法发送消息，对方已被拉黑' });

    const msg = await prisma.message.create({ data: { senderId, receiverId, content, type, replyToId } });

    // 实时推送
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
    reply.send(msg);
  });

  // 获取与某用户的聊天历史（过滤已删除的消息）
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

  // 标记消息已读
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

  // 撤回消息（设置 recalled = true）
  fastify.put('/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: 'Permission denied' });
    await prisma.message.update({
      where: { id: messageId },
      data: { recalled: true, updatedAt: new Date() },
    });
    reply.send({ success: true });
  });

  // 双向删除消息（仅发送者可调用，双方均不可见）
  fastify.delete('/delete', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: 'Only sender can delete' });
    await prisma.message.update({
      where: { id: messageId },
      data: { deleted: true, updatedAt: new Date() },
    });
    reply.send({ success: true });
  });

  // 编辑消息（彻底无时间限制）
  fastify.put('/edit', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId, content } = request.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });

    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: '消息不存在' });
    if (msg.senderId !== userId) return reply.status(403).send({ error: '只能编辑自己的消息' });

    // 直接更新，没有任何时间检查
    await prisma.message.update({
      where: { id: messageId },
      data: { content, edited: true, updatedAt: new Date() },
    });
    reply.send({ success: true, content });
  });

  // 获取会话列表（包含最后一条消息预览和未读计数，好友信息含 lastSeen）
  fastify.get('/sessions', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const friendships = await prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: { id: true, username: true, nickname: true, avatar: true, status: true, lastSeen: true },
        },
      },
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
          where: {
            senderId: f.friendId,
            receiverId: userId,
            status: { not: 'read' },
            deleted: false,
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

  // 转发消息（修复实时推送并添加错误捕获）
  fastify.post('/forward', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId, targetIds } = request.body as any;
    if (!messageId || !targetIds || targetIds.length === 0) {
      return reply.status(400).send({ error: '缺少参数' });
    }

    const original = await prisma.message.findUnique({ where: { id: messageId } });
    if (!original) return reply.status(404).send({ error: '消息不存在' });

    const forwardedContent = `[转发] ${original.content}`;
    const results = [];

    for (const targetId of targetIds) {
      const isGroup = targetId.startsWith('group-');
      try {
        if (isGroup) {
          const groupId = targetId.replace('group-', '');
          const msg = await prisma.groupMessage.create({
            data: { groupId, senderId: userId, content: forwardedContent, type: original.type },
          });
          // 广播给群成员
          const group = await prisma.groupChat.findUnique({
            where: { id: groupId },
            include: { members: true },
          });
          if (group) {
            group.members.forEach(member => {
              const memberWs = onlineUsers.get(member.userId);
              if (memberWs) {
                memberWs.send(JSON.stringify({ event: 'group-message:receive', data: msg }));
              }
            });
          }
          results.push({ targetId, msg });
        } else {
          const msg = await prisma.message.create({
            data: { senderId: userId, receiverId: targetId, content: forwardedContent, type: original.type },
          });
          // 实时推送给接收方
          const receiverWs = onlineUsers.get(targetId);
          if (receiverWs) {
            receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
          } else {
            await prisma.offlineQueue.create({ data: { userId: targetId, messageId: msg.id } });
          }
          results.push({ targetId, msg });
        }
      } catch (err) {
        console.error('转发失败', err);
      }
    }

    reply.send({ success: true, results });
  });
}
