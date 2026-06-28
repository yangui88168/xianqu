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
}
