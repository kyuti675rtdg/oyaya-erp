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
import {
  FLOUR_PRODUCT_TYPES,
  DOWNTIME_CATEGORIES,
  createBlendRecipe,
  activateBlendRecipe,
  checkBlendCompliance,
  createProductionPlan,
  transitionProductionPlan,
  startMillingRun,
  endMillingRun,
  logDowntime,
  downtimeSummary,
  recordFlourOutput,
  acknowledgeYieldAlert,
  createShiftHandover,
  dailyProductionReport,
  shiftProductionReport,
  type BlendRecipeInput,
  type ProductionPlanInput,
  type MillingRunInput,
  type DowntimeInput,
  type FlourOutputInput,
} from './service';

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
  // Module 4: operator reassignment on an existing shift run
  operators: z.array(z.string().min(1).max(120)).max(20).optional(),
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
            operators: b.operators,
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
  waterUsedL: z.number().int().min(0).optional().nullable(),
  impurityBeforePct: z.number().min(0).max(100).optional().nullable(),
  impurityAfterPct: z.number().min(0).max(100).optional().nullable(),
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
        // WashingLog.waterUsedL / impurity* columns arrive via /tmp/migration-module4.sql;
        // until the Prisma client is regenerated we write through a cast delegate.
        const washingCreate = tx.washingLog.create as unknown as (args: {
          data: Record<string, unknown>;
        }) => Promise<{ id: string }>;
        const created = await washingCreate({
          data: {
            tankOrSilo: b.tankOrSilo,
            startedAt: b.startedAt,
            endedAt: b.endedAt,
            durationMin,
            downtimeMin: b.downtimeMin,
            equipmentChange: b.equipmentChange ?? null,
            operators: b.operators,
            batchId: b.batchId ?? null,
            waterUsedL: b.waterUsedL ?? null,
            impurityBeforePct: b.impurityBeforePct != null ? dec(b.impurityBeforePct) : null,
            impurityAfterPct: b.impurityAfterPct != null ? dec(b.impurityAfterPct) : null,
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

const washingUpdateSchema = z.object({
  endedAt: z.coerce.date().optional(),
  waterUsedL: z.number().int().min(0).optional().nullable(),
  impurityBeforePct: z.number().min(0).max(100).optional().nullable(),
  impurityAfterPct: z.number().min(0).max(100).optional().nullable(),
  operators: z.array(z.string()).optional(),
});
type WashingUpdateInput = z.infer<typeof washingUpdateSchema>;

router.put(
  '/washing/:id',
  requirePermission('production:manage'),
  validateParams(idParamSchema),
  validateBody(washingUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as WashingUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.washingLog.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Washing log not found');
        const data: Record<string, unknown> = {};
        if (b.endedAt !== undefined) {
          data.endedAt = b.endedAt;
          data.durationMin = Math.round((b.endedAt.getTime() - existing.startedAt.getTime()) / 60000);
        }
        if (b.waterUsedL !== undefined) data.waterUsedL = b.waterUsedL;
        if (b.impurityBeforePct !== undefined) {
          data.impurityBeforePct = b.impurityBeforePct != null ? dec(b.impurityBeforePct) : null;
        }
        if (b.impurityAfterPct !== undefined) {
          data.impurityAfterPct = b.impurityAfterPct != null ? dec(b.impurityAfterPct) : null;
        }
        if (b.operators !== undefined) data.operators = b.operators;
        // New columns exist post-merge; cast for the current generated client.
        const washingUpdate = tx.washingLog.update as unknown as (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => Promise<unknown>;
        const saved = await washingUpdate({ where: { id }, data });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'WashingLog',
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

/* ═══════════════════════════════════════════════════════════════════════════
 * Module 4: Production & Milling Management
 * ═══════════════════════════════════════════════════════════════════════════ */
const m4View = requirePermission('production:view');
const m4Manage = requirePermission('production:manage');
const m4Approve = requirePermission('production:approve');

// ─── Blend recipes ─────────────────────────────────────────────────────────

const blendRecipeSchema = z.object({
  name: z.string().min(1).max(120),
  productType: z.enum(FLOUR_PRODUCT_TYPES),
  hardPct: z.number().min(0).max(100),
  softPct: z.number().min(0).max(100),
  foreignPct: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});
type BlendRecipeBody = z.infer<typeof blendRecipeSchema>;

const blendRecipeListQuerySchema = z.object({
  productType: z.enum(FLOUR_PRODUCT_TYPES).optional(),
});
type BlendRecipeListQuery = z.infer<typeof blendRecipeListQuerySchema>;

router.get(
  '/blend-recipes',
  m4View,
  validateQuery(blendRecipeListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as BlendRecipeListQuery;
      const recipes = await (prisma as unknown as {
        blendRecipe: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).blendRecipe.findMany({
        where: { productType: q.productType },
        orderBy: [{ productType: 'asc' }, { isActive: 'desc' }, { createdAt: 'desc' }],
      });
      res.json(recipes);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/blend-recipes',
  m4Manage,
  validateBody(blendRecipeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const recipe = await prisma.$transaction((tx) =>
        createBlendRecipe(tx, req.body as BlendRecipeInput, userId),
      );
      res.status(201).json(recipe);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/blend-recipes/:id/activate',
  m4Manage,
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const recipe = await prisma.$transaction((tx) => activateBlendRecipe(tx, id, userId));
      res.json(recipe);
    } catch (err) {
      next(err);
    }
  },
);

const blendComplianceQuerySchema = z.object({
  batchId: z.string().min(1),
  productType: z.enum(FLOUR_PRODUCT_TYPES),
  tolerancePct: z.coerce.number().min(0).max(20).optional().default(2),
});
type BlendComplianceQuery = z.infer<typeof blendComplianceQuerySchema>;

router.get(
  '/blend-recipes/compliance',
  m4View,
  validateQuery(blendComplianceQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as BlendComplianceQuery;
      const result = await prisma.$transaction((tx) =>
        checkBlendCompliance(tx, q.batchId, q.productType, q.tolerancePct),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Production plans ──────────────────────────────────────────────────────

const planTargetSchema = z.object({
  productType: z.enum(FLOUR_PRODUCT_TYPES),
  plannedQ: z.number().positive(),
});

const productionPlanSchema = z.object({
  tankCode: z.string().min(1).max(20).optional().nullable(),
  batchId: z.string().min(1).optional().nullable(),
  targets: z.array(planTargetSchema).min(1).max(10),
  plannedWheatQ: z.number().positive(),
  scheduledDate: z.coerce.date(),
  shift: z.enum(['MORNING', 'NIGHT']),
  notes: z.string().max(1000).optional().nullable(),
});
type ProductionPlanBody = z.infer<typeof productionPlanSchema>;

const planListQuerySchema = z.object({
  status: z.string().min(1).optional(),
  scheduledDate: z.coerce.date().optional(),
});
type PlanListQuery = z.infer<typeof planListQuerySchema>;

router.get(
  '/plans',
  m4View,
  validateQuery(planListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as PlanListQuery;
      const plans = await (prisma as unknown as {
        productionPlan: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).productionPlan.findMany({
        where: { status: q.status, scheduledDate: q.scheduledDate },
        orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
      });
      res.json(plans);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/plans',
  m4Manage,
  validateBody(productionPlanSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const plan = await prisma.$transaction((tx) =>
        createProductionPlan(tx, req.body as ProductionPlanInput, userId),
      );
      res.status(201).json(plan);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/plans/:id',
  m4View,
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const plan = await (prisma as unknown as {
        productionPlan: { findUnique(args: unknown): Promise<Record<string, unknown> | null> };
      }).productionPlan.findUnique({ where: { id } });
      if (!plan) throw new AppError(404, 'Production plan not found');
      res.json(plan);
    } catch (err) {
      next(err);
    }
  },
);

const planTransitionSchema = z.object({
  actualWheatQ: z.number().min(0).optional(),
  actualOutputQ: z.number().min(0).optional(),
});
type PlanTransitionBody = z.infer<typeof planTransitionSchema>;

router.post(
  '/plans/:id/start',
  m4Manage,
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const plan = await prisma.$transaction((tx) =>
        transitionProductionPlan(tx, id, 'IN_PROGRESS', userId),
      );
      res.json(plan);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/plans/:id/complete',
  m4Manage,
  validateParams(idParamSchema),
  validateBody(planTransitionSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as PlanTransitionBody;
      const plan = await prisma.$transaction((tx) =>
        transitionProductionPlan(tx, id, 'COMPLETED', userId, {
          actualWheatQ: b.actualWheatQ,
          actualOutputQ: b.actualOutputQ,
        }),
      );
      res.json(plan);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Milling runs ──────────────────────────────────────────────────────────

const millingRunSchema = z.object({
  planId: z.string().min(1).optional().nullable(),
  batchId: z.string().min(1),
  lineMachine: z.string().min(1).max(60),
  startedAt: z.coerce.date(),
  feedRateQHr: z.number().positive().optional().nullable(),
  rollSettings: z.string().max(1000).optional().nullable(),
  operator: z.string().min(1).max(120),
});
type MillingRunBody = z.infer<typeof millingRunSchema>;

const millingRunListQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});
type MillingRunListQuery = z.infer<typeof millingRunListQuerySchema>;

// NOTE: /milling-runs/running must be registered before /milling-runs/:id
router.get(
  '/milling-runs/running',
  m4View,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runs = await (prisma as unknown as {
        millingRun: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).millingRun.findMany({
        where: { status: 'RUNNING' },
        orderBy: { startedAt: 'asc' },
      });
      res.json(runs);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/milling-runs',
  m4View,
  validateQuery(millingRunListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as MillingRunListQuery;
      const runs = await (prisma as unknown as {
        millingRun: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).millingRun.findMany({
        where: { batchId: q.batchId, planId: q.planId, status: q.status },
        orderBy: { startedAt: 'desc' },
      });
      res.json(runs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/milling-runs',
  m4Manage,
  validateBody(millingRunSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const run = await prisma.$transaction((tx) =>
        startMillingRun(tx, req.body as MillingRunInput, userId),
      );
      res.status(201).json(run);
    } catch (err) {
      next(err);
    }
  },
);

const millingRunEndSchema = z.object({
  endedAt: z.coerce.date(),
  status: z.enum(['COMPLETED', 'STOPPED']).optional().default('COMPLETED'),
  feedRateQHr: z.number().positive().optional().nullable(),
  rollSettings: z.string().max(1000).optional().nullable(),
});
type MillingRunEndBody = z.infer<typeof millingRunEndSchema>;

router.post(
  '/milling-runs/:id/end',
  m4Manage,
  validateParams(idParamSchema),
  validateBody(millingRunEndSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as MillingRunEndBody;
      const run = await prisma.$transaction((tx) =>
        endMillingRun(tx, id, userId, {
          endedAt: b.endedAt,
          status: b.status,
          feedRateQHr: b.feedRateQHr,
          rollSettings: b.rollSettings,
        }),
      );
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Downtime logs ─────────────────────────────────────────────────────────

const downtimeSchema = z.object({
  machineLine: z.string().min(1).max(60),
  runId: z.string().min(1).optional().nullable(),
  shiftRunId: z.string().min(1).optional().nullable(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional().nullable(),
  minutesLost: z.number().int().positive(),
  reasonCategory: z.enum(DOWNTIME_CATEGORIES),
  description: z.string().max(1000).optional().nullable(),
  resolvedBy: z.string().max(120).optional().nullable(),
});
type DowntimeBody = z.infer<typeof downtimeSchema>;

const downtimeListQuerySchema = z.object({
  machineLine: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type DowntimeListQuery = z.infer<typeof downtimeListQuerySchema>;

router.get(
  '/downtime',
  m4View,
  validateQuery(downtimeListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as DowntimeListQuery;
      const where: Record<string, unknown> = { machineLine: q.machineLine };
      if (q.from || q.to) where.startedAt = { gte: q.from, lte: q.to };
      const logs = await (prisma as unknown as {
        downtimeLog: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).downtimeLog.findMany({ where, orderBy: { startedAt: 'desc' } });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/downtime',
  m4Manage,
  validateBody(downtimeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const entry = await prisma.$transaction((tx) =>
        logDowntime(tx, req.body as DowntimeInput, userId),
      );
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

const downtimeSummaryQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});
type DowntimeSummaryQuery = z.infer<typeof downtimeSummaryQuerySchema>;

router.get(
  '/downtime/summary',
  m4View,
  validateQuery(downtimeSummaryQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as DowntimeSummaryQuery;
      const summary = await prisma.$transaction((tx) => downtimeSummary(tx, q.from, q.to));
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Flour output & extraction ─────────────────────────────────────────────

const flourOutputSchema = z.object({
  batchId: z.string().min(1),
  productType: z.enum(FLOUR_PRODUCT_TYPES),
  quintals: z.number().positive(),
});
type FlourOutputBody = z.infer<typeof flourOutputSchema>;

const flourOutputListQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
  flagged: z.coerce.boolean().optional(),
});
type FlourOutputListQuery = z.infer<typeof flourOutputListQuerySchema>;

router.get(
  '/flour-outputs',
  m4View,
  validateQuery(flourOutputListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as FlourOutputListQuery;
      const outputs = await (prisma as unknown as {
        flourOutput: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).flourOutput.findMany({
        where: { batchId: q.batchId, belowYieldFlag: q.flagged },
        orderBy: { loggedAt: 'desc' },
      });
      res.json(outputs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/flour-outputs',
  m4Manage,
  validateBody(flourOutputSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const result = await prisma.$transaction((tx) =>
        recordFlourOutput(tx, req.body as FlourOutputInput, userId),
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Yield alerts ──────────────────────────────────────────────────────────

const yieldAlertListQuerySchema = z.object({
  status: z.string().min(1).optional(),
  severity: z.enum(['AMBER', 'RED']).optional(),
});
type YieldAlertListQuery = z.infer<typeof yieldAlertListQuerySchema>;

router.get(
  '/yield-alerts',
  m4View,
  validateQuery(yieldAlertListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as YieldAlertListQuery;
      const alerts = await (prisma as unknown as {
        yieldAlert: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).yieldAlert.findMany({
        where: { status: q.status, severity: q.severity },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      });
      res.json(alerts);
    } catch (err) {
      next(err);
    }
  },
);

const alertAckSchema = z.object({
  ackNotes: z.string().max(1000).optional().nullable(),
});
type AlertAckBody = z.infer<typeof alertAckSchema>;

router.post(
  '/yield-alerts/:id/acknowledge',
  m4Approve,
  validateParams(idParamSchema),
  validateBody(alertAckSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as AlertAckBody;
      const alert = await prisma.$transaction((tx) =>
        acknowledgeYieldAlert(tx, id, userId, b.ackNotes),
      );
      res.json(alert);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Shift handovers ───────────────────────────────────────────────────────

const handoverSchema = z.object({
  noteType: z.enum(['HANDOVER', 'OPERATOR_NOTE']).optional().default('HANDOVER'),
  content: z.string().min(1).max(2000),
});
type HandoverBody = z.infer<typeof handoverSchema>;

router.get(
  '/shifts/:id/handovers',
  m4View,
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const notes = await (prisma as unknown as {
        shiftHandover: { findMany(args: unknown): Promise<Record<string, unknown>[]> };
      }).shiftHandover.findMany({
        where: { shiftRunId: id },
        orderBy: { createdAt: 'desc' },
      });
      res.json(notes);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/shifts/:id/handovers',
  m4Manage,
  validateParams(idParamSchema),
  validateBody(handoverSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as HandoverBody;
      const note = await prisma.$transaction((tx) =>
        createShiftHandover(tx, id, userId, b.noteType, b.content),
      );
      res.status(201).json(note);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reports ─────────────────────────────────────────────────────────────

const dailyReportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});
type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

const shiftReportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  shift: z.enum(['MORNING', 'NIGHT']),
});
type ShiftReportQuery = z.infer<typeof shiftReportQuerySchema>;

router.get(
  '/reports/daily',
  m4View,
  validateQuery(dailyReportQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as DailyReportQuery;
      const report = await prisma.$transaction((tx) => dailyProductionReport(tx, q.date));
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/shift',
  m4View,
  validateQuery(shiftReportQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as ShiftReportQuery;
      const report = await prisma.$transaction((tx) => shiftProductionReport(tx, q.date, q.shift));
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);
