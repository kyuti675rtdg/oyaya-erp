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
