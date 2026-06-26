import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs
  import jwt from 'jsonwebtoken';
import { prisma } from '@xianqu/db-schema';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const { email, username, password } = request.body as any;
    if (!email || !username || !password)
      return reply.status(400).send({ error: 'Missing fields' });

    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (exists) return reply.status(409).send({ error: 'Email or username exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, username, password: hash } });
    reply.send({ id: user.id, email: user.email, username: user.username });
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return reply.status(401).send({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'dev', { expiresIn: '7d' });
    reply.send({ token });
  });
}
