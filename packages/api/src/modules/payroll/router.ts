import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PieceStage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit } from '../../lib/audit';
import { computePayrollRun } from './service';
import { postJournal } from '../finance/service';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

// ─── Piece-rate configs ─────────────────────────────────────────

router.get('/piece-rates', requirePermission('payroll:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.pieceRateConfig.findMany({ orderBy: { stage: 'asc' } });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const pieceRateUpsertSchema = z.object({
  stage: z.nativeEnum(PieceStage),
  rateBirrPerQ: z.number().positive(),
});

router.post(
  '/piece-rates',
  requirePermission('payroll:manage'),
  validateBody(pieceRateUpsertSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof pieceRateUpsertSchema>;
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.pieceRateConfig.findUnique({ where: { stage: body.stage } });
        const row = existing
          ? await tx.pieceRateConfig.update({
              where: { stage: body.stage },
              data: { rateBirrPerQ: new Prisma.Decimal(body.rateBirrPerQ), isActive: true },
            })
          : await tx.pieceRateConfig.create({
              data: {
                stage: body.stage,
                rateBirrPerQ: new Prisma.Decimal(body.rateBirrPerQ),
                isActive: true,
              },
            });
        await audit(tx, {
          userId: uid,
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'PieceRateConfig',
          entityId: row.id,
          changes: { stage: body.stage, rateBirrPerQ: body.rateBirrPerQ },
        });
        return row;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Piece-rate logs ────────────────────────────────────────────

const pieceLogsQuerySchema = z.object({
  stage: z.nativeEnum(PieceStage).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  laborer: z.string().optional(),
});

router.get(
  '/piece-logs',
  requirePermission('payroll:view'),
  validateQuery(pieceLogsQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof pieceLogsQuerySchema>;
      const rows = await prisma.pieceRateLog.findMany({
        where: {
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.laborer ? { laborer: { contains: q.laborer, mode: 'insensitive' } } : {}),
          ...(q.from || q.to
            ? {
                loggedAt: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lte: new Date(q.to) } : {}),
                },
              }
            : {}),
        },
        orderBy: { loggedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const pieceLogCreateSchema = z.object({
  stage: z.nativeEnum(PieceStage),
  laborer: z.string().min(1),
  quintals: z.number().positive(),
  truckPlate: z.string().optional(),
});

router.post(
  '/piece-logs',
  requirePermission('payroll:manage'),
  validateBody(pieceLogCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof pieceLogCreateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.pieceRateLog.create({
          data: {
            stage: body.stage,
            laborer: body.laborer,
            quintals: new Prisma.Decimal(body.quintals),
            truckPlate: body.truckPlate ?? null,
            loggedById: uid,
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'PieceRateLog',
          entityId: created.id,
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Driver trip rate ───────────────────────────────────────────

router.get('/driver-trip-rate', requirePermission('payroll:view'), async (_req, res, next) => {
  try {
    const row = await prisma.driverTripRate.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

const driverTripRateSchema = z.object({
  rateBirrPerTrip: z.number().positive(),
});

router.post(
  '/driver-trip-rate',
  requirePermission('payroll:manage'),
  validateBody(driverTripRateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof driverTripRateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        await tx.driverTripRate.updateMany({ where: { isActive: true }, data: { isActive: false } });
        const created = await tx.driverTripRate.create({
          data: {
            rateBirrPerTrip: new Prisma.Decimal(body.rateBirrPerTrip),
            isActive: true,
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'DriverTripRate',
          entityId: created.id,
          changes: { rateBirrPerTrip: body.rateBirrPerTrip },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payroll runs ───────────────────────────────────────────────

router.get('/runs', requirePermission('payroll:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.payrollRun.findMany({
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const runIdParamsSchema = z.object({ id: z.string().min(1) });

router.get(
  '/runs/:id',
  requirePermission('payroll:view'),
  validateParams(runIdParamsSchema),
  async (req, res, next) => {
    try {
      const run = await prisma.payrollRun.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { employee: true } } },
      });
      if (!run) throw new AppError(404, 'Payroll run not found');
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

const computeRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

router.post(
  '/runs',
  requirePermission('payroll:manage'),
  validateBody(computeRunSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof computeRunSchema>;
      try {
        const run = await prisma.$transaction(async (tx) =>
          computePayrollRun(tx, body.year, body.month, uid),
        );
        res.status(201).json(run);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(409, 'Payroll run already exists for period');
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/runs/:id/post',
  requirePermission('payroll:approve'),
  validateParams(runIdParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const result = await prisma.$transaction(async (tx) => {
        const run = await tx.payrollRun.findUnique({
          where: { id: req.params.id },
          include: { lines: true },
        });
        if (!run) throw new AppError(404, 'Payroll run not found');
        if (run.status !== 'DRAFT') throw new AppError(409, 'Only DRAFT runs can be posted');

        let total = new Prisma.Decimal(0);
        for (const line of run.lines) {
          total = total.plus(line.grossBirr);
        }

        await tx.payrollRun.update({
          where: { id: run.id },
          data: { status: 'POSTED' },
        });

        await postJournal(tx, {
          entryDate: new Date(),
          memo: `Payroll ${run.periodYear}-${run.periodMonth}`,
          module: 'payroll',
          referenceType: 'PayrollRun',
          referenceId: run.id,
          createdById: uid,
          lines: [
            { accountCode: '6000', debit: total, credit: new Prisma.Decimal(0) },
            { accountCode: '1000', debit: new Prisma.Decimal(0), credit: total },
          ],
        });

        await audit(tx, {
          userId: uid,
          action: 'POST',
          entityType: 'PayrollRun',
          entityId: run.id,
          changes: { status: 'POSTED', totalBirr: total.toNumber() },
        });

        return tx.payrollRun.findUniqueOrThrow({
          where: { id: run.id },
          include: { lines: true },
        });
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
