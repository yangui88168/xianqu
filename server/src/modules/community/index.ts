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

export async function communityRoutes(fastify: FastifyInstance) {
  // 创建社区
  fastify.post('/create', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { name, description } = request.body as any;
    if (!name) return reply.status(400).send({ error: '社区名不能为空' });
    const community = await prisma.community.create({
      data: { name, description, ownerId: userId },
    });
    reply.send(community);
  });

  // 获取所有社区
  fastify.get('/list', { preHandler: authMiddleware }, async (request, reply) => {
    const communities = await prisma.community.findMany({
      include: { _count: { select: { channels: true } } },
      orderBy: { createdAt: 'desc' },
    });
    reply.send(communities);
  });

  // 获取社区详情（含频道列表）
  fastify.get('/:communityId', { preHandler: authMiddleware }, async (request, reply) => {
    const { communityId } = request.params as any;
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: { channels: { include: { _count: { select: { posts: true } } } } },
    });
    if (!community) return reply.status(404).send({ error: '社区不存在' });
    reply.send(community);
  });

  // 在社区内创建频道（复用原有频道创建逻辑，但加 communityId）
  fastify.post('/:communityId/channel', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { communityId } = request.params as any;
    const { name, description } = request.body as any;
    if (!name) return reply.status(400).send({ error: '频道名不能为空' });
    // 验证社区存在
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return reply.status(404).send({ error: '社区不存在' });
    // 检查是否有权限（社区管理员或所有者）
    if (community.ownerId !== userId) return reply.status(403).send({ error: '只有社区主能创建频道' });
    const channel = await prisma.channel.create({
      data: { name, description, ownerId: userId, communityId },
    });
    // 创建者自动订阅
    await prisma.channelSubscriber.create({ data: { channelId: channel.id, userId } });
    reply.send(channel);
  });
}
