import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';

/* ── Shared ─────────────────────────────────────────────────────────────── */

const dateInput = z.string().min(1); // ISO date / datetime, coerced via new Date()
const decInput = z.number().nonnegative();

export const idParamSchema = z.object({ id: z.string().min(1) });

/* ── Vehicles ───────────────────────────────────────────────────────────── */

export const vehicleCreateSchema = z.object({
  plateNo: z.string().min(1),
  vehicleType: z.enum(['TRUCK', 'PICKUP']).optional(),
  capacityQt: decInput.optional(),
  ownership: z.enum(['OWNED', 'RENTED']),
  status: z.enum(['AVAILABLE', 'ON_TRIP', 'IN_MAINTENANCE', 'OFF_DUTY']).optional(),
  purchaseDate: dateInput.optional().nullable(),
  purchaseCostBirr: decInput.optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const vehicleUpdateSchema = vehicleCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

type Db = PrismaClient;

export async function listVehicles(db: Db) {
  return db.vehicle.findMany({
    include: {
      _count: { select: { fleetTrips: true, fuelLogs: true } },
    },
    orderBy: { plateNo: 'asc' },
  });
}

export async function createVehicle(db: Db, uid: string, body: z.infer<typeof vehicleCreateSchema>) {
  return db.$transaction(async (tx) => {
    const created = await tx.vehicle.create({
      data: {
        plateNo: body.plateNo,
        vehicleType: body.vehicleType ?? null,
        capacityQt: body.capacityQt ?? null,
        ownership: body.ownership,
        status: body.status ?? 'AVAILABLE',
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
        purchaseCostBirr: body.purchaseCostBirr ?? null,
        notes: body.notes ?? null,
      },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Vehicle', entityId: created.id });
    return created;
  });
}

export async function updateVehicle(
  db: Db,
  uid: string,
  id: string,
  body: z.infer<typeof vehicleUpdateSchema>,
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Vehicle not found');
    const updated = await tx.vehicle.update({
      where: { id },
      data: {
        ...(body.plateNo !== undefined ? { plateNo: body.plateNo } : {}),
        ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType ?? null } : {}),
        ...(body.capacityQt !== undefined ? { capacityQt: body.capacityQt ?? null } : {}),
        ...(body.ownership !== undefined ? { ownership: body.ownership } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.purchaseDate !== undefined
          ? { purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null }
          : {}),
        ...(body.purchaseCostBirr !== undefined ? { purchaseCostBirr: body.purchaseCostBirr ?? null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
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
}

/* ── Contracts ──────────────────────────────────────────────────────────── */

export const contractCreateSchema = z.object({
  vehicleId: z.string().min(1),
  vendor: z.string().min(1),
  contractType: z.enum(['RENTAL_DAILY', 'RENTAL_MONTHLY', 'OWNED']),
  rateBirr: decInput,
  startDate: dateInput,
  endDate: dateInput.optional().nullable(),
  terms: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
});

export const contractUpdateSchema = contractCreateSchema.partial();

export const contractQuerySchema = z.object({
  vehicleId: z.string().optional(),
  status: z.string().optional(),
});

export async function listContracts(db: Db, q: z.infer<typeof contractQuerySchema>) {
  return db.vehicleContract.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    include: { vehicle: true },
    orderBy: { startDate: 'desc' },
  });
}

export async function createContract(db: Db, uid: string, body: z.infer<typeof contractCreateSchema>) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    const created = await tx.vehicleContract.create({
      data: {
        vehicleId: body.vehicleId,
        vendor: body.vendor,
        contractType: body.contractType,
        rateBirr: body.rateBirr,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        terms: body.terms ?? null,
        status: body.status ?? 'ACTIVE',
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'VehicleContract', entityId: created.id });
    return created;
  });
}

export async function updateContract(
  db: Db,
  uid: string,
  id: string,
  body: z.infer<typeof contractUpdateSchema>,
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.vehicleContract.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Contract not found');
    const updated = await tx.vehicleContract.update({
      where: { id },
      data: {
        ...(body.vendor !== undefined ? { vendor: body.vendor } : {}),
        ...(body.contractType !== undefined ? { contractType: body.contractType } : {}),
        ...(body.rateBirr !== undefined ? { rateBirr: body.rateBirr } : {}),
        ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate ? new Date(body.endDate) : null } : {}),
        ...(body.terms !== undefined ? { terms: body.terms ?? null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'VehicleContract',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

/* ── Driver assignments ─────────────────────────────────────────────────── */

export const assignmentCreateSchema = z.object({
  vehicleId: z.string().min(1),
  driverName: z.string().min(1),
  licenseNo: z.string().optional().nullable(),
  licenseExpiry: dateInput.optional().nullable(),
  assignedFrom: dateInput,
  assignedTo: dateInput.optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const assignmentUpdateSchema = z.object({
  driverName: z.string().min(1).optional(),
  licenseNo: z.string().optional().nullable(),
  licenseExpiry: dateInput.optional().nullable(),
  assignedFrom: dateInput.optional(),
  assignedTo: dateInput.optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

export const assignmentQuerySchema = z.object({
  vehicleId: z.string().optional(),
  status: z.string().optional(),
});

export async function listAssignments(db: Db, q: z.infer<typeof assignmentQuerySchema>) {
  return db.driverAssignment.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    include: { vehicle: true },
    orderBy: { assignedFrom: 'desc' },
  });
}

export async function createAssignment(
  db: Db,
  uid: string,
  body: z.infer<typeof assignmentCreateSchema>,
) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    // A vehicle can only have one active assignment at a time.
    const clash = await tx.driverAssignment.findFirst({
      where: { vehicleId: body.vehicleId, status: 'ACTIVE' },
    });
    if (clash && !body.assignedTo) {
      throw new AppError(409, `Vehicle already has an active driver (${clash.driverName}). End that assignment first.`);
    }
    const created = await tx.driverAssignment.create({
      data: {
        vehicleId: body.vehicleId,
        driverName: body.driverName,
        licenseNo: body.licenseNo ?? null,
        licenseExpiry: body.licenseExpiry ? new Date(body.licenseExpiry) : null,
        assignedFrom: new Date(body.assignedFrom),
        assignedTo: body.assignedTo ? new Date(body.assignedTo) : null,
        status: body.assignedTo ? 'ENDED' : 'ACTIVE',
        notes: body.notes ?? null,
        createdById: uid,
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'DriverAssignment', entityId: created.id });
    return created;
  });
}

export async function updateAssignment(
  db: Db,
  uid: string,
  id: string,
  body: z.infer<typeof assignmentUpdateSchema>,
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.driverAssignment.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Assignment not found');
    const updated = await tx.driverAssignment.update({
      where: { id },
      data: {
        ...(body.driverName !== undefined ? { driverName: body.driverName } : {}),
        ...(body.licenseNo !== undefined ? { licenseNo: body.licenseNo ?? null } : {}),
        ...(body.licenseExpiry !== undefined
          ? { licenseExpiry: body.licenseExpiry ? new Date(body.licenseExpiry) : null }
          : {}),
        ...(body.assignedFrom !== undefined ? { assignedFrom: new Date(body.assignedFrom) } : {}),
        ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo ? new Date(body.assignedTo) : null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'DriverAssignment',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

export async function deleteAssignment(db: Db, uid: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.driverAssignment.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Assignment not found');
    await tx.driverAssignment.delete({ where: { id } });
    await audit(tx, { userId: uid, action: 'DELETE', entityType: 'DriverAssignment', entityId: id });
    return { ok: true };
  });
}

/** Active assignments whose license expires within `days` (or already expired). */
export async function licenseAlerts(db: Db, days: number) {
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  return db.driverAssignment.findMany({
    where: { status: 'ACTIVE', licenseExpiry: { not: null, lte: limit } },
    include: { vehicle: true },
    orderBy: { licenseExpiry: 'asc' },
  });
}

/* ── Fleet trips ────────────────────────────────────────────────────────── */

export const tripCreateSchema = z.object({
  vehicleId: z.string().min(1),
  driverName: z.string().optional().nullable(),
  routeFrom: z.string().optional().nullable(),
  routeTo: z.string().optional().nullable(),
  cargoType: z.enum(['FLOUR', 'WHEAT', 'BRAN', 'OTHER']).optional().nullable(),
  cargoQt: decInput.optional().nullable(),
  departureAt: dateInput.optional().nullable(),
  arrivalAt: dateInput.optional().nullable(),
  odometerStart: decInput.optional().nullable(),
  odometerEnd: decInput.optional().nullable(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  dispatchId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const tripUpdateSchema = tripCreateSchema.partial();

export const tripQuerySchema = z.object({
  vehicleId: z.string().optional(),
  status: z.string().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export async function listFleetTrips(db: Db, q: z.infer<typeof tripQuerySchema>) {
  return db.fleetTrip.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            departureAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    },
    include: { vehicle: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createFleetTrip(db: Db, uid: string, body: z.infer<typeof tripCreateSchema>) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    const created = await tx.fleetTrip.create({
      data: {
        vehicleId: body.vehicleId,
        driverName: body.driverName ?? null,
        routeFrom: body.routeFrom ?? null,
        routeTo: body.routeTo ?? null,
        cargoType: body.cargoType ?? null,
        cargoQt: body.cargoQt ?? null,
        departureAt: body.departureAt ? new Date(body.departureAt) : null,
        arrivalAt: body.arrivalAt ? new Date(body.arrivalAt) : null,
        odometerStart: body.odometerStart ?? null,
        odometerEnd: body.odometerEnd ?? null,
        status: body.status ?? 'PLANNED',
        dispatchId: body.dispatchId ?? null,
        notes: body.notes ?? null,
        createdById: uid,
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'FleetTrip', entityId: created.id });
    return created;
  });
}

export async function updateFleetTrip(db: Db, uid: string, id: string, body: z.infer<typeof tripUpdateSchema>) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetTrip.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Trip not found');
    const updated = await tx.fleetTrip.update({
      where: { id },
      data: {
        ...(body.driverName !== undefined ? { driverName: body.driverName ?? null } : {}),
        ...(body.routeFrom !== undefined ? { routeFrom: body.routeFrom ?? null } : {}),
        ...(body.routeTo !== undefined ? { routeTo: body.routeTo ?? null } : {}),
        ...(body.cargoType !== undefined ? { cargoType: body.cargoType ?? null } : {}),
        ...(body.cargoQt !== undefined ? { cargoQt: body.cargoQt ?? null } : {}),
        ...(body.departureAt !== undefined ? { departureAt: body.departureAt ? new Date(body.departureAt) : null } : {}),
        ...(body.arrivalAt !== undefined ? { arrivalAt: body.arrivalAt ? new Date(body.arrivalAt) : null } : {}),
        ...(body.odometerStart !== undefined ? { odometerStart: body.odometerStart ?? null } : {}),
        ...(body.odometerEnd !== undefined ? { odometerEnd: body.odometerEnd ?? null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.dispatchId !== undefined ? { dispatchId: body.dispatchId ?? null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'FleetTrip',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

export async function deleteFleetTrip(db: Db, uid: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetTrip.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Trip not found');
    await tx.fleetTrip.delete({ where: { id } });
    await audit(tx, { userId: uid, action: 'DELETE', entityType: 'FleetTrip', entityId: id });
    return { ok: true };
  });
}

/* ── Fuel logs ──────────────────────────────────────────────────────────── */

export const fuelCreateSchema = z.object({
  vehicleId: z.string().min(1),
  loggedAt: dateInput.optional(),
  liters: decInput,
  costBirr: decInput,
  odometer: decInput.optional().nullable(),
  station: z.string().optional().nullable(),
});

export const fuelUpdateSchema = fuelCreateSchema.partial().omit({ vehicleId: true });

export const fuelQuerySchema = z.object({
  vehicleId: z.string().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export async function listFuelLogs(db: Db, q: z.infer<typeof fuelQuerySchema>) {
  return db.fuelLog.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.from || q.to
        ? {
            loggedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    },
    include: { vehicle: true },
    orderBy: { loggedAt: 'desc' },
  });
}

export async function createFuelLog(db: Db, uid: string, body: z.infer<typeof fuelCreateSchema>) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    const created = await tx.fuelLog.create({
      data: {
        vehicleId: body.vehicleId,
        loggedAt: body.loggedAt ? new Date(body.loggedAt) : new Date(),
        liters: body.liters,
        costBirr: body.costBirr,
        odometer: body.odometer ?? null,
        station: body.station ?? null,
        createdById: uid,
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'FuelLog', entityId: created.id });
    return created;
  });
}

export async function updateFuelLog(db: Db, uid: string, id: string, body: z.infer<typeof fuelUpdateSchema>) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Fuel log not found');
    const updated = await tx.fuelLog.update({
      where: { id },
      data: {
        ...(body.loggedAt !== undefined ? { loggedAt: new Date(body.loggedAt) } : {}),
        ...(body.liters !== undefined ? { liters: body.liters } : {}),
        ...(body.costBirr !== undefined ? { costBirr: body.costBirr } : {}),
        ...(body.odometer !== undefined ? { odometer: body.odometer ?? null } : {}),
        ...(body.station !== undefined ? { station: body.station ?? null } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'FuelLog',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

export async function deleteFuelLog(db: Db, uid: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Fuel log not found');
    await tx.fuelLog.delete({ where: { id } });
    await audit(tx, { userId: uid, action: 'DELETE', entityType: 'FuelLog', entityId: id });
    return { ok: true };
  });
}

/* ── Fleet expenses ─────────────────────────────────────────────────────── */

export const expenseCreateSchema = z.object({
  vehicleId: z.string().min(1),
  expenseDate: dateInput,
  category: z.enum(['TOLL', 'REPAIR_PARTS', 'INSURANCE', 'WASHING', 'OTHER']),
  amountBirr: decInput,
  description: z.string().optional().nullable(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial().omit({ vehicleId: true });

export const expenseQuerySchema = z.object({
  vehicleId: z.string().optional(),
  category: z.string().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export async function listExpenses(db: Db, q: z.infer<typeof expenseQuerySchema>) {
  return db.fleetExpense.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.from || q.to
        ? {
            expenseDate: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    },
    include: { vehicle: true },
    orderBy: { expenseDate: 'desc' },
  });
}

export async function createExpense(db: Db, uid: string, body: z.infer<typeof expenseCreateSchema>) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    const created = await tx.fleetExpense.create({
      data: {
        vehicleId: body.vehicleId,
        expenseDate: new Date(body.expenseDate),
        category: body.category,
        amountBirr: body.amountBirr,
        description: body.description ?? null,
        createdById: uid,
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'FleetExpense', entityId: created.id });
    return created;
  });
}

export async function updateExpense(db: Db, uid: string, id: string, body: z.infer<typeof expenseUpdateSchema>) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetExpense.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Expense not found');
    const updated = await tx.fleetExpense.update({
      where: { id },
      data: {
        ...(body.expenseDate !== undefined ? { expenseDate: new Date(body.expenseDate) } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.amountBirr !== undefined ? { amountBirr: body.amountBirr } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'FleetExpense',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

export async function deleteExpense(db: Db, uid: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetExpense.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Expense not found');
    await tx.fleetExpense.delete({ where: { id } });
    await audit(tx, { userId: uid, action: 'DELETE', entityType: 'FleetExpense', entityId: id });
    return { ok: true };
  });
}

/* ── Fleet maintenance records ──────────────────────────────────────────── */

export const maintCreateSchema = z.object({
  vehicleId: z.string().min(1),
  serviceType: z.enum(['PREVENTIVE', 'CORRECTIVE', 'INSPECTION']),
  description: z.string().min(1),
  serviceDate: dateInput,
  costBirr: decInput.optional().default(0),
  odometer: decInput.optional().nullable(),
  nextDueDate: dateInput.optional().nullable(),
  performedBy: z.string().optional().nullable(),
  status: z.enum(['SCHEDULED', 'COMPLETED']).optional(),
});

export const maintUpdateSchema = maintCreateSchema.partial().omit({ vehicleId: true });

export const maintQuerySchema = z.object({
  vehicleId: z.string().optional(),
  status: z.string().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export async function listMaintRecords(db: Db, q: z.infer<typeof maintQuerySchema>) {
  return db.fleetMaintenanceRecord.findMany({
    where: {
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            serviceDate: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    },
    include: { vehicle: true },
    orderBy: { serviceDate: 'desc' },
  });
}

export async function createMaintRecord(db: Db, uid: string, body: z.infer<typeof maintCreateSchema>) {
  return db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) throw new AppError(404, 'Vehicle not found');
    const created = await tx.fleetMaintenanceRecord.create({
      data: {
        vehicleId: body.vehicleId,
        serviceType: body.serviceType,
        description: body.description,
        serviceDate: new Date(body.serviceDate),
        costBirr: body.costBirr ?? 0,
        odometer: body.odometer ?? null,
        nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : null,
        performedBy: body.performedBy ?? null,
        status: body.status ?? 'COMPLETED',
        createdById: uid,
      },
      include: { vehicle: true },
    });
    await audit(tx, { userId: uid, action: 'CREATE', entityType: 'FleetMaintenanceRecord', entityId: created.id });
    return created;
  });
}

export async function updateMaintRecord(db: Db, uid: string, id: string, body: z.infer<typeof maintUpdateSchema>) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetMaintenanceRecord.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Maintenance record not found');
    const updated = await tx.fleetMaintenanceRecord.update({
      where: { id },
      data: {
        ...(body.serviceType !== undefined ? { serviceType: body.serviceType } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.serviceDate !== undefined ? { serviceDate: new Date(body.serviceDate) } : {}),
        ...(body.costBirr !== undefined ? { costBirr: body.costBirr } : {}),
        ...(body.odometer !== undefined ? { odometer: body.odometer ?? null } : {}),
        ...(body.nextDueDate !== undefined
          ? { nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : null }
          : {}),
        ...(body.performedBy !== undefined ? { performedBy: body.performedBy ?? null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      include: { vehicle: true },
    });
    await audit(tx, {
      userId: uid,
      action: 'UPDATE',
      entityType: 'FleetMaintenanceRecord',
      entityId: updated.id,
      changes: body,
    });
    return updated;
  });
}

export async function deleteMaintRecord(db: Db, uid: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.fleetMaintenanceRecord.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Maintenance record not found');
    await tx.fleetMaintenanceRecord.delete({ where: { id } });
    await audit(tx, { userId: uid, action: 'DELETE', entityType: 'FleetMaintenanceRecord', entityId: id });
    return { ok: true };
  });
}

/** Completed records whose nextDueDate falls within `days` (or is already past). */
export async function maintenanceDue(db: Db, days: number) {
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  return db.fleetMaintenanceRecord.findMany({
    where: { status: 'COMPLETED', nextDueDate: { not: null, lte: limit } },
    include: { vehicle: true },
    orderBy: { nextDueDate: 'asc' },
  });
}

/* ── Utilization ────────────────────────────────────────────────────────── */

export const utilizationQuerySchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export interface VehicleUtilization {
  vehicleId: string;
  plateNo: string;
  vehicleType: string | null;
  ownership: string;
  status: string;
  tripCount: number;
  completedTripCount: number;
  totalKm: number;
  cargoQt: number;
  fuelLiters: number;
  fuelCostBirr: number;
  kmPerLiter: number | null;
  activeDays: number;
  periodDays: number;
  utilizationPct: number;
}

export async function utilization(db: Db, q: z.infer<typeof utilizationQuerySchema>): Promise<VehicleUtilization[]> {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400_000);
  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400_000));

  const vehicles = await db.vehicle.findMany({ where: { isActive: true }, orderBy: { plateNo: 'asc' } });

  return Promise.all(
    vehicles.map(async (v) => {
      const trips = await db.fleetTrip.findMany({
        where: { vehicleId: v.id, departureAt: { gte: from, lte: to } },
      });
      const logs = await db.fuelLog.findMany({
        where: { vehicleId: v.id, loggedAt: { gte: from, lte: to } },
      });

      let totalKm = 0;
      const activeDays = new Set<string>();
      let cargoQt = 0;
      let completed = 0;
      for (const t of trips) {
        if (t.odometerStart != null && t.odometerEnd != null && Number(t.odometerEnd) > Number(t.odometerStart)) {
          totalKm += Number(t.odometerEnd) - Number(t.odometerStart);
        }
        if (t.departureAt) activeDays.add(new Date(t.departureAt).toISOString().slice(0, 10));
        if (t.status === 'COMPLETED') completed += 1;
        if (t.cargoQt != null) cargoQt += Number(t.cargoQt);
      }
      const fuelLiters = logs.reduce((s, l) => s + Number(l.liters), 0);
      const fuelCostBirr = logs.reduce((s, l) => s + Number(l.costBirr), 0);

      return {
        vehicleId: v.id,
        plateNo: v.plateNo,
        vehicleType: v.vehicleType,
        ownership: v.ownership,
        status: v.status,
        tripCount: trips.length,
        completedTripCount: completed,
        totalKm: Math.round(totalKm * 100) / 100,
        cargoQt: Math.round(cargoQt * 100) / 100,
        fuelLiters: Math.round(fuelLiters * 100) / 100,
        fuelCostBirr: Math.round(fuelCostBirr * 100) / 100,
        kmPerLiter: fuelLiters > 0 && totalKm > 0 ? Math.round((totalKm / fuelLiters) * 100) / 100 : null,
        activeDays: activeDays.size,
        periodDays,
        utilizationPct: Math.round((activeDays.size / periodDays) * 1000) / 10,
      };
    }),
  );
}

/* ── Reports ────────────────────────────────────────────────────────────── */

export interface FleetSummaryRow {
  vehicleId: string;
  plateNo: string;
  vehicleType: string | null;
  ownership: string;
  tripCount: number;
  totalKm: number;
  fuelLiters: number;
  fuelCostBirr: number;
  expenseCostBirr: number;
  maintenanceCostBirr: number;
  totalCostBirr: number;
  kmPerLiter: number | null;
  costPerKmBirr: number | null;
  birrPerLiter: number | null;
}

export async function reportSummary(db: Db, q: z.infer<typeof utilizationQuerySchema>): Promise<FleetSummaryRow[]> {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400_000);

  const vehicles = await db.vehicle.findMany({ orderBy: { plateNo: 'asc' } });

  return Promise.all(
    vehicles.map(async (v) => {
      const [trips, logs, expenses, maint] = await Promise.all([
        db.fleetTrip.findMany({ where: { vehicleId: v.id, departureAt: { gte: from, lte: to } } }),
        db.fuelLog.findMany({ where: { vehicleId: v.id, loggedAt: { gte: from, lte: to } } }),
        db.fleetExpense.findMany({ where: { vehicleId: v.id, expenseDate: { gte: from, lte: to } } }),
        db.fleetMaintenanceRecord.findMany({
          where: { vehicleId: v.id, serviceDate: { gte: from, lte: to } },
        }),
      ]);

      let totalKm = 0;
      for (const t of trips) {
        if (t.odometerStart != null && t.odometerEnd != null && Number(t.odometerEnd) > Number(t.odometerStart)) {
          totalKm += Number(t.odometerEnd) - Number(t.odometerStart);
        }
      }
      const fuelLiters = logs.reduce((s, l) => s + Number(l.liters), 0);
      const fuelCostBirr = logs.reduce((s, l) => s + Number(l.costBirr), 0);
      const expenseCostBirr = expenses.reduce((s, e) => s + Number(e.amountBirr), 0);
      const maintenanceCostBirr = maint.reduce((s, m) => s + Number(m.costBirr), 0);
      const totalCostBirr = fuelCostBirr + expenseCostBirr + maintenanceCostBirr;

      const r2 = (n: number) => Math.round(n * 100) / 100;
      return {
        vehicleId: v.id,
        plateNo: v.plateNo,
        vehicleType: v.vehicleType,
        ownership: v.ownership,
        tripCount: trips.length,
        totalKm: r2(totalKm),
        fuelLiters: r2(fuelLiters),
        fuelCostBirr: r2(fuelCostBirr),
        expenseCostBirr: r2(expenseCostBirr),
        maintenanceCostBirr: r2(maintenanceCostBirr),
        totalCostBirr: r2(totalCostBirr),
        kmPerLiter: fuelLiters > 0 && totalKm > 0 ? r2(totalKm / fuelLiters) : null,
        costPerKmBirr: totalKm > 0 ? r2(totalCostBirr / totalKm) : null,
        birrPerLiter: fuelLiters > 0 ? r2(fuelCostBirr / fuelLiters) : null,
      };
    }),
  );
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: (unknown[])[]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n');
}

export const csvQuerySchema = z.object({
  kind: z.enum(['trips', 'fuel', 'maintenance', 'expenses', 'summary']),
  vehicleId: z.string().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export async function buildCsv(db: Db, q: z.infer<typeof csvQuerySchema>): Promise<string> {
  const common = {
    vehicleId: q.vehicleId,
    from: q.from,
    to: q.to,
  };
  switch (q.kind) {
    case 'trips': {
      const rows = await listFleetTrips(db, common);
      return toCsv(
        ['Trip ID', 'Plate', 'Driver', 'From', 'To', 'Cargo', 'Quintals', 'Departure', 'Arrival', 'Km', 'Status', 'Dispatch'],
        rows.map((t) => [
          t.id,
          t.vehicle?.plateNo ?? '',
          t.driverName ?? '',
          t.routeFrom ?? '',
          t.routeTo ?? '',
          t.cargoType ?? '',
          t.cargoQt != null ? String(t.cargoQt) : '',
          t.departureAt ? new Date(t.departureAt).toISOString() : '',
          t.arrivalAt ? new Date(t.arrivalAt).toISOString() : '',
          t.odometerStart != null && t.odometerEnd != null
            ? String(Number(t.odometerEnd) - Number(t.odometerStart))
            : '',
          t.status,
          t.dispatchId ?? '',
        ]),
      );
    }
    case 'fuel': {
      const rows = await listFuelLogs(db, common);
      return toCsv(
        ['Log ID', 'Plate', 'Logged At', 'Liters', 'Cost (ETB)', 'Odometer', 'Station'],
        rows.map((l) => [
          l.id,
          l.vehicle?.plateNo ?? '',
          new Date(l.loggedAt).toISOString(),
          String(l.liters),
          String(l.costBirr),
          l.odometer != null ? String(l.odometer) : '',
          l.station ?? '',
        ]),
      );
    }
    case 'maintenance': {
      const rows = await listMaintRecords(db, common);
      return toCsv(
        ['Record ID', 'Plate', 'Service Type', 'Description', 'Service Date', 'Cost (ETB)', 'Odometer', 'Next Due', 'Performed By', 'Status'],
        rows.map((m) => [
          m.id,
          m.vehicle?.plateNo ?? '',
          m.serviceType,
          m.description,
          new Date(m.serviceDate).toISOString().slice(0, 10),
          String(m.costBirr),
          m.odometer != null ? String(m.odometer) : '',
          m.nextDueDate ? new Date(m.nextDueDate).toISOString().slice(0, 10) : '',
          m.performedBy ?? '',
          m.status,
        ]),
      );
    }
    case 'expenses': {
      const rows = await listExpenses(db, common);
      return toCsv(
        ['Expense ID', 'Plate', 'Date', 'Category', 'Amount (ETB)', 'Description'],
        rows.map((e) => [
          e.id,
          e.vehicle?.plateNo ?? '',
          new Date(e.expenseDate).toISOString().slice(0, 10),
          e.category,
          String(e.amountBirr),
          e.description ?? '',
        ]),
      );
    }
    case 'summary': {
      const rows = await reportSummary(db, { from: q.from, to: q.to });
      return toCsv(
        ['Plate', 'Type', 'Ownership', 'Trips', 'Km', 'Fuel Liters', 'Fuel Cost (ETB)', 'Expenses (ETB)', 'Maintenance (ETB)', 'Total Cost (ETB)', 'Km/L', 'Cost/Km (ETB)', 'ETB/Liter'],
        rows.map((r) => [
          r.plateNo,
          r.vehicleType ?? '',
          r.ownership,
          r.tripCount,
          r.totalKm,
          r.fuelLiters,
          r.fuelCostBirr,
          r.expenseCostBirr,
          r.maintenanceCostBirr,
          r.totalCostBirr,
          r.kmPerLiter ?? '',
          r.costPerKmBirr ?? '',
          r.birrPerLiter ?? '',
        ]),
      );
    }
  }
}
