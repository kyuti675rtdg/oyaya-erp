// Rocket.Chat integration router — mounted at /api/v1/chat (authenticated).
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac';
import { validateBody } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import {
  getAdminAuth,
  ensureRcUser,
  generateUserToken,
  ensureDepartmentChannel,
  ensureAnnouncementsChannel,
  postAnnouncement,
  deactivateRcUser,
  testConnection,
} from './service';

export const router = Router();

// ─── Status & SSO ──────────────────────────────────────────────

// Get chat server status + SSO token for the current user
router.get('/status', requirePermission('chat:view'), async (req: any, res, next) => {
  try {
    const cfg = await prisma.chatConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!cfg || !cfg.isEnabled) {
      return res.json({ enabled: false });
    }
    // Generate SSO token for embedding
    const { serverUrl, resumeToken, rcUsername } = await generateUserToken(req.user.id);
    res.json({
      enabled: true,
      serverUrl,
      resumeToken,
      rcUsername,
      embedUrl: `${serverUrl.replace(/\/$/, '')}/home?resumeToken=${encodeURIComponent(resumeToken)}&layout=embedded`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: configuration ───────────────────────────────────────

const configSchema = z.object({
  serverUrl: z.string().url(),
  adminUsername: z.string().min(1),
  isEnabled: z.boolean().optional(),
});

router.get('/config', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    const cfg = await prisma.chatConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    res.json(
      cfg
        ? { serverUrl: cfg.serverUrl, adminUsername: cfg.adminUsername, isEnabled: cfg.isEnabled, updatedAt: cfg.updatedAt }
        : null
    );
  } catch (err) {
    next(err);
  }
});

router.post('/config', requirePermission('chat:manage'), validateBody(configSchema), async (req, res, next) => {
  try {
    const { serverUrl, adminUsername, isEnabled } = req.body as z.infer<typeof configSchema>;

    // Verify the server is reachable before saving
    const check = await testConnection(serverUrl);
    if (!check.ok) {
      return res.status(400).json({ error: `Cannot reach Rocket.Chat server: ${check.error}` });
    }

    const existing = await prisma.chatConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    const data = { serverUrl: serverUrl.replace(/\/$/, ''), adminUsername, isEnabled: isEnabled ?? true };
    const cfg = existing
      ? await prisma.chatConfig.update({ where: { id: existing.id }, data })
      : await prisma.chatConfig.create({ data });

    res.json({ serverUrl: cfg.serverUrl, adminUsername: cfg.adminUsername, isEnabled: cfg.isEnabled, version: check.version });
  } catch (err) {
    next(err);
  }
});

router.post('/test', requirePermission('chat:manage'), async (req, res, next) => {
  try {
    const { serverUrl } = req.body as { serverUrl?: string };
    const cfg = await prisma.chatConfig.findFirst({ orderBy: { createdAt: 'desc' } });
    const url = serverUrl || cfg?.serverUrl;
    if (!url) return res.status(400).json({ error: 'No server URL configured.' });
    const result = await testConnection(url);
    // Also verify admin login works
    if (result.ok) {
      try {
        await getAdminAuth();
        (result as any).adminAuth = true;
      } catch (e: any) {
        (result as any).adminAuth = false;
        (result as any).adminError = e.message;
      }
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Admin: user & channel sync ─────────────────────────────────

router.post('/sync/users', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true, name: true } });
    const results = { synced: 0, failed: 0, errors: [] as string[] };
    for (const u of users) {
      try {
        await ensureRcUser(u.id);
        results.synced++;
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${u.email}: ${e.message}`);
      }
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post('/sync/departments', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    const depts = await prisma.department.findMany({ where: { isActive: true } });
    const results = { synced: 0, failed: 0, errors: [] as string[] };
    for (const d of depts) {
      try {
        await ensureDepartmentChannel(d.id);
        results.synced++;
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${d.name}: ${e.message}`);
      }
    }
    // Also ensure announcements channel
    try {
      await ensureAnnouncementsChannel();
    } catch (e: any) {
      results.errors.push(`announcements: ${e.message}`);
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.get('/channels', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    const channels = await prisma.chatChannelMap.findMany({
      include: { department: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(channels);
  } catch (err) {
    next(err);
  }
});

router.get('/users', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    const maps = await prisma.chatUserMap.findMany({
      include: { erpUser: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(maps);
  } catch (err) {
    next(err);
  }
});

// ─── Announcements ─────────────────────────────────────────────

const announceSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

router.post('/announce', requirePermission('chat:approve'), validateBody(announceSchema), async (req: any, res, next) => {
  try {
    const { title, body } = req.body as z.infer<typeof announceSchema>;
    const result = await postAnnouncement(title, body, req.user.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/announcements', requirePermission('chat:view'), async (_req, res, next) => {
  try {
    const list = await prisma.chatAnnouncement.findMany({
      include: { publishedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ─── User deactivation hook (called from user management) ──────

router.post('/deactivate/:erpUserId', requirePermission('chat:manage'), async (req, res, next) => {
  try {
    await deactivateRcUser(req.params.erpUserId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
