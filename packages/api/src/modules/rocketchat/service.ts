// Rocket.Chat REST API client for Oyaya Flour Mill ERP integration.
// Handles: admin auth, user provisioning, channel management, SSO tokens, announcements.
import { prisma } from '../../lib/prisma';

interface RcAuth {
  userId: string;
  authToken: string;
}

interface ChatConfigRow {
  serverUrl: string;
  adminUsername: string;
  adminUserId: string | null;
  adminToken: string | null;
  adminTokenExp: Date | null;
  isEnabled: boolean;
}

async function getConfig(): Promise<ChatConfigRow | null> {
  const cfg = await prisma.chatConfig.findFirst({ orderBy: { createdAt: 'desc' } });
  return cfg;
}

async function rcRequest(
  serverUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  auth?: RcAuth
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    headers['X-Auth-Token'] = auth.authToken;
    headers['X-User-Id'] = auth.userId;
  }
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Rocket.Chat API error: ${res.status} ${path}`);
  }
  return data;
}

/** Get a valid admin auth (login if token missing/expired). */
export async function getAdminAuth(): Promise<{ serverUrl: string; auth: RcAuth }> {
  const cfg = await getConfig();
  if (!cfg || !cfg.isEnabled) throw new Error('Team chat is not configured or not enabled.');
  const serverUrl = cfg.serverUrl;

  // Reuse cached token if still valid (with 5-min buffer)
  if (cfg.adminToken && cfg.adminUserId && cfg.adminTokenExp) {
    if (cfg.adminTokenExp.getTime() - Date.now() > 5 * 60 * 1000) {
      return { serverUrl, auth: { userId: cfg.adminUserId, authToken: cfg.adminToken } };
    }
  }

  // Need admin password — stored in env (never in DB)
  const adminPassword = process.env.ROCKETCHAT_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('ROCKETCHAT_ADMIN_PASSWORD env var is not set.');

  const login = await rcRequest(serverUrl, 'POST', '/login', {
    user: cfg.adminUsername,
    password: adminPassword,
  });
  const auth: RcAuth = { userId: login.data.userId, authToken: login.data.authToken };

  // Cache token (Rocket.Chat tokens default to ~90 days; we refresh proactively at 30 days)
  await prisma.chatConfig.update({
    where: { id: (cfg as any).id },
    data: {
      adminUserId: auth.userId,
      adminToken: auth.authToken,
      adminTokenExp: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { serverUrl, auth };
}

/** Ensure an ERP user exists in Rocket.Chat; returns the RC user ID + username. */
export async function ensureRcUser(erpUserId: string): Promise<{ rcUserId: string; rcUsername: string }> {
  const existing = await prisma.chatUserMap.findUnique({ where: { erpUserId } });
  if (existing) return { rcUserId: existing.rcUserId, rcUsername: existing.rcUsername };

  const { serverUrl, auth } = await getAdminAuth();
  const user = await prisma.user.findUnique({
    where: { id: erpUserId },
    include: { role: true, employee: { include: { departmentRef: true } } },
  });
  if (!user) throw new Error('ERP user not found.');
  if (!user.isActive) throw new Error('Cannot provision chat for inactive user.');

  // Build a safe Rocket.Chat username from email prefix
  const base = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  let username = base || `user${erpUserId.slice(-6)}`;

  // Check for collision, append suffix if needed
  try {
    await rcRequest(serverUrl, 'GET', `/users.info?username=${encodeURIComponent(username)}`, undefined, auth);
    username = `${base}${erpUserId.slice(-4).toLowerCase()}`;
  } catch {
    // username is free — proceed
  }

  // Temporary password — user will SSO via token, never needs it
  const tempPassword = `Oyaya!${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const created = await rcRequest(serverUrl, 'POST', '/users.create', {
    name: user.name,
    email: user.email,
    password: tempPassword,
    username,
    active: true,
    roles: ['user'],
    joinDefaultChannels: true,
    verified: true,
  }, auth);

  const rcUserId: string = created.user._id;

  // Map ERP role → Rocket.Chat role
  const roleName = user.role?.name?.toLowerCase() ?? '';
  if (roleName.includes('admin') || roleName.includes('ceo') || roleName.includes('owner')) {
    await rcRequest(serverUrl, 'POST', '/roles.addUserToRole', { username, roleName: 'admin' }, auth).catch(() => {});
  }

  await prisma.chatUserMap.create({
    data: { erpUserId, rcUserId, rcUsername: username },
  });
  return { rcUserId, rcUsername: username };
}

/** Generate a login token for SSO (iframe embedding). */
export async function generateUserToken(erpUserId: string): Promise<{ serverUrl: string; resumeToken: string; rcUsername: string }> {
  const { serverUrl, auth } = await getAdminAuth();
  const { rcUsername } = await ensureRcUser(erpUserId);

  // Generate a personal access token the frontend can use as resumeToken
  const tok = await rcRequest(serverUrl, 'POST', '/users.generatePersonalAccessToken', {
    username: rcUsername,
  }, auth);

  return { serverUrl, resumeToken: tok.data.token, rcUsername };
}

