import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';
import { progressTask } from '../task'; // 新增：导入任务进度函数

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
  // 创建群（支持邀请初始成员）
  fastify.post('/create', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { name, memberIds } = request.body as any;
    if (!name) return reply.status(400).send({ error: 'Name required' });

    const initialMembers = memberIds
      ? [...new Set([userId, ...memberIds.filter((id: string) => id !== userId)])]
      : [userId];

    const group = await prisma.groupChat.create({
      data: {
        name,
        ownerId: userId,
        members: {
          create: initialMembers.map((id: string) => ({
            userId: id,
            role: id === userId ? 'owner' : 'member',
          })),
        },
      },
    });

    // 创建群成功后推进任务进度
    await progressTask(userId, 'create_group');

    reply.send(group);
  });

  // 邀请好友加入群（群主/管理员）
  fastify.post('/:groupId/invite', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { userIds } = request.body as any;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role === 'member') {
      return reply.status(403).send({ error: 'Permission denied' });
    }

    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingIds = existingMembers.map(m => m.userId);
    const newMembers = userIds.filter((id: string) => !existingIds.includes(id));

    if (newMembers.length === 0) {
      return reply.status(400).send({ error: 'All users are already members' });
    }

    await prisma.groupMember.createMany({
      data: newMembers.map((id: string) => ({
        groupId,
        userId: id,
        role: 'member',
      })),
    });

    reply.send({ success: true, invited: newMembers.length });
  });

  // 加入群（公开加入）
  fastify.post('/join', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) return reply.status(400).send({ error: 'Already a member' });
    await prisma.groupMember.create({ data: { groupId, userId } });
    reply.send({ success: true });
  });

  // 退出/解散群
  fastify.post('/leave', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.body as any;
    const group = await prisma.groupChat.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.ownerId === userId) {
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

  // 获取群详情
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

  // 更新群公告
  fastify.put('/:groupId/announcement', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { announcement } = request.body as any;
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    await prisma.groupChat.update({ where: { id: groupId }, data: { announcement } });
    reply.send({ success: true });
  });

  // 设置/取消管理员
  fastify.put('/:groupId/admin', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { targetUserId, role } = request.body as any;
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
      data: { role: 'admin' },
    });
    reply.send({ success: true });
  });

  // 禁言成员
  fastify.put('/:groupId/mute', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId } = request.params as any;
    const { targetUserId, minutes } = request.body as any;
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    const until = new Date(Date.now() + minutes * 60000);
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { mutedUntil: until },
    });
    reply.send({ success: true });
  });

  // 发送群消息（WebSocket方式已替代，保留REST降级）
  fastify.post('/message', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { groupId, content, type = 'text', replyToId } = request.body as any;
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return reply.status(403).send({ error: 'Not a member' });
    if (membership.mutedUntil && membership.mutedUntil > new Date()) return reply.status(403).send({ error: 'You are muted' });
    const msg = await prisma.groupMessage.create({
      data: { groupId, senderId: userId, content, type, replyToId },
    });
    reply.send(msg);
  });

  // 获取群消息历史（过滤已删除消息）
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

  // 撤回群消息（设置 recalled = true）
  fastify.put('/message/recall', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: msg.groupId, userId } },
      });
      if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    }
    await prisma.groupMessage.update({ where: { id: messageId }, data: { recalled: true } });
    reply.send({ success: true });
  });

  // 删除群消息（发送者或管理员可删除）
  fastify.delete('/message/delete', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { messageId } = request.body as any;
    const msg = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!msg) return reply.status(404).send({ error: 'Not found' });
    if (msg.senderId !== userId) {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: msg.groupId, userId } },
      });
      if (!membership || membership.role === 'member') return reply.status(403).send({ error: 'Permission denied' });
    }
    await prisma.groupMessage.update({ where: { id: messageId }, data: { deleted: true } });
    reply.send({ success: true });
  });
}
