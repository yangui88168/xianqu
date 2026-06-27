import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { authRoutes } from './modules/auth';
import { messageRoutes } from './modules/message';
import { contactRoutes } from './modules/contact';
import { groupRoutes } from './modules/group';
import { userRoutes } from './modules/user';
import { starRoutes } from './modules/star';
import { searchRoutes } from './modules/search';
import { wsHandler } from './websocket';

export const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(fastifyWebsocket);
app.register(authRoutes, { prefix: '/auth' });
app.register(messageRoutes, { prefix: '/messages' });
app.register(contactRoutes, { prefix: '/contacts' });
app.register(groupRoutes, { prefix: '/groups' });
app.register(userRoutes, { prefix: '/user' });
app.register(starRoutes, { prefix: '/star' });
app.register(searchRoutes, { prefix: '/search' });

app.register(async (fastify) => {
  fastify.get('/ws', { websocket: true }, wsHandler);
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running on port 3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
