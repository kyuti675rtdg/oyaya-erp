import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission, requireRoles } from '../../middleware/rbac';
import { validateParams } from '../../middleware/validate';

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
