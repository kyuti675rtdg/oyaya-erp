import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PieceStage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery } from '../../middleware/validate';

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
  quintals: z.number().positive(),
  productionDate: z.coerce.date(),
  locationCode: z.string().min(1).optional(),
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
      const quintals = new Prisma.Decimal(body.quintals);

      const run = await prisma.$transaction(async (tx) => {
        const batch = await tx.productionBatch.findUnique({ where: { id: body.batchId } });
        if (!batch) throw new AppError(404, 'Production batch not found');
        if (batch.status !== 'APPROVED') {
          throw new AppError(409, `Batch ${batch.batchNo} is not APPROVED (status: ${batch.status})`);
        }

        const created = await tx.packagingRun.create({
          data: {
            batchId: batch.id,
            productId: body.productId,
            packagingSizeId: body.packagingSizeId,
            bags: body.bags,
            quintals,
            productionDate: body.productionDate,
            packedById: uid,
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
            quintals: body.quintals,
            locationCode,
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
