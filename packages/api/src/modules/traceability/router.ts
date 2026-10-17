import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission, requireRoles } from '../../middleware/rbac';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';

export const router = Router();

const batchNoParamsSchema = z.object({ batchNo: z.string().min(1) });

router.get(
  '/batch/:batchNo',
  requirePermission('traceability:view'),
  requireRoles('Production Manager', 'Quality / Lab Head', 'Owner / CEO'),
  validateParams(batchNoParamsSchema),
  async (req, res, next) => {
    try {
      const { batchNo } = req.params;

      const batch = await prisma.productionBatch.findUnique({
        where: { batchNo },
        include: {
          sources: { include: { intake: { include: { supplier: true } } } },
          shifts: { include: { outputs: { include: { product: true } } } },
          labChecks: true,
          capas: true,
          packRuns: { include: { product: true } },
        },
      });
      if (!batch) throw new AppError(404, 'Production batch not found');

      const sourceIntakeIds = batch.sources.map((s) => s.intakeId);

      const [tankFills, dispatchLines] = await Promise.all([
        prisma.tankFill.findMany({
          where: { intakeId: { in: sourceIntakeIds } },
          include: { intake: true },
          orderBy: { filledAt: 'asc' },
        }),
        prisma.dispatchLine.findMany({
          where: { batchNo: batch.batchNo },
          include: {
            dispatch: { include: { vehicle: true, invoice: true } },
            product: true,
          },
          orderBy: { dispatch: { dispatchedAt: 'asc' } },
        }),
      ]);

      res.json({
        batch: {
          batchNo: batch.batchNo,
          productType: batch.productType,
          status: batch.status,
          blend: {
            softPct: batch.blendSoftPct,
            hardPct: batch.blendHardPct,
            foreignPct: batch.blendForeignPct,
            softQ: batch.blendSoftQ,
            hardQ: batch.blendHardQ,
            foreignQ: batch.blendForeignQ,
          },
          wheatWeighedQ: batch.wheatWeighedQ,
          createdAt: batch.createdAt,
        },
        intakeSources: batch.sources,
        tankFills,
        shifts: batch.shifts,
        labChecks: batch.labChecks,
        capas: batch.capas,
        packagingRuns: batch.packRuns,
        dispatchLines,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Module 12: Product Traceability Management ──────────────────────
// Full-chain genealogy: WheatIntake → TankFill / ConditioningCycle →
// ProductionBatch → QC → PackagingRun → FinishedGoodsStock → Dispatch/Sales.

const VIEW = requirePermission('traceability:view');
const QC_MANAGE = requirePermission('qc:manage');

/** Downstream of one production batch: packaging, FG lots, dispatches/customers. */
async function batchDownstream(batchId: string, batchNo: string) {
  const [packRuns, fgLots, dispatchLines] = await Promise.all([
    prisma.packagingRun.findMany({
      where: { batchId },
      include: { product: true },
      orderBy: { packedAt: 'asc' },
    }),
    prisma.finishedGoodsStock.findMany({
      where: { batchNo },
      include: { product: true },
      orderBy: { receivedAt: 'asc' },
    }),
    prisma.dispatchLine.findMany({
      where: { batchNo },
      include: {
        dispatch: { include: { vehicle: true } },
        order: { include: { customer: true } },
        product: true,
      },
      orderBy: { dispatch: { dispatchedAt: 'asc' } },
    }),
  ]);
  const customers = new Map<string, { name: string; quintals: number; bags: number }>();
  for (const dl of dispatchLines) {
    const name = dl.order?.customer?.name ?? 'Walk-in / no sales order';
    const cur = customers.get(name) ?? { name, quintals: 0, bags: 0 };
    cur.quintals += Number(dl.quintals);
    cur.bags += dl.bags;
    customers.set(name, cur);
  }
  return { packRuns, fgLots, dispatchLines, customers: [...customers.values()] };
}

/** Upstream of one production batch: intakes → tank fills, conditioning cycles. */
async function batchUpstream(batchId: string, batchNo: string) {
  const sources = await prisma.batchIntakeSource.findMany({
    where: { batchId },
    include: { intake: { include: { supplier: true } } },
  });
  const intakeIds = sources.map((s) => s.intakeId);
  const [tankFills, cycles] = await Promise.all([
    intakeIds.length
      ? prisma.tankFill.findMany({
          where: { intakeId: { in: intakeIds } },
          include: { intake: true },
          orderBy: { filledAt: 'asc' },
        })
      : [],
    prisma.conditioningCycle.findMany({
      where: { batchNo },
      orderBy: { startedAt: 'asc' },
    }),
  ]);
  return { sources, tankFills, cycles };
}

/** All quality evidence attached to one production batch. */
async function batchQuality(batchId: string) {
  const [labChecks, flourTests, nonconformities, capas] = await Promise.all([
    prisma.labCheck.findMany({
      where: { batchId },
      include: { shiftRun: true },
      orderBy: { sampleTime: 'asc' },
    }),
    prisma.flourQualityTest.findMany({
      where: { batchId },
      orderBy: { sampleTime: 'asc' },
    }),
    prisma.nonconformity.findMany({
      where: { batchId },
      include: { rootCause: true, actions: true, disposition: true, linkedCapa: true },
      orderBy: { dateDetected: 'desc' },
    }),
    prisma.cAPA.findMany({
      where: { batchId },
      orderBy: { dateIdentified: 'desc' },
    }),
  ]);
  return { labChecks, flourTests, nonconformities, capas };
}

const chainParamsSchema = z.object({
  type: z.enum(['intake', 'tank-cycle', 'batch', 'lot']),
  id: z.string().min(1),
});

/**
 * GET /traceability/chain/:type/:id — full upstream + downstream chain.
 */
router.get('/chain/:type/:id', VIEW, validateParams(chainParamsSchema), async (req, res, next) => {
  try {
    const { type, id } = req.params;

    if (type === 'intake') {
      const intake = await prisma.wheatIntake.findUnique({
        where: { id },
        include: { supplier: true, unloadingLabor: true },
      });
      if (!intake) throw new AppError(404, 'Intake not found');
      const batchSources = await prisma.batchIntakeSource.findMany({
        where: { intakeId: id },
        include: { batch: { include: { _count: { select: { shifts: true, labChecks: true, packRuns: true } } } } },
      });
      const tankFills = await prisma.tankFill.findMany({
        where: { intakeId: id },
        orderBy: { filledAt: 'asc' },
      });
      const downstream: Array<Record<string, unknown>> = [];
      for (const bs of batchSources) {
        const b = bs.batch;
        downstream.push({ batch: b, ...(await batchDownstream(b.id, b.batchNo)) });
      }
      res.json({ type, intake, tankFills, batches: batchSources, downstream });
      return;
    }

    if (type === 'tank-cycle') {
      const cycle = await prisma.conditioningCycle.findUnique({ where: { id } });
      if (!cycle) throw new AppError(404, 'Conditioning cycle not found');
      const batches = await prisma.productionBatch.findMany({
        where: { batchNo: cycle.batchNo },
        include: { sources: { include: { intake: { include: { supplier: true } } } } },
      });
      const downstream: Array<Record<string, unknown>> = [];
      for (const b of batches) {
        downstream.push({
          batch: b,
          ...(await batchDownstream(b.id, b.batchNo)),
          quality: await batchQuality(b.id),
        });
      }
      res.json({ type, cycle, batches: downstream });
      return;
    }

    if (type === 'batch') {
      const batch = await prisma.productionBatch.findUnique({
        where: { id },
        include: {
          shifts: { include: { outputs: { include: { product: true } } }, orderBy: { startedAt: 'asc' } },
        },
      });
      if (!batch) throw new AppError(404, 'Production batch not found');
      const [upstream, downstream, quality] = await Promise.all([
        batchUpstream(id, batch.batchNo),
        batchDownstream(id, batch.batchNo),
        batchQuality(id),
      ]);
      res.json({ type, batch, upstream, downstream, quality });
      return;
    }

    // type === 'lot'
    const lot = await prisma.finishedGoodsStock.findUnique({
      where: { id },
      include: { product: true },
    });
    if (!lot) throw new AppError(404, 'Finished-goods lot not found');
    const packRuns = await prisma.packagingRun.findMany({
      where: { batch: { batchNo: lot.batchNo }, productId: lot.productId },
      include: { product: true, batch: true },
      orderBy: { packedAt: 'asc' },
    });
    const ancestry: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const pr of packRuns) {
      if (seen.has(pr.batchId)) continue;
      seen.add(pr.batchId);
      ancestry.push({
        batch: pr.batch,
        upstream: await batchUpstream(pr.batchId, pr.batch.batchNo),
        quality: await batchQuality(pr.batchId),
      });
    }
    const dispatchLines = await prisma.dispatchLine.findMany({
      where: { batchNo: lot.batchNo, productId: lot.productId },
      include: {
        dispatch: { include: { vehicle: true } },
        order: { include: { customer: true } },
        product: true,
      },
      orderBy: { dispatch: { dispatchedAt: 'asc' } },
    });
    res.json({ type, lot, packRuns, ancestry, dispatchLines });
  } catch (err) {
    next(err);
  }
});

// ─── Traceability lists ─────────────────────────────────────────────

router.get('/intakes', VIEW, async (_req, res, next) => {
  try {
    const intakes = await prisma.wheatIntake.findMany({
      include: {
        supplier: true,
        _count: { select: { batchSources: true, tankFills: true } },
      },
      orderBy: { deliveryDate: 'desc' },
      take: 200,
    });
    res.json(intakes);
  } catch (err) {
    next(err);
  }
});

router.get('/tanks', VIEW, async (_req, res, next) => {
  try {
    const cycles = await prisma.conditioningCycle.findMany({ orderBy: { startedAt: 'desc' }, take: 60 });
    const batchNos = [...new Set(cycles.map((c) => c.batchNo))];
    const batches = await prisma.productionBatch.findMany({
      where: { batchNo: { in: batchNos } },
      select: { id: true, batchNo: true, status: true, wheatWeighedQ: true, createdAt: true },
    });
    const byBatchNo = new Map(batches.map((b) => [b.batchNo, b]));
    const fills = await prisma.tankFill.findMany({ orderBy: { filledAt: 'desc' }, take: 120 });
    const tankCodes = [...new Set([...cycles.map((c) => c.tankCode), ...fills.map((f) => f.tankCode), 'TANK_A', 'TANK_B', 'TANK_C'])];
    res.json({
      tanks: tankCodes.map((code) => ({
        tankCode: code,
        cycles: cycles
          .filter((c) => c.tankCode === code)
          .map((c) => ({ ...c, batch: byBatchNo.get(c.batchNo) ?? null })),
        fills: fills.filter((f) => f.tankCode === code),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/batches', VIEW, async (_req, res, next) => {
  try {
    const batches = await prisma.productionBatch.findMany({
      include: {
        _count: { select: { sources: true, shifts: true, labChecks: true, packRuns: true, nonconformities: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    res.json(batches);
  } catch (err) {
    next(err);
  }
});

router.get('/lots', VIEW, async (_req, res, next) => {
  try {
    const lots = await prisma.finishedGoodsStock.findMany({
      include: { product: true },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    res.json(lots);
  } catch (err) {
    next(err);
  }
});

const qualityParamsSchema = z.object({
  type: z.enum(['batch', 'lot']),
  id: z.string().min(1),
});

/** GET /traceability/quality/:type/:id — every QC check, NC and CAPA for a batch or lot. */
router.get('/quality/:type/:id', VIEW, validateParams(qualityParamsSchema), async (req, res, next) => {
  try {
    const { type, id } = req.params;
    let batchIds: string[] = [];
    let lot: unknown = null;
    if (type === 'lot') {
      const l = await prisma.finishedGoodsStock.findUnique({ where: { id }, include: { product: true } });
      if (!l) throw new AppError(404, 'Finished-goods lot not found');
      lot = l;
      const packRuns = await prisma.packagingRun.findMany({
        where: { batch: { batchNo: l.batchNo }, productId: l.productId },
        select: { batchId: true },
      });
      batchIds = [...new Set(packRuns.map((p) => p.batchId))];
    } else {
      const b = await prisma.productionBatch.findUnique({ where: { id }, select: { id: true } });
      if (!b) throw new AppError(404, 'Production batch not found');
      batchIds = [id];
    }
    const quality: Array<Record<string, unknown>> = [];
    for (const batchId of batchIds) {
      const batch = await prisma.productionBatch.findUnique({
        where: { id: batchId },
        select: { id: true, batchNo: true, productType: true, status: true },
      });
      quality.push({ batch, ...(await batchQuality(batchId)) });
    }
    res.json({ type, lot, quality });
  } catch (err) {
    next(err);
  }
});

// ─── Recall & investigation ─────────────────────────────────────────

const batchIdParamsSchema = z.object({ batchId: z.string().min(1) });

/** GET /traceability/recall/impact/:batchId — auto-identify all affected downstream. */
router.get('/recall/impact/:batchId', VIEW, validateParams(batchIdParamsSchema), async (req, res, next) => {
  try {
    const batch = await prisma.productionBatch.findUnique({ where: { id: req.params.batchId } });
    if (!batch) throw new AppError(404, 'Production batch not found');
    const [upstream, downstream] = await Promise.all([
      batchUpstream(batch.id, batch.batchNo),
      batchDownstream(batch.id, batch.batchNo),
    ]);
    const totalQ = downstream.dispatchLines.reduce((s, dl) => s + Number(dl.quintals), 0);
    res.json({
      batch: {
        id: batch.id,
        batchNo: batch.batchNo,
        productType: batch.productType,
        status: batch.status,
        wheatWeighedQ: batch.wheatWeighedQ,
      },
      upstream,
      downstream,
      impact: {
        packRunCount: downstream.packRuns.length,
        lotCount: downstream.fgLots.length,
        dispatchLineCount: downstream.dispatchLines.length,
        customerCount: downstream.customers.length,
        dispatchedQuintals: totalQ,
        customers: downstream.customers,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/recall/cases', VIEW, async (_req, res, next) => {
  try {
    const cases = await prisma.recallCase.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(cases);
  } catch (err) {
    next(err);
  }
});

const recallCreateSchema = z.object({
  rootType: z.enum(['INTAKE', 'BATCH', 'LOT']),
  rootBatchId: z.string().optional(),
  rootBatchNo: z.string().optional(),
  rootLotNo: z.string().optional(),
  severity: z.enum(['CLASS_I', 'CLASS_II', 'CLASS_III']),
  reason: z.string().min(3),
});

/** POST /traceability/recall/cases — create a recall case with auto-computed impact. */
router.post('/recall/cases', QC_MANAGE, validateBody(recallCreateSchema), async (req, res, next) => {
  try {
    const body = recallCreateSchema.parse(req.body);
    const openedById = req.user?.id ?? null;

    let impactSnapshot: Record<string, unknown> | null = null;
    let items: Array<Record<string, unknown>> = [];
    if (body.rootBatchId) {
      const batch = await prisma.productionBatch.findUnique({ where: { id: body.rootBatchId } });
      if (!batch) throw new AppError(404, 'Root production batch not found');
      const downstream = await batchDownstream(batch.id, batch.batchNo);
      impactSnapshot = {
        batchNo: batch.batchNo,
        packRunCount: downstream.packRuns.length,
        lotCount: downstream.fgLots.length,
        dispatchLineCount: downstream.dispatchLines.length,
        customers: downstream.customers,
      };
      const itemMap = new Map<string, Record<string, unknown>>();
      for (const lot of downstream.fgLots) {
        const key = `LOT:${lot.id}`;
        itemMap.set(key, {
          batchNo: lot.batchNo,
          lotNo: lot.id,
          productName: lot.product?.name,
          quintals: Number(lot.quintals),
          bags: lot.bags,
          customerName: null,
        });
      }
      for (const dl of downstream.dispatchLines) {
        const key = `DIS:${dl.id}`;
        itemMap.set(key, {
          batchNo: dl.batchNo,
          lotNo: null,
          productName: dl.product?.name,
          quintals: Number(dl.quintals),
          bags: dl.bags,
          customerName: dl.order?.customer?.name ?? 'Walk-in / no sales order',
        });
      }
      items = [...itemMap.values()];
    }

    const created = await prisma.$transaction(async (tx) => {
      const caseNo = await nextDocNo(tx, 'recallCase', 'caseNo', 'REC');
      return tx.recallCase.create({
        data: {
          caseNo,
          rootType: body.rootType,
          rootBatchId: body.rootBatchId ?? null,
          rootBatchNo: body.rootBatchNo ?? null,
          rootLotNo: body.rootLotNo ?? null,
          severity: body.severity,
          reason: body.reason,
          impactSnapshot: (impactSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
          openedById,
          items: { create: items },
        },
        include: { items: true },
      });
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

const caseIdParamsSchema = z.object({ id: z.string().min(1) });

router.get('/recall/cases/:id', VIEW, validateParams(caseIdParamsSchema), async (req, res, next) => {
  try {
    const c = await prisma.recallCase.findUnique({
      where: { id: req.params.id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw new AppError(404, 'Recall case not found');
    res.json(c);
  } catch (err) {
    next(err);
  }
});

const recallUpdateSchema = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'INVESTIGATING', 'DISPOSITIONED', 'CLOSED']).optional(),
  investigationNote: z.string().min(1).optional(),
  disposition: z.enum(['RELEASE', 'REWORK', 'REJECT', 'DESTROY']).optional(),
  dispositionNote: z.string().optional(),
});

/** PATCH /traceability/recall/cases/:id — investigation steps, disposition, closure. */
router.patch('/recall/cases/:id', QC_MANAGE, validateParams(caseIdParamsSchema), validateBody(recallUpdateSchema), async (req, res, next) => {
  try {
    const body = recallUpdateSchema.parse(req.body);
    const c = await prisma.recallCase.findUnique({ where: { id: req.params.id } });
    if (!c) throw new AppError(404, 'Recall case not found');

    const log = Array.isArray(c.investigationLog) ? (c.investigationLog as Array<Record<string, unknown>>) : [];
    if (body.investigationNote) {
      log.push({ at: new Date().toISOString(), by: req.user?.name ?? req.user?.email ?? 'unknown', step: body.investigationNote });
    }
    const data: Record<string, unknown> = { investigationLog: log };
    if (body.status) data.status = body.status;
    if (body.disposition) {
      data.disposition = body.disposition;
      data.decidedById = req.user?.id ?? null;
      data.decidedAt = new Date();
    }
    if (body.dispositionNote !== undefined) data.dispositionNote = body.dispositionNote;
    if (body.status === 'CLOSED') data.closedAt = new Date();

    const updated = await prisma.recallCase.update({
      where: { id: req.params.id },
      data,
      include: { items: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/recall/cases/:id', QC_MANAGE, validateParams(caseIdParamsSchema), async (req, res, next) => {
  try {
    await prisma.recallCase.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── Universal search ───────────────────────────────────────────────

const searchQuerySchema = z.object({
  q: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** GET /traceability/search?q=…&from=…&to=… — batch no, lot no, supplier, dates. */
router.get('/search', VIEW, validateQuery(searchQuerySchema), async (req, res, next) => {
  try {
    const { q, from, to } = searchQuerySchema.parse(req.query);
    const dateFilter =
      from || to
        ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined }
        : undefined;

    const [batches, intakes, lots, suppliers] = await Promise.all([
      prisma.productionBatch.findMany({
        where: {
          batchNo: { contains: q, mode: 'insensitive' },
          ...(dateFilter ? { createdAt: dateFilter } : {}),
        },
        select: { id: true, batchNo: true, productType: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.wheatIntake.findMany({
        where: {
          OR: [
            { intakeNo: { contains: q, mode: 'insensitive' } },
            { truckPlate: { contains: q, mode: 'insensitive' } },
            { supplier: { name: { contains: q, mode: 'insensitive' } } },
          ],
          ...(dateFilter ? { deliveryDate: dateFilter } : {}),
        },
        include: { supplier: true },
        orderBy: { deliveryDate: 'desc' },
        take: 25,
      }),
      prisma.finishedGoodsStock.findMany({
        where: {
          OR: [
            { batchNo: { contains: q, mode: 'insensitive' } },
            { product: { name: { contains: q, mode: 'insensitive' } } },
          ],
          ...(dateFilter ? { receivedAt: dateFilter } : {}),
        },
        include: { product: true },
        orderBy: { receivedAt: 'desc' },
        take: 25,
      }),
      prisma.supplier.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true, type: true },
        take: 10,
      }),
    ]);
    res.json({ q, batches, intakes, lots, suppliers });
  } catch (err) {
    next(err);
  }
});
