import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';
import { progressTask } from '../task';       // 任务进度
import { checkBadges } from '../badge';       // 徽章检查

function authMiddleware(request: any, reply: any, done: any) {
  const token = (request.headers.authorization || '').replace('Bearer ', '');
  if (!token) { reply.status(401).send({ error: 'No token' }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    request.userId = decoded.userId;
    done();
  } catch { reply.status(401).send({ error: 'Invalid token' }); }
}

export async function contactRoutes(fastify: FastifyInstance) {
  // 搜索用户
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
      select: { id: true, username: true, nickname: true, avatar: true, status: true },
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

    const existingFriendship = await prisma.friendship.findFirst({
      where: { OR: [{ userId: senderId, friendId: receiverId }, { userId: receiverId, friendId: senderId }] },
    });
    if (existingFriendship) return reply.status(400).send({ error: 'Already friends' });

    const existingRequest = await prisma.friendRequest.findFirst({
      where: { senderId, receiverId, status: 'pending' },
    });
    if (existingRequest) return reply.status(400).send({ error: 'Request already sent' });

    const req = await prisma.friendRequest.create({ data: { senderId, receiverId } });
    reply.send(req);
  });

  // 收到的好友请求
  fastify.get('/requests/incoming', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'pending' },
      include: {
        sender: { select: { id: true, username: true, nickname: true, avatar: true, status: true } },
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

    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'accepted' },
    });

    await prisma.friendship.createMany({
      data: [
        { userId: req.senderId, friendId: req.receiverId },
        { userId: req.receiverId, friendId: req.senderId },
      ],
    });

    // 好友关系建立成功后，推进双方“添加好友”任务进度
    await progressTask(userId, 'add_friend');
    await progressTask(req.senderId, 'add_friend');

    // 检查并授予添加好友相关徽章
    checkBadges(userId);
    checkBadges(req.senderId);

    reply.send({ success: true });
  });

  // 拒绝好友请求
  fastify.post('/request/reject', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { requestId } = request.body as any;
    await prisma.friendRequest.updateMany({
      where: { id: requestId, receiverId: userId, status: 'pending' },
      data: { status: 'rejected' },
    });
    reply.send({ success: true });
  });

  // 好友列表（返回备注、分组和最后在线时间）
  fastify.get('/friends', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const friendships = await prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: { id: true, username: true, nickname: true, avatar: true, status: true, lastSeen: true },
        },
      },
    });
    reply.send(friendships.map(f => ({
      ...f.friend,
      note: f.note,
      groupName: f.groupName,
    })));
  });

  // 删除好友
  fastify.delete('/friend/:friendId', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { friendId } = request.params as any;
    await prisma.friendship.deleteMany({
      where: { OR: [{ userId, friendId }, { userId: friendId, friendId: userId }] },
    });
    reply.send({ success: true });
  });

  // 更新好友备注
  fastify.put('/friend/:friendId/note', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { friendId } = request.params as any;
    const { note } = request.body as any;
    await prisma.friendship.updateMany({
      where: { userId, friendId },
      data: { note },
    });
    reply.send({ success: true });
  });

  // 更新好友分组
  fastify.put('/friend/:friendId/group', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { friendId } = request.params as any;
    const { groupName } = request.body as any;
    await prisma.friendship.updateMany({
      where: { userId, friendId },
      data: { groupName },
    });
    reply.send({ success: true });
  });

  // 拉黑用户
  fastify.post('/block', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { blockedId } = request.body as any;
    // 删除双向好友关系
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId, friendId: blockedId },
          { userId: blockedId, friendId: userId },
        ],
      },
    });
    // 添加拉黑记录
    await prisma.blocked.create({
      data: { userId, blockedId },
    });
    reply.send({ success: true });
  });

  // 取消拉黑
  fastify.delete('/block/:blockedId', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { blockedId } = request.params as any;
    await prisma.blocked.deleteMany({
      where: { userId, blockedId },
    });
    reply.send({ success: true });
  });

  // 获取拉黑列表
  fastify.get('/blocked', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const blocked = await prisma.blocked.findMany({
      where: { userId },
      include: { blocked: { select: { id: true, username: true, nickname: true, avatar: true } } },
    });
    reply.send(blocked.map(b => b.blocked));
  });

  // 获取共同好友
  fastify.get('/mutual/:userId', { preHandler: authMiddleware }, async (request, reply) => {
    const currentUserId = (request as any).userId;
    const otherUserId = (request.params as any).userId;

    // 我的好友ID列表
    const myFriends = await prisma.friendship.findMany({
      where: { userId: currentUserId },
      select: { friendId: true },
    });
    const myFriendIds = myFriends.map(f => f.friendId);

    // 对方的好友ID列表
    const otherFriends = await prisma.friendship.findMany({
      where: { userId: otherUserId },
      select: { friendId: true },
    });
    const otherFriendIds = otherFriends.map(f => f.friendId);

    // 交集
    const mutualIds = myFriendIds.filter(id => otherFriendIds.includes(id));

    // 获取共同好友信息
    const mutualUsers = await prisma.user.findMany({
      where: { id: { in: mutualIds } },
      select: { id: true, nickname: true, username: true, avatar: true },
    });

    reply.send(mutualUsers);
  });

  // 好友推荐（简单推荐：有共同好友的用户）
  fastify.get('/recommend', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;

    // 我的好友ID列表
    const myFriends = await prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });
    const myFriendIds = myFriends.map(f => f.friendId);
    myFriendIds.push(userId); // 排除自己

    // 我的好友的好友（二级关系）
    const friendsOfFriends = await prisma.friendship.findMany({
      where: { userId: { in: myFriendIds } },
      select: { friendId: true },
    });
    const candidateIds = friendsOfFriends.map(f => f.friendId)
      .filter(id => !myFriendIds.includes(id)); // 排除已经是好友的人

    // 统计每个候选人的出现次数（共同好友越多，推荐优先级越高）
    const countMap: Record<string, number> = {};
    candidateIds.forEach(id => { countMap[id] = (countMap[id] || 0) + 1; });

    // 排序并取前10个
    const topIds = Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    if (topIds.length === 0) return reply.send([]);

    const recommendedUsers = await prisma.user.findMany({
      where: { id: { in: topIds } },
      select: { id: true, nickname: true, username: true, avatar: true },
    });

    // 按出现次数排序
    const sorted = topIds.map(id => recommendedUsers.find(u => u.id === id)).filter(Boolean);
    reply.send(sorted);
  });
}
