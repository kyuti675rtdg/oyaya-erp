import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit, type DbClient } from '../../lib/audit';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
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

const view = requirePermission('storage:view');
const manage = requirePermission('storage:manage');

const tankParam = z.object({ code: z.string().min(1) });
const LIST_TAKE = 200;

const TANK_CODES = ['TANK_A', 'TANK_B', 'TANK_C'] as const;

/** Net tank level = Σ fills − Σ (partial-empty + emptied) events, clamped ≥ 0. */
async function tankLevel(db: DbClient, tankCode: string): Promise<Prisma.Decimal> {
  const [fills, events] = await Promise.all([
    db.tankFill.aggregate({ where: { tankCode }, _sum: { quintals: true } }),
    db.tankEvent.aggregate({
      where: { tankCode, event: { in: ['PARTIAL_EMPTY', 'EMPTIED'] } },
      _sum: { quintals: true },
    }),
  ]);
  const level = (fills._sum.quintals ?? new Prisma.Decimal(0)).minus(
    events._sum.quintals ?? new Prisma.Decimal(0),
  );
  return level.lt(0) ? new Prisma.Decimal(0) : level;
}

async function requireActiveTank(db: DbClient, code: string) {
  const tank = await db.storageLocation.findUnique({ where: { code } });
  if (!tank) throw new AppError(404, `Tank ${code} not configured`);
  if (!tank.isActive) throw new AppError(400, `Tank ${code} is inactive`);
  return tank;
}

// ─── Dry pool ───────────────────────────────────────────────────

router.get('/dry-pool', view, ah(async (_req, res) => {
  const loc = await prisma.storageLocation.findUnique({ where: { code: 'DRY_POOL' } });
  if (!loc) throw new AppError(404, 'DRY_POOL storage location not configured');
  const [inAgg, outAgg, adjInAgg, adjOutAgg, movements] = await Promise.all([
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'IN' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'OUT' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'ADJUST', reference: 'ADJUST_IN' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'ADJUST', reference: 'ADJUST_OUT' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.count({ where: { locationCode: 'DRY_POOL' } }),
  ]);
  const d0 = new Prisma.Decimal(0);
  const balanceQ = (inAgg._sum.quintals ?? d0)
    .add(adjInAgg._sum.quintals ?? d0)
    .minus(outAgg._sum.quintals ?? d0)
    .minus(adjOutAgg._sum.quintals ?? d0);
  res.json({
    code: loc.code,
    capacityQ: loc.capacityQ.toNumber(),
    balanceQ: balanceQ.toNumber(),
    movements,
  });
}));

// ─── Movements ──────────────────────────────────────────────────

