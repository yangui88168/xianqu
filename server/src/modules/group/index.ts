import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';

function authMiddleware(request: any, reply: any, done: any) {
  const token = (request.headers.authorization || '').replace('Bearer ', '');
  if (!token) { reply.status(401).send({ error: 'No token' }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    request.userId = decoded.userId;
    done();
  } catch { reply.status(401).send({ error: 'Invalid token' }); }
}

export async function groupRoutes(fastify: FastifyInstance) {
  // 创建群
  fastify.post('/create', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { name } = request.body as any;
    if (!name) return reply.status(400).send({ error: 'Name required' });
    const group = await prisma.groupChat.create({
      data: {
        name,
        ownerId: userId,
        members: {
          create: { userId, role: 'owner' }
        }
      }
    });
    reply.send(group);
  });

  // 加入群（公开群，实际可加邀请机制）
  fastify.post('/join', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    // 检查是否已加入
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } }
    });
    if (existing) return reply.status(400).send({ error: 'Already a member' });
    await prisma.groupMember.create({ data: { groupId, userId } });
    reply.send({ success: true });
  });

  // 退出群
  fastify.post('/leave', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    await prisma.groupMember.deleteMany({ where: { groupId, userId } });
    reply.send({ success: true });
  });

  // 获取我的群聊列表
  fastify.get('/list', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: { group: true }
    });
    reply.send(memberships.map(m => m.group));
  });

  // 获取群详情（含成员列表）
  fastify.get('/:groupId', { preHandler: authMiddleware }, async (request, reply) => {
    const { groupId } = request.params as any;
    const group = await prisma.groupChat.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, email: true, avatar: true } } }
        }
      }
    });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    reply.send(group);
  });

  // 发送群消息
  fastify.post('/message', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId, content, type, replyToId } = request.body as any;
    const msg = await prisma.groupMessage.create({
      data: { groupId, senderId: userId, content, type: type || 'text', replyToId }
    });
    // TODO: WebSocket 推送给群内所有在线成员（需扩展 WebSocket 逻辑，现在先用 REST 方式，稍后可在群聊前端轮询）
    reply.send(msg);
  });

  // 获取群消息历史
  fastify.get('/:groupId/messages', { preHandler: authMiddleware }, async (request, reply) => {
    const { groupId } = request.params as any;
    const messages = await prisma.groupMessage.findMany({
      where: { groupId, deleted: false },
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } }
      },
      orderBy: { createdAt: 'asc' },
      take: 100
    });
    reply.send(messages);
  });

  // 撤回消息（发送者或管理员）
  fastify.put('/message/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Message not found' });
    if (msg.senderId !== userId) {
      // 检查是否为管理员
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: msg.groupId, userId } }
      });
      if (!membership || membership.role === 'member')
        return reply.status(403).send({ error: 'Permission denied' });
    }
    await prisma.groupMessage.update({
      where: { id: messageId },
      data: { deleted: true }
    });
    reply.send({ success: true });
  });
}
