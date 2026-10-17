import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PieceStage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery } from '../../middleware/validate';
import {
  agingBucket,
  agingDays,
  bagsToQuintals,
  byproductLabel,
  evaluateLabCheckAgainstGrade,
  expiryDate,
  m10,
  packagingRunWide,
  BYPRODUCT_MIN_Q,
  BYPRODUCT_STALE_DAYS,
} from './service';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const DEFAULT_FG_LOCATION = 'FG_WH_1';

// ─── Packaging runs ─────────────────────────────────────────────

const createPackagingRunSchema = z.object({
  batchId: z.string().min(1),
  productId: z.string().min(1),
  packagingSizeId: z.string().min(1),
  bags: z.number().int().positive(),
  // Optional: auto-computed from bags × bag weight when omitted.
  quintals: z.number().positive().optional(),
  productionDate: z.coerce.date(),
  locationCode: z.string().min(1).optional(),
  line: z.string().min(1).optional(),
  operator: z.string().min(1).optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional(),
});

const listPackagingRunsQuery = z.object({
  batchId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.post(
  '/packaging-runs',
  requirePermission('fg:manage'),
  validateBody(createPackagingRunSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createPackagingRunSchema>;
      const locationCode = body.locationCode ?? DEFAULT_FG_LOCATION;

      // Auto-compute quintals from bags × bag weight when not supplied.
      const size = await prisma.packagingSize.findUnique({
        where: { id: body.packagingSizeId },
      });
      if (!size) throw new AppError(404, 'Packaging size not found');
      const quintals =
        body.quintals !== undefined
          ? new Prisma.Decimal(body.quintals)
          : bagsToQuintals(body.bags, size.kg);

      const run = await prisma.$transaction(async (tx) => {
        const batch = await tx.productionBatch.findUnique({ where: { id: body.batchId } });
        if (!batch) throw new AppError(404, 'Production batch not found');
        if (batch.status !== 'APPROVED') {
          throw new AppError(409, `Batch ${batch.batchNo} is not APPROVED (status: ${batch.status})`);
        }

        const created = await packagingRunWide(tx).create({
          data: {
            batchId: batch.id,
            productId: body.productId,
            packagingSizeId: body.packagingSizeId,
            bags: body.bags,
            quintals,
            productionDate: body.productionDate,
            packedById: uid,
            line: body.line ?? null,
            operator: body.operator ?? null,
            startedAt: body.startedAt ?? null,
            endedAt: body.endedAt ?? null,
          },
        });

        await tx.finishedGoodsStock.upsert({
          where: {
            productId_batchNo_packagingSizeId_locationCode: {
              productId: body.productId,
              batchNo: batch.batchNo,
              packagingSizeId: body.packagingSizeId,
              locationCode,
            },
          },
          update: {
            bags: { increment: body.bags },
            quintals: { increment: quintals },
          },
          create: {
            productId: body.productId,
            batchNo: batch.batchNo,
            packagingSizeId: body.packagingSizeId,
            locationCode,
            bags: body.bags,
            quintals,
          },
        });

        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'PackagingRun',
          entityId: created.id,
          changes: {
            batchNo: batch.batchNo,
            bags: body.bags,
            quintals: quintals.toString(),
            locationCode,
            line: body.line ?? null,
          },
        });
        return created;
      });

      res.status(201).json(run);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/packaging-runs',
  requirePermission('fg:view'),
  validateQuery(listPackagingRunsQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof listPackagingRunsQuery>;
      const rows = await prisma.packagingRun.findMany({
        where: {
          batchId: q.batchId,
          productionDate: { gte: q.from, lte: q.to },
        },
        include: { product: true, batch: true },
        orderBy: { packedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Warehouse transfers ────────────────────────────────────────

const createTransferSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().min(1),
  packagingSizeId: z.string().min(1).optional().nullable(),
  fromLocation: z.string().min(1),
  toLocation: z.string().min(1),
  quintals: z.number().positive(),
  laborer: z.string().min(1).optional(),
});

const listTransfersQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.post(
  '/transfers',
  requirePermission('warehouse:manage'),
  validateBody(createTransferSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createTransferSchema>;
      const qty = new Prisma.Decimal(body.quintals);
      const sizeId = body.packagingSizeId ?? null;

      const transfer = await prisma.$transaction(async (tx) => {
        const source = await tx.finishedGoodsStock.findFirst({
          where: {
            productId: body.productId,
            batchNo: body.batchNo,
            packagingSizeId: sizeId,
            locationCode: body.fromLocation,
          },
        });
        if (!source) throw new AppError(404, 'Source stock row not found');
        if (source.quintals.lt(qty)) {
          throw new AppError(
            400,
            `Insufficient stock: have ${source.quintals.toString()} q, need ${qty.toString()} q`,
          );
        }

        await tx.finishedGoodsStock.update({
          where: { id: source.id },
          data: { quintals: { decrement: qty } },
        });

        const dest = await tx.finishedGoodsStock.findFirst({
          where: {
            productId: body.productId,
            batchNo: body.batchNo,
            packagingSizeId: sizeId,
            locationCode: body.toLocation,
          },
        });
        if (dest) {
          await tx.finishedGoodsStock.update({
            where: { id: dest.id },
            data: { quintals: { increment: qty } },
          });
        } else {
          await tx.finishedGoodsStock.create({
            data: {
              productId: body.productId,
              batchNo: body.batchNo,
              packagingSizeId: sizeId,
              locationCode: body.toLocation,
              bags: 0,
              quintals: qty,
              receivedAt: new Date(),
            },
          });
        }

        const created = await tx.warehouseTransfer.create({
          data: {
            productId: body.productId,
            batchNo: body.batchNo,
            fromLocation: body.fromLocation,
            toLocation: body.toLocation,
            quintals: qty,
            laborer: body.laborer ?? null,
            movedById: uid,
          },
        });

        if (body.laborer) {
          await tx.pieceRateLog.create({
            data: {
              stage: PieceStage.STORE_MOVEMENT,
              laborer: body.laborer,
              quintals: qty,
              loggedById: uid,
            },
          });
        }

        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'WarehouseTransfer',
          entityId: created.id,
          changes: {
            batchNo: body.batchNo,
            fromLocation: body.fromLocation,
            toLocation: body.toLocation,
            quintals: body.quintals,
            laborer: body.laborer ?? null,
          },
        });
        return created;
      });

      res.status(201).json(transfer);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/transfers',
  requirePermission('warehouse:view'),
  validateQuery(listTransfersQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof listTransfersQuery>;
      const rows = await prisma.warehouseTransfer.findMany({
        where: { movedAt: { gte: q.from, lte: q.to } },
        orderBy: { movedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ─── FG stock on hand ───────────────────────────────────────────

const stockQuerySchema = z.object({
  productId: z.string().optional(),
  batchNo: z.string().optional(),
  locationCode: z.string().optional(),
});

const MS_PER_DAY = 86400000;

router.get(
  '/stock',
  requirePermission('warehouse:view'),
  validateQuery(stockQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof stockQuerySchema>;
      const rows = await prisma.finishedGoodsStock.findMany({
        where: {
          productId: q.productId,
          batchNo: q.batchNo,
          locationCode: q.locationCode,
        },
        include: { product: true },
        orderBy: { receivedAt: 'asc' },
      });
      const now = Date.now();
      res.json(
        rows.map((r) => ({
          ...r,
          agingDays: Math.floor((now - r.receivedAt.getTime()) / MS_PER_DAY),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);
// ─── MODULE 10: Finished Goods & Byproduct Management ─────────────────────
// New-model delegates (FlourGrade, LabelPrint, ByproductStock,
// ByproductMovement, FgStockAdjustment) are accessed via m10() until the
// coordinator merges /tmp/schema-module10.prisma and regenerates the client.

// ─── Finished flour inventory (aggregated by product × packaging size) ───

const inventoryQuerySchema = z.object({
  productId: z.string().optional(),
  locationCode: z.string().optional(),
});

router.get(
  '/inventory',
  requirePermission('fg:view'),
  validateQuery(inventoryQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof inventoryQuerySchema>;
      const [rows, sizes] = await Promise.all([
        prisma.finishedGoodsStock.findMany({
          where: { productId: q.productId, locationCode: q.locationCode },
          include: { product: true },
          orderBy: [{ productId: 'asc' }, { receivedAt: 'asc' }],
        }),
        prisma.packagingSize.findMany(),
      ]);
      const sizeMap = new Map(sizes.map((s) => [s.id, s]));
      const now = Date.now();

      // Lifetime inflow (packaging runs) and outflow (dispatch lines) per
      // product × packaging size, for the product×size matrix.
      const [inAgg, outAgg] = await Promise.all([
        prisma.packagingRun.groupBy({
          by: ['productId', 'packagingSizeId'],
          _sum: { bags: true, quintals: true },
          where: { productId: q.productId },
        }),
        prisma.dispatchLine.groupBy({
          by: ['productId', 'packagingSizeId'],
          _sum: { bags: true, quintals: true },
          where: { productId: q.productId },
        }),
      ]);
      const inKey = (p: string, s: string | null) => `${p}::${s ?? ''}`;
      const inMap = new Map(
        inAgg.map((r) => [inKey(r.productId, r.packagingSizeId), r._sum]),
      );
      const outMap = new Map(
        outAgg.map((r) => [inKey(r.productId, r.packagingSizeId), r._sum]),
      );

      res.json(
        rows.map((r) => {
          const size = r.packagingSizeId ? sizeMap.get(r.packagingSizeId) : undefined;
          const flowIn = inMap.get(inKey(r.productId, r.packagingSizeId));
          const flowOut = outMap.get(inKey(r.productId, r.packagingSizeId));
          return {
            id: r.id,
            productId: r.productId,
            productName: r.product.name,
            productKind: r.product.kind,
            batchNo: r.batchNo,
            packagingSizeId: r.packagingSizeId,
            bagLabel: size?.label ?? '-',
            bagKg: size ? Number(size.kg) : null,
            locationCode: r.locationCode,
            bags: r.bags,
            quintals: Number(r.quintals),
            receivedAt: r.receivedAt,
            agingDays: agingDays(r.receivedAt, now),
            inflowBags: flowIn?.bags ?? 0,
            inflowQ: Number(flowIn?.quintals ?? 0),
            outflowBags: flowOut?.bags ?? 0,
            outflowQ: Number(flowOut?.quintals ?? 0),
          };
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// Update line-ops metadata on a packaging run (no stock impact).
const updatePackagingRunSchema = z.object({
  line: z.string().min(1).nullable().optional(),
  operator: z.string().min(1).nullable().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
});

router.patch(
  '/packaging-runs/:id',
  requirePermission('fg:manage'),
  validateBody(updatePackagingRunSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof updatePackagingRunSchema>;
      if (
        body.startedAt &&
        body.endedAt &&
        new Date(body.endedAt).getTime() < new Date(body.startedAt).getTime()
      ) {
        throw new AppError(400, 'endedAt cannot be before startedAt');
      }
      const run = await packagingRunWide(prisma).update({
        where: { id: req.params.id },
        data: {
          line: body.line ?? undefined,
          operator: body.operator ?? undefined,
          startedAt: body.startedAt ?? undefined,
          endedAt: body.endedAt ?? undefined,
        },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'PackagingRun',
        entityId: run.id,
        changes: { line: body.line ?? null, operator: body.operator ?? null },
      });
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Packing efficiency (per line × day) ─────────────────────────────────

const efficiencyQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  line: z.string().optional(),
});

router.get(
  '/packing-efficiency',
  requirePermission('fg:view'),
  validateQuery(efficiencyQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof efficiencyQuerySchema>;
      const runs = await packagingRunWide(prisma).findMany({
        where: {
          productionDate: { gte: q.from, lte: q.to },
          line: q.line,
        },
        orderBy: { productionDate: 'asc' },
      });
      const groups = new Map<
        string,
        { date: string; line: string; runs: number; bags: number; quintals: number; hours: number }
      >();
      for (const r of runs) {
        const date = new Date(String(r.productionDate)).toISOString().slice(0, 10);
        const lineName = String(r.line ?? 'UNASSIGNED');
        const key = `${date}::${lineName}`;
        const g = groups.get(key) ?? {
          date,
          line: lineName,
          runs: 0,
          bags: 0,
          quintals: 0,
          hours: 0,
        };
        g.runs += 1;
        g.bags += r.bags;
        g.quintals += Number(r.quintals);
        if (r.startedAt && r.endedAt) {
          g.hours +=
            (new Date(String(r.endedAt)).getTime() - new Date(String(r.startedAt)).getTime()) /
            3600000;
        }
        groups.set(key, g);
      }
      res.json(
        [...groups.values()].map((g) => ({
          ...g,
          quintals: Number(g.quintals.toFixed(2)),
          hours: Number(g.hours.toFixed(2)),
          bagsPerHour: g.hours > 0 ? Number((g.bags / g.hours).toFixed(1)) : null,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ─── Flour grade management ──────────────────────────────────────────────

const createGradeSchema = z.object({
  productId: z.string().min(1),
  gradeCode: z.string().min(1),
  name: z.string().min(1),
  moistureMax: z.number().positive().optional(),
  wetGlutenMin: z.number().nonnegative().optional(),
  wetGlutenMax: z.number().positive().optional(),
  ashMax: z.number().positive().optional(),
  shelfLifeDays: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

router.get('/grades', requirePermission('fg:view'), async (req, res, next) => {
  try {
    const rows = await m10(prisma, 'flourGrade').findMany({
      include: { product: true },
      orderBy: [{ isActive: 'desc' }, { gradeCode: 'asc' }],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/grades',
  requirePermission('fg:manage'),
  validateBody(createGradeSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createGradeSchema>;
      const product = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!product) throw new AppError(404, 'Product not found');
      const existing = await m10(prisma, 'flourGrade').findFirst({
        where: { productId: body.productId, gradeCode: body.gradeCode },
      });
      if (existing) throw new AppError(409, 'Grade code already exists for this product');
      const grade = await m10(prisma, 'flourGrade').create({
        data: {
          productId: body.productId,
          gradeCode: body.gradeCode.toUpperCase(),
          name: body.name,
          moistureMax: body.moistureMax ?? 14.0,
          wetGlutenMin: body.wetGlutenMin ?? 30.0,
          wetGlutenMax: body.wetGlutenMax ?? 33.0,
          ashMax: body.ashMax ?? 0.7,
          shelfLifeDays: body.shelfLifeDays ?? 180,
          notes: body.notes ?? null,
        },
        include: { product: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'FlourGrade',
        entityId: String(grade.id),
        changes: { gradeCode: body.gradeCode, name: body.name },
      });
      res.status(201).json(grade);
    } catch (err) {
      next(err);
    }
  },
);

const updateGradeSchema = z.object({
  name: z.string().min(1).optional(),
  moistureMax: z.number().positive().optional(),
  wetGlutenMin: z.number().nonnegative().optional(),
  wetGlutenMax: z.number().positive().optional(),
  ashMax: z.number().positive().optional(),
  shelfLifeDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

router.patch(
  '/grades/:id',
  requirePermission('fg:manage'),
  validateBody(updateGradeSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof updateGradeSchema>;
      const grade = await m10(prisma, 'flourGrade').update({
        where: { id: req.params.id },
        data: {
          name: body.name ?? undefined,
          moistureMax: body.moistureMax ?? undefined,
          wetGlutenMin: body.wetGlutenMin ?? undefined,
          wetGlutenMax: body.wetGlutenMax ?? undefined,
          ashMax: body.ashMax ?? undefined,
          shelfLifeDays: body.shelfLifeDays ?? undefined,
          isActive: body.isActive ?? undefined,
          notes: body.notes ?? undefined,
        },
        include: { product: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'FlourGrade',
        entityId: String(grade.id),
        changes: { isActive: body.isActive ?? undefined, name: body.name ?? undefined },
      });
      res.json(grade);
    } catch (err) {
      next(err);
    }
  },
);

// Linked QC results: latest lab checks for batches packed into this grade's
// product, evaluated against the grade spec.
router.get(
  '/grades/:id/quality',
  requirePermission('fg:view'),
  async (req, res, next) => {
    try {
      const grade = (await m10(prisma, 'flourGrade').findUnique({
        where: { id: req.params.id },
      })) as unknown as {
        id: string;
        productId: string;
        moistureMax: string | number;
        wetGlutenMin: string | number;
        wetGlutenMax: string | number;
        ashMax: string | number;
      } | null;
      if (!grade) throw new AppError(404, 'Grade not found');
      const checks = await prisma.labCheck.findMany({
        where: { batch: { packRuns: { some: { productId: grade.productId } } } },
        include: { batch: true },
        orderBy: { sampleTime: 'desc' },
        take: 20,
      });
      res.json({
        gradeId: grade.id,
        results: checks.map((c) => {
          const params = evaluateLabCheckAgainstGrade(
            {
              moistureMax: grade.moistureMax,
              wetGlutenMin: grade.wetGlutenMin,
              wetGlutenMax: grade.wetGlutenMax,
              ashMax: grade.ashMax,
            },
            c,
          );
          return {
            id: c.id,
            batchNo: c.batch.batchNo,
            sampleTime: c.sampleTime,
            params,
            pass: params.every((p) => p.pass),
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Production date & batch labeling ─────────────────────────────────────

const labelsQuerySchema = z.object({
  productId: z.string().optional(),
  status: z.string().optional(),
});

router.get(
  '/labels',
  requirePermission('fg:view'),
  validateQuery(labelsQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof labelsQuerySchema>;
      const rows = await m10(prisma, 'labelPrint').findMany({
        where: { productId: q.productId, status: q.status },
        include: { product: true },
        orderBy: { printedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// Queue: packaging runs with unprinted bags (one label per bag).
router.get('/labels/queue', requirePermission('fg:view'), async (req, res, next) => {
  try {
    const [runs, sizes, prints] = await Promise.all([
      prisma.packagingRun.findMany({
        include: { product: true, batch: true },
        orderBy: { productionDate: 'desc' },
        take: 100,
      }),
      prisma.packagingSize.findMany(),
      m10(prisma, 'labelPrint').findMany({}),
    ]);
    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    const printedByRun = new Map<string, number>();
    for (const p of prints) {
      const runId = String(p.packagingRunId ?? '');
      if (!runId) continue;
      printedByRun.set(runId, (printedByRun.get(runId) ?? 0) + Number(p.copies));
    }
    const queue = runs
      .map((r) => {
        const size = sizeMap.get(r.packagingSizeId);
        const printed = printedByRun.get(r.id) ?? 0;
        return {
          packagingRunId: r.id,
          batchNo: r.batch.batchNo,
          batchStatus: r.batch.status,
          productId: r.productId,
          productName: r.product.name,
          productionDate: r.productionDate,
          bagLabel: size?.label ?? '-',
          bagKg: size ? Number(size.kg) : null,
          bagsPacked: r.bags,
          labelsPrinted: printed,
          pending: Math.max(0, r.bags - printed),
        };
      })
      .filter((r) => r.pending > 0);
    res.json(queue);
  } catch (err) {
    next(err);
  }
});

const printLabelSchema = z.object({
  packagingRunId: z.string().min(1),
  copies: z.number().int().positive().max(100000),
  shelfLifeDays: z.number().int().positive().optional(),
});

router.post(
  '/labels/print',
  requirePermission('fg:manage'),
  validateBody(printLabelSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof printLabelSchema>;
      const run = await prisma.packagingRun.findUnique({
        where: { id: body.packagingRunId },
        include: { product: true },
      });
      if (!run) throw new AppError(404, 'Packaging run not found');
      const size = await prisma.packagingSize.findUnique({
        where: { id: run.packagingSizeId },
      });
      if (!size) throw new AppError(404, 'Packaging size not found');
      const grade = (await m10(prisma, 'flourGrade').findFirst({
        where: { productId: run.productId, isActive: true },
        orderBy: { createdAt: 'asc' },
      })) as unknown as { shelfLifeDays: number } | null;
      const shelfLife = body.shelfLifeDays ?? grade?.shelfLifeDays ?? 180;
      const productionDate = new Date(run.productionDate);
      const label = await m10(prisma, 'labelPrint').create({
        data: {
          packagingRunId: run.id,
          batchNo: run.batchId
            ? ((await prisma.productionBatch.findUnique({ where: { id: run.batchId } }))?.batchNo ?? '')
            : '',
          productId: run.productId,
          packagingSizeId: run.packagingSizeId,
          bagKg: size.kg,
          copies: body.copies,
          productionDate,
          expiryDate: expiryDate(productionDate, shelfLife),
          status: 'PRINTED',
          printedById: uid,
        },
        include: { product: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'LabelPrint',
        entityId: String(label.id),
        changes: { packagingRunId: run.id, copies: body.copies, shelfLifeDays: shelfLife },
      });
      res.status(201).json(label);
    } catch (err) {
      next(err);
    }
  },
);

const reprintLabelSchema = z.object({
  reason: z.string().min(1),
});

router.post(
  '/labels/:id/reprint',
  requirePermission('fg:manage'),
  validateBody(reprintLabelSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof reprintLabelSchema>;
      const original = (await m10(prisma, 'labelPrint').findUnique({
        where: { id: req.params.id },
      })) as unknown as {
        id: string;
        packagingRunId: unknown;
        batchNo: string;
        productId: string;
        packagingSizeId: unknown;
        bagKg: unknown;
        copies: unknown;
        productionDate: Date;
        expiryDate: Date;
      } | null;
      if (!original) throw new AppError(404, 'Label print record not found');
      const reprint = await m10(prisma, 'labelPrint').create({
        data: {
          packagingRunId: original.packagingRunId as string | null,
          batchNo: original.batchNo,
          productId: original.productId,
          packagingSizeId: original.packagingSizeId as string | null,
          bagKg: original.bagKg as number,
          copies: Number(original.copies),
          productionDate: new Date(original.productionDate),
          expiryDate: new Date(original.expiryDate),
          status: 'REPRINTED',
          reprintReason: body.reason,
          printedById: uid,
        },
        include: { product: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'LabelPrint',
        entityId: String(reprint.id),
        changes: { status: 'REPRINTED', reason: body.reason, originalId: original.id },
      });
      res.status(201).json(reprint);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Byproduct inventory (bran, shorts) ───────────────────────────────────

const byproductQuerySchema = z.object({
  type: z.string().optional(),
  locationCode: z.string().optional(),
});

router.get(
  '/byproducts',
  requirePermission('fg:view'),
  validateQuery(byproductQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof byproductQuerySchema>;
      const now = Date.now();
      const rows = await m10(prisma, 'byproductStock').findMany({
        where: {
          type: q.type ? String(q.type).toUpperCase() : undefined,
          locationCode: q.locationCode,
        },
        orderBy: { receivedAt: 'asc' },
      });
      res.json(
        rows.map((r) => ({
          ...r,
          typeLabel: byproductLabel(String(r.type)),
          quintals: Number(r.quintals),
          agingDays: agingDays(new Date(String(r.receivedAt)), now),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

const byproductMovementSchema = z.object({
  type: z.enum(['BRAN', 'SHORTS']),
  direction: z.enum(['IN', 'OUT']),
  quintals: z.number().positive(),
  reference: z.string().optional(),
  reason: z.string().min(1),
  batchNo: z.string().optional(),
  locationCode: z.string().min(1).optional(),
});

router.post(
  '/byproducts/movements',
  requirePermission('fg:manage'),
  validateBody(byproductMovementSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof byproductMovementSchema>;
      const qty = new Prisma.Decimal(body.quintals);
      const locationCode = body.locationCode ?? 'BP_WH_1';

      const movement = await prisma.$transaction(async (tx) => {
        const bp = m10(tx, 'byproductStock');
        if (body.direction === 'IN') {
          await bp.upsert({
            where: {
              type_batchNo_locationCode: {
                type: body.type,
                batchNo: body.batchNo ?? null,
                locationCode,
              },
            },
            update: { quintals: { increment: qty } },
            create: {
              type: body.type,
              batchNo: body.batchNo ?? null,
              locationCode,
              quintals: qty,
            },
          });
        } else {
          // FEFO: consume oldest lots first within the type/location.
          const lots = (await bp.findMany({
            where: { type: body.type, locationCode },
            orderBy: { receivedAt: 'asc' },
          })) as unknown as { id: string; quintals: unknown }[];
          const total = lots.reduce((s, l) => s + Number(l.quintals), 0);
          if (total < body.quintals) {
            throw new AppError(
              400,
              `Insufficient ${byproductLabel(body.type)} stock: have ${total.toFixed(1)} q, need ${body.quintals.toFixed(1)} q`,
            );
          }
          let remaining = qty;
          for (const lot of lots) {
            if (remaining.lte(0)) break;
            const lotQ = new Prisma.Decimal(String(lot.quintals));
            const take = Prisma.Decimal.min(lotQ, remaining);
            await bp.update({
              where: { id: lot.id },
              data: { quintals: { decrement: take } },
            });
            remaining = remaining.minus(take);
          }
        }

        const created = await m10(tx, 'byproductMovement').create({
          data: {
            type: body.type,
            direction: body.direction,
            quintals: qty,
            reference: body.reference ?? null,
            reason: body.reason,
            movedById: uid,
          },
        });

        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'ByproductMovement',
          entityId: String(created.id),
          changes: {
            type: body.type,
            direction: body.direction,
            quintals: body.quintals,
            reference: body.reference ?? null,
          },
        });
        return created;
      });

      res.status(201).json(movement);
    } catch (err) {
      next(err);
    }
  },
);

const byproductHistoryQuery = z.object({
  type: z.string().optional(),
  direction: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/byproducts/movements',
  requirePermission('fg:view'),
  validateQuery(byproductHistoryQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof byproductHistoryQuery>;
      const rows = await m10(prisma, 'byproductMovement').findMany({
        where: {
          type: q.type ? String(q.type).toUpperCase() : undefined,
          direction: q.direction,
          movedAt: { gte: q.from, lte: q.to },
        },
        orderBy: { movedAt: 'desc' },
        take: 500,
      });
      res.json(
        rows.map((r) => ({
          ...r,
          typeLabel: byproductLabel(String(r.type)),
          quintals: Number(r.quintals),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

// Byproduct stock alerts: low stock + stale lots.
router.get('/byproducts/alerts', requirePermission('fg:view'), async (req, res, next) => {
  try {
    const now = Date.now();
    const rows = (await m10(prisma, 'byproductStock').findMany({})) as unknown as {
      type: string;
      quintals: unknown;
      receivedAt: string | Date;
      locationCode: string;
    }[];
    const alerts: {
      kind: 'LOW_STOCK' | 'STALE';
      type: string;
      typeLabel: string;
      detail: string;
      quintals?: number;
      agingDays?: number;
    }[] = [];
    const totals = new Map<string, number>();
    for (const r of rows) {
      const t = String(r.type);
      totals.set(t, (totals.get(t) ?? 0) + Number(r.quintals));
      const age = agingDays(new Date(r.receivedAt), now);
      if (age > BYPRODUCT_STALE_DAYS) {
        alerts.push({
          kind: 'STALE',
          type: t,
          typeLabel: byproductLabel(t),
          detail: `${byproductLabel(t)} lot in ${r.locationCode} is ${age} days old`,
          quintals: Number(r.quintals),
          agingDays: age,
        });
      }
    }
    for (const [t, total] of totals) {
      if (total < BYPRODUCT_MIN_Q) {
        alerts.push({
          kind: 'LOW_STOCK',
          type: t,
          typeLabel: byproductLabel(t),
          detail: `${byproductLabel(t)} below minimum (${total.toFixed(1)} q < ${BYPRODUCT_MIN_Q} q)`,
          quintals: total,
        });
      }
    }
    res.json({ alerts, thresholdQ: BYPRODUCT_MIN_Q, staleAfterDays: BYPRODUCT_STALE_DAYS });
  } catch (err) {
    next(err);
  }
});

// ─── Stock aging & expiry monitoring (FEFO) ───────────────────────────────

const agingQuerySchema = z.object({
  productId: z.string().optional(),
  bucket: z.enum(['0-30', '31-60', '61-90', '90+']).optional(),
});

router.get(
  '/aging',
  requirePermission('fg:view'),
  validateQuery(agingQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof agingQuerySchema>;
      const [rows, sizes, grades] = await Promise.all([
        prisma.finishedGoodsStock.findMany({
          where: { productId: q.productId },
          include: { product: true },
          orderBy: { receivedAt: 'asc' },
        }),
        prisma.packagingSize.findMany(),
        m10(prisma, 'flourGrade').findMany({ where: { isActive: true } }),
      ]);
      const sizeMap = new Map(sizes.map((s) => [s.id, s]));
      const shelfLife = new Map(
        (grades as unknown as { productId: string; shelfLifeDays: number }[]).map((g) => [
          String(g.productId),
          Number(g.shelfLifeDays),
        ]),
      );
      const now = Date.now();

      const lots = rows.map((r) => {
        const size = r.packagingSizeId ? sizeMap.get(r.packagingSizeId) : undefined;
        const received = new Date(r.receivedAt);
        const age = agingDays(received, now);
        const life = shelfLife.get(r.productId) ?? 180;
        const exp = new Date(received);
        exp.setUTCDate(exp.getUTCDate() + life);
        const daysToExpiry = Math.floor((exp.getTime() - now) / MS_PER_DAY);
        const status =
          daysToExpiry < 0 ? 'EXPIRED' : daysToExpiry <= 30 ? 'NEAR_EXPIRY' : 'OK';
        return {
          id: r.id,
          productId: r.productId,
          productName: r.product.name,
          batchNo: r.batchNo,
          packagingSizeId: r.packagingSizeId,
          bagLabel: size?.label ?? '-',
          bagKg: size ? Number(size.kg) : null,
          locationCode: r.locationCode,
          bags: r.bags,
          quintals: Number(r.quintals),
          receivedAt: r.receivedAt,
          agingDays: age,
          bucket: agingBucket(age),
          expiryDate: exp,
          daysToExpiry,
          status,
        };
      });

      const filtered = q.bucket ? lots.filter((l) => l.bucket === q.bucket) : lots;

      // FEFO suggestion: oldest lot per product that still has stock.
      const fefo = new Map<string, (typeof lots)[number]>();
      for (const l of lots) {
        if (l.quintals <= 0) continue;
        const cur = fefo.get(l.productId);
        if (!cur || new Date(l.receivedAt).getTime() < new Date(cur.receivedAt).getTime()) {
          fefo.set(l.productId, l);
        }
      }

      res.json({
        lots: filtered,
        summary: (['0-30', '31-60', '61-90', '90+'] as const).map((b) => ({
          bucket: b,
          lots: lots.filter((l) => l.bucket === b).length,
          quintals: Number(
            lots.filter((l) => l.bucket === b).reduce((s, l) => s + l.quintals, 0).toFixed(2),
          ),
        })),
        nearExpiry: lots.filter((l) => l.status === 'NEAR_EXPIRY' || l.status === 'EXPIRED'),
        fefo: [...fefo.entries()].map(([productId, lot]) => ({
          productId,
          productName: lot.productName,
          batchNo: lot.batchNo,
          bagLabel: lot.bagLabel,
          locationCode: lot.locationCode,
          agingDays: lot.agingDays,
          quintals: lot.quintals,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── FG stock adjustments (draft → approve) ───────────────────────────────

const createAdjustmentSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().min(1),
  packagingSizeId: z.string().optional(),
  locationCode: z.string().min(1),
  bagsDelta: z.number().int(),
  quintalsDelta: z.number(),
  reason: z.string().min(1),
});

router.get(
  '/stock-adjustments',
  requirePermission('fg:view'),
  validateQuery(z.object({ status: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { status?: string };
      const rows = await m10(prisma, 'fgStockAdjustment').findMany({
        where: { status: q.status },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/stock-adjustments',
  requirePermission('fg:manage'),
  validateBody(createAdjustmentSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createAdjustmentSchema>;
      const product = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!product) throw new AppError(404, 'Product not found');
      const created = await m10(prisma, 'fgStockAdjustment').create({
        data: {
          productId: body.productId,
          batchNo: body.batchNo,
          packagingSizeId: body.packagingSizeId ?? null,
          locationCode: body.locationCode,
          bagsDelta: body.bagsDelta,
          quintalsDelta: new Prisma.Decimal(body.quintalsDelta),
          reason: body.reason,
          createdById: uid,
        },
        include: { product: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'FgStockAdjustment',
        entityId: String(created.id),
        changes: { batchNo: body.batchNo, bagsDelta: body.bagsDelta, quintalsDelta: body.quintalsDelta },
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

const decideAdjustmentSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
});

router.post(
  '/stock-adjustments/:id/approve',
  requirePermission('fg:approve'),
  validateBody(decideAdjustmentSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof decideAdjustmentSchema>;
      const adj = (await m10(prisma, 'fgStockAdjustment').findUnique({
        where: { id: req.params.id },
      })) as unknown as {
        id: string;
        status: string;
        productId: string;
        batchNo: string;
        packagingSizeId: unknown;
        locationCode: string;
        bagsDelta: number;
        quintalsDelta: unknown;
        reason: string;
      } | null;
      if (!adj) throw new AppError(404, 'Adjustment not found');
      if (adj.status !== 'DRAFT') throw new AppError(409, `Adjustment is ${adj.status}`);

      const result = await prisma.$transaction(async (tx) => {
        if (body.decision === 'APPROVE') {
          const delta = new Prisma.Decimal(String(adj.quintalsDelta));
          const existing = await tx.finishedGoodsStock.findFirst({
            where: {
              productId: adj.productId,
              batchNo: adj.batchNo,
              packagingSizeId: (adj.packagingSizeId as string | null) ?? null,
              locationCode: adj.locationCode,
            },
          });
          if (existing) {
            const next = new Prisma.Decimal(String(existing.quintals)).plus(delta);
            if (next.lt(0)) {
              throw new AppError(
                400,
                `Adjustment would drive stock negative (${next.toFixed(1)} q)`,
              );
            }
            await tx.finishedGoodsStock.update({
              where: { id: existing.id },
              data: {
                quintals: { increment: delta },
                bags: { increment: Number(adj.bagsDelta) },
              },
            });
          } else {
            if (delta.lt(0) || Number(adj.bagsDelta) < 0) {
              throw new AppError(400, 'Cannot apply a negative adjustment to a missing stock row');
            }
            await tx.finishedGoodsStock.create({
              data: {
                productId: adj.productId,
                batchNo: adj.batchNo,
                packagingSizeId: (adj.packagingSizeId as string | null) ?? null,
                locationCode: adj.locationCode,
                bags: Number(adj.bagsDelta),
                quintals: delta,
              },
            });
          }
        }
        const decided = await m10(tx, 'fgStockAdjustment').update({
          where: { id: adj.id },
          data: {
            status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            approvedById: uid,
          },
          include: { product: true },
        });
        await audit(tx, {
          userId: uid,
          action: body.decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
          entityType: 'FgStockAdjustment',
          entityId: adj.id,
          changes: { reason: adj.reason, batchNo: adj.batchNo },
        });
        return decided;
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── FG reports ───────────────────────────────────────────────────────────

const LOW_FG_Q = 100; // quintals — low-stock flag for finished flour

router.get('/reports/stock-position', requirePermission('fg:view'), async (req, res, next) => {
  try {
    const [rows, sizes] = await Promise.all([
      prisma.finishedGoodsStock.findMany({ include: { product: true } }),
      prisma.packagingSize.findMany(),
    ]);
    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    const byProduct = new Map<
      string,
      {
        productId: string;
        productName: string;
        totalBags: number;
        totalQuintals: number;
        locations: string[];
        sizes: { bagLabel: string; bags: number; quintals: number }[];
      }
    >();
    for (const r of rows) {
      const key = r.productId;
      const g =
        byProduct.get(key) ??
        {
          productId: r.productId,
          productName: r.product.name,
          totalBags: 0,
          totalQuintals: 0,
          locations: [] as string[],
          sizes: [] as { bagLabel: string; bags: number; quintals: number }[],
        };
      g.totalBags += r.bags;
      g.totalQuintals += Number(r.quintals);
      if (!g.locations.includes(r.locationCode)) g.locations.push(r.locationCode);
      const label = r.packagingSizeId ? (sizeMap.get(r.packagingSizeId)?.label ?? 'Bulk') : 'Bulk';
      const sz = g.sizes.find((s) => s.bagLabel === label);
      if (sz) {
        sz.bags += r.bags;
        sz.quintals += Number(r.quintals);
      } else {
        g.sizes.push({ bagLabel: label, bags: r.bags, quintals: Number(r.quintals) });
      }
      byProduct.set(key, g);
    }
    res.json({
      products: [...byProduct.values()].map((p) => ({
        ...p,
        totalQuintals: Number(p.totalQuintals.toFixed(2)),
        sizes: p.sizes.map((s) => ({ ...s, quintals: Number(s.quintals.toFixed(2)) })),
        lowStock: p.totalQuintals < LOW_FG_Q,
      })),
      lowStockThresholdQ: LOW_FG_Q,
      grandTotalQ: Number(
        [...byProduct.values()].reduce((s, p) => s + p.totalQuintals, 0).toFixed(2),
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/reports/byproduct-balance',
  requirePermission('fg:view'),
  validateQuery(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date };
      const [movements, stock] = await Promise.all([
        m10(prisma, 'byproductMovement').findMany({
          where: { movedAt: { gte: q.from, lte: q.to } },
        }),
        m10(prisma, 'byproductStock').findMany({}),
      ]);
      const balance = new Map<
        string,
        { type: string; typeLabel: string; inflowQ: number; outflowQ: number; netQ: number }
      >();
      const ensure = (t: string) =>
        balance.get(t) ??
        balance
          .set(t, { type: t, typeLabel: byproductLabel(t), inflowQ: 0, outflowQ: 0, netQ: 0 })
          .get(t)!;
      for (const m of movements) {
        const t = String(m.type);
        const b = ensure(t);
        const v = Number(m.quintals);
        if (String(m.direction) === 'IN') b.inflowQ += v;
        else b.outflowQ += v;
      }
      for (const b of balance.values()) {
        b.netQ = Number((b.inflowQ - b.outflowQ).toFixed(2));
        b.inflowQ = Number(b.inflowQ.toFixed(2));
        b.outflowQ = Number(b.outflowQ.toFixed(2));
      }
      const onHand = new Map<string, number>();
      for (const s of stock) {
        const t = String(s.type);
        onHand.set(t, (onHand.get(t) ?? 0) + Number(s.quintals));
      }
      res.json({
        from: q.from ?? null,
        to: q.to ?? null,
        types: [...balance.values()].map((b) => ({
          ...b,
          onHandQ: Number((onHand.get(b.type) ?? 0).toFixed(2)),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);
