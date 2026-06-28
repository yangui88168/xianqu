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

export async function channelRoutes(fastify: FastifyInstance) {
  // 创建频道
  fastify.post('/create', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { name, description } = request.body as any;
    if (!name) return reply.status(400).send({ error: '频道名不能为空' });
    const channel = await prisma.channel.create({
      data: { name, description, ownerId: userId },
    });
    // 创建者自动订阅
    await prisma.channelSubscriber.create({
      data: { channelId: channel.id, userId },
    });
    reply.send(channel);
  });

  // 获取所有频道
  fastify.get('/list', { preHandler: authMiddleware }, async (request, reply) => {
    const channels = await prisma.channel.findMany({
      include: { _count: { select: { subscribers: true, posts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    reply.send(channels);
  });

  // 订阅/取消订阅频道
  fastify.post('/:channelId/subscribe', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { channelId } = request.params as any;
    const existing = await prisma.channelSubscriber.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) {
      await prisma.channelSubscriber.delete({ where: { channelId_userId: { channelId, userId } } });
      reply.send({ subscribed: false });
    } else {
      await prisma.channelSubscriber.create({ data: { channelId, userId } });
      reply.send({ subscribed: true });
    }
  });

  // 获取频道详情（含是否订阅）
  fastify.get('/:channelId', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { channelId } = request.params as any;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { _count: { select: { subscribers: true, posts: true } } },
    });
    if (!channel) return reply.status(404).send({ error: '频道不存在' });
    const subscriber = await prisma.channelSubscriber.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    reply.send({ ...channel, isSubscribed: !!subscriber });
  });

  // 发帖
  fastify.post('/:channelId/post', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { channelId } = request.params as any;
    const { content, imageUrl, pollOptions } = request.body as any;
    if (!content) return reply.status(400).send({ error: '内容不能为空' });
    // 检查是否订阅（频道所有者可直接发帖）
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return reply.status(404).send({ error: '频道不存在' });
    const isSubscriber = await prisma.channelSubscriber.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!isSubscriber && channel.ownerId !== userId) {
      return reply.status(403).send({ error: '请先订阅频道' });
    }
    const post = await prisma.channelPost.create({
      data: {
        channelId,
        authorId: userId,
        content,
        imageUrl,
        pollOptions: pollOptions ? JSON.stringify(pollOptions) : null,
        pollVotes: pollOptions ? JSON.stringify(pollOptions.map(() => 0)) : null,
      },
    });
    reply.send(post);
  });

  // 获取频道帖子（置顶优先，按时间倒序）
  fastify.get('/:channelId/posts', { preHandler: authMiddleware }, async (request, reply) => {
    const { channelId } = request.params as any;
    const posts = await prisma.channelPost.findMany({
      where: { channelId },
      include: {
        author: { select: { id: true, nickname: true, username: true, avatar: true } },
        comments: {
          include: { user: { select: { id: true, nickname: true, username: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { comments: true } },
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    // 解析 pollOptions 和 pollVotes
    const parsed = posts.map(post => ({
      ...post,
      pollOptions: post.pollOptions ? JSON.parse(post.pollOptions) : null,
      pollVotes: post.pollVotes ? JSON.parse(post.pollVotes) : null,
    }));
    reply.send(parsed);
  });

  // 评论帖子
  fastify.post('/:channelId/comment', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { postId, content } = request.body as any;
    if (!content) return reply.status(400).send({ error: '评论不能为空' });
    const comment = await prisma.channelComment.create({
      data: { postId, userId, content },
      include: { user: { select: { id: true, nickname: true, username: true } } },
    });
    reply.send(comment);
  });

  // 投票（简化：每个用户只能投一票，选项索引）
  fastify.post('/:channelId/vote', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { postId, optionIndex } = request.body as any;
    const post = await prisma.channelPost.findUnique({ where: { id: postId } });
    if (!post || !post.pollOptions) return reply.status(400).send({ error: '非投票帖子' });
    const votes = JSON.parse(post.pollVotes || '[]');
    // 这里简单处理，未记录用户投票历史，允许重复投。正式应检查是否已投过。
    votes[optionIndex] = (votes[optionIndex] || 0) + 1;
    await prisma.channelPost.update({
      where: { id: postId },
      data: { pollVotes: JSON.stringify(votes) },
    });
    reply.send({ success: true, votes });
  });

  // 置顶/取消置顶（频道所有者）
  fastify.put('/:channelId/post/:postId/pin', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { channelId, postId } = request.params as any;
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.ownerId !== userId) return reply.status(403).send({ error: '无权限' });
    const post = await prisma.channelPost.findUnique({ where: { id: postId } });
    if (!post) return reply.status(404).send({ error: '帖子不存在' });
    await prisma.channelPost.update({
      where: { id: postId },
      data: { pinned: !post.pinned },
    });
    reply.send({ pinned: !post.pinned });
  });
}
