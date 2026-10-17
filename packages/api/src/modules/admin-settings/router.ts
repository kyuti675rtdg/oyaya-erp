// Module 18: System Administration & Settings router — mounted at /api/v1/settings.
// Covers: company profile, key/value system preferences (general, security
// policy, SMS/notification config, backup schedule), and webhook management.
// All routes are permission-guarded with settings:view / settings:manage.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { validateBody, validateParams } from '../../middleware/validate';
import { requirePermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function ah(fn: AsyncFn) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function requireUid(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new AppError(401, 'Unauthenticated');
  return id;
}

const view = requirePermission('settings:view');
const manage = requirePermission('settings:manage');

const idParam = z.object({ id: z.string().min(1) });

// ─── System preference defaults (Module 18) ──────────────────────────
// Keys not present in the SystemSetting table resolve to these defaults.
// Note: security lockout/session-timeout enforcement and TOTP MFA enrollment
// are not yet implemented in the auth module — these values configure policy
// that future auth updates will consume. The UI labels that honestly.

export const PREFERENCE_DEFAULTS: Record<string, string> = {
  // General preferences
  'prefs.timezone': 'Africa/Addis_Ababa',
  'prefs.dateFormat': 'DD/MM/YYYY',
  'prefs.numberFormat': '1,234.56',
  'prefs.language': 'en',
  'prefs.defaultPageSize': '25',
  // Password & session policy
  'security.minPasswordLength': '8',
  'security.requireUppercase': 'true',
  'security.requireLowercase': 'true',
  'security.requireDigit': 'true',
  'security.requireSymbol': 'false',
  'security.passwordExpiryDays': '90',
  'security.sessionTimeoutMin': '30',
  'security.maxLoginAttempts': '5',
  'security.lockoutMinutes': '15',
  // SMS / notifications (AfroMessage)
  'sms.provider': 'afromessage',
  'sms.afromessageToken': '',
  'sms.senderId': 'Oyaya',
  'sms.notify.intakeCreated': 'true',
  'sms.notify.qcFailed': 'true',
  'sms.notify.lowStock': 'true',
  'sms.notify.payrollRun': 'true',
  'sms.notify.maintenanceDue': 'false',
  // Backup & retention
  'backup.schedule': 'daily 02:00 EAT',
  'backup.retentionDays': '30',
  'backup.manualSupported': 'false',
};

const KNOWN_PREF_KEYS = new Set(Object.keys(PREFERENCE_DEFAULTS));

async function readPreferences(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...KNOWN_PREF_KEYS] } },
  });
  const out: Record<string, string> = { ...PREFERENCE_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

const companySchema = z.object({
  name: z.string().min(2).max(200),
  address: z.string().max(500).optional().nullable(),
  taxId: z.string().max(50).optional().nullable(),
  logoUrl: z.string().max(20000).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional().nullable(),
});

const preferencesSchema = z.record(z.string(), z.string().max(5000));

async function getOrCreateCompany() {
  let company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    company = await prisma.company.create({ data: { name: 'Oyaya Flour Production Company PLC' } });
  }
  return company;
}

// ─── Company profile ───────────────────────────────────────────────

router.get(
  '/company',
  view,
  ah(async (_req, res) => {
    res.json(await getOrCreateCompany());
  }),
);

router.put(
  '/company',
  manage,
  validateBody(companySchema),
  ah(async (req, res) => {
    const body = companySchema.parse(req.body);
    const uid = requireUid(req);
    const existing = await getOrCreateCompany();
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.company.update({ where: { id: existing.id }, data: body });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'CompanySettings',
        entityId: c.id,
        changes: body,
      });
      return c;
    });
    res.json(updated);
  }),
);

// ─── System preferences (key/value) ────────────────────────────────

router.get(
  '/preferences',
  view,
  ah(async (_req, res) => {
    res.json(await readPreferences());
  }),
);

router.put(
  '/preferences',
  manage,
  validateBody(preferencesSchema),
  ah(async (req, res) => {
    const body = preferencesSchema.parse(req.body);
    const uid = requireUid(req);
    const entries = Object.entries(body).filter(([k]) => KNOWN_PREF_KEYS.has(k));
    if (entries.length === 0) throw new AppError(400, 'No known preference keys provided');
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.systemSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
      }
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'SystemPreferences',
        entityId: 'preferences',
        changes: Object.fromEntries(entries),
      });
    });
    res.json(await readPreferences());
  }),
);

// ─── Backup status (honest: manual trigger not supported) ──────────

router.get(
  '/backup-status',
  view,
  ah(async (_req, res) => {
    const prefs = await readPreferences();
    res.json({
      schedule: prefs['backup.schedule'],
      retentionDays: Number(prefs['backup.retentionDays']),
      manualSupported: prefs['backup.manualSupported'] === 'true',
      message:
        'Automated database dumps run on the configured schedule. Manual on-demand backup is not yet supported by the backend — trigger a dump via the infrastructure workflow and upload it to the backups store.',
    });
  }),
);

// ─── Webhooks ──────────────────────────────────────────────────────

