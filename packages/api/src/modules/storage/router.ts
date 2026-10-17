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
  const [inAgg, outAgg, movements] = await Promise.all([
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'IN' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.aggregate({
      where: { locationCode: 'DRY_POOL', direction: 'OUT' },
      _sum: { quintals: true },
    }),
    prisma.storageMovement.count({ where: { locationCode: 'DRY_POOL' } }),
  ]);
  const balanceQ = (inAgg._sum.quintals ?? new Prisma.Decimal(0)).minus(
    outAgg._sum.quintals ?? new Prisma.Decimal(0),
  );
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
      return {
        code: t.code,
        name: t.name,
        capacityQ: t.capacityQ.toNumber(),
        levelQ,
        note,
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
