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

// 任务类型与经验奖励
const TASK_CONFIG: any = {
  send_message: { exp: 2, target: 10, desc: '发送消息' },
  add_friend: { exp: 20, target: 3, desc: '添加好友' },
  create_group: { exp: 30, target: 1, desc: '创建群聊' },
  make_call: { exp: 15, target: 1, desc: '发起通话' },
  publish_post: { exp: 10, target: 3, desc: '发布动态' },
};

// 辅助函数：增加任务进度
async function progressTask(userId: string, taskType: string) {
  const config = TASK_CONFIG[taskType];
  if (!config) return;

  const today = new Date().toISOString().slice(0, 10);
  let task = await prisma.userTask.findFirst({
    where: { userId, taskType, date: new Date(today) },
  });

  if (task && task.completed) return; // 已完成

  if (!task) {
    task = await prisma.userTask.create({
      data: { userId, taskType, date: new Date(today), target: config.target },
    });
  }

  const newProgress = task.progress + 1;
  const completed = newProgress >= config.target;

  await prisma.userTask.update({
    where: { id: task.id },
    data: { progress: newProgress, completed },
  });

  if (completed) {
    // 发放经验
    await prisma.userExp.upsert({
      where: { userId },
      update: { exp: { increment: config.exp } },
      create: { userId, exp: config.exp },
    });
  }
}

export async function taskRoutes(fastify: FastifyInstance) {
  // 查询每日任务
  fastify.get('/daily', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const today = new Date().toISOString().slice(0, 10);
    const tasks = await prisma.userTask.findMany({
      where: { userId, date: new Date(today) },
    });
    reply.send(tasks);
  });

  // 手动领取已完成任务奖励（前端调用）
  fastify.post('/claim', { preHandler: authMiddleware }, async (request, reply) => {
    const userId = (request as any).userId;
    const { taskId } = request.body as any;
    const task = await prisma.userTask.findUnique({ where: { id: taskId } });
    if (!task || task.userId !== userId) return reply.status(404).send({ error: '任务不存在' });
    if (!task.completed) return reply.status(400).send({ error: '任务未完成' });
    const config = TASK_CONFIG[task.taskType];
    if (!config) return reply.status(400).send({ error: '无效任务类型' });

    // 发放经验（如果还没发过）
    await prisma.userExp.upsert({
      where: { userId },
      update: { exp: { increment: config.exp } },
      create: { userId, exp: config.exp },
    });
    // 标记任务已领取
    await prisma.userTask.update({
      where: { id: task.id },
      data: { completed: true },
    });
    reply.send({ success: true, expGain: config.exp });
  });
}

// 导出 progressTask 供其他模块调用
export { progressTask };
