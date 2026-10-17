import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit } from '../../lib/audit';
import {
  vehicleCreateSchema,
  vehicleUpdateSchema,
  createVehicle,
  updateVehicle,
  listVehicles,
  contractCreateSchema,
  contractUpdateSchema,
  contractQuerySchema,
  listContracts,
  createContract,
  updateContract,
  assignmentCreateSchema,
  assignmentUpdateSchema,
  assignmentQuerySchema,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  licenseAlerts,
  tripCreateSchema,
  tripUpdateSchema,
  tripQuerySchema,
  listFleetTrips,
  createFleetTrip,
  updateFleetTrip,
  deleteFleetTrip,
  fuelCreateSchema,
  fuelUpdateSchema,
  fuelQuerySchema,
  listFuelLogs,
  createFuelLog,
  updateFuelLog,
  deleteFuelLog,
  expenseCreateSchema,
  expenseUpdateSchema,
  expenseQuerySchema,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  maintCreateSchema,
  maintUpdateSchema,
  maintQuerySchema,
  listMaintRecords,
  createMaintRecord,
  updateMaintRecord,
  deleteMaintRecord,
  maintenanceDue,
  utilizationQuerySchema,
  utilization,
  csvQuerySchema,
  buildCsv,
  reportSummary,
} from './service';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const vehicleIdSchema = z.object({ id: z.string().min(1) });

router.get('/vehicles', requirePermission('fleet:view'), async (_req, res, next) => {
  try {
    res.json(await listVehicles(prisma));
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
      const row = await createVehicle(prisma, uidOf(req), req.body as z.infer<typeof vehicleCreateSchema>);
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
      const row = await updateVehicle(
        prisma,
        uidOf(req),
        req.params.id,
        req.body as z.infer<typeof vehicleUpdateSchema>,
      );
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

/* ── Module 16: contracts, driver assignments, trips, fuel, expenses, maintenance, reports ── */

// ── Vehicle contracts ──
router.get('/contracts', requirePermission('fleet:view'), validateQuery(contractQuerySchema), async (req, res, next) => {
  try {
    res.json(await listContracts(prisma, req.query as z.infer<typeof contractQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/contracts', requirePermission('fleet:manage'), validateBody(contractCreateSchema), async (req, res, next) => {
  try {
    const row = await createContract(prisma, uidOf(req), req.body as z.infer<typeof contractCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/contracts/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(contractUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateContract(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof contractUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/contracts/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    const row = await updateContract(prisma, uidOf(req), req.params.id, { status: 'TERMINATED' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ── Driver assignments ──
router.get('/assignments/license-alerts', requirePermission('fleet:view'), async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    res.json(await licenseAlerts(prisma, Number.isFinite(days) ? days : 30));
  } catch (err) {
    next(err);
  }
});

router.get('/assignments', requirePermission('fleet:view'), validateQuery(assignmentQuerySchema), async (req, res, next) => {
  try {
    res.json(await listAssignments(prisma, req.query as z.infer<typeof assignmentQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/assignments', requirePermission('fleet:manage'), validateBody(assignmentCreateSchema), async (req, res, next) => {
  try {
    const row = await createAssignment(prisma, uidOf(req), req.body as z.infer<typeof assignmentCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/assignments/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(assignmentUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateAssignment(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof assignmentUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/assignments/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    res.json(await deleteAssignment(prisma, uidOf(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

// ── Fleet trips ──
router.get('/trips', requirePermission('fleet:view'), validateQuery(tripQuerySchema), async (req, res, next) => {
  try {
    res.json(await listFleetTrips(prisma, req.query as z.infer<typeof tripQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/trips', requirePermission('fleet:manage'), validateBody(tripCreateSchema), async (req, res, next) => {
  try {
    const row = await createFleetTrip(prisma, uidOf(req), req.body as z.infer<typeof tripCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/trips/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(tripUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateFleetTrip(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof tripUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/trips/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    res.json(await deleteFleetTrip(prisma, uidOf(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

// ── Fuel logs ──
router.get('/fuel', requirePermission('fleet:view'), validateQuery(fuelQuerySchema), async (req, res, next) => {
  try {
    res.json(await listFuelLogs(prisma, req.query as z.infer<typeof fuelQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/fuel', requirePermission('fleet:manage'), validateBody(fuelCreateSchema), async (req, res, next) => {
  try {
    const row = await createFuelLog(prisma, uidOf(req), req.body as z.infer<typeof fuelCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/fuel/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(fuelUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateFuelLog(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof fuelUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/fuel/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    res.json(await deleteFuelLog(prisma, uidOf(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

// ── Fleet expenses ──
router.get('/expenses', requirePermission('fleet:view'), validateQuery(expenseQuerySchema), async (req, res, next) => {
  try {
    res.json(await listExpenses(prisma, req.query as z.infer<typeof expenseQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/expenses', requirePermission('fleet:manage'), validateBody(expenseCreateSchema), async (req, res, next) => {
  try {
    const row = await createExpense(prisma, uidOf(req), req.body as z.infer<typeof expenseCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/expenses/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(expenseUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateExpense(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof expenseUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/expenses/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    res.json(await deleteExpense(prisma, uidOf(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

// ── Fleet maintenance ──
router.get('/maintenance/due', requirePermission('fleet:view'), async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    res.json(await maintenanceDue(prisma, Number.isFinite(days) ? days : 30));
  } catch (err) {
    next(err);
  }
});

router.get('/maintenance', requirePermission('fleet:view'), validateQuery(maintQuerySchema), async (req, res, next) => {
  try {
    res.json(await listMaintRecords(prisma, req.query as z.infer<typeof maintQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance', requirePermission('fleet:manage'), validateBody(maintCreateSchema), async (req, res, next) => {
  try {
    const row = await createMaintRecord(prisma, uidOf(req), req.body as z.infer<typeof maintCreateSchema>);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.put('/maintenance/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), validateBody(maintUpdateSchema), async (req, res, next) => {
  try {
    const row = await updateMaintRecord(prisma, uidOf(req), req.params.id, req.body as z.infer<typeof maintUpdateSchema>);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/maintenance/:id', requirePermission('fleet:manage'), validateParams(vehicleIdSchema), async (req, res, next) => {
  try {
    res.json(await deleteMaintRecord(prisma, uidOf(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

// ── Utilization ──
router.get('/utilization', requirePermission('fleet:view'), validateQuery(utilizationQuerySchema), async (req, res, next) => {
  try {
    res.json(await utilization(prisma, req.query as z.infer<typeof utilizationQuerySchema>));
  } catch (err) {
    next(err);
  }
});

// ── Reports ──
router.get('/reports/summary', requirePermission('fleet:view'), validateQuery(utilizationQuerySchema), async (req, res, next) => {
  try {
    res.json(await reportSummary(prisma, req.query as z.infer<typeof utilizationQuerySchema>));
  } catch (err) {
    next(err);
  }
});

router.get('/reports/csv', requirePermission('fleet:view'), validateQuery(csvQuerySchema), async (req, res, next) => {
  try {
    const csv = await buildCsv(prisma, req.query as unknown as z.infer<typeof csvQuerySchema>);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fleet-${(req.query as { kind: string }).kind}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
