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

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.get('/messages', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const q = (request.query as any).q as string;
    if (!q || q.trim().length === 0) return reply.send([]);

    const privateMessages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: { not: userId } },
          { receiverId: userId, senderId: { not: userId } },
        ],
        content: { contains: q, mode: 'insensitive' },
        deleted: false,
      },
      include: {
        sender: { select: { id: true, nickname: true, username: true } },
        receiver: { select: { id: true, nickname: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const groupMessages = await prisma.groupMessage.findMany({
      where: {
        content: { contains: q, mode: 'insensitive' },
        deleted: false,
        group: { members: { some: { userId } } },
      },
      include: {
        sender: { select: { id: true, nickname: true, username: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const results = [
      ...privateMessages.map(m => ({
        id: m.id,
        content: m.content,
        chatType: 'friend',
        chatName: (m.senderId === userId ? m.receiver?.nickname : m.sender?.nickname) || '',
        createdAt: m.createdAt,
      })),
      ...groupMessages.map(m => ({
        id: m.id,
        content: m.content,
        chatType: 'group',
        chatName: m.group?.name || '',
        createdAt: m.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    reply.send(results.slice(0, 20));
  });
}
