import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';

// JWT 验证中间件
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

export async function contactRoutes(fastify: FastifyInstance) {
  // 搜索用户（按昵称或用户名）
  fastify.get('/search', { preHandler: authMiddleware }, async (request, reply) => {
    const { q } = request.query as any;
    if (!q || q.length < 1) return reply.send([]);
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { nickname: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
        id: { not: (request as any).userId },
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        status: true,
      },
      take: 10,
    });
    reply.send(users);
  });

  // 发送好友请求
  fastify.post('/request', { preHandler: authMiddleware }, async (request, reply) => {
    const senderId = (request as any).userId;
    const { receiverId } = request.body as any;
    if (!receiverId) return reply.status(400).send({ error: 'receiverId required' });
    if (senderId === receiverId) return reply.status(400).send({ error: 'Cannot add yourself' });

    // 检查是否已经是好友
    const existingFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: senderId, friendId: receiverId },
          { userId: receiverId, friendId: senderId },
        ],
      },
    });
    if (existingFriendship) return reply.status(400).send({ error: 'Already friends' });

    // 检查是否已有待处理的请求
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        senderId,
        receiverId,
        status: 'pending',
      },
    });
    if (existingRequest) return reply.status(400).send({ error: 'Request already sent' });

    const req = await prisma.friendRequest.create({
      data: { senderId, receiverId },
    });
    reply.send(req);
  });

  // 获取我收到的待处理好友请求
  fastify.get('/requests/incoming', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'pending' },
      include: {
        sender: {
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
    reply.send(requests);
  });

  // 接受好友请求
  fastify.post('/request/accept', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { requestId } = request.body as any;
    const req = await prisma.friendRequest.findFirst({
      where: { id: requestId, receiverId: userId, status: 'pending' },
    });
    if (!req) return reply.status(404).send({ error: 'Request not found' });

    // 更新请求状态
    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'accepted' },
    });
    // 创建双向好友关系
    await prisma.friendship.createMany({
      data: [
        { userId: req.senderId, friendId: req.receiverId },
        { userId: req.receiverId, friendId: req.senderId },
      ],
    });
    reply.send({ success: true });
  });

  // 拒绝好友请求
  fastify.post('/request/reject', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { requestId } = request.body as any;
    await prisma.friendRequest.updateMany({
      where: { id: requestId, receiverId: userId, status: 'pending' },
    });
    reply.send({ success: true });
  });

  // 获取好友列表
  fastify.get('/friends', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
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
    // ✅ 已为您确保使用 .friend 映射关联对象
    reply.send(friendships.map((f) => f.friend));
  });

  // 删除好友
  fastify.delete('/friend/:friendId', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { friendId } = request.params as any;
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
      },
    });
    reply.send({ success: true });
  });
}
