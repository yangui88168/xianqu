fastify.delete('/account', { preHandler: authMiddleware }, async (request, reply) => {
  const userId = (request as any).userId;
  // 在事务中删除所有用户数据
  await prisma.$transaction([
    // 删除用户的好友关系（双向）
    prisma.friendship.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } }),
    // 删除好友请求
    prisma.friendRequest.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
    // 删除拉黑记录
    prisma.blocked.deleteMany({ where: { OR: [{ userId }, { blockedId: userId }] } }),
    // 删除私聊消息
    prisma.message.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
    // 删除离线队列
    prisma.offlineQueue.deleteMany({ where: { userId } }),
    // 删除群聊消息（先删消息再删成员关系）
    prisma.groupMessage.deleteMany({ where: { senderId: userId } }),
    // 删除群成员记录，若群主则解散群
    prisma.groupMember.deleteMany({ where: { userId } }),
    // 删除用户创建的群（若群主）
    prisma.groupChat.deleteMany({ where: { ownerId: userId } }),
    // 删除智慧星动态
    prisma.starPost.deleteMany({ where: { userId } }),
    // 删除点赞、评论（通过关联）
    prisma.starLike.deleteMany({ where: { userId } }),
    prisma.starComment.deleteMany({ where: { userId } }),
    // 删除关注关系
    prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } }),
    // 删除收藏
    prisma.favorite.deleteMany({ where: { userId } }),
    // 删除签到、经验、勋章
    prisma.userSignin.deleteMany({ where: { userId } }),
    prisma.userExp.deleteMany({ where: { userId } }),
    prisma.userBadge.deleteMany({ where: { userId } }),
    // 删除任务记录
    prisma.userTask.deleteMany({ where: { userId } }),
    // 最后删除用户本身
    prisma.user.delete({ where: { id: userId } }),
  ]);
  reply.send({ success: true });
});
