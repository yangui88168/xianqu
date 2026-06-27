import { SocketStream } from '@fastify/websocket';
import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { WsEvent } from '../shared-types';

export const onlineUsers = new Map<string, SocketStream['socket']>();

export const wsHandler = (connection: SocketStream, req: FastifyRequest) => {
  const token = (req.query as any).token as string | undefined;
  if (!token) {
    connection.socket.close(1008, 'Token missing');
    return;
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev') as { userId: string };
    userId = decoded.userId;
  } catch {
    connection.socket.close(1008, 'Invalid token');
    return;
  }

  onlineUsers.set(userId, connection.socket);
  console.log(`User ${userId} online`);

  // 推送离线私聊消息
  prisma.offlineQueue.findMany({
    where: { userId },
    include: { message: true },
  }).then(queues => {
    queues.forEach(q => {
      connection.socket.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: q.message }));
    });
    return prisma.offlineQueue.deleteMany({ where: { userId } });
  }).catch(console.error);

  // 处理客户端消息
  connection.socket.on('message', async (data: any) => {
    try {
      const parsed = JSON.parse(data.toString());
      switch (parsed.event) {
        case WsEvent.MESSAGE_SEND: {
          const { receiverId, content, type = 'text', replyToId, chatType, groupId } = parsed.data;
          const senderId = userId;

          // 1. 群聊消息处理分支
          if (chatType === 'group' && groupId) {
            const membership = await prisma.groupMember.findUnique({
              where: { groupId_userId: { groupId, userId: senderId } },
            });
            if (!membership) {
              connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Not a member' }));
              return;
            }
            if (membership.mutedUntil && membership.mutedUntil > new Date()) {
              connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'You are muted' }));
              return;
            }

            const msg = await prisma.groupMessage.create({
              data: {
                groupId,
                senderId,
                content,
                type,
                replyToId,
              },
              include: {
                sender: { select: { id: true, username: true, nickname: true, avatar: true } },
                replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
              },
            });

            const group = await prisma.groupChat.findUnique({
              where: { id: groupId },
              include: { members: true },
            });
            if (group) {
              group.members.forEach(member => {
                const memberWs = onlineUsers.get(member.userId);
                if (memberWs) {
                  memberWs.send(
                    JSON.stringify({
                      event: WsEvent.GROUP_MESSAGE_RECEIVE,
                      data: msg,
                    })
                  );
                }
              });
            }
          } 
          // 2. 私聊消息处理分支
          else {
            const msg = await prisma.message.create({
              data: { senderId, receiverId, content, type, replyToId },
            });
            const receiverWs = onlineUsers.get(receiverId);
            if (receiverWs) {
              receiverWs.send(JSON.stringify({ event: WsEvent.MESSAGE_RECEIVE, data: msg }));
              const senderWs = onlineUsers.get(senderId);
              if (senderWs) {
                senderWs.send(JSON.stringify({
                  event: 'message:delivered',
                  data: { messageId: msg.id },
                }));
              }
            } else {
              await prisma.offlineQueue.create({ data: { userId: receiverId, messageId: msg.id } });
            }
          }
          break;
        }

        case 'message:read': {
          const { messageId, senderId: originalSenderId } = parsed.data;
          await prisma.message.updateMany({
            where: { id: messageId },
            data: { status: 'read', readAt: new Date() },
          });
          const targetWs = onlineUsers.get(originalSenderId);
          if (targetWs) {
            targetWs.send(JSON.stringify({ event: 'message:read', data: { messageId } }));
          }
          break;
        }

        // WebRTC 信令转发（事件名统一为 call-accepted）
        case 'call-offer':
        case 'call-accepted':
        case 'call-answer':
        case 'ice-candidate':
        case 'call-hangup': {
          const targetId = parsed.data.targetId;
          const targetWs = onlineUsers.get(targetId);
          if (targetWs) {
            targetWs.send(JSON.stringify({
              event: parsed.event,
              data: { ...parsed.data, from: userId },
            }));
          }
          break;
        }

        case 'ping':
          connection.socket.send(JSON.stringify({ event: 'pong' }));
          break;

        default:
          connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Unknown event' }));
      }
    } catch {
      connection.socket.send(JSON.stringify({ event: WsEvent.ERROR, data: 'Invalid format' }));
    }
  });

  connection.socket.on('close', () => {
    onlineUsers.delete(userId);
    console.log(`User ${userId} offline`);
  });
};
