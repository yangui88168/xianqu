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

// 检查并授予勋章
export async function checkBadges(userId: string) {
  const badges = await prisma.badge.findMany();
  for (const badge of badges) {
    const cond = JSON.parse(badge.condition);
    let qualified = false;

    switch (cond.type) {
      case 'signin_days': {
        // 最大连续签到天数
        const signins = await prisma.userSignin.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
          select: { date: true },
        });
        let maxStreak = 0, currentStreak = 0;
        const today = new Date();
        for (let i = 0; i < signins.length; i++) {
          const sDate = new Date(signins[i].date);
          const diffDays = Math.round((today.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === currentStreak) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
          } else break;
        }
        qualified = maxStreak >= cond.value;
        break;
      }
      case 'message_count': {
        const count = await prisma.message.count({ where: { senderId: userId } });
        qualified = count >= cond.value;
        break;
      }
      case 'friend_count': {
        const count = await prisma.friendship.count({ where: { userId } });
        qualified = count >= cond.value;
        break;
      }
      case 'group_count': {
        const count = await prisma.groupChat.count({ where: { ownerId: userId } });
        qualified = count >= cond.value;
        break;
      }
      case 'post_count': {
        const count = await prisma.starPost.count({ where: { userId } });
        qualified = count >= cond.value;
        break;
      }
    }

    if (qualified) {
      // 授予勋章
      const existing = await prisma.userBadge.findUnique({
        where: { userId_badgeId: { userId, badgeId: badge.id } },
      });
      if (!existing) {
        await prisma.userBadge.create({
          data: { userId, badgeId: badge.id },
        });
      }
    }
  }
}

export async function badgeRoutes(fastify: FastifyInstance) {
  // 获取我的勋章
  fastify.get('/mine', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    // 先检查一遍勋章
    await checkBadges(userId);
    const userBadges = await prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { awardedAt: 'desc' },
    });
    reply.send(userBadges.map(ub => ub.badge));
  });
}
