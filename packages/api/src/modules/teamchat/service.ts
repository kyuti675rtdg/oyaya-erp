// Native team chat service — channels, messages, attachments with DMS auto-save.
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { emitEvent } from '../../lib/socket';

const STORAGE_ROOT = process.env.DOCUMENT_STORAGE_PATH || path.join(process.cwd(), 'storage', 'documents');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function storagePathFor(fileName: string): { abs: string; rel: string } {
  const now = new Date();
  const relDir = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const safe = `${randomUUID()}-${path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  ensureDir(path.join(STORAGE_ROOT, relDir));
  return { abs: path.join(STORAGE_ROOT, relDir, safe), rel: path.join(relDir, safe) };
}

function nextDocNo(): string {
  const d = new Date();
  return `DOC-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/** Get all channels visible to a user, with unread counts. */
export async function getUserChannels(userId: string) {
  const memberships = await prisma.chatChannelMember.findMany({
    where: { userId, channel: { isActive: true } },
    include: {
      channel: {
        include: {
          department: { select: { name: true } },
          _count: { select: { messages: true } },
        },
      },
    },
    orderBy: { channel: { updatedAt: 'desc' } },
  });

  const channels = await Promise.all(
    memberships.map(async (m) => {
      const unread = await prisma.chatMessage.count({
        where: {
          channelId: m.channelId,
          isDeleted: false,
          createdAt: m.lastReadAt ? { gt: m.lastReadAt } : undefined,
          senderId: { not: userId },
        },
      });
      const lastMessage = await prisma.chatMessage.findFirst({
        where: { channelId: m.channelId, isDeleted: false },
        include: { sender: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        id: m.channel.id,
        name: m.channel.name,
        type: m.channel.type,
        description: m.channel.description,
        departmentName: m.channel.department?.name,
        role: m.role,
        unread,
        lastMessage: lastMessage
          ? { body: lastMessage.body.slice(0, 80), senderName: lastMessage.sender.name, createdAt: lastMessage.createdAt }
          : null,
      };
    })
  );
  return channels;
}

/** Ensure department channels exist and members are synced. */
export async function syncDepartmentChannels(): Promise<{ created: number; synced: number }> {
  let created = 0;
  let synced = 0;

  // General announcements channel
  let ann = await prisma.chatChannel.findFirst({ where: { type: 'announcements' } });
  if (!ann) {
    ann = await prisma.chatChannel.create({
      data: { name: 'Announcements', type: 'announcements', description: 'Company-wide announcements from management' },
    });
    created++;
  }

  // Department channels
  const departments = await prisma.department.findMany({ where: { isActive: true } });
  for (const dept of departments) {
    let channel = await prisma.chatChannel.findFirst({
      where: { type: 'department', departmentId: dept.id },
    });
    if (!channel) {
      channel = await prisma.chatChannel.create({
        data: { name: dept.name, type: 'department', departmentId: dept.id, description: `${dept.name} department channel` },
      });
      created++;
    }

    // Sync members: all active users linked to employees in this department
    const employees = await prisma.employee.findMany({
      where: { departmentId: dept.id, isActive: true, userId: { not: null } },
      select: { userId: true },
    });
    for (const emp of employees) {
      if (!emp.userId) continue;
      await prisma.chatChannelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId: emp.userId } },
        update: {},
        create: { channelId: channel.id, userId: emp.userId, role: 'member' },
      });
      synced++;
    }

    // Add all users to announcements channel
    if (ann) {
      const allUsers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
      for (const u of allUsers) {
        await prisma.chatChannelMember.upsert({
          where: { channelId_userId: { channelId: ann.id, userId: u.id } },
          update: {},
          create: { channelId: ann.id, userId: u.id, role: 'member' },
        });
      }
    }
  }
  return { created, synced };
}

