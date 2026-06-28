import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
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

export async function userRoutes(fastify: FastifyInstance) {
  // 获取当前用户资料
  fastify.get('/profile', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, nickname: true, signature: true, avatar: true },
    });
    const exp = await prisma.userExp.findUnique({ where: { userId } });
    reply.send({ ...user, exp: exp?.exp || 0, level: exp?.level || 1 });
  });

  // 更新个人资料
  fastify.put('/profile', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { nickname, signature, avatar } = request.body as any;
    await prisma.user.update({
      where: { id: userId },
      data: { nickname, signature, avatar },
    });
    reply.send({ success: true });
  });

  // 修改密码
  fastify.put('/password', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { oldPassword, newPassword } = request.body as any;
    if (!oldPassword || !newPassword) return reply.status(400).send({ error: '请输入旧密码和新密码' });
    if (newPassword.length < 6) return reply.status(400).send({ error: '新密码至少6位' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: '用户不存在' });

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return reply.status(403).send({ error: '旧密码错误' });

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hash } });
    reply.send({ success: true });
  });

  // 获取收藏列表
  fastify.get('/favorites', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    reply.send(favorites);
  });

  // 添加收藏
  fastify.post('/favorite', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { type, targetId, content } = request.body as any;
    await prisma.favorite.create({ data: { userId, type, targetId, content } });
    reply.send({ success: true });
  });

  // 删除收藏
  fastify.delete('/favorite/:favoriteId', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { favoriteId } = request.params as any;
    const fav = await prisma.favorite.findUnique({ where: { id: favoriteId } });
    if (!fav || fav.userId !== userId) return reply.status(404).send({ error: '未找到或无权操作' });
    await prisma.favorite.delete({ where: { id: favoriteId } });
    reply.send({ success: true });
  });

  // 每日签到（简化稳定版）
  fastify.post('/signin', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await prisma.userSignin.findUnique({
        where: { userId_date: { userId, date: new Date(today) } },
      });
      if (existing) {
        return reply.status(400).send({ error: '今日已签到，明天再来吧' });
      }
      await prisma.userSignin.create({
        data: { userId, date: new Date(today) },
      });
      const allSignins = await prisma.userSignin.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        select: { date: true },
      });
      let streak = 0;
      const todayDate = new Date(today);
      for (const s of allSignins) {
        const sDate = new Date(s.date);
        const diffDays = Math.floor((todayDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === streak) streak++;
        else break;
      }
      const expGain = 10 + streak * 2;
      await prisma.userExp.upsert({
        where: { userId },
        update: { exp: { increment: expGain } },
        create: { userId, exp: expGain },
      });
      const userExp = await prisma.userExp.findUnique({ where: { userId } });
      const newLevel = Math.floor((userExp?.exp || 0) / 100) + 1;
      if (userExp && userExp.level !== newLevel) {
        await prisma.userExp.update({ where: { userId }, data: { level: newLevel } });
      }
      reply.send({
        success: true,
        expGain,
        streak,
        totalExp: userExp?.exp || 0,
        level: newLevel,
      });
    } catch (err: any) {
      console.error('签到失败', err);
      reply.status(500).send({ error: err.message || '签到失败' });
    }
  });

  // 获取签到状态
  fastify.get('/signin/status', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const today = new Date().toISOString().slice(0, 10);
    const existing = await prisma.userSignin.findUnique({
      where: { userId_date: { userId, date: new Date(today) } },
    });
    const allSignins = await prisma.userSignin.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    let streak = 0;
    const todayDate = new Date(today);
    for (const s of allSignins) {
      const sDate = new Date(s.date);
      const diffDays = Math.floor((todayDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === streak) streak++;
      else break;
    }
    const userExp = await prisma.userExp.findUnique({ where: { userId } });
    reply.send({
      signedToday: !!existing,
      streak,
      exp: userExp?.exp || 0,
      level: userExp?.level || 1,
    });
  });

  // 获取隐私与通知设置
  fastify.get('/settings', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { allowFriendRequest: true, allowSearch: true, notifyMessage: true, notifyCall: true, notifyPost: true },
    });
    reply.send(user);
  });

  // 更新隐私与通知设置
  fastify.put('/settings', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { allowFriendRequest, allowSearch, notifyMessage, notifyCall, notifyPost } = request.body as any;
    await prisma.user.update({
      where: { id: userId },
      data: { allowFriendRequest, allowSearch, notifyMessage, notifyCall, notifyPost },
    });
    reply.send({ success: true });
  });

  // 手动切换在线状态
  fastify.put('/status', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { status } = request.body as any;
    const validStatuses = ['online', 'busy', 'dnd', 'away', 'invisible'];
    if (!validStatuses.includes(status)) return reply.status(400).send({ error: '无效状态' });
    await prisma.user.update({ where: { id: userId }, data: { status } });
    reply.send({ success: true, status });
  });

  // ✅ 注销账号（新增）
  fastify.delete('/account', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    try {
      await prisma.$transaction(async (tx) => {
        // 删除该用户相关所有数据（按外键依赖顺序）
        await tx.userTask.deleteMany({ where: { userId } });
        await tx.userBadge.deleteMany({ where: { userId } });
        await tx.userSignin.deleteMany({ where: { userId } });
        await tx.blocked.deleteMany({ where: { OR: [{ userId }, { blockedId: userId }] } });
        await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
        await tx.starLike.deleteMany({ where: { userId } });
        await tx.starComment.deleteMany({ where: { userId } });
        await tx.starPost.deleteMany({ where: { userId } });
        await tx.favorite.deleteMany({ where: { userId } });
        // 群组相关
        const ownedGroups = await tx.groupChat.findMany({ where: { ownerId: userId } });
        for (const group of ownedGroups) {
          await tx.groupMessage.deleteMany({ where: { groupId: group.id } });
          await tx.groupMember.deleteMany({ where: { groupId: group.id } });
          await tx.groupChat.delete({ where: { id: group.id } });
        }
        // 非群主群组：删除成员记录、发送的群消息
        await tx.groupMessage.deleteMany({ where: { senderId: userId } });
        await tx.groupMember.deleteMany({ where: { userId } });
        // 好友关系
        await tx.friendship.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } });
        await tx.friendRequest.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } });
        // 消息
        await tx.message.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } });
        await tx.offlineQueue.deleteMany({ where: { userId } });
        // 经验
        await tx.userExp.deleteMany({ where: { userId } });
        // 最后删除用户记录
        await tx.user.delete({ where: { id: userId } });
      });
      reply.send({ success: true });
    } catch (err: any) {
      console.error('注销失败', err);
      reply.status(500).send({ error: err.message || '注销失败' });
    }
  });
}
