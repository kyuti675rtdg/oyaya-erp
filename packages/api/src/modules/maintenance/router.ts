import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── Maintenance logs ────────────────────────────────────────────

const logListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
type LogListQuery = z.infer<typeof logListQuerySchema>;

const logCreateSchema = z.object({
  equipment: z.string().min(1).max(200),
  inspectionDate: z.coerce.date(),
  inspector: z.string().max(200).optional().nullable(),
  outcome: z.string().max(2000).optional().nullable(),
  followUpAction: z.string().max(2000).optional().nullable(),
  partReplaced: z.string().max(500).optional().nullable(),
});
type LogCreateInput = z.infer<typeof logCreateSchema>;

const logUpdateSchema = z.object({
  equipment: z.string().min(1).max(200).optional(),
  inspectionDate: z.coerce.date().optional(),
  inspector: z.string().max(200).optional().nullable(),
  outcome: z.string().max(2000).optional().nullable(),
  followUpAction: z.string().max(2000).optional().nullable(),
  partReplaced: z.string().max(500).optional().nullable(),
  isOverdue: z.boolean().optional(),
});
type LogUpdateInput = z.infer<typeof logUpdateSchema>;

router.get(
  '/logs',
  requirePermission('maintenance:view'),
  validateQuery(logListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as LogListQuery;
      const where: Prisma.MaintenanceLogWhereInput = {};
      if (q.from !== undefined || q.to !== undefined) {
        where.inspectionDate = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      if (q.overdue !== undefined) where.isOverdue = q.overdue === 'true';
      const logs = await prisma.maintenanceLog.findMany({
        where,
        orderBy: { inspectionDate: 'desc' },
      });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/logs',
  requirePermission('maintenance:manage'),
  validateBody(logCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as LogCreateInput;
      const log = await prisma.$transaction(async (tx) => {
        const created = await tx.maintenanceLog.create({
          data: {
            equipment: b.equipment,
            inspectionDate: b.inspectionDate,
            inspector: b.inspector ?? null,
            outcome: b.outcome ?? null,
            followUpAction: b.followUpAction ?? null,
            partReplaced: b.partReplaced ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'MaintenanceLog',
          entityId: created.id,
          changes: { equipment: b.equipment, inspectionDate: b.inspectionDate },
        });
        return created;
      });
      res.status(201).json(log);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/logs/:id',
  requirePermission('maintenance:manage'),
  validateParams(idParamSchema),
  validateBody(logUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as LogUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.maintenanceLog.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Maintenance log not found');
        const saved = await tx.maintenanceLog.update({
          where: { id },
          data: {
            equipment: b.equipment,
            inspectionDate: b.inspectionDate,
            inspector: b.inspector === undefined ? undefined : (b.inspector ?? null),
            outcome: b.outcome === undefined ? undefined : (b.outcome ?? null),
            followUpAction: b.followUpAction === undefined ? undefined : (b.followUpAction ?? null),
            partReplaced: b.partReplaced === undefined ? undefined : (b.partReplaced ?? null),
            isOverdue: b.isOverdue,
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'MaintenanceLog',
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

// ─── Spare part checks ───────────────────────────────────────────

const sparePartCreateSchema = z.object({
  partName: z.string().min(1).max(200),
  equipment: z.string().max(200).optional().nullable(),
  checkType: z.enum(['STOCK_LEVEL', 'PHYSICAL_CONDITION']),
  condition: z.string().max(1000).optional().nullable(),
});
type SparePartCreateInput = z.infer<typeof sparePartCreateSchema>;

router.get(
  '/spare-parts',
  requirePermission('maintenance:view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const checks = await prisma.sparePartCheck.findMany({
        orderBy: { checkedAt: 'desc' },
      });
      res.json(checks);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/spare-parts',
  requirePermission('maintenance:manage'),
  validateBody(sparePartCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as SparePartCreateInput;
      const check = await prisma.$transaction(async (tx) => {
        const created = await tx.sparePartCheck.create({
          data: {
            partName: b.partName,
            equipment: b.equipment ?? null,
            checkType: b.checkType,
            condition: b.condition ?? null,
            checkedById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'SparePartCheck',
          entityId: created.id,
          changes: { partName: b.partName, checkType: b.checkType },
        });
        return created;
      });
      res.status(201).json(check);
    } catch (err) {
      next(err);
    }
  },
);
