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
      include: { _count: { select: { homesteads: true } } },
      orderBy: { createdAt: 'desc' },
    });
    reply.send(communities);
  });

  // 获取社区详情（含家园列表）
  fastify.get('/:communityId', { preHandler: authMiddleware }, async (request, reply) => {
    const { communityId } = request.params as any;
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: {
        homesteads: {
          include: { _count: { select: { posts: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!community) return reply.status(404).send({ error: '社区不存在' });
    reply.send(community);
  });

  // 创建家园
  fastify.post('/:communityId/homestead', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { communityId } = request.params as any;
    const { name, description } = request.body as any;
    if (!name) return reply.status(400).send({ error: '家园名不能为空' });

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return reply.status(404).send({ error: '社区不存在' });

    const homestead = await prisma.homestead.create({
      data: { communityId, name, description, ownerId: userId },
    });
    reply.send(homestead);
  });

  // 获取家园详情（含帖子）
  fastify.get('/:communityId/homestead/:homesteadId', { preHandler: authMiddleware }, async (request, reply) => {
    const { homesteadId } = request.params as any;
    const homestead = await prisma.homestead.findUnique({
      where: { id: homesteadId },
      include: {
        posts: {
          include: { author: { select: { id: true, nickname: true, username: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!homestead) return reply.status(404).send({ error: '家园不存在' });
    reply.send(homestead);
  });

  // 在家园发帖
  fastify.post('/:communityId/homestead/:homesteadId/post', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { homesteadId } = request.params as any;
    const { content } = request.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });

    const post = await prisma.homesteadPost.create({
      data: { homesteadId, authorId: userId, content },
      include: { author: { select: { id: true, nickname: true, username: true } } },
    });
    reply.send(post);
  });
}
