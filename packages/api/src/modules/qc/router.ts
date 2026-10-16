import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma, CAPAStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { createLabCheck } from './service';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });
const dec = (n?: number | null): Prisma.Decimal | null =>
  n === undefined || n === null ? null : new Prisma.Decimal(n);

// ─── QC thresholds ───────────────────────────────────────────────

const thresholdListQuerySchema = z.object({
  category: z.string().min(1).optional(),
});
type ThresholdListQuery = z.infer<typeof thresholdListQuerySchema>;

const thresholdCreateSchema = z.object({
  code: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  param: z.string().min(1).max(100),
  minValue: z.number().optional().nullable(),
  maxValue: z.number().optional().nullable(),
  unit: z.string().max(20).optional().nullable(),
});
type ThresholdCreateInput = z.infer<typeof thresholdCreateSchema>;

const thresholdUpdateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  param: z.string().min(1).max(100).optional(),
  minValue: z.number().optional().nullable(),
  maxValue: z.number().optional().nullable(),
  unit: z.string().max(20).optional().nullable(),
  isActive: z.boolean().optional(),
});
type ThresholdUpdateInput = z.infer<typeof thresholdUpdateSchema>;

router.get(
  '/thresholds',
  requirePermission('qc:view'),
  validateQuery(thresholdListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ThresholdListQuery;
      const thresholds = await prisma.qcThreshold.findMany({
        where: { category: q.category },
        orderBy: { param: 'asc' },
      });
      res.json(thresholds);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/thresholds',
  requirePermission('qc:manage'),
  validateBody(thresholdCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ThresholdCreateInput;
      const threshold = await prisma.$transaction(async (tx) => {
        const created = await tx.qcThreshold.create({
          data: {
            code: b.code,
            category: b.category,
            param: b.param,
            minValue: dec(b.minValue),
            maxValue: dec(b.maxValue),
            unit: b.unit ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'QcThreshold',
          entityId: created.id,
          changes: { code: b.code, category: b.category, param: b.param },
        });
        return created;
      });
      res.status(201).json(threshold);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/thresholds/:id',
  requirePermission('qc:manage'),
  validateParams(idParamSchema),
  validateBody(thresholdUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as ThresholdUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.qcThreshold.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'QC threshold not found');
        const saved = await tx.qcThreshold.update({
          where: { id },
          data: {
            category: b.category,
            param: b.param,
            minValue: b.minValue === undefined ? undefined : dec(b.minValue),
            maxValue: b.maxValue === undefined ? undefined : dec(b.maxValue),
            unit: b.unit === undefined ? undefined : (b.unit ?? null),
            isActive: b.isActive,
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'QcThreshold',
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

router.delete(
  '/thresholds/:id',
  requirePermission('qc:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.$transaction(async (tx) => {
        const existing = await tx.qcThreshold.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'QC threshold not found');
        await tx.qcThreshold.delete({ where: { id } });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'QcThreshold',
          entityId: id,
          changes: { deleted: true, code: existing.code, param: existing.param },
        });
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ─── Lab checks ──────────────────────────────────────────────────

const labCheckListQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
  shiftRunId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type LabCheckListQuery = z.infer<typeof labCheckListQuerySchema>;

const labCheckCreateSchema = z.object({
  shiftRunId: z.string().min(1),
  sampleTime: z.coerce.date().optional(),
  impurityPct: z.number().nonnegative().optional().nullable(),
  wheatMoistureBefore: z.number().nonnegative().optional().nullable(),
  wheatMoistureAfter: z.number().nonnegative().optional().nullable(),
  flourMoisturePct: z.number().nonnegative().optional().nullable(),
  wetGlutenPct: z.number().nonnegative().optional().nullable(),
  glutenElasticity: z.string().max(50).optional().nullable(),
  dryGlutenPct: z.number().nonnegative().optional().nullable(),
  ashPct: z.number().nonnegative().optional().nullable(),
  colorScore: z.number().nonnegative().optional().nullable(),
  granulationPct: z.number().nonnegative().optional().nullable(),
});
type LabCheckCreateInput = z.infer<typeof labCheckCreateSchema>;

router.get(
  '/lab-checks',
  requirePermission('qc:view'),
  validateQuery(labCheckListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as LabCheckListQuery;
      const where: Prisma.LabCheckWhereInput = {
        batchId: q.batchId,
        shiftRunId: q.shiftRunId,
      };
      if (q.from !== undefined || q.to !== undefined) {
        where.sampleTime = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      const checks = await prisma.labCheck.findMany({
        where,
        orderBy: { sampleTime: 'desc' },
      });
      res.json(checks);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/lab-checks',
  requirePermission('qc:manage'),
  validateBody(labCheckCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const input = req.body as LabCheckCreateInput;
      const result = await prisma.$transaction(async (tx) => createLabCheck(tx, input, userId));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Batch quality approval ──────────────────────────────────────

router.post(
  '/batches/:id/approve-quality',
  requirePermission('qc:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const batch = await prisma.$transaction(async (tx) => {
        const existing = await tx.productionBatch.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Production batch not found');
        const openCapas = await tx.cAPA.count({
          where: { batchId: id, status: { in: [CAPAStatus.OPEN, CAPAStatus.IN_PROGRESS] } },
        });
        if (openCapas > 0) throw new AppError(409, 'Batch has open CAPAs');
        const approved = await tx.productionBatch.update({
          where: { id },
          data: { status: 'APPROVED' },
        });
        await audit(tx, {
          userId,
          action: 'APPROVE',
          entityType: 'ProductionBatch',
          entityId: id,
          changes: { status: 'APPROVED' },
        });
        return approved;
      });
      res.json(batch);
    } catch (err) {
      next(err);
    }
  },
);