/** Ensure a department channel exists (private group). Returns RC room ID. */
export async function ensureDepartmentChannel(departmentId: string): Promise<{ rcRoomId: string; rcRoomName: string }> {
  const existing = await prisma.chatChannelMap.findUnique({ where: { departmentId } });
  if (existing) return { rcRoomId: existing.rcRoomId, rcRoomName: existing.rcRoomName };

  const { serverUrl, auth } = await getAdminAuth();
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw new Error('Department not found.');

  const roomName = `dept-${dept.code.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  // Collect member usernames (ERP users linked to employees in this department)
  const employees = await prisma.employee.findMany({
    where: { departmentId, isActive: true, userId: { not: null } },
    include: { user: true },
  });
  const members: string[] = [];
  for (const emp of employees) {
    if (!emp.userId) continue;
    try {
      const { rcUsername } = await ensureRcUser(emp.userId);
      members.push(rcUsername);
    } catch { /* skip failed provisions */ }
  }

  let roomId: string;
  try {
    const created = await rcRequest(serverUrl, 'POST', '/groups.create', {
      name: roomName,
      members,
      topic: `${dept.name} — department channel`,
    }, auth);
    roomId = created.group._id;
  } catch (err: any) {
    // Room may already exist — look it up
    if (String(err.message).includes('already')) {
      const info = await rcRequest(serverUrl, 'GET', `/groups.info?roomName=${encodeURIComponent(roomName)}`, undefined, auth);
      roomId = info.group._id;
      // Invite missing members
      for (const username of members) {
        try {
          const uinfo = await rcRequest(serverUrl, 'GET', `/users.info?username=${encodeURIComponent(username)}`, undefined, auth);
          await rcRequest(serverUrl, 'POST', '/groups.invite', { roomId, userId: uinfo.user._id }, auth).catch(() => {});
        } catch { /* skip */ }
      }
    } else {
      throw err;
    }
  }

  await prisma.chatChannelMap.create({
    data: { departmentId, rcRoomId: roomId!, rcRoomName: roomName, roomType: 'private', purpose: 'department' },
  });
  return { rcRoomId: roomId!, rcRoomName: roomName };
}

/** Ensure the company-wide announcements channel exists. */
export async function ensureAnnouncementsChannel(): Promise<{ rcRoomId: string; rcRoomName: string }> {
  const existing = await prisma.chatChannelMap.findFirst({ where: { purpose: 'announcements' } });
  if (existing) return { rcRoomId: existing.rcRoomId, rcRoomName: existing.rcRoomName };

  const { serverUrl, auth } = await getAdminAuth();
  const roomName = 'announcements';

  let roomId: string;
  try {
    // Public read-only channel for company-wide announcements
    const created = await rcRequest(serverUrl, 'POST', '/channels.create', {
      name: roomName,
      readOnly: true,
      topic: 'Company-wide announcements from management',
    }, auth);
    roomId = created.channel._id;
  } catch (err: any) {
    if (String(err.message).includes('already')) {
      const info = await rcRequest(serverUrl, 'GET', `/channels.info?roomName=${encodeURIComponent(roomName)}`, undefined, auth);
      roomId = info.channel._id;
    } else {
      throw err;
    }
  }

  await prisma.chatChannelMap.create({
    data: { departmentId: null, rcRoomId: roomId!, rcRoomName: roomName, roomType: 'public', purpose: 'announcements' },
  });
  return { rcRoomId: roomId!, rcRoomName: roomName };
}

/** Post a company-wide announcement. */
export async function postAnnouncement(title: string, body: string, publishedById: string): Promise<{ rcMessageId: string }> {
  const { serverUrl, auth } = await getAdminAuth();
  const { rcRoomId } = await ensureAnnouncementsChannel();

  const text = `*${title}*\n\n${body}`;
  const sent = await rcRequest(serverUrl, 'POST', '/chat.postMessage', {
    roomId: rcRoomId,
    text,
  }, auth);

  const announcement = await prisma.chatAnnouncement.create({
    data: { title, body, rcMessageId: sent.message?._id ?? null, publishedById },
  });
  return { rcMessageId: announcement.rcMessageId ?? '' };
}

/** Deactivate a user's Rocket.Chat account (on ERP deactivation). */
export async function deactivateRcUser(erpUserId: string): Promise<void> {
  const mapped = await prisma.chatUserMap.findUnique({ where: { erpUserId } });
  if (!mapped) return;
  const { serverUrl, auth } = await getAdminAuth();
  await rcRequest(serverUrl, 'POST', '/users.setActive', { userId: mapped.rcUserId, active: false }, auth).catch(() => {});
}

/** Test the Rocket.Chat server connection. */
export async function testConnection(serverUrl: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/info`);
    const data = await res.json();
    if (data.success) return { ok: true, version: data.info?.version };
    return { ok: false, error: 'Server responded but API is not available.' };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