const movementQuerySchema = z.object({
  locationCode: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/movements',
  view,
  validateQuery(movementQuerySchema),
  ah(async (req, res) => {
    const q = movementQuerySchema.parse(req.query);
    const where: Prisma.StorageMovementWhereInput = {
      locationCode: q.locationCode,
      movedAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    res.json(
      await prisma.storageMovement.findMany({
        where,
        orderBy: { movedAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

// ─── Conditioning tanks ─────────────────────────────────────────

router.get('/tanks', view, ah(async (_req, res) => {
  const tanks = await prisma.storageLocation.findMany({
    where: { code: { in: [...TANK_CODES] } },
    orderBy: { code: 'asc' },
  });
  const result = await Promise.all(
    tanks.map(async (t) => {
      const rawLevel = await tankLevel(prisma, t.code);
      const [lastFill, lastEvent] = await Promise.all([
        prisma.tankFill.findFirst({ where: { tankCode: t.code }, orderBy: { filledAt: 'desc' } }),
        prisma.tankEvent.findFirst({ where: { tankCode: t.code }, orderBy: { occurredAt: 'desc' } }),
      ]);
      let levelQ = rawLevel.toNumber();
      let note: string | null = null;
      if (rawLevel.lte(2)) {
        levelQ = 0;
        note = 'residual ≤2q tolerated';
      }
      const statusInfo = await tankStatusInfo(prisma, t.code);
      return {
        code: t.code,
        name: t.name,
        capacityQ: t.capacityQ.toNumber(),
        levelQ,
        note,
        status: statusInfo.status,
        activeCycle: statusInfo.activeCycle,
        lastFillAt: lastFill?.filledAt ?? null,
        elapsedHrs:
          lastFill === null
            ? null
            : Math.round(((Date.now() - lastFill.filledAt.getTime()) / 3600000) * 10) / 10,
        lastEvent: lastEvent
          ? { event: lastEvent.event, occurredAt: lastEvent.occurredAt }
          : null,
      };
    }),
  );
  res.json(result);
}));

const fillSchema = z.object({
  intakeId: z.string().min(1).optional(),
  quintals: z.number().positive(),
  blendRatio: z.record(z.string(), z.number()).optional(),
  wheatType: z.enum(['SOFT', 'HARD', 'FOREIGN']).optional(),
});

router.post(
  '/tanks/:code/fills',
  manage,
  validateParams(tankParam),
  validateBody(fillSchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = fillSchema.parse(req.body);
    const uid = requireUid(req);
    const fill = await prisma.$transaction(async (tx) => {
      await requireActiveTank(tx, tankCode);
      if (body.intakeId) {
        const intake = await tx.wheatIntake.findUnique({ where: { id: body.intakeId } });
        if (!intake) throw new AppError(404, 'Intake not found');
      }
      const quintals = new Prisma.Decimal(body.quintals);
      // Capacity guard: fill must not exceed free space in the tank
      const level = await tankLevel(tx, tankCode);
      const tank = await requireActiveTank(tx, tankCode);
      const freeQ = tank.capacityQ.minus(level);
      if (quintals.gt(freeQ)) {
        throw new AppError(
          400,
          `Fill of ${quintals.toFixed(1)}q exceeds free space of ${freeQ.toFixed(1)}q in ${tankCode}`,
        );
      }
      const created = await tx.tankFill.create({
        data: {
          tankCode,
          intakeId: body.intakeId ?? null,
          quintals,
          blendRatio: (body.blendRatio ?? undefined) as Prisma.InputJsonValue | undefined,
          filledById: uid,
        },
      });
      await tx.storageMovement.create({
        data: {
          locationCode: 'DRY_POOL',
          direction: 'OUT',
          quintals,
          wheatType: body.wheatType ?? null,
          reference: `TANK_FILL:${created.id}`,
          movedById: uid,
        },
      });
      await audit(tx, {
        userId: uid,
        action: 'CREATE',
        entityType: 'TankFill',
        entityId: created.id,
        changes: { tankCode, intakeId: body.intakeId ?? null, quintals: body.quintals },
      });
      return created;
    });
    res.status(201).json(fill);
  }),
);

const emptySchema = z.object({
  quintals: z.number().positive(),
  partial: z.boolean().optional(),
});

router.post(
  '/tanks/:code/empty',
  manage,
  validateParams(tankParam),
  validateBody(emptySchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = emptySchema.parse(req.body);
    const uid = requireUid(req);
    const event = await prisma.$transaction(async (tx) => {
      await requireActiveTank(tx, tankCode);
      const level = await tankLevel(tx, tankCode);
      const requested = new Prisma.Decimal(body.quintals);
      if (requested.gt(level)) {
        throw new AppError(
          400,
          `Requested ${requested.toFixed(2)}q exceeds tank ${tankCode} level of ${level.toFixed(2)}q`,
        );
      }
      const created = body.partial
        ? await tx.tankEvent.create({
            data: { tankCode, event: 'PARTIAL_EMPTY', quintals: requested, byId: uid },
          })
        : await tx.tankEvent.create({
            data: {
              tankCode,
              event: 'EMPTIED',
              quintals: level,
              note: 'full drain; residual ≤2q absorbed',
              byId: uid,
            },
          });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'TankEvent',
        entityId: created.id,
        changes: { tankCode, event: created.event, quintals: created.quintals?.toFixed(2) ?? null },
      });
      return created;
    });
    res.status(201).json(event);
  }),
);

const markReadySchema = z.object({
  note: z.string().optional(),
});

router.post(
  '/tanks/:code/mark-ready',
  manage,
  validateParams(tankParam),
  validateBody(markReadySchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = markReadySchema.parse(req.body);
    const uid = requireUid(req);
    const event = await prisma.$transaction(async (tx) => {
      await requireActiveTank(tx, tankCode);
      const created = await tx.tankEvent.create({
        data: { tankCode, event: 'MARKED_READY', note: body.note ?? null, byId: uid },
      });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'TankEvent',
        entityId: created.id,
        changes: { tankCode, event: 'MARKED_READY', note: body.note ?? null },
      });
      return created;
    });
    res.status(201).json(event);
  }),
);

router.get(
  '/tanks/:code/events',
  view,
  validateParams(tankParam),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    res.json(
      await prisma.tankEvent.findMany({
        where: { tankCode },
        orderBy: { occurredAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

// ─── Conditioning status derivation ─────────────────────────────────

export type TankStatus = 'Empty' | 'Filling' | 'Conditioning' | 'Ready' | 'In Use' | 'Cleaning';

interface TankStatusInfo {
  status: TankStatus;
  activeCycle: {
    id: string;
    batchNo: string;
    startedAt: Date;
    requiredHrs: number;
    elapsedHrs: number;
    remainingHrs: number;
    completedAt: Date | null;
    releasedAt: Date | null;
    moistureAfter: number | null;
  } | null;
}

/** Derive a tank's operational status from level, events and active cycle. */
export async function tankStatusInfo(db: DbClient, tankCode: string): Promise<TankStatusInfo> {
  const [level, lastEvent, activeCycle] = await Promise.all([
    tankLevel(db, tankCode),
    db.tankEvent.findFirst({ where: { tankCode }, orderBy: { occurredAt: 'desc' } }),
    db.conditioningCycle.findFirst({
      where: { tankCode, releasedAt: null },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const levelQ = level.toNumber();

  let cycle = null;
  if (activeCycle) {
    const elapsedHrs = (Date.now() - activeCycle.startedAt.getTime()) / 3600000;
    const requiredHrs = activeCycle.requiredHrs.toNumber();
    cycle = {
      id: activeCycle.id,
      batchNo: activeCycle.batchNo,
      startedAt: activeCycle.startedAt,
      requiredHrs,
      elapsedHrs: Math.round(elapsedHrs * 10) / 10,
      remainingHrs: Math.max(0, Math.round((requiredHrs - elapsedHrs) * 10) / 10),
      completedAt: activeCycle.completedAt,
      releasedAt: activeCycle.releasedAt,
      moistureAfter: activeCycle.moistureAfter ? activeCycle.moistureAfter.toNumber() : null,
    };
  }

  let status: TankStatus;
  if (lastEvent?.event === 'CLEANING_STARTED') {
    status = 'Cleaning';
  } else if (levelQ <= 2) {
    status = 'Empty';
  } else if (cycle && !cycle.completedAt) {
    status = 'Conditioning';
  } else if (cycle && cycle.completedAt && !cycle.releasedAt) {
    status = 'Ready';
  } else if (lastEvent?.event === 'RELEASED_TO_MILLING' && levelQ > 2) {
    status = 'In Use';
  } else if (lastEvent?.event === 'MARKED_READY') {
    status = 'Ready';
  } else {
    status = 'Filling';
  }
  return { status, activeCycle: cycle };
}

// ─── Conditioning cycles ────────────────────────────────────────────

const startCycleSchema = z.object({
  requiredHrs: z.number().positive().max(72),
  waterAddedQ: z.number().nonnegative().optional(),
  moistureBefore: z.number().min(0).max(30).optional(),
  blendRatio: z.record(z.string(), z.number()).optional(),
  notes: z.string().max(500).optional(),
});

router.post(
  '/tanks/:code/conditioning/start',
  manage,
  validateParams(tankParam),
  validateBody(startCycleSchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = startCycleSchema.parse(req.body);
    const uid = requireUid(req);
    const result = await prisma.$transaction(async (tx) => {
      await requireActiveTank(tx, tankCode);
      const level = await tankLevel(tx, tankCode);
      if (level.lte(2)) throw new AppError(400, `Tank ${tankCode} is empty — fill it before starting conditioning`);
      const existing = await tx.conditioningCycle.findFirst({
        where: { tankCode, releasedAt: null },
      });
      if (existing) throw new AppError(400, `Tank ${tankCode} already has an active conditioning cycle (${existing.batchNo})`);
      const { nextDocNo } = await import('../../lib/numbers');
      const batchNo = await nextDocNo(tx, 'conditioningCycle', 'batchNo', 'PB');
      const cycle = await tx.conditioningCycle.create({
        data: {
          tankCode,
          batchNo,
          blendRatio: (body.blendRatio ?? undefined) as Prisma.InputJsonValue | undefined,
          requiredHrs: new Prisma.Decimal(body.requiredHrs),
          waterAddedQ: body.waterAddedQ != null ? new Prisma.Decimal(body.waterAddedQ) : null,
          moistureBefore: body.moistureBefore != null ? new Prisma.Decimal(body.moistureBefore) : null,
          notes: body.notes ?? null,
        },
      });
      await tx.tankEvent.create({
        data: { tankCode, event: 'CONDITIONING_STARTED', note: `Batch ${batchNo}`, byId: uid },
      });
      await audit(tx, {
        userId: uid,
        action: 'CREATE',
        entityType: 'ConditioningCycle',
        entityId: cycle.id,
        changes: { tankCode, batchNo, requiredHrs: body.requiredHrs },
      });
      return cycle;
    });
    res.status(201).json(result);
  }),
);

const waterSchema = z.object({
  waterAddedQ: z.number().positive(),
  note: z.string().max(300).optional(),
});

router.post(
  '/tanks/:code/conditioning/water',
  manage,
  validateParams(tankParam),
  validateBody(waterSchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = waterSchema.parse(req.body);
    const uid = requireUid(req);
    const cycle = await prisma.$transaction(async (tx) => {
      const active = await tx.conditioningCycle.findFirst({
        where: { tankCode, releasedAt: null, completedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!active) throw new AppError(400, `No active conditioning cycle on ${tankCode}`);
      const updated = await tx.conditioningCycle.update({
        where: { id: active.id },
        data: {
          waterAddedQ: (active.waterAddedQ ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(body.waterAddedQ)),
        },
      });
      await tx.tankEvent.create({
        data: { tankCode, event: 'WATER_ADDED', quintals: new Prisma.Decimal(body.waterAddedQ), note: body.note ?? null, byId: uid },
      });
      return updated;
    });
    res.json(cycle);
  }),
);

const completeCycleSchema = z.object({
  moistureAfter: z.number().min(0).max(30),
  notes: z.string().max(500).optional(),
});

router.post(
  '/tanks/:code/conditioning/complete',
  manage,
  validateParams(tankParam),
  validateBody(completeCycleSchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = completeCycleSchema.parse(req.body);
    const uid = requireUid(req);
    const cycle = await prisma.$transaction(async (tx) => {
      const active = await tx.conditioningCycle.findFirst({
        where: { tankCode, releasedAt: null, completedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!active) throw new AppError(400, `No active conditioning cycle on ${tankCode}`);
      const elapsedHrs = (Date.now() - active.startedAt.getTime()) / 3600000;
      if (elapsedHrs < active.requiredHrs.toNumber()) {
        throw new AppError(400, `Conditioning not yet complete: ${elapsedHrs.toFixed(1)}h elapsed of ${active.requiredHrs.toNumber()}h required`);
      }
      const updated = await tx.conditioningCycle.update({
        where: { id: active.id },
        data: {
          completedAt: new Date(),
          completedById: uid,
          moistureAfter: new Prisma.Decimal(body.moistureAfter),
          notes: body.notes ?? active.notes,
        },
      });
      await tx.tankEvent.create({
        data: { tankCode, event: 'CONDITIONING_COMPLETE', note: `Moisture ${body.moistureAfter}%`, byId: uid },
      });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'ConditioningCycle',
        entityId: updated.id,
        changes: { completed: true, moistureAfter: body.moistureAfter },
      });
      return updated;
    });
    res.json(cycle);
  }),
);

// ─── Tank release to milling ────────────────────────────────────────

const releaseSchema = z.object({
  moistureVerified: z.boolean(),
  timeMet: z.boolean(),
  labApproved: z.boolean(),
  note: z.string().max(500).optional(),
});

router.post(
  '/tanks/:code/release',
  manage,
  validateParams(tankParam),
  validateBody(releaseSchema),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = releaseSchema.parse(req.body);
    const uid = requireUid(req);
    if (!body.moistureVerified || !body.timeMet || !body.labApproved) {
      throw new AppError(400, 'All pre-milling checklist items must be confirmed before release');
    }
    const result = await prisma.$transaction(async (tx) => {
      await requireActiveTank(tx, tankCode);
      const cycle = await tx.conditioningCycle.findFirst({
        where: { tankCode, releasedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (cycle && !cycle.completedAt) {
        throw new AppError(400, `Conditioning cycle ${cycle.batchNo} is not marked complete yet`);
      }
      if (cycle) {
        await tx.conditioningCycle.update({
          where: { id: cycle.id },
          data: { releasedAt: new Date(), releasedById: uid },
        });
      }
      const event = await tx.tankEvent.create({
        data: { tankCode, event: 'RELEASED_TO_MILLING', note: body.note ?? (cycle ? `Batch ${cycle.batchNo}` : null), byId: uid },
      });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'TankEvent',
        entityId: event.id,
        changes: { tankCode, event: 'RELEASED_TO_MILLING' },
      });
      return { event, batchNo: cycle?.batchNo ?? null };
    });
    res.status(201).json(result);
  }),
);

router.post(
  '/tanks/:code/cleaning',
  manage,
  validateParams(tankParam),
  validateBody(z.object({ start: z.boolean(), note: z.string().max(300).optional() })),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const body = z.object({ start: z.boolean(), note: z.string().max(300).optional() }).parse(req.body);
    const uid = requireUid(req);
    const event = await prisma.tankEvent.create({
      data: {
        tankCode,
        event: body.start ? 'CLEANING_STARTED' : 'CLEANING_DONE',
        note: body.note ?? null,
        byId: uid,
      },
    });
    res.status(201).json(event);
  }),
);

router.get(
  '/tanks/:code/cycle',
  view,
  validateParams(tankParam),
  ah(async (req, res) => {
    const { code } = tankParam.parse(req.params);
    const tankCode = code.toUpperCase();
    const info = await tankStatusInfo(prisma, tankCode);
    res.json({ tankCode, ...info });
  }),
);

const cycleQuerySchema = z.object({
  tankCode: z.string().min(1).optional(),
  active: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/cycles',
  view,
  validateQuery(cycleQuerySchema),
  ah(async (req, res) => {
    const q = cycleQuerySchema.parse(req.query);
    const where: Prisma.ConditioningCycleWhereInput = {
      tankCode: q.tankCode,
      startedAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    if (q.active === true) where.releasedAt = null;
    if (q.active === false) where.releasedAt = { not: null };
    res.json(
      await prisma.conditioningCycle.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

// ─── Blend tracking ─────────────────────────────────────────────────

router.get('/blends', view, ah(async (_req, res) => {
  const result = await Promise.all(
    TANK_CODES.map(async (tankCode) => {
      const level = await tankLevel(prisma, tankCode);
      const fills = await prisma.tankFill.findMany({
        where: { tankCode },
        orderBy: { filledAt: 'desc' },
        take: 20,
      });
      // Weighted blend from recent fills (simple: latest fill's ratio, or weighted)
      let total = new Prisma.Decimal(0);
      const acc: Record<string, Prisma.Decimal> = { soft: new Prisma.Decimal(0), hard: new Prisma.Decimal(0), foreign: new Prisma.Decimal(0) };
      for (const f of fills) {
        total = total.add(f.quintals);
        const ratio = (f.blendRatio ?? {}) as Record<string, number>;
        for (const k of Object.keys(acc)) {
          const pct = Number(ratio[k] ?? 0);
          acc[k] = acc[k].add(f.quintals.mul(pct).div(100));
        }
      }
      const blend = total.gt(0)
        ? {
            soft: Math.round(acc.soft.div(total).mul(100).toNumber() * 10) / 10,
            hard: Math.round(acc.hard.div(total).mul(100).toNumber() * 10) / 10,
            foreign: Math.round(acc.foreign.div(total).mul(100).toNumber() * 10) / 10,
          }
        : null;
      const activeCycle = await prisma.conditioningCycle.findFirst({
        where: { tankCode, releasedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      return {
        tankCode,
        levelQ: level.toNumber(),
        blend,
        batchNo: activeCycle?.batchNo ?? null,
        history: fills.map((f) => ({
          id: f.id,
          quintals: f.quintals.toNumber(),
          blendRatio: f.blendRatio,
          filledAt: f.filledAt,
        })),
      };
    }),
  );
  res.json(result);
}));

// ─── Dry pool detail + adjustments ──────────────────────────────────

router.get('/dry-pool/detail', view, ah(async (_req, res) => {
  const group = async (direction: string, reference?: string) =>
    prisma.storageMovement.groupBy({
      by: ['wheatType'],
      where: { locationCode: 'DRY_POOL', direction, reference },
      _sum: { quintals: true },
    });
  const [inAgg, outAgg, adjIn, adjOut] = await Promise.all([
    group('IN'),
    group('OUT'),
    group('ADJUST', 'ADJUST_IN'),
    group('ADJUST', 'ADJUST_OUT'),
  ]);
  const breakdown: Record<string, number> = {};
  const add = (rows: Array<{ wheatType: string | null; _sum: { quintals: Prisma.Decimal | null } }>, sign: 1 | -1) => {
    for (const r of rows) {
      const key = (r.wheatType ?? 'UNKNOWN').toLowerCase();
      breakdown[key] = (breakdown[key] ?? 0) + sign * (r._sum.quintals?.toNumber() ?? 0);
    }
  };
  add(inAgg, 1);
  add(adjIn, 1);
  add(outAgg, -1);
  add(adjOut, -1);
  const loc = await prisma.storageLocation.findUnique({ where: { code: 'DRY_POOL' } });
  const capacityQ = loc?.capacityQ.toNumber() ?? 7000;
  const balanceQ = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const LOW_PCT = 0.15;
  const HIGH_PCT = 0.95;
  const pct = capacityQ > 0 ? balanceQ / capacityQ : 0;
  const alerts: Array<{ level: 'low' | 'high' | 'info'; message: string }> = [];
  if (pct < LOW_PCT) alerts.push({ level: 'low', message: `Dry pool below ${(LOW_PCT * 100).toFixed(0)}% capacity — schedule procurement` });
  if (pct > HIGH_PCT) alerts.push({ level: 'high', message: `Dry pool above ${(HIGH_PCT * 100).toFixed(0)}% capacity — pause intake` });
  res.json({ capacityQ, balanceQ, pct: Math.round(pct * 1000) / 10, breakdown, alerts });
}));

const adjustSchema = z.object({
  quintals: z.number(), // positive = add, negative = remove
  wheatType: z.enum(['SOFT', 'HARD', 'FOREIGN']).optional(),
  reason: z.string().min(3).max(300),
});

router.post(
  '/dry-pool/adjust',
  manage,
  validateBody(adjustSchema),
  ah(async (req, res) => {
    const body = adjustSchema.parse(req.body);
    const uid = requireUid(req);
    if (body.quintals === 0) throw new AppError(400, 'Adjustment quantity cannot be zero');
    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.storageMovement.create({
        data: {
          locationCode: 'DRY_POOL',
          direction: 'ADJUST',
          quintals: new Prisma.Decimal(Math.abs(body.quintals)),
          wheatType: body.wheatType ?? null,
          reference: body.quintals > 0 ? 'ADJUST_IN' : 'ADJUST_OUT',
          notes: body.reason,
          movedById: uid,
        },
      });
      await audit(tx, {
        userId: uid,
        action: 'CREATE',
        entityType: 'StorageMovement',
        entityId: created.id,
        changes: { locationCode: 'DRY_POOL', quintals: body.quintals, reason: body.reason },
      });
      return created;
    });
    res.status(201).json(movement);
  }),
);

// ─── Movement filters ───────────────────────────────────────────────

const movementFilterSchema = z.object({
  locationCode: z.string().min(1).optional(),
  direction: z.enum(['IN', 'OUT', 'ADJUST']).optional(),
  wheatType: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/movements/filtered',
  view,
  validateQuery(movementFilterSchema),
  ah(async (req, res) => {
    const q = movementFilterSchema.parse(req.query);
    const where: Prisma.StorageMovementWhereInput = {
      locationCode: q.locationCode,
      direction: q.direction,
      wheatType: q.wheatType,
      movedAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    const rows = await prisma.storageMovement.findMany({
      where,
      orderBy: { movedAt: 'desc' },
      take: LIST_TAKE,
    });
    res.json(rows);
  }),
);
