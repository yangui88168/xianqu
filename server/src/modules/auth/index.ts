import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db';

export async function authRoutes(fastify: FastifyInstance) {
  // 注册
  fastify.post('/register', async (request, reply) => {
    const { username, password, nickname } = request.body as any;
    if (!username || !password || !nickname) {
      return reply.status(400).send({ error: '账号、密码和昵称不能为空' });
    }

    // 检查账号是否已存在
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) {
      return reply.status(409).send({ error: '账号已存在' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hash,
        nickname,
        email: `${username}@xianqu.local`, // 兼容旧字段，可以默认生成
      },
    });
    reply.send({ id: user.id, username: user.username, nickname: user.nickname });
  });

  // 登录
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) {
      return reply.status(400).send({ error: '账号和密码不能为空' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return reply.status(401).send({ error: '账号或密码错误' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: '7d' }
    );
    reply.send({ token, userId: user.id, username: user.username, nickname: user.nickname });
  });
}
