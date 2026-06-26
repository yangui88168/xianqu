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
        members: { create: { userId, role: 'owner' } },
      },
    });
    reply.send(group);
  });

  // 加入群
  fastify.post('/join', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    const existing = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (existing) return reply.status(400).send({ error: 'Already a member' });
    await prisma.groupMember.create({ data: { groupId, userId } });
    reply.send({ success: true });
  });

  // 退出群 / 解散群（如果是群主且没有其他成员则解散）
  fastify.post('/leave', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    const group = await prisma.groupChat.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.ownerId === userId) {
      // 群主退出则解散群
      await prisma.groupChat.delete({ where: { id: groupId } });
    } else {
      await prisma.groupMember.deleteMany({ where: { groupId, userId } });
    }
    reply.send({ success: true });
  });

  // 获取我的群聊列表
  fastify.get('/list', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: { group: true },
    });
    reply.send(memberships.map(m => m.group));
  });

  // 获取群详情（成员列表、角色、禁言状态）
  fastify.get('/:groupId', { preHandler: authMiddleware }, async (request, reply) => {
    const { groupId } = request.params as any;
    const group = await prisma.groupChat.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    reply.send(group);
  });

  // 更新群公告（群主/管理员）
  fastify.put('/:groupId/announcement', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { announcement } = request.body as any;
    const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    await prisma.groupChat.update({ where: { id: groupId }, data: { announcement } });
    reply.send({ success: true });
  });

  // 设置管理员 / 撤销管理员（仅群主）
  fastify.put('/:groupId/admin', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { targetUserId, role } = request.body as any; // role: 'admin' | 'member'
    const group = await prisma.groupChat.findUnique({ where: { id: groupId } });
    if (!group || group.ownerId !== userId) return reply.status(403).send({ error: 'Only owner can change roles' });
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { role },
    });
    reply.send({ success: true });
  });

  // 转让群主
  fastify.put('/:groupId/transfer', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { newOwnerId } = request.body as any;
    const group = await prisma.groupChat.findUnique({ where: { id: groupId } });
    if (!group || group.ownerId !== userId) return reply.status(403).send({ error: 'Only owner can transfer' });
    await prisma.groupChat.update({ where: { id: groupId }, data: { ownerId: newOwnerId } });
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: newOwnerId } },
      data: { role: 'owner' },
    });
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role: 'admin' }, // 原群主降为管理员
    });
    reply.send({ success: true });
  });

  // 群禁言（设置禁言截止时间，管理员操作）
  fastify.put('/:groupId/mute', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { targetUserId, minutes } = request.body as any;
    const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    const until = new Date(Date.now() + minutes * 60000);
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { mutedUntil: until },
    });
    reply.send({ success: true });
  });

  // 发送群消息（含@功能）
  fastify.post('/message', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId, content, type = 'text', replyToId, mentions } = request.body as any;
    const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership) return reply.status(403).send({ error: 'Not a member' });
    if (membership.mutedUntil && membership.mutedUntil > new Date()) return reply.status(403).send({ error: 'You are muted' });
    const msg = await prisma.groupMessage.create({
      data: { groupId, senderId: userId, content, type, replyToId },
    });
    // 这里可以扩展 WebSocket 推送，目前使用 REST，前端定期刷新或通过轮询
    reply.send(msg);
  });

  // 获取群消息历史（分页支持 skip/take）
  fastify.get('/:groupId/messages', { preHandler: authMiddleware }, async (request, reply) => {
    const { groupId } = request.params as any;
    const skip = parseInt((request.query as any).skip || '0', 10);
    const take = Math.min(parseInt((request.query as any).take || '50', 10), 50);
    const messages = await prisma.groupMessage.findMany({
      where: { groupId, deleted: false },
      include: {
        sender: { select: { id: true, username: true, nickname: true, avatar: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    reply.send(messages.reverse());
  });

  // 撤回群消息
  fastify.put('/message/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) {
      const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: msg.groupId, userId } } });
      if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    }
    await prisma.groupMessage.update({ where: { id: messageId }, data: { deleted: true } });
    reply.send({ success: true });
  });
}