/** Get messages for a channel (paginated, newest last). */
export async function getChannelMessages(channelId: string, userId: string, limit = 50, before?: string) {
  // Verify membership
  const member = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  if (!member) throw new Error('Not a member of this channel.');

  const messages = await prisma.chatMessage.findMany({
    where: {
      channelId,
      isDeleted: false,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: {
      sender: { select: { id: true, name: true } },
      attachments: { include: { document: { select: { id: true, docNo: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Mark as read
  await prisma.chatChannelMember.update({
    where: { id: member.id },
    data: { lastReadAt: new Date() },
  });

  return messages.reverse();
}

/** Send a message with optional attachments. Auto-saves attachments to DMS. */
export async function sendMessage(
  channelId: string,
  senderId: string,
  body: string,
  attachments?: Array<{ fileName: string; mimeType: string; contentBase64: string }>
) {
  const member = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId: senderId } },
  });
  if (!member) throw new Error('Not a member of this channel.');

  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    include: { department: { select: { name: true } } },
  });
  if (!channel || !channel.isActive) throw new Error('Channel not found or inactive.');

  // Announcements channel: only managers/admins can post
  if (channel.type === 'announcements') {
    const sender = await prisma.user.findUnique({ where: { id: senderId }, include: { role: true } });
    const roleName = sender?.role?.name?.toLowerCase() ?? '';
    const canAnnounce = member.role === 'owner' || member.role === 'moderator' ||
      roleName.includes('admin') || roleName.includes('ceo') || roleName.includes('manager') || roleName.includes('head');
    if (!canAnnounce) throw new Error('Only management can post announcements.');
  }

  const message = await prisma.chatMessage.create({
    data: { channelId, senderId, body: body.slice(0, 5000) },
    include: { sender: { select: { id: true, name: true } } },
  });

  // Process attachments: save file + auto-create Document in DMS
  const savedAttachments = [];
  if (attachments && attachments.length > 0) {
    for (const att of attachments.slice(0, 5)) { // max 5 per message
      const buf = Buffer.from(att.contentBase64, 'base64');
      if (buf.length > 25 * 1024 * 1024) throw new Error(`File ${att.fileName} exceeds 25MB limit.`);

      const { abs, rel } = storagePathFor(att.fileName);
      fs.writeFileSync(abs, buf);

      // Auto-save to Document Management
      const sender = await prisma.user.findUnique({ where: { id: senderId } });
      const doc = await prisma.document.create({
        data: {
          docNo: nextDocNo(),
          title: att.fileName,
          description: `Shared in team chat: ${channel.name}${channel.department ? ` (${channel.department.name})` : ''}`,
          category: 'Team Chat',
          tags: ['team-chat', channel.type, channel.name.toLowerCase().replace(/\s+/g, '-')],
          fileName: att.fileName,
          mimeType: att.mimeType || 'application/octet-stream',
          fileSize: buf.length,
          storagePath: rel,
          status: 'PUBLISHED',
          uploadedById: senderId,
          versions: {
            create: {
              version: '1.0',
              fileName: att.fileName,
              fileSize: buf.length,
              storagePath: rel,
              changeNote: `Shared in chat by ${sender?.name || 'user'}`,
              createdById: senderId,
            },
          },
        },
      });

      const chatAtt = await prisma.chatAttachment.create({
        data: {
          messageId: message.id,
          documentId: doc.id,
          fileName: att.fileName,
          mimeType: att.mimeType || 'application/octet-stream',
          fileSize: buf.length,
        },
        include: { document: { select: { id: true, docNo: true } } },
      });
      savedAttachments.push(chatAtt);
    }
  }

  // Broadcast via Socket.io
  emitEvent(`chat:${channelId}`, {
    type: 'new_message',
    message: { ...message, attachments: savedAttachments },
  });

  return { ...message, attachments: savedAttachments };
}

/** Get or create a DM channel between two users. */
export async function getOrCreateDM(userId: string, otherUserId: string) {
  if (userId === otherUserId) throw new Error('Cannot message yourself.');

  const other = await prisma.user.findUnique({ where: { id: otherUserId, isActive: true } });
  if (!other) throw new Error('User not found.');

  // Find existing DM channel with exactly these two members
  const existing = await prisma.chatChannel.findFirst({
    where: {
      type: 'dm',
      isActive: true,
      members: { every: { userId: { in: [userId, otherUserId] } } },
    },
    include: { members: true },
  });
  // Verify it has exactly 2 members (both users)
  if (existing && existing.members.length === 2) {
    return existing;
  }

  const me = await prisma.user.findUnique({ where: { id: userId } });
  const channel = await prisma.chatChannel.create({
    data: {
      name: `DM: ${me?.name} & ${other.name}`,
      type: 'dm',
      description: 'Direct message',
      members: {
        create: [
          { userId, role: 'member' },
          { userId: otherUserId, role: 'member' },
        ],
      },
    },
  });
  return channel;
}

/** Delete a message (sender or moderator). */
export async function deleteMessage(messageId: string, userId: string) {
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { channel: { include: { members: { where: { userId } } } } },
  });
  if (!message) throw new Error('Message not found.');

  const membership = message.channel.members[0];
  const canDelete = message.senderId === userId || membership?.role === 'moderator' || membership?.role === 'owner';
  if (!canDelete) throw new Error('Cannot delete this message.');

  await prisma.chatMessage.update({ where: { id: messageId }, data: { isDeleted: true } });
  emitEvent(`chat:${message.channelId}`, { type: 'delete_message', messageId });
  return { ok: true };
}

/** Search users for starting DMs. */
export async function searchUsers(query: string, excludeUserId: string) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: excludeUserId },
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 20,
  });
  return users;
}
