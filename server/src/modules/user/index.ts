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
