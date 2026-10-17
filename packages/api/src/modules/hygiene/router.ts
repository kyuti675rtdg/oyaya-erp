import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { CleaningGrade } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── Equipment cleaning ──────────────────────────────────────────

const equipmentCleaningListQuerySchema = z.object({
  checkMonth: z.coerce.date().optional(),
  section: z.string().min(1).optional(),
});
type EquipmentCleaningListQuery = z.infer<typeof equipmentCleaningListQuerySchema>;

const equipmentCleaningCreateSchema = z.object({
  checkMonth: z.coerce.date(),
  section: z.string().min(1).max(100),
  equipment: z.string().min(1).max(200),
  grade: z.nativeEnum(CleaningGrade),
  nonconformity: z.string().max(2000).optional().nullable(),
  actionTaken: z.string().max(2000).optional().nullable(),
});
type EquipmentCleaningCreateInput = z.infer<typeof equipmentCleaningCreateSchema>;

const equipmentCleaningUpdateSchema = equipmentCleaningCreateSchema.partial();
type EquipmentCleaningUpdateInput = z.infer<typeof equipmentCleaningUpdateSchema>;

router.get(
  '/equipment-cleaning',
  requirePermission('hygiene:view'),
  validateQuery(equipmentCleaningListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as EquipmentCleaningListQuery;
      const rows = await prisma.equipmentCleaning.findMany({
        where: { checkMonth: q.checkMonth, section: q.section },
        orderBy: [{ checkMonth: 'desc' }, { section: 'asc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/equipment-cleaning',
  requirePermission('hygiene:manage'),
  validateBody(equipmentCleaningCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as EquipmentCleaningCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.equipmentCleaning.create({
          data: {
            checkMonth: b.checkMonth,
            section: b.section,
            equipment: b.equipment,
            grade: b.grade,
            nonconformity: b.nonconformity ?? null,
            actionTaken: b.actionTaken ?? null,
            checkedById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'EquipmentCleaning',
          entityId: created.id,
          changes: { checkMonth: b.checkMonth, section: b.section, equipment: b.equipment },
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
  '/equipment-cleaning/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(equipmentCleaningUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as EquipmentCleaningUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.equipmentCleaning.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Equipment cleaning record not found');
        const saved = await tx.equipmentCleaning.update({
          where: { id },
          data: {
            checkMonth: b.checkMonth,
            section: b.section,
            equipment: b.equipment,
            grade: b.grade,
            nonconformity: b.nonconformity === undefined ? undefined : (b.nonconformity ?? null),
            actionTaken: b.actionTaken === undefined ? undefined : (b.actionTaken ?? null),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'EquipmentCleaning',
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

// ─── Daily cleaning reports ──────────────────────────────────────

const dailyCleaningListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  area: z.string().min(1).optional(),
});
type DailyCleaningListQuery = z.infer<typeof dailyCleaningListQuerySchema>;

const dailyCleaningCreateSchema = z.object({
  reportDate: z.coerce.date(),
  area: z.string().min(1).max(100),
  dryCleaned: z.boolean().optional(),
  wetCleaned: z.boolean().optional(),
  janitor: z.string().max(200).optional().nullable(),
  overallStatus: z.string().max(200).optional().nullable(),
  supervisorSign: z.string().max(200).optional().nullable(),
  qualitySign: z.string().max(200).optional().nullable(),
});
type DailyCleaningCreateInput = z.infer<typeof dailyCleaningCreateSchema>;

router.get(
  '/daily-cleaning',
  requirePermission('hygiene:view'),
  validateQuery(dailyCleaningListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as DailyCleaningListQuery;
      const where: Prisma.DailyCleaningReportWhereInput = { area: q.area };
      if (q.from !== undefined || q.to !== undefined) {
        where.reportDate = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const reports = await prisma.dailyCleaningReport.findMany({
        where,
        orderBy: { reportDate: 'desc' },
      });
      res.json(reports);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/daily-cleaning',
  requirePermission('hygiene:manage'),
  validateBody(dailyCleaningCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as DailyCleaningCreateInput;
      const report = await prisma.$transaction(async (tx) => {
        const created = await tx.dailyCleaningReport.create({
          data: {
            reportDate: b.reportDate,
            area: b.area,
            dryCleaned: b.dryCleaned ?? false,
            wetCleaned: b.wetCleaned ?? false,
            janitor: b.janitor ?? null,
            overallStatus: b.overallStatus ?? null,
            supervisorSign: b.supervisorSign ?? null,
            qualitySign: b.qualitySign ?? null,
            createdById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'DailyCleaningReport',
          entityId: created.id,
          changes: { reportDate: b.reportDate, area: b.area },
        });
        return created;
      });
      res.status(201).json(report);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Pest inspections ────────────────────────────────────────────

const pestListQuerySchema = z.object({
  followUpPending: z.enum(['true', 'false']).optional(),
});
type PestListQuery = z.infer<typeof pestListQuerySchema>;

const pestCreateSchema = z.object({
  area: z.string().min(1).max(100),
  signsObserved: z.string().max(2000).optional().nullable(),
  evidenceFound: z.string().max(2000).optional().nullable(),
  correctiveAction: z.string().max(2000).optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
  inspectorId: z.string().min(1).optional().nullable(),
});
type PestCreateInput = z.infer<typeof pestCreateSchema>;

const pestUpdateSchema = z.object({
  followUpDone: z.boolean().optional(),
  correctiveAction: z.string().max(2000).optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
});
type PestUpdateInput = z.infer<typeof pestUpdateSchema>;

router.get(
  '/pest',
  requirePermission('hygiene:view'),
  validateQuery(pestListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as PestListQuery;
      const where: Prisma.PestInspectionWhereInput =
        q.followUpPending === undefined
          ? {}
          : q.followUpPending === 'true'
            ? { followUpDone: false, followUpDate: { not: null } }
            : { followUpDone: true };
      const inspections = await prisma.pestInspection.findMany({
        where,
        orderBy: { inspectedAt: 'desc' },
      });
      res.json(inspections);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/pest',
  requirePermission('pest:manage'),
  validateBody(pestCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as PestCreateInput;
      const inspection = await prisma.$transaction(async (tx) => {
        const created = await tx.pestInspection.create({
          data: {
            area: b.area,
            signsObserved: b.signsObserved ?? null,
            evidenceFound: b.evidenceFound ?? null,
            correctiveAction: b.correctiveAction ?? null,
            followUpDate: b.followUpDate ?? null,
            inspectorId: b.inspectorId ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'PestInspection',
          entityId: created.id,
          changes: { area: b.area, followUpDate: b.followUpDate ?? null },
        });
        return created;
      });
      res.status(201).json(inspection);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/pest/:id',
  requirePermission('pest:manage'),
  validateParams(idParamSchema),
  validateBody(pestUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as PestUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.pestInspection.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Pest inspection not found');
        const saved = await tx.pestInspection.update({
          where: { id },
          data: {
            followUpDone: b.followUpDone,
            correctiveAction:
              b.correctiveAction === undefined ? undefined : (b.correctiveAction ?? null),
            followUpDate: b.followUpDate === undefined ? undefined : (b.followUpDate ?? null),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'PestInspection',
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

// ═══════════════════════════════════════════════════════════════
// Module 7 — Sanitation & Hygiene Management (new sub-modules)
// NOTE: the Prisma models below live in /tmp/schema-module7.prisma and are
// merged by the coordinator; until `prisma generate` runs they are reached
// through an untyped cast so tsc stays clean.
const dbm = prisma as unknown as Record<string, any>;

// ─── 1. Equipment cleaning checklist templates ───────────────────

const FREQUENCIES = ['PER_SHIFT', 'DAILY', 'WEEKLY'] as const;

const checklistListQuerySchema = z.object({
  equipment: z.string().min(1).optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
});
type ChecklistListQuery = z.infer<typeof checklistListQuerySchema>;

const checklistItemInputSchema = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).optional().nullable(),
});
type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

const checklistCreateSchema = z.object({
  name: z.string().min(1).max(200),
  equipment: z.string().min(1).max(200),
  area: z.string().max(100).optional().nullable(),
  frequency: z.enum(FREQUENCIES),
  assignedTo: z.string().max(200).optional().nullable(),
  items: z.array(checklistItemInputSchema).min(1).max(100),
});
type ChecklistCreateInput = z.infer<typeof checklistCreateSchema>;

const checklistUpdateSchema = checklistCreateSchema
  .partial()
  .omit({ items: true })
  .extend({ isActive: z.boolean().optional() });
type ChecklistUpdateInput = z.infer<typeof checklistUpdateSchema>;

router.get(
  '/checklists',
  requirePermission('hygiene:view'),
  validateQuery(checklistListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ChecklistListQuery;
      const where: Record<string, unknown> = {
        ...(q.equipment ? { equipment: q.equipment } : {}),
        ...(q.frequency ? { frequency: q.frequency } : {}),
        ...(q.activeOnly === 'false' ? {} : { isActive: true }),
      };
      const rows = await dbm.cleaningChecklistTemplate.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: [{ equipment: 'asc' }, { name: 'asc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/checklists',
  requirePermission('hygiene:manage'),
  validateBody(checklistCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ChecklistCreateInput;
      const created = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const template = await t.cleaningChecklistTemplate.create({
          data: {
            name: b.name,
            equipment: b.equipment,
            area: b.area ?? null,
            frequency: b.frequency,
            assignedTo: b.assignedTo ?? null,
            createdById: userId,
            items: {
              create: b.items.map((it, i) => ({
                title: it.title,
                detail: it.detail ?? null,
                sortOrder: i,
              })),
            },
          },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'CleaningChecklistTemplate',
          entityId: template.id,
          changes: { name: b.name, equipment: b.equipment, frequency: b.frequency },
        });
        return template;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/checklists/:id',
  requirePermission('hygiene:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const row = await dbm.cleaningChecklistTemplate.findUnique({
        where: { id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!row) throw new AppError(404, 'Checklist template not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/checklists/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(checklistUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as ChecklistUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.cleaningChecklistTemplate.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Checklist template not found');
        const saved = await t.cleaningChecklistTemplate.update({
          where: { id },
          data: {
            name: b.name,
            equipment: b.equipment,
            area: b.area === undefined ? undefined : (b.area ?? null),
            frequency: b.frequency,
            assignedTo: b.assignedTo === undefined ? undefined : (b.assignedTo ?? null),
            isActive: b.isActive,
          },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        await audit(tx, { userId, action: 'UPDATE', entityType: 'CleaningChecklistTemplate', entityId: id, changes: b });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/checklists/:id/items',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(z.object({ items: z.array(checklistItemInputSchema).min(1).max(100) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { items } = req.body as { items: ChecklistItemInput[] };
      const saved = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.cleaningChecklistTemplate.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Checklist template not found');
        await t.checklistTaskItem.deleteMany({ where: { templateId: id } });
        const template = await t.cleaningChecklistTemplate.update({
          where: { id },
          data: {
            items: {
              create: items.map((it, i) => ({
                title: it.title,
                detail: it.detail ?? null,
                sortOrder: i,
              })),
            },
          },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'CleaningChecklistTemplate',
          entityId: id,
          changes: { itemsReplaced: items.length },
        });
        return template;
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/checklists/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const deactivated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.cleaningChecklistTemplate.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Checklist template not found');
        const saved = await t.cleaningChecklistTemplate.update({ where: { id }, data: { isActive: false } });
        await audit(tx, { userId, action: 'DEACTIVATE', entityType: 'CleaningChecklistTemplate', entityId: id });
        return saved;
      });
      res.json(deactivated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── 2. Production area cleaning log ─────────────────────────────

const CLEANING_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'DONE'] as const;

const areaCleaningListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  area: z.string().min(1).optional(),
  status: z.enum(CLEANING_STATUSES).optional(),
  overdue: z.enum(['true']).optional(),
});
type AreaCleaningListQuery = z.infer<typeof areaCleaningListQuerySchema>;

const areaCleaningCreateSchema = z.object({
  area: z.string().min(1).max(100),
  logDate: z.coerce.date(),
  shift: z.string().min(1).max(30),
  cleaner: z.string().min(1).max(200),
  templateId: z.string().min(1).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
type AreaCleaningCreateInput = z.infer<typeof areaCleaningCreateSchema>;

const areaCleaningUpdateSchema = z.object({
  cleaner: z.string().min(1).max(200).optional(),
  shift: z.string().min(1).max(30).optional(),
  notes: z.string().max(2000).optional().nullable(),
});
type AreaCleaningUpdateInput = z.infer<typeof areaCleaningUpdateSchema>;

const areaCleaningStatusSchema = z.object({ status: z.enum(CLEANING_STATUSES) });
type AreaCleaningStatusInput = z.infer<typeof areaCleaningStatusSchema>;

const AREA_LOG_INCLUDE = {
  tasks: { orderBy: { done: 'asc' } },
} as const;

router.get(
  '/area-cleaning',
  requirePermission('hygiene:view'),
  validateQuery(areaCleaningListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as AreaCleaningListQuery;
      const where: Record<string, unknown> = { ...(q.area ? { area: q.area } : {}) };
      if (q.status) where.status = q.status;
      if (q.from !== undefined || q.to !== undefined) {
        where.logDate = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      if (q.overdue) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        where.logDate = { lt: today };
        where.status = { not: 'DONE' };
      }
      const rows = await dbm.areaCleaningLog.findMany({
        where,
        include: AREA_LOG_INCLUDE,
        orderBy: [{ logDate: 'desc' }, { shift: 'asc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/area-cleaning',
  requirePermission('hygiene:manage'),
  validateBody(areaCleaningCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as AreaCleaningCreateInput;
      const created = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        let taskRows: { title: string; detail: string | null }[] = [];
        if (b.templateId) {
          const template = await t.cleaningChecklistTemplate.findUnique({
            where: { id: b.templateId },
            include: { items: { orderBy: { sortOrder: 'asc' } } },
          });
          if (!template || template.isActive === false)
            throw new AppError(400, 'Checklist template not found or inactive');
          taskRows = template.items.map((it: any) => ({ title: it.title, detail: it.detail ?? null }));
        }
        const log = await t.areaCleaningLog.create({
          data: {
            area: b.area,
            logDate: b.logDate,
            shift: b.shift,
            cleaner: b.cleaner,
            templateId: b.templateId ?? null,
            notes: b.notes ?? null,
            createdById: userId,
            tasks: { create: taskRows },
          },
          include: AREA_LOG_INCLUDE,
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'AreaCleaningLog',
          entityId: log.id,
          changes: { area: b.area, logDate: b.logDate, shift: b.shift, templateId: b.templateId ?? null },
        });
        return log;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/area-cleaning/:id',
  requirePermission('hygiene:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const row = await dbm.areaCleaningLog.findUnique({ where: { id }, include: AREA_LOG_INCLUDE });
      if (!row) throw new AppError(404, 'Cleaning log not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/area-cleaning/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(areaCleaningUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as AreaCleaningUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.areaCleaningLog.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Cleaning log not found');
        if (existing.status !== 'SCHEDULED')
          throw new AppError(400, 'Only scheduled cleanings can be edited');
        const saved = await t.areaCleaningLog.update({
          where: { id },
          data: {
            cleaner: b.cleaner,
            shift: b.shift,
            notes: b.notes === undefined ? undefined : (b.notes ?? null),
          },
          include: AREA_LOG_INCLUDE,
        });
        await audit(tx, { userId, action: 'UPDATE', entityType: 'AreaCleaningLog', entityId: id, changes: b });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

/** Forward-only status workflow: SCHEDULED → IN_PROGRESS → DONE. */
router.post(
  '/area-cleaning/:id/status',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(areaCleaningStatusSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as AreaCleaningStatusInput;
      const saved = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.areaCleaningLog.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Cleaning log not found');
        const order: Record<string, number> = { SCHEDULED: 0, IN_PROGRESS: 1, DONE: 2 };
        if (order[b.status] <= order[existing.status])
          throw new AppError(400, `Cannot move status from ${existing.status} to ${b.status}`);
        const data: Record<string, unknown> = { status: b.status };
        if (b.status === 'IN_PROGRESS') data.startedAt = new Date();
        if (b.status === 'DONE') data.endedAt = new Date();
        const updated = await t.areaCleaningLog.update({ where: { id }, data, include: AREA_LOG_INCLUDE });
        await audit(tx, {
          userId,
          action: 'STATUS',
          entityType: 'AreaCleaningLog',
          entityId: id,
          changes: { from: existing.status, to: b.status },
        });
        // Auto-raise an approval request when a cleaning is completed.
        if (b.status === 'DONE') {
          const open = await t.hygieneApproval.findFirst({
            where: { subjectType: 'CLEANING', subjectId: id, status: { in: ['PENDING', 'SUPERVISOR_SIGNED'] } },
          });
          if (!open) {
            await t.hygieneApproval.create({
              data: {
                subjectType: 'CLEANING',
                subjectId: id,
                subjectLabel: `${existing.area} — ${String(existing.logDate).slice(0, 10)} (${existing.shift})`,
                requestedById: userId,
              },
            });
          }
        }
        return updated;
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/area-cleaning/:logId/tasks/:taskId',
  requirePermission('hygiene:manage'),
  validateBody(z.object({ done: z.boolean() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { logId, taskId } = req.params as { logId: string; taskId: string };
      const { done } = req.body as { done: boolean };
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const log = await t.areaCleaningLog.findUnique({ where: { id: logId } });
        if (!log) throw new AppError(404, 'Cleaning log not found');
        if (log.status === 'SCHEDULED')
          throw new AppError(400, 'Start the cleaning before ticking off tasks');
        const task = await t.cleaningLogTask.findFirst({ where: { id: taskId, logId } });
        if (!task) throw new AppError(404, 'Checklist task not found');
        const saved = await t.cleaningLogTask.update({
          where: { id: taskId },
          data: { done, doneAt: done ? new Date() : null },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'CleaningLogTask',
          entityId: taskId,
          changes: { done, title: task.title },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── 3. Hygiene inspection records ───────────────────────────────

const INSPECTION_RESULTS = ['PASS', 'FAIL'] as const;

const inspectionsListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  target: z.string().min(1).optional(),
  targetType: z.enum(['AREA', 'EQUIPMENT']).optional(),
  result: z.enum(INSPECTION_RESULTS).optional(),
});
type InspectionsListQuery = z.infer<typeof inspectionsListQuerySchema>;

const criterionInputSchema = z.object({
  criterion: z.string().min(1).max(300),
  result: z.enum(INSPECTION_RESULTS),
  notes: z.string().max(2000).optional().nullable(),
});
type CriterionInput = z.infer<typeof criterionInputSchema>;

const inspectionCreateSchema = z.object({
  targetType: z.enum(['AREA', 'EQUIPMENT']),
  target: z.string().min(1).max(200),
  inspector: z.string().min(1).max(200),
  score: z.number().min(0).max(100).optional().nullable(),
  findings: z.string().max(5000).optional().nullable(),
  photosNote: z.string().max(1000).optional().nullable(),
  criteria: z.array(criterionInputSchema).min(1).max(60),
});
type InspectionCreateInput = z.infer<typeof inspectionCreateSchema>;

const inspectionUpdateSchema = z.object({
  score: z.number().min(0).max(100).optional().nullable(),
  findings: z.string().max(5000).optional().nullable(),
  photosNote: z.string().max(1000).optional().nullable(),
  criteria: z.array(criterionInputSchema).min(1).max(60).optional(),
});
type InspectionUpdateInput = z.infer<typeof inspectionUpdateSchema>;

const INSPECTION_INCLUDE = {
  criteria: true,
} as const;

function deriveOverall(criteria: { result: string }[]): 'PASS' | 'FAIL' {
  return criteria.some((c) => c.result === 'FAIL') ? 'FAIL' : 'PASS';
}

router.get(
  '/inspections',
  requirePermission('hygiene:view'),
  validateQuery(inspectionsListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as InspectionsListQuery;
      const where: Record<string, unknown> = {
        ...(q.target ? { target: q.target } : {}),
        ...(q.targetType ? { targetType: q.targetType } : {}),
        ...(q.result ? { overallResult: q.result } : {}),
      };
      if (q.from !== undefined || q.to !== undefined) {
        where.inspectedAt = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const rows = await dbm.hygieneInspection.findMany({
        where,
        include: INSPECTION_INCLUDE,
        orderBy: { inspectedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/inspections',
  requirePermission('hygiene:manage'),
  validateBody(inspectionCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as InspectionCreateInput;
      const created = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const overallResult = deriveOverall(b.criteria);
        const inspection = await t.hygieneInspection.create({
          data: {
            targetType: b.targetType,
            target: b.target,
            inspector: b.inspector,
            score: b.score ?? null,
            findings: b.findings ?? null,
            photosNote: b.photosNote ?? null,
            overallResult,
            createdById: userId,
            criteria: {
              create: b.criteria.map((c) => ({
                criterion: c.criterion,
                result: c.result,
                notes: c.notes ?? null,
              })),
            },
          },
          include: INSPECTION_INCLUDE,
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'HygieneInspection',
          entityId: inspection.id,
          changes: { target: b.target, overallResult, criteria: b.criteria.length },
        });
        return inspection;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/inspections/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(inspectionUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as InspectionUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.hygieneInspection.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Inspection not found');
        let overallResult = existing.overallResult;
        if (b.criteria) {
          await t.inspectionCriterion.deleteMany({ where: { inspectionId: id } });
          overallResult = deriveOverall(b.criteria);
        }
        const saved = await t.hygieneInspection.update({
          where: { id },
          data: {
            score: b.score === undefined ? undefined : (b.score ?? null),
            findings: b.findings === undefined ? undefined : (b.findings ?? null),
            photosNote: b.photosNote === undefined ? undefined : (b.photosNote ?? null),
            overallResult,
            ...(b.criteria
              ? {
                  criteria: {
                    create: b.criteria.map((c) => ({
                      criterion: c.criterion,
                      result: c.result,
                      notes: c.notes ?? null,
                    })),
                  },
                }
              : {}),
          },
          include: INSPECTION_INCLUDE,
        });
        await audit(tx, { userId, action: 'UPDATE', entityType: 'HygieneInspection', entityId: id, changes: b });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── 4. Cleaning action tracking ─────────────────────────────────

const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED'] as const;

const actionsListQuerySchema = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  owner: z.string().min(1).optional(),
  overdue: z.enum(['true']).optional(),
});
type ActionsListQuery = z.infer<typeof actionsListQuerySchema>;

const actionCreateSchema = z.object({
  action: z.string().min(1).max(1000),
  owner: z.string().min(1).max(200),
  dueDate: z.coerce.date().optional().nullable(),
  sourceInspectionId: z.string().min(1).optional().nullable(),
});
type ActionCreateInput = z.infer<typeof actionCreateSchema>;

const actionUpdateSchema = z.object({
  action: z.string().min(1).max(1000).optional(),
  owner: z.string().min(1).max(200).optional(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(),
});
type ActionUpdateInput = z.infer<typeof actionUpdateSchema>;

router.get(
  '/actions',
  requirePermission('hygiene:view'),
  validateQuery(actionsListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ActionsListQuery;
      const where: Record<string, unknown> = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.owner ? { owner: q.owner } : {}),
      };
      if (q.overdue) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        where.dueDate = { lt: today };
        where.status = { in: ['OPEN', 'IN_PROGRESS'] };
      }
      const rows = await dbm.cleaningAction.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/actions',
  requirePermission('hygiene:manage'),
  validateBody(actionCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ActionCreateInput;
      const created = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        if (b.sourceInspectionId) {
          const insp = await t.hygieneInspection.findUnique({ where: { id: b.sourceInspectionId } });
          if (!insp) throw new AppError(400, 'Source inspection not found');
        }
        const action = await t.cleaningAction.create({
          data: {
            action: b.action,
            owner: b.owner,
            dueDate: b.dueDate ?? null,
            sourceInspectionId: b.sourceInspectionId ?? null,
            createdById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'CleaningAction',
          entityId: action.id,
          changes: { action: b.action, owner: b.owner, dueDate: b.dueDate ?? null },
        });
        return action;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/actions/:id',
  requirePermission('hygiene:manage'),
  validateParams(idParamSchema),
  validateBody(actionUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as ActionUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.cleaningAction.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Action not found');
        if (existing.status === 'VERIFIED' || existing.status === 'CLOSED')
          throw new AppError(400, 'Verified or closed actions cannot be edited');
        const saved = await t.cleaningAction.update({
          where: { id },
          data: {
            action: b.action,
            owner: b.owner,
            dueDate: b.dueDate === undefined ? undefined : (b.dueDate ?? null),
            status: b.status,
          },
        });
        await audit(tx, { userId, action: 'UPDATE', entityType: 'CleaningAction', entityId: id, changes: b });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

/** Verify a completed follow-up action — requires approval permission. */
router.post(
  '/actions/:id/verify',
  requirePermission('hygiene:approve'),
  validateParams(idParamSchema),
  validateBody(z.object({ verificationNotes: z.string().min(1).max(2000) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { verificationNotes } = req.body as { verificationNotes: string };
      const updated = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.cleaningAction.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Action not found');
        if (existing.status !== 'IN_PROGRESS' && existing.status !== 'OPEN')
          throw new AppError(400, 'Only open or in-progress actions can be verified');
        const saved = await t.cleaningAction.update({
          where: { id },
          data: {
            status: 'VERIFIED',
            verificationNotes,
            verifiedById: userId,
            verifiedAt: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'VERIFY',
          entityType: 'CleaningAction',
          entityId: id,
          changes: { verificationNotes },
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── 5. Supervisor & quality approval queue ──────────────────────

const APPROVAL_STATUSES = ['PENDING', 'SUPERVISOR_SIGNED', 'APPROVED', 'REJECTED'] as const;

const approvalsListQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  subjectType: z.enum(['CLEANING', 'INSPECTION']).optional(),
});
type ApprovalsListQuery = z.infer<typeof approvalsListQuerySchema>;

const approvalCreateSchema = z.object({
  subjectType: z.enum(['CLEANING', 'INSPECTION']),
  subjectId: z.string().min(1),
  subjectLabel: z.string().max(300).optional().nullable(),
});
type ApprovalCreateInput = z.infer<typeof approvalCreateSchema>;

const signoffSchema = z.object({
  role: z.enum(['supervisor', 'quality']),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(2000).optional().nullable(),
});
type SignoffInput = z.infer<typeof signoffSchema>;

router.get(
  '/approvals',
  requirePermission('hygiene:view'),
  validateQuery(approvalsListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ApprovalsListQuery;
      const where: Record<string, unknown> = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      };
      const rows = await dbm.hygieneApproval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/approvals',
  requirePermission('hygiene:manage'),
  validateBody(approvalCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ApprovalCreateInput;
      const created = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const dup = await t.hygieneApproval.findFirst({
          where: { subjectType: b.subjectType, subjectId: b.subjectId, status: { in: ['PENDING', 'SUPERVISOR_SIGNED'] } },
        });
        if (dup) throw new AppError(400, 'An open approval request already exists for this item');
        // Ensure the subject exists.
        if (b.subjectType === 'CLEANING') {
          const log = await t.areaCleaningLog.findUnique({ where: { id: b.subjectId } });
          if (!log) throw new AppError(400, 'Cleaning log not found');
          if (log.status !== 'DONE') throw new AppError(400, 'Only completed cleanings can be approved');
        } else {
          const insp = await t.hygieneInspection.findUnique({ where: { id: b.subjectId } });
          if (!insp) throw new AppError(400, 'Inspection not found');
        }
        const approval = await t.hygieneApproval.create({
          data: {
            subjectType: b.subjectType,
            subjectId: b.subjectId,
            subjectLabel: b.subjectLabel ?? null,
            requestedById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'HygieneApproval',
          entityId: approval.id,
          changes: { subjectType: b.subjectType, subjectId: b.subjectId },
        });
        return approval;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/approvals/:id/signoff',
  requirePermission('hygiene:approve'),
  validateParams(idParamSchema),
  validateBody(signoffSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as SignoffInput;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const signer = user?.name ?? userId;
      const saved = await prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, any>;
        const existing = await t.hygieneApproval.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Approval request not found');
        if (existing.status === 'APPROVED' || existing.status === 'REJECTED')
          throw new AppError(400, 'This approval request is already decided');
        if (b.role === 'supervisor') {
          if (existing.status !== 'PENDING')
            throw new AppError(400, 'Supervisor sign-off is already recorded');
          const data =
            b.decision === 'reject'
              ? { supervisorBy: signer, supervisorAt: new Date(), supervisorNote: b.note ?? null, status: 'REJECTED' }
              : { supervisorBy: signer, supervisorAt: new Date(), supervisorNote: b.note ?? null, status: 'SUPERVISOR_SIGNED' };
          return await t.hygieneApproval.update({ where: { id }, data });
        }
        // quality role
        if (existing.status !== 'SUPERVISOR_SIGNED')
          throw new AppError(400, 'Supervisor must sign off before quality');
        return await t.hygieneApproval.update({
          where: { id },
          data: {
            qualityBy: signer,
            qualityAt: new Date(),
            qualityNote: b.note ?? null,
            status: b.decision === 'approve' ? 'APPROVED' : 'REJECTED',
          },
        });
      });
      await audit(prisma, {
        userId,
        action: b.decision === 'approve' ? 'SIGNOFF' : 'REJECT',
        entityType: 'HygieneApproval',
        entityId: id,
        changes: { role: b.role, decision: b.decision },
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

// ─── 6. Sanitation reports ───────────────────────────────────────

const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type ReportQuery = z.infer<typeof reportQuerySchema>;

function rangeFilter(q: ReportQuery, field: string): Record<string, unknown> {
  if (q.from === undefined && q.to === undefined) return {};
  return {
    [field]: {
      ...(q.from !== undefined ? { gte: q.from } : {}),
      ...(q.to !== undefined ? { lte: q.to } : {}),
    },
  };
}

router.get(
  '/reports/summary',
  requirePermission('hygiene:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ReportQuery;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const logs: any[] = await dbm.areaCleaningLog.findMany({
        where: rangeFilter(q, 'logDate'),
        select: { id: true, area: true, status: true, logDate: true },
      });
      const totalCleanings = logs.length;
      const doneCleanings = logs.filter((l) => l.status === 'DONE').length;
      const overdueCleanings = logs.filter(
        (l) => l.status !== 'DONE' && new Date(l.logDate) < today,
      );
      const cleaningCompliancePct = totalCleanings === 0 ? 0 : (doneCleanings / totalCleanings) * 100;

      const inspections: any[] = await dbm.hygieneInspection.findMany({
        where: rangeFilter(q, 'inspectedAt'),
        select: { id: true, target: true, targetType: true, overallResult: true },
      });
      const graded = inspections.filter((i) => i.overallResult !== null);
      const passed = graded.filter((i) => i.overallResult === 'PASS').length;
      const inspectionPassPct = graded.length === 0 ? 0 : (passed / graded.length) * 100;

      // Pass rate per area/equipment target.
      const byTarget = new Map<string, { total: number; pass: number }>();
      for (const i of graded) {
        const label = `${i.targetType === 'AREA' ? 'Area' : 'Equipment'}: ${i.target}`;
        const cur = byTarget.get(label) ?? { total: 0, pass: 0 };
        cur.total += 1;
        if (i.overallResult === 'PASS') cur.pass += 1;
        byTarget.set(label, cur);
      }
      const passRatesByArea = [...byTarget.entries()].map(([target, v]) => ({
        target,
        total: v.total,
        pass: v.pass,
        passPct: v.total === 0 ? 0 : (v.pass / v.total) * 100,
      }));

      const openActions = await dbm.cleaningAction.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });

      res.json({
        from: q.from ?? null,
        to: q.to ?? null,
        cleaningCompliancePct,
        totalCleanings,
        doneCleanings,
        overdueCleanings: overdueCleanings.length,
        overdueCleaningIds: overdueCleanings.slice(0, 50).map((l) => l.id),
        inspectionPassPct,
        totalInspections: inspections.length,
        passedInspections: passed,
        passRatesByArea,
        openActions,
      });
    } catch (err) {
      next(err);
    }
  },
);

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
  return lines.join('\n');
}

router.get(
  '/reports/csv',
  requirePermission('hygiene:view'),
  validateQuery(reportQuerySchema.extend({ type: z.enum(['cleanings', 'inspections', 'actions']) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as ReportQuery & { type: 'cleanings' | 'inspections' | 'actions' };
      const where: Record<string, unknown> = rangeFilter(q, q.type === 'inspections' ? 'inspectedAt' : q.type === 'actions' ? 'createdAt' : 'logDate');
      let csv: string;
      if (q.type === 'cleanings') {
        const rows: any[] = await dbm.areaCleaningLog.findMany({
          where,
          include: AREA_LOG_INCLUDE,
          orderBy: { logDate: 'desc' },
        });
        csv = toCsv(
          rows.map((r) => ({
            date: String(r.logDate).slice(0, 10),
            area: r.area,
            shift: r.shift,
            cleaner: r.cleaner,
            status: r.status,
            tasksTotal: (r.tasks ?? []).length,
            tasksDone: (r.tasks ?? []).filter((t: any) => t.done).length,
            startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : '',
            endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : '',
            notes: r.notes ?? '',
          })),
          ['date', 'area', 'shift', 'cleaner', 'status', 'tasksTotal', 'tasksDone', 'startedAt', 'endedAt', 'notes'],
        );
      } else if (q.type === 'inspections') {
        const rows: any[] = await dbm.hygieneInspection.findMany({
          where,
          include: INSPECTION_INCLUDE,
          orderBy: { inspectedAt: 'desc' },
        });
        csv = toCsv(
          rows.map((r) => ({
            inspectedAt: new Date(r.inspectedAt).toISOString(),
            targetType: r.targetType,
            target: r.target,
            inspector: r.inspector,
            score: r.score ?? '',
            overallResult: r.overallResult ?? '',
            criteriaCount: (r.criteria ?? []).length,
            failedCriteria: (r.criteria ?? []).filter((c: any) => c.result === 'FAIL').map((c: any) => c.criterion).join('; '),
            findings: r.findings ?? '',
            photosNote: r.photosNote ?? '',
          })),
          ['inspectedAt', 'targetType', 'target', 'inspector', 'score', 'overallResult', 'criteriaCount', 'failedCriteria', 'findings', 'photosNote'],
        );
      } else {
        const rows: any[] = await dbm.cleaningAction.findMany({ where, orderBy: { createdAt: 'desc' } });
        csv = toCsv(
          rows.map((r) => ({
            createdAt: new Date(r.createdAt).toISOString(),
            action: r.action,
            owner: r.owner,
            dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : '',
            status: r.status,
            sourceInspectionId: r.sourceInspectionId ?? '',
            verificationNotes: r.verificationNotes ?? '',
            verifiedAt: r.verifiedAt ? new Date(r.verifiedAt).toISOString() : '',
          })),
          ['createdAt', 'action', 'owner', 'dueDate', 'status', 'sourceInspectionId', 'verificationNotes', 'verifiedAt'],
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="sanitation-${q.type}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);
