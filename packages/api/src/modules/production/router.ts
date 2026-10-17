import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma, BatchProductType, ShiftType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { recordShiftOutputs } from './service';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });
const dec = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

function blendPctSumOk(soft: number, hard: number, foreign: number): boolean {
  return Math.abs(soft + hard + foreign - 100) <= 0.01;
}

// ─── Batches ─────────────────────────────────────────────────────

const batchCreateSchema = z.object({
  productType: z.nativeEnum(BatchProductType),
  blendSoftPct: z.number().min(0).max(100),
  blendHardPct: z.number().min(0).max(100),
  blendForeignPct: z.number().min(0).max(100),
  blendSoftQ: z.number().nonnegative(),
  blendHardQ: z.number().nonnegative(),
  blendForeignQ: z.number().nonnegative(),
  wheatWeighedQ: z.number().positive(),
});
type BatchCreateInput = z.infer<typeof batchCreateSchema>;
const batchUpdateSchema = batchCreateSchema.partial();
type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;

const batchListQuerySchema = z.object({
  status: z.string().min(1).optional(),
  productType: z.nativeEnum(BatchProductType).optional(),
});
type BatchListQuery = z.infer<typeof batchListQuerySchema>;

router.get(
  '/batches',
  requirePermission('production:view'),
  validateQuery(batchListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as BatchListQuery;
      const batches = await prisma.productionBatch.findMany({
        where: { status: q.status, productType: q.productType },
        orderBy: { createdAt: 'desc' },
      });
      res.json(batches);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/batches',
  requirePermission('production:manage'),
  validateBody(batchCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as BatchCreateInput;
      if (!blendPctSumOk(b.blendSoftPct, b.blendHardPct, b.blendForeignPct)) {
        throw new AppError(
          400,
          `Blend percentages must sum to 100 (got ${(b.blendSoftPct + b.blendHardPct + b.blendForeignPct).toFixed(2)})`,
        );
      }
      const batch = await prisma.$transaction(async (tx) => {
        const batchNo = await nextDocNo(tx, 'productionBatch', 'batchNo', 'BATCH');
        const created = await tx.productionBatch.create({
          data: {
            batchNo,
            productType: b.productType,
            blendSoftPct: dec(b.blendSoftPct),
            blendHardPct: dec(b.blendHardPct),
            blendForeignPct: dec(b.blendForeignPct),
            blendSoftQ: dec(b.blendSoftQ),
            blendHardQ: dec(b.blendHardQ),
            blendForeignQ: dec(b.blendForeignQ),
            wheatWeighedQ: dec(b.wheatWeighedQ),
            status: 'OPEN',
            createdById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'ProductionBatch',
          entityId: created.id,
          changes: { batchNo, productType: b.productType },
        });
        return created;
      });
      res.status(201).json(batch);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/batches/:id',
  requirePermission('production:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const batch = await prisma.productionBatch.findUnique({
        where: { id },
        include: {
          sources: { include: { intake: { include: { supplier: true } } } },
          shifts: { orderBy: { startedAt: 'desc' } },
          labChecks: { orderBy: { sampleTime: 'desc' } },
          capas: true,
          packRuns: true,
        },
      });
      if (!batch) throw new AppError(404, 'Production batch not found');
      res.json(batch);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/batches/:id',
  requirePermission('production:manage'),
  validateParams(idParamSchema),
  validateBody(batchUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as BatchUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.productionBatch.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Production batch not found');
        if (existing.status !== 'OPEN') throw new AppError(409, 'Only OPEN batches can be edited');
        const soft = b.blendSoftPct ?? existing.blendSoftPct.toNumber();
        const hard = b.blendHardPct ?? existing.blendHardPct.toNumber();
        const foreign = b.blendForeignPct ?? existing.blendForeignPct.toNumber();
        if (!blendPctSumOk(soft, hard, foreign)) {
          throw new AppError(
            400,
            `Blend percentages must sum to 100 (got ${(soft + hard + foreign).toFixed(2)})`,
          );
        }
        const data: Prisma.ProductionBatchUpdateInput = {};
        if (b.productType !== undefined) data.productType = b.productType;
        if (b.blendSoftPct !== undefined) data.blendSoftPct = dec(b.blendSoftPct);
        if (b.blendHardPct !== undefined) data.blendHardPct = dec(b.blendHardPct);
        if (b.blendForeignPct !== undefined) data.blendForeignPct = dec(b.blendForeignPct);
        if (b.blendSoftQ !== undefined) data.blendSoftQ = dec(b.blendSoftQ);
        if (b.blendHardQ !== undefined) data.blendHardQ = dec(b.blendHardQ);
        if (b.blendForeignQ !== undefined) data.blendForeignQ = dec(b.blendForeignQ);
        if (b.wheatWeighedQ !== undefined) data.wheatWeighedQ = dec(b.wheatWeighedQ);
        const saved = await tx.productionBatch.update({ where: { id }, data });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'ProductionBatch',
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

const batchSourceSchema = z.object({
  intakeId: z.string().min(1),
  quintals: z.number().positive(),
});
type BatchSourceInput = z.infer<typeof batchSourceSchema>;

router.post(
  '/batches/:id/sources',
  requirePermission('production:manage'),
  validateParams(idParamSchema),
  validateBody(batchSourceSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as BatchSourceInput;
      const source = await prisma.$transaction(async (tx) => {
        const batch = await tx.productionBatch.findUnique({ where: { id } });
        if (!batch) throw new AppError(404, 'Production batch not found');
        const intake = await tx.wheatIntake.findUnique({ where: { id: input.intakeId } });
        if (!intake) throw new AppError(404, 'Wheat intake not found');
        if (intake.status !== 'ACCEPTED') {
          throw new AppError(409, `Intake ${intake.intakeNo} is not accepted (status: ${intake.status})`);
        }
        const created = await tx.batchIntakeSource.create({
          data: { batchId: id, intakeId: input.intakeId, quintals: dec(input.quintals) },
          include: { intake: true },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'BatchIntakeSource',
          entityId: `${id}:${input.intakeId}`,
          changes: { batchId: id, intakeId: input.intakeId, quintals: input.quintals },
        });
        return created;
      });
      res.status(201).json(source);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Shifts ──────────────────────────────────────────────────────

const shiftListQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
  shiftDate: z.coerce.date().optional(),
});
type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;

const shiftCreateSchema = z.object({
  batchId: z.string().min(1),
  shift: z.nativeEnum(ShiftType),
  shiftDate: z.coerce.date(),
  startedAt: z.coerce.date(),
  operators: z.array(z.string()).optional().default([]),
});
type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;

const shiftUpdateSchema = z.object({
  endedAt: z.coerce.date().optional(),
  downtimeMin: z.number().int().min(0).optional(),
  downtimeReason: z.string().max(500).optional().nullable(),
});
type ShiftUpdateInput = z.infer<typeof shiftUpdateSchema>;

router.get(
  '/shifts',
  requirePermission('production:view'),
  validateQuery(shiftListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ShiftListQuery;
      const shifts = await prisma.shiftRun.findMany({
        where: { batchId: q.batchId, shiftDate: q.shiftDate },
        orderBy: { startedAt: 'desc' },
      });
      res.json(shifts);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/shifts',
  requirePermission('production:manage'),
  validateBody(shiftCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as ShiftCreateInput;
      const shift = await prisma.$transaction(async (tx) => {
        const batch = await tx.productionBatch.findUnique({ where: { id: b.batchId } });
        if (!batch) throw new AppError(404, 'Production batch not found');
        const created = await tx.shiftRun.create({
          data: {
            batchId: b.batchId,
            shift: b.shift,
            shiftDate: b.shiftDate,
            startedAt: b.startedAt,
            operators: b.operators,
            createdById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'ShiftRun',
          entityId: created.id,
          changes: { batchId: b.batchId, shift: b.shift, shiftDate: b.shiftDate },
        });
        return created;
      });
      res.status(201).json(shift);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/shifts/:id',
  requirePermission('production:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const shift = await prisma.shiftRun.findUnique({
        where: { id },
        include: { outputs: { include: { product: true } }, batch: true },
      });
      if (!shift) throw new AppError(404, 'Shift run not found');
      res.json(shift);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/shifts/:id',
  requirePermission('production:manage'),
  validateParams(idParamSchema),
  validateBody(shiftUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as ShiftUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.shiftRun.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Shift run not found');
        const saved = await tx.shiftRun.update({
          where: { id },
          data: {
            endedAt: b.endedAt,
            downtimeMin: b.downtimeMin,
            downtimeReason: b.downtimeReason ?? undefined,
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'ShiftRun',
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

const shiftOutputsSchema = z.object({
  outputs: z
    .array(
      z.object({
        productId: z.string().min(1),
        quintals: z.number().positive(),
      }),
    )
    .min(1),
});
type ShiftOutputsInput = z.infer<typeof shiftOutputsSchema>;

router.post(
  '/shifts/:id/outputs',
  requirePermission('production:manage'),
  validateParams(idParamSchema),
  validateBody(shiftOutputsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as ShiftOutputsInput;
      const result = await prisma.$transaction(async (tx) => {
        const shift = await tx.shiftRun.findUnique({ where: { id } });
        if (!shift) throw new AppError(404, 'Shift run not found');
        return recordShiftOutputs(tx, id, input.outputs, userId);
      });
      res
        .status(201)
        .json({ extractionPct: result.extractionPct.toNumber(), belowYieldFlag: result.belowYieldFlag });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Washing ─────────────────────────────────────────────────────

const washingListQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
});
type WashingListQuery = z.infer<typeof washingListQuerySchema>;

const washingCreateSchema = z.object({
  tankOrSilo: z.string().min(1).max(100),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  downtimeMin: z.number().int().min(0).optional().default(0),
  equipmentChange: z.string().max(500).optional().nullable(),
  operators: z.array(z.string()).optional().default([]),
  batchId: z.string().min(1).optional(),
});
type WashingCreateInput = z.infer<typeof washingCreateSchema>;

router.get(
  '/washing',
  requirePermission('production:view'),
  validateQuery(washingListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as WashingListQuery;
      const logs = await prisma.washingLog.findMany({
        where: { batchId: q.batchId },
        orderBy: { startedAt: 'desc' },
      });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/washing',
  requirePermission('production:manage'),
  validateBody(washingCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as WashingCreateInput;
      const log = await prisma.$transaction(async (tx) => {
        if (b.batchId) {
          const batch = await tx.productionBatch.findUnique({ where: { id: b.batchId } });
          if (!batch) throw new AppError(404, 'Production batch not found');
        }
        const durationMin =
          b.endedAt !== undefined ? Math.round((b.endedAt.getTime() - b.startedAt.getTime()) / 60000) : null;
        const created = await tx.washingLog.create({
          data: {
            tankOrSilo: b.tankOrSilo,
            startedAt: b.startedAt,
            endedAt: b.endedAt,
            durationMin,
            downtimeMin: b.downtimeMin,
            equipmentChange: b.equipmentChange ?? null,
            operators: b.operators,
            batchId: b.batchId ?? null,
            createdById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'WashingLog',
          entityId: created.id,
          changes: { tankOrSilo: b.tankOrSilo, durationMin, batchId: b.batchId ?? null },
        });
        return created;
      });
      res.status(201).json(log);
    } catch (err) {
      next(err);
    }
  },
);
