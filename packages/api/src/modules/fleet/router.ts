import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit } from '../../lib/audit';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const vehicleIdSchema = z.object({ id: z.string().min(1) });

const vehicleCreateSchema = z.object({
  plateNo: z.string().min(1),
  vehicleType: z.string().optional(),
  ownership: z.enum(['OWNED', 'RENTED']),
});

const vehicleUpdateSchema = z.object({
  plateNo: z.string().min(1).optional(),
  vehicleType: z.string().optional(),
  ownership: z.enum(['OWNED', 'RENTED']).optional(),
  isActive: z.boolean().optional(),
});

router.get('/vehicles', requirePermission('fleet:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.vehicle.findMany({ orderBy: { plateNo: 'asc' } });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/vehicles',
  requirePermission('fleet:manage'),
  validateBody(vehicleCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof vehicleCreateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.vehicle.create({
          data: {
            plateNo: body.plateNo,
            vehicleType: body.vehicleType ?? null,
            ownership: body.ownership,
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'Vehicle',
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

router.get(
  '/vehicles/:id',
  requirePermission('fleet:view'),
  validateParams(vehicleIdSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
      if (!row) throw new AppError(404, 'Vehicle not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/vehicles/:id',
  requirePermission('fleet:manage'),
  validateParams(vehicleIdSchema),
  validateBody(vehicleUpdateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof vehicleUpdateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.vehicle.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new AppError(404, 'Vehicle not found');
        const updated = await tx.vehicle.update({
          where: { id: req.params.id },
          data: {
            ...(body.plateNo !== undefined ? { plateNo: body.plateNo } : {}),
            ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType } : {}),
            ...(body.ownership !== undefined ? { ownership: body.ownership } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'UPDATE',
          entityType: 'Vehicle',
          entityId: updated.id,
          changes: body,
        });
        return updated;
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/vehicles/:id',
  requirePermission('fleet:manage'),
  validateParams(vehicleIdSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.vehicle.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new AppError(404, 'Vehicle not found');
        const updated = await tx.vehicle.update({
          where: { id: req.params.id },
          data: { isActive: false },
        });
        await audit(tx, {
          userId: uid,
          action: 'UPDATE',
          entityType: 'Vehicle',
          entityId: updated.id,
          changes: { isActive: false },
        });
        return updated;
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

const tripsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

router.get(
  '/vehicles/:id/trips',
  requirePermission('fleet:view'),
  validateParams(vehicleIdSchema),
  validateQuery(tripsQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof tripsQuerySchema>;
      const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle) throw new AppError(404, 'Vehicle not found');
      const rows = await prisma.trip.findMany({
        where: {
          vehicleId: req.params.id,
          ...(q.from || q.to
            ? {
                departureDate: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lte: new Date(q.to) } : {}),
                },
              }
            : {}),
        },
        include: { vehicle: true },
        orderBy: { departureDate: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);
