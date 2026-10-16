import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── List all integrations with latest status ────────────────────────
router.get(
  '/',
  requirePermission('settings:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const integrations = await prisma.apiIntegration.findMany({
        orderBy: { name: 'asc' },
        include: {
          healthLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      res.json(integrations);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Get health history for an integration ───────────────────────────
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  '/:id/health',
  requirePermission('settings:view'),
  validateParams(idParamSchema),
  validateQuery(historyQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const q = req.query as unknown as { limit: number };
      const logs = await prisma.apiHealthLog.findMany({
        where: { integrationId: id },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      res.json(logs);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Create integration ──────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['sms', 'biometric', 'webhook', 'custom']),
  baseUrl: z.string().url().max(500).optional().nullable(),
  config: z.record(z.unknown()).optional().nullable(),
  enabled: z.boolean().default(true),
});

router.post(
  '/',
  requirePermission('settings:manage'),
  validateBody(createSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const created = await prisma.apiIntegration.create({
        data: req.body as unknown as Parameters<typeof prisma.apiIntegration.create>[0]['data'],
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'ApiIntegration', entityId: created.id, changes: { name: created.name } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Update integration ──────────────────────────────────────────────
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().max(500).optional().nullable(),
  config: z.record(z.unknown()).optional().nullable(),
  enabled: z.boolean().optional(),
});

router.patch(
  '/:id',
  requirePermission('settings:manage'),
  validateParams(idParamSchema),
  validateBody(updateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.apiIntegration.update({
        where: { id },
        data: req.body as unknown as Parameters<typeof prisma.apiIntegration.update>[0]['data'],
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'ApiIntegration', entityId: id, changes: req.body });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Manual health check ─────────────────────────────────────────────
// Pings the integration's baseUrl and records the result.
router.post(
  '/:id/check',
  requirePermission('settings:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const integration = await prisma.apiIntegration.findUnique({ where: { id } });
      if (!integration) throw new AppError(404, 'Integration not found');

      const started = Date.now();
      let status = 'offline';
      let message: string | null = null;
      let latencyMs: number | null = null;

      if (integration.baseUrl) {
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 10000);
          const resp = await fetch(integration.baseUrl, {
            method: 'HEAD',
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          latencyMs = Date.now() - started;
          status = resp.ok ? 'online' : 'degraded';
          message = `HTTP ${resp.status}`;
        } catch (e) {
          latencyMs = Date.now() - started;
          message = e instanceof Error ? e.message : 'Connection failed';
        }
      } else {
        message = 'No URL configured';
      }

      // Record health log
      await prisma.apiHealthLog.create({
        data: { integrationId: id, status, latencyMs, message },
      });

      // Update integration status + rolling uptime
      const recent = await prisma.apiHealthLog.findMany({
        where: { integrationId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { status: true },
      });
      const onlineCount = recent.filter((r) => r.status === 'online').length;
      const uptimePct = recent.length > 0 ? (onlineCount / recent.length) * 100 : null;

      const updated = await prisma.apiIntegration.update({
        where: { id },
        data: { status, lastCheckedAt: new Date(), latencyMs, uptimePct },
      });

      await audit(prisma, { userId: uid, action: 'HEALTH_CHECK', entityType: 'ApiIntegration', entityId: id, changes: { status, latencyMs } });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Delete integration ──────────────────────────────────────────────
router.delete(
  '/:id',
  requirePermission('settings:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.apiIntegration.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'ApiIntegration', entityId: id });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);
