// SMS module router — mounted at /api/v1/sms (authenticated).
// AfroMessage delivery-status webhook is a separate PUBLIC router below,
// mounted at /api/v1/webhooks.
import { Router } from 'express';
import { z } from 'zod';
import type { SmsStatus } from '@prisma/client';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';

export const router = Router();

const logsQuerySchema = z.object({
  status: z.enum(['QUEUED', 'SENT', 'FAILED', 'DELIVERED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/logs',
  requirePermission('sms:view'),
  validateQuery(logsQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as z.infer<typeof logsQuerySchema>;
      const logs = await prisma.smsLog.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.from || q.to
            ? {
                createdAt: {
                  ...(q.from ? { gte: q.from } : {}),
                  ...(q.to ? { lte: q.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

// ─── AfroMessage delivery-status webhook (PUBLIC — no auth) ──────────
// Mounted at /api/v1/webhooks by app.ts.

export const webhookRouter = Router();

const afromessageWebhookSchema = z.object({
  id: z.unknown().optional(),
  to: z.unknown().optional(),
  status: z.unknown().optional(),
});

webhookRouter.post(
  '/afromessage/status',
  validateBody(afromessageWebhookSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof afromessageWebhookSchema>;
      const rawStatus = String(body.status ?? '').toLowerCase();

      let newStatus: SmsStatus | null = null;
      if (rawStatus === 'delivered') {
        newStatus = 'DELIVERED';
      } else if (rawStatus === 'failed' || rawStatus === 'undelivered' || rawStatus === 'rejected') {
        newStatus = 'FAILED';
      } else if (rawStatus === 'sent' || rawStatus === 'submitted') {
        newStatus = 'SENT';
      }

      if (!newStatus) {
        res.status(400).json({ error: 'Unknown status' });
        return;
      }

      let log = null;
      if (body.id !== undefined && body.id !== null && String(body.id) !== '') {
        log = await prisma.smsLog.findFirst({ where: { providerId: String(body.id) } });
      }
      if (!log && body.to !== undefined && body.to !== null && String(body.to) !== '') {
        log = await prisma.smsLog.findFirst({
          where: { to: String(body.to), status: { in: ['QUEUED', 'SENT'] } },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (log) {
        await prisma.smsLog.update({ where: { id: log.id }, data: { status: newStatus } });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
