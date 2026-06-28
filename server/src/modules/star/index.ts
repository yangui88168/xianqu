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

export async function starRoutes(fastify: FastifyInstance) {
  // 发布动态
  fastify.post('/post', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { content, imageUrl, permission } = request.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });
    const post = await prisma.starPost.create({
      data: { userId, content, imageUrl, permission: permission || 'public' },
      include: { user: { select: { id: true, nickname: true, username: true, avatar: true } } },
    });

    // 发布动态成功后推进任务进度
    await progressTask(userId, 'publish_post');

    reply.send(post);
  });

  // 获取动态流（公开动态 + 好友动态，按时间倒序，分页）
  fastify.get('/feed', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const skip = parseInt((request.query as any).skip || '0', 10);
    const take = Math.min(parseInt((request.query as any).take || '20', 10), 50);

    // 获取关注者的 ID 列表
    const followings = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = followings.map(f => f.followingId);
    followingIds.push(userId); // 也包含自己的动态

    const posts = await prisma.starPost.findMany({
      where: {
        userId: { in: followingIds },
        permission: 'public',
      },
      include: {
        user: { select: { id: true, nickname: true, username: true, avatar: true } },
        likes: { select: { userId: true } },
        comments: {
          include: { user: { select: { id: true, nickname: true, username: true } } },
          orderBy: { createdAt: 'asc' },
          take: 3,
        },
        _count: { select: { likes: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    reply.send(posts);
  });

  // 点赞/取消点赞
  fastify.post('/like', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { postId } = request.body as any;
    const existing = await prisma.starLike.findUnique({ where: { postId_userId: { postId, userId } } });
    if (existing) {
      await prisma.starLike.delete({ where: { id: existing.id } });
      reply.send({ liked: false });
    } else {
      await prisma.starLike.create({ data: { postId, userId } });
      reply.send({ liked: true });
    }
  });

  // 评论
  fastify.post('/comment', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { postId, content } = request.body as any;
    if (!content) return reply.status(400).send({ error: '评论不能为空' });
    const comment = await prisma.starComment.create({
      data: { postId, userId, content },
      include: { user: { select: { id: true, nickname: true, username: true } } },
    });
    reply.send(comment);
  });

  // 关注用户
  fastify.post('/follow', { preHandler: authMiddleware }, async (request, reply) => {
    const followerId = (request as any).userId;
    const { followingId } = request.body as any;
    if (followerId === followingId) return reply.status(400).send({ error: '不能关注自己' });
    const existing = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } });
    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      reply.send({ following: false });
    } else {
      await prisma.follow.create({ data: { followerId, followingId } });
      reply.send({ following: true });
    }
  });

  // 获取推荐用户（简单按注册时间排序）
  fastify.get('/users', { preHandler: authMiddleware }, async (request, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, nickname: true, username: true, avatar: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    reply.send(users);
  });
}