const webhookSchema = z.object({
  name: z.string().min(2).max(200),
  url: z.string().url().max(2000),
  events: z.array(z.string().min(1).max(120)).min(1).max(50),
  secret: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const webhookUpdateSchema = webhookSchema.partial();

export const WEBHOOK_EVENTS = [
  'intake.created',
  'intake.flagged',
  'qc.check.completed',
  'qc.threshold.breached',
  'production.batch.completed',
  'sales.order.created',
  'sales.invoice.issued',
  'payroll.run.completed',
  'user.created',
  'system.alert',
] as const;

router.get(
  '/webhooks',
  view,
  ah(async (_req, res) => {
    const hooks = await prisma.webhook.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { deliveries: true } },
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, createdAt: true },
        },
      },
    });
    res.json(
      hooks.map((h) => ({
        ...h,
        deliveryCount: h._count.deliveries,
        lastDelivery: h.deliveries[0] ?? null,
        deliveries: undefined,
        _count: undefined,
      })),
    );
  }),
);

router.post(
  '/webhooks',
  manage,
  validateBody(webhookSchema),
  ah(async (req, res) => {
    const body = webhookSchema.parse(req.body);
    const uid = requireUid(req);
    const hook = await prisma.$transaction(async (tx) => {
      const created = await tx.webhook.create({ data: { ...body, enabled: body.enabled ?? true } });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Webhook', entityId: created.id });
      return created;
    });
    res.status(201).json(hook);
  }),
);

router.patch(
  '/webhooks/:id',
  manage,
  validateParams(idParam),
  validateBody(webhookUpdateSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = webhookUpdateSchema.parse(req.body);
    const uid = requireUid(req);
    const hook = await prisma.$transaction(async (tx) => {
      const updated = await tx.webhook.update({ where: { id }, data: body });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'Webhook',
        entityId: id,
        changes: body,
      });
      return updated;
    });
    res.json(hook);
  }),
);

router.delete(
  '/webhooks/:id',
  manage,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    await prisma.$transaction(async (tx) => {
      await tx.webhook.delete({ where: { id } });
      await audit(tx, { userId: uid, action: 'DELETE', entityType: 'Webhook', entityId: id });
    });
    res.json({ ok: true });
  }),
);

router.get(
  '/webhooks/events',
  view,
  ah(async (_req, res) => {
    res.json([...WEBHOOK_EVENTS]);
  }),
);

router.get(
  '/webhooks/:id/deliveries',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(deliveries);
  }),
);

async function deliverToWebhook(
  webhookId: string,
  event: string,
  payload: Prisma.InputJsonValue,
): Promise<{ status: 'delivered' | 'failed'; httpStatus: number | null; responseBody: string | null; error: string | null }> {
  const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!hook) throw new AppError(404, 'Webhook not found');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let result: { status: 'delivered' | 'failed'; httpStatus: number | null; responseBody: string | null; error: string | null };
  try {
    const resp = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hook.secret ? { 'X-Webhook-Secret': hook.secret } : {}),
        'X-Webhook-Event': event,
      },
      body: JSON.stringify({ event, payload, sentAt: new Date().toISOString() }),
      signal: controller.signal,
    });
    const text = (await resp.text()).slice(0, 2000);
    result = {
      status: resp.ok ? 'delivered' : 'failed',
      httpStatus: resp.status,
      responseBody: text,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    };
  } catch (err) {
    result = {
      status: 'failed',
      httpStatus: null,
      responseBody: null,
      error: err instanceof Error ? err.message : 'Delivery failed',
    };
  } finally {
    clearTimeout(timer);
  }
  await prisma.webhookDelivery.create({
    data: {
      webhookId,
      event,
      payload,
      status: result.status,
      attempts: 1,
      httpStatus: result.httpStatus,
      responseBody: result.responseBody,
      error: result.error,
    },
  });
  return result;
}

router.post(
  '/webhooks/:id/test',
  manage,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    const result = await deliverToWebhook(id, 'system.alert', {
      message: 'Test event from Oyaya ERP webhook management',
      triggeredBy: uid,
    });
    await audit(prisma, {
      userId: uid,
      action: 'TEST',
      entityType: 'Webhook',
      entityId: id,
      changes: { status: result.status },
    });
    res.json(result);
  }),
);

router.post(
  '/webhooks/:id/deliveries/:deliveryId/retry',
  manage,
  validateParams(z.object({ id: z.string().min(1), deliveryId: z.string().min(1) })),
  ah(async (req, res) => {
    const { id, deliveryId } = z
      .object({ id: z.string().min(1), deliveryId: z.string().min(1) })
      .parse(req.params);
    const uid = requireUid(req);
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.webhookId !== id) throw new AppError(404, 'Delivery not found');
    const payload = (delivery.payload ?? { retried: true }) as Prisma.InputJsonValue;
    const result = await deliverToWebhook(id, delivery.event, payload);
    await audit(prisma, {
      userId: uid,
      action: 'RETRY',
      entityType: 'WebhookDelivery',
      entityId: deliveryId,
      changes: { status: result.status },
    });
    res.json(result);
  }),
);
