import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { effectiveScheduleStatus, refreshPestAlerts, treatmentEffectiveness } from './service';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

/** Date-only input (YYYY-MM-DD). Uses the codebase's coerce pattern so the
 *  schema stays compatible with validateQuery/validateBody's ZodSchema<T>. */
const dateOnly = z.coerce
  .date()
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

// ─── Inspection scheduling ─────────────────────────────────────────

const scheduleListQuerySchema = z.object({
  // SCHEDULED | DONE | CANCELLED | OVERDUE (OVERDUE is derived, not stored)
  status: z.enum(['SCHEDULED', 'DONE', 'CANCELLED', 'OVERDUE']).optional(),
  area: z.string().min(1).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>;

const scheduleCreateSchema = z.object({
  area: z.string().min(1).max(100),
  scheduledDate: dateOnly,
  frequency: z.enum(['WEEKLY', 'MONTHLY']),
  inspector: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;

const scheduleUpdateSchema = z.object({
  area: z.string().min(1).max(100).optional(),
  scheduledDate: dateOnly.optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY']).optional(),
  inspector: z.string().max(200).optional().nullable(),
  status: z.enum(['SCHEDULED', 'DONE', 'CANCELLED']).optional(),
  notes: z.string().max(2000).optional().nullable(),
});
type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;

router.get(
  '/schedules',
  requirePermission('pest:view'),
  validateQuery(scheduleListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ScheduleListQuery;
      const where: Prisma.PestScheduleEntryWhereInput = { area: q.area };
      if (q.status !== undefined && q.status !== 'OVERDUE') where.status = q.status;
      if (q.from !== undefined || q.to !== undefined) {
        where.scheduledDate = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const rows = await prisma.pestScheduleEntry.findMany({
        where,
        orderBy: [{ scheduledDate: 'asc' }],
      });
      const withEffective = rows.map((r) => ({ ...r, effectiveStatus: effectiveScheduleStatus(r) }));
      res.json(
        q.status === 'OVERDUE'
          ? withEffective.filter((r) => r.effectiveStatus === 'OVERDUE')
          : withEffective,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/schedules',
  requirePermission('pest:manage'),
  validateBody(scheduleCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ScheduleCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.pestScheduleEntry.create({
          data: {
            area: b.area,
            scheduledDate: b.scheduledDate,
            frequency: b.frequency,
            inspector: b.inspector ?? null,
            notes: b.notes ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'PestScheduleEntry',
          entityId: created.id,
          changes: { area: b.area, scheduledDate: b.scheduledDate, frequency: b.frequency },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/schedules/:id',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  validateBody(scheduleUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as ScheduleUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestScheduleEntry.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest schedule entry not found');
        const saved = await tx.pestScheduleEntry.update({
          where: { id },
          data: {
            area: b.area,
            scheduledDate: b.scheduledDate,
            frequency: b.frequency,
            inspector: b.inspector === undefined ? undefined : (b.inspector ?? null),
            status: b.status,
            completedAt: b.status === 'DONE' ? new Date() : undefined,
            notes: b.notes === undefined ? undefined : (b.notes ?? null),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'PestScheduleEntry',
          entityId: id,
          changes: b,
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/schedules/:id/done',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestScheduleEntry.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest schedule entry not found');
        const saved = await tx.pestScheduleEntry.update({
          where: { id },
          data: { status: 'DONE', completedAt: new Date() },
        });
        await audit(tx, {
          userId,
          action: 'COMPLETE',
          entityType: 'PestScheduleEntry',
          entityId: id,
          changes: { area: existing.area, scheduledDate: existing.scheduledDate },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── High-risk area inspections ────────────────────────────────────

const riskListQuerySchema = z.object({
  area: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  overallPass: z.enum(['true', 'false']).optional(),
});
type RiskListQuery = z.infer<typeof riskListQuerySchema>;

const checkpointSchema = z.object({
  checkpoint: z.string().min(1).max(200),
  category: z.enum(['BAIT_STATION', 'ENTRY_POINT', 'GENERAL']),
  result: z.enum(['PASS', 'FAIL']),
  notes: z.string().max(1000).optional().nullable(),
});

const riskCreateSchema = z.object({
  area: z.string().min(1).max(100),
  inspectedAt: z.coerce.date().optional(),
  inspector: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  checkpoints: z.array(checkpointSchema).min(1),
});
type RiskCreateInput = z.infer<typeof riskCreateSchema>;

router.get(
  '/risk-inspections',
  requirePermission('pest:view'),
  validateQuery(riskListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as RiskListQuery;
      const where: Prisma.PestRiskInspectionWhereInput = { area: q.area };
      if (q.overallPass !== undefined) where.overallPass = q.overallPass === 'true';
      if (q.from !== undefined || q.to !== undefined) {
        where.inspectedAt = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const rows = await prisma.pestRiskInspection.findMany({
        where,
        include: { checkpoints: { orderBy: { checkpoint: 'asc' } } },
        orderBy: { inspectedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/risk-inspections/:id',
  requirePermission('pest:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const row = await prisma.pestRiskInspection.findUnique({
        where: { id },
        include: { checkpoints: { orderBy: { checkpoint: 'asc' } } },
      });
      if (!row) throw new AppError(404, 'Risk area inspection not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/risk-inspections',
  requirePermission('pest:manage'),
  validateBody(riskCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as RiskCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.pestRiskInspection.create({
          data: {
            area: b.area,
            inspectedAt: b.inspectedAt ?? new Date(),
            inspector: b.inspector ?? null,
            notes: b.notes ?? null,
            overallPass: b.checkpoints.every((c) => c.result === 'PASS'),
            checkpoints: {
              create: b.checkpoints.map((c) => ({
                checkpoint: c.checkpoint,
                category: c.category,
                result: c.result,
                notes: c.notes ?? null,
              })),
            },
          },
          include: { checkpoints: true },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'PestRiskInspection',
          entityId: created.id,
          changes: {
            area: b.area,
            checkpointCount: b.checkpoints.length,
            overallPass: created.overallPass,
          },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pest evidence & treatment records ─────────────────────────────

const evidenceListQuerySchema = z.object({
  pestType: z.enum(['RODENT', 'INSECT', 'TERMITE', 'BIRD']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'CLEARED']).optional(),
  location: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type EvidenceListQuery = z.infer<typeof evidenceListQuerySchema>;

const evidenceCreateSchema = z.object({
  pestType: z.enum(['RODENT', 'INSECT', 'TERMITE', 'BIRD']),
  location: z.string().min(1).max(200),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  observedAt: z.coerce.date().optional(),
  description: z.string().max(2000).optional().nullable(),
  treatment: z.enum(['TRAP', 'BAIT', 'SPRAY', 'FUMIGATION']).optional().nullable(),
  chemical: z.string().max(200).optional().nullable(),
  dosage: z.string().max(200).optional().nullable(),
  treatedAt: z.coerce.date().optional().nullable(),
  applicator: z.string().max(200).optional().nullable(),
});
type EvidenceCreateInput = z.infer<typeof evidenceCreateSchema>;

const evidenceUpdateSchema = evidenceCreateSchema.partial();
type EvidenceUpdateInput = z.infer<typeof evidenceUpdateSchema>;

router.get(
  '/evidence',
  requirePermission('pest:view'),
  validateQuery(evidenceListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as EvidenceListQuery;
      const where: Prisma.PestEvidenceRecordWhereInput = {
        pestType: q.pestType,
        severity: q.severity,
        status: q.status,
        location: q.location,
      };
      if (q.from !== undefined || q.to !== undefined) {
        where.observedAt = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const rows = await prisma.pestEvidenceRecord.findMany({
        where,
        include: { followUps: { orderBy: { dueDate: 'asc' } } },
        orderBy: { observedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/evidence',
  requirePermission('pest:manage'),
  validateBody(evidenceCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as EvidenceCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.pestEvidenceRecord.create({
          data: {
            pestType: b.pestType,
            location: b.location,
            severity: b.severity,
            observedAt: b.observedAt ?? new Date(),
            description: b.description ?? null,
            treatment: b.treatment ?? null,
            chemical: b.chemical ?? null,
            dosage: b.dosage ?? null,
            treatedAt: b.treatedAt ?? null,
            applicator: b.applicator ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'PestEvidenceRecord',
          entityId: created.id,
          changes: { pestType: b.pestType, location: b.location, severity: b.severity },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/evidence/:id',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  validateBody(evidenceUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as EvidenceUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestEvidenceRecord.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest evidence record not found');
        const saved = await tx.pestEvidenceRecord.update({
          where: { id },
          data: {
            pestType: b.pestType,
            location: b.location,
            severity: b.severity,
            observedAt: b.observedAt,
            description: b.description === undefined ? undefined : (b.description ?? null),
            treatment: b.treatment === undefined ? undefined : (b.treatment ?? null),
            chemical: b.chemical === undefined ? undefined : (b.chemical ?? null),
            dosage: b.dosage === undefined ? undefined : (b.dosage ?? null),
            treatedAt: b.treatedAt === undefined ? undefined : (b.treatedAt ?? null),
            applicator: b.applicator === undefined ? undefined : (b.applicator ?? null),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'PestEvidenceRecord',
          entityId: id,
          changes: b,
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/evidence/:id/clear',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestEvidenceRecord.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest evidence record not found');
        const saved = await tx.pestEvidenceRecord.update({
          where: { id },
          data: { status: 'CLEARED', clearedAt: new Date() },
        });
        await audit(tx, {
          userId,
          action: 'CLEAR',
          entityType: 'PestEvidenceRecord',
          entityId: id,
          changes: { pestType: existing.pestType, location: existing.location },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Follow-up inspection tracking ─────────────────────────────────

const followUpListQuerySchema = z.object({
  status: z.enum(['PENDING', 'DONE']).optional(),
  result: z.enum(['CLEARED', 'PERSISTENT', 'ESCALATED']).optional(),
  dueBefore: dateOnly.optional(),
  evidenceId: z.string().min(1).optional(),
});
type FollowUpListQuery = z.infer<typeof followUpListQuerySchema>;

const followUpCreateSchema = z.object({
  evidenceId: z.string().min(1),
  dueDate: dateOnly,
  inspector: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
type FollowUpCreateInput = z.infer<typeof followUpCreateSchema>;

const followUpResultSchema = z.object({
  result: z.enum(['CLEARED', 'PERSISTENT', 'ESCALATED']),
  inspector: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
type FollowUpResultInput = z.infer<typeof followUpResultSchema>;

router.get(
  '/follow-ups',
  requirePermission('pest:view'),
  validateQuery(followUpListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as FollowUpListQuery;
      const rows = await prisma.pestFollowUp.findMany({
        where: {
          status: q.status,
          result: q.result,
          evidenceId: q.evidenceId,
          dueDate: q.dueBefore !== undefined ? { lte: q.dueBefore } : undefined,
        },
        include: { evidence: true },
        orderBy: { dueDate: 'asc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/follow-ups',
  requirePermission('pest:manage'),
  validateBody(followUpCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as FollowUpCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const evidence = await tx.pestEvidenceRecord.findUnique({ where: { id: b.evidenceId } });
        if (!evidence) throw new AppError(404, 'Pest evidence record not found');
        const created = await tx.pestFollowUp.create({
          data: {
            evidenceId: b.evidenceId,
            dueDate: b.dueDate,
            inspector: b.inspector ?? null,
            notes: b.notes ?? null,
          },
          include: { evidence: true },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'PestFollowUp',
          entityId: created.id,
          changes: { evidenceId: b.evidenceId, dueDate: b.dueDate },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/follow-ups/:id/result',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  validateBody(followUpResultSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as FollowUpResultInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestFollowUp.findUnique({
          where: { id },
          include: { evidence: true },
        });
        if (!existing) throw new AppError(404, 'Follow-up not found');
        const saved = await tx.pestFollowUp.update({
          where: { id },
          data: {
            status: 'DONE',
            result: b.result,
            inspector: b.inspector ?? existing.inspector,
            notes: b.notes === undefined ? existing.notes : (b.notes ?? null),
            completedAt: new Date(),
          },
          include: { evidence: true },
        });
        if (b.result === 'CLEARED') {
          await tx.pestEvidenceRecord.update({
            where: { id: existing.evidenceId },
            data: { status: 'CLEARED', clearedAt: new Date() },
          });
        }
        await audit(tx, {
          userId,
          action: 'FOLLOWUP_RESULT',
          entityType: 'PestFollowUp',
          entityId: id,
          changes: { result: b.result, evidenceId: existing.evidenceId },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/follow-ups/:id/escalate',
  requirePermission('pest:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestFollowUp.findUnique({
          where: { id },
          include: { evidence: true },
        });
        if (!existing) throw new AppError(404, 'Follow-up not found');
        const saved = await tx.pestFollowUp.update({
          where: { id },
          data: { result: 'ESCALATED', escalatedAt: new Date() },
          include: { evidence: true },
        });
        await tx.pestAlert.create({
          data: {
            type: 'PERSISTENT_INFESTATION',
            severity: 'CRITICAL',
            message:
              `Escalated: persistent ${existing.evidence.pestType.toLowerCase()} infestation ` +
              `at "${existing.evidence.location}" requires senior review.`,
            refType: 'PestEvidenceRecord',
            refId: existing.evidenceId,
          },
        });
        await audit(tx, {
          userId,
          action: 'ESCALATE',
          entityType: 'PestFollowUp',
          entityId: id,
          changes: { evidenceId: existing.evidenceId },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pest control alerts ───────────────────────────────────────────

const alertsListQuerySchema = z.object({
  acknowledged: z.enum(['true', 'false']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
});
type AlertsListQuery = z.infer<typeof alertsListQuerySchema>;

router.get(
  '/alerts',
  requirePermission('pest:view'),
  validateQuery(alertsListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as AlertsListQuery;
      const rows = await prisma.pestAlert.findMany({
        where: {
          acknowledged: q.acknowledged === undefined ? undefined : q.acknowledged === 'true',
          severity: q.severity,
        },
        orderBy: [{ acknowledged: 'asc' }, { createdAt: 'desc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/alerts/refresh',
  requirePermission('pest:manage'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const created = await refreshPestAlerts();
      res.json({ created });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/alerts/:id/acknowledge',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestAlert.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest alert not found');
        const saved = await tx.pestAlert.update({
          where: { id },
          data: {
            acknowledged: true,
            acknowledgedBy: userId,
            acknowledgedAt: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'ACKNOWLEDGE',
          entityType: 'PestAlert',
          entityId: id,
          changes: { type: existing.type },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pest control reports ──────────────────────────────────────────

const reportQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
type ReportQuery = z.infer<typeof reportQuerySchema>;

router.get(
  '/reports/inspections',
  requirePermission('pest:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ReportQuery;
      const [schedules, riskInspections] = await Promise.all([
        prisma.pestScheduleEntry.findMany({
          where: {
            scheduledDate: {
              ...(q.from !== undefined ? { gte: q.from } : {}),
              ...(q.to !== undefined ? { lte: q.to } : {}),
            },
          },
        }),
        prisma.pestRiskInspection.findMany({
          where: {
            inspectedAt: {
              ...(q.from !== undefined ? { gte: q.from } : {}),
              ...(q.to !== undefined ? { lte: q.to } : {}),
            },
          },
          include: { _count: { select: { checkpoints: true } }, checkpoints: true },
        }),
      ]);

      const byArea = new Map<string, { scheduled: number; done: number; overdue: number }>();
      for (const s of schedules) {
        const eff = effectiveScheduleStatus(s);
        const bucket = byArea.get(s.area) ?? { scheduled: 0, done: 0, overdue: 0 };
        bucket.scheduled += 1;
        if (eff === 'DONE') bucket.done += 1;
        if (eff === 'OVERDUE') bucket.overdue += 1;
        byArea.set(s.area, bucket);
      }

      const byMonth = new Map<string, { scheduled: number; done: number }>();
      for (const s of schedules) {
        const key = s.scheduledDate.toISOString().slice(0, 7);
        const bucket = byMonth.get(key) ?? { scheduled: 0, done: 0 };
        bucket.scheduled += 1;
        if (effectiveScheduleStatus(s) === 'DONE') bucket.done += 1;
        byMonth.set(key, bucket);
      }

      const riskByArea = new Map<string, { inspections: number; passed: number; failed: number }>();
      for (const r of riskInspections) {
        const bucket = riskByArea.get(r.area) ?? { inspections: 0, passed: 0, failed: 0 };
        bucket.inspections += 1;
        if (r.overallPass) bucket.passed += 1;
        else bucket.failed += 1;
        riskByArea.set(r.area, bucket);
      }

      res.json({
        byArea: [...byArea.entries()].map(([area, v]) => ({ area, ...v })),
        byMonth: [...byMonth.entries()]
          .map(([month, v]) => ({ month, ...v }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        riskByArea: [...riskByArea.entries()].map(([area, v]) => ({ area, ...v })),
        totals: {
          schedules: schedules.length,
          riskInspections: riskInspections.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/evidence',
  requirePermission('pest:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ReportQuery;
      const where: Prisma.PestEvidenceRecordWhereInput = {
        observedAt: {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        },
      };
      const [byType, bySeverity, byLocation] = await Promise.all([
        prisma.pestEvidenceRecord.groupBy({
          by: ['pestType'],
          where,
          _count: { _all: true },
          orderBy: { _count: { pestType: 'desc' } },
        }),
        prisma.pestEvidenceRecord.groupBy({
          by: ['severity'],
          where,
          _count: { _all: true },
        }),
        prisma.pestEvidenceRecord.groupBy({
          by: ['location'],
          where,
          _count: { _all: true },
          orderBy: { _count: { location: 'desc' } },
          take: 10,
        }),
      ]);
      res.json({
        byPestType: byType.map((r) => ({ pestType: r.pestType, count: r._count._all })),
        bySeverity: bySeverity.map((r) => ({ severity: r.severity, count: r._count._all })),
        byLocation: byLocation.map((r) => ({ location: r.location, count: r._count._all })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/treatment-effectiveness',
  requirePermission('pest:view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await treatmentEffectiveness());
    } catch (err) {
      next(err);
    }
  },
);
