import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';

/**
 * Module 9 — Maintenance & Spare Parts service.
 *
 * NOTE: The Prisma models used here (MaintenanceEquipment, PmTemplate,
 * PmExecution, BreakdownRecord, SparePart, SparePartVerification,
 * WorkOrder, RepairApproval) live in /tmp/schema-module9.prisma pending the
 * coordinator merge into schema.prisma. All access goes through an `any`
 * cast so the API package keeps type-checking (zero new tsc errors) until
 * the merge lands; behaviour is unchanged afterwards.
 */

const db = prisma as any;

type Tx = any;

export const EQUIPMENT_TYPES = [
  'ROLLER_MILL',
  'PLANSIFTER',
  'PURIFIER',
  'CONVEYOR',
  'BUCKET_ELEVATOR',
  'PACKING_MACHINE',
  'COMPRESSOR',
  'GENERATOR',
  'OTHER',
] as const;

export const WO_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN'],
  IN_PROGRESS: ['COMPLETED', 'ASSIGNED'],
  COMPLETED: ['VERIFIED', 'IN_PROGRESS'],
  VERIFIED: [],
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

// ─── Equipment ─────────────────────────────────────────────────────

export async function listEquipment(opts: {
  overdue?: boolean;
  dueSoonDays?: number;
  type?: string;
  search?: string;
}) {
  const where: Record<string, any> = {};
  if (opts.type) where.type = opts.type;
  if (opts.search) where.name = { contains: opts.search, mode: 'insensitive' };
  const rows = await db.maintenanceEquipment.findMany({
    where,
    orderBy: [{ nextDueDate: 'asc' }, { name: 'asc' }],
  });
  const today = startOfToday();
  const dueSoonLimit = opts.dueSoonDays ? addDays(today, opts.dueSoonDays) : null;
  const mapped = rows.map((r: any) => {
    const due = r.nextDueDate ? new Date(r.nextDueDate) : null;
    const overdue = !!due && due < today;
    const dueSoon = !overdue && !!due && dueSoonLimit !== null && due <= dueSoonLimit;
    return { ...r, overdue, dueSoon };
  });
  return opts.overdue ? mapped.filter((r: any) => r.overdue) : mapped;
}

export async function createEquipment(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.maintenanceEquipment.create({
      data: {
        name: b.name,
        type: b.type,
        location: b.location ?? null,
        installDate: b.installDate ?? null,
        intervalDays: b.intervalDays ?? 30,
        nextDueDate: b.nextDueDate ?? null,
        status: b.status ?? 'OPERATIONAL',
      },
    });
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'MaintenanceEquipment',
      entityId: created.id,
      changes: { name: b.name, type: b.type },
    });
    return created;
  });
}

export async function updateEquipment(userId: string, id: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.maintenanceEquipment.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Equipment not found');
    const saved = await tx.maintenanceEquipment.update({
      where: { id },
      data: {
        name: b.name,
        type: b.type,
        location: b.location === undefined ? undefined : (b.location ?? null),
        installDate: b.installDate === undefined ? undefined : (b.installDate ?? null),
        intervalDays: b.intervalDays,
        nextDueDate: b.nextDueDate === undefined ? undefined : (b.nextDueDate ?? null),
        status: b.status,
      },
    });
    await audit(tx, { userId, action: 'UPDATE', entityType: 'MaintenanceEquipment', entityId: id, changes: b });
    return saved;
  });
}

// ─── PM templates & executions ─────────────────────────────────────

export async function listPmTemplates(equipmentType?: string) {
  return db.pmTemplate.findMany({
    where: equipmentType ? { equipmentType } : {},
    orderBy: [{ equipmentType: 'asc' }, { name: 'asc' }],
  });
}

export async function createPmTemplate(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.pmTemplate.create({
      data: {
        equipmentType: b.equipmentType,
        name: b.name,
        frequencyDays: b.frequencyDays,
        estimatedMinutes: b.estimatedMinutes,
        items: b.items,
      },
    });
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'PmTemplate',
      entityId: created.id,
      changes: { name: b.name, equipmentType: b.equipmentType },
    });
    return created;
  });
}

export async function updatePmTemplate(userId: string, id: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.pmTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'PM template not found');
    const saved = await tx.pmTemplate.update({
      where: { id },
      data: {
        name: b.name,
        equipmentType: b.equipmentType,
        frequencyDays: b.frequencyDays,
        estimatedMinutes: b.estimatedMinutes,
        items: b.items,
      },
    });
    await audit(tx, { userId, action: 'UPDATE', entityType: 'PmTemplate', entityId: id, changes: b });
    return saved;
  });
}

/** Record a PM execution; rolls the equipment's next due date forward. */
export async function executePm(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const equipment = await tx.maintenanceEquipment.findUnique({ where: { id: b.equipmentId } });
    if (!equipment) throw new AppError(404, 'Equipment not found');
    const interval = b.intervalDays ?? equipment.intervalDays ?? 30;
    const nextDue = addDays(startOfToday(), interval);
    const exec = await tx.pmExecution.create({
      data: {
        equipmentId: b.equipmentId,
        templateId: b.templateId ?? null,
        executedById: userId,
        checklist: b.checklist,
        durationMinutes: b.durationMinutes ?? null,
        notes: b.notes ?? null,
        nextDueDate: nextDue,
      },
    });
    await tx.maintenanceEquipment.update({
      where: { id: b.equipmentId },
      data: { lastMaintainedAt: new Date(), nextDueDate: nextDue },
    });
    await audit(tx, {
      userId,
      action: 'EXECUTE',
      entityType: 'PmExecution',
      entityId: exec.id,
      changes: { equipmentId: b.equipmentId, nextDueDate: nextDue },
    });
    return exec;
  });
}

export async function listPmExecutions(equipmentId?: string, limit = 100) {
  return db.pmExecution.findMany({
    where: equipmentId ? { equipmentId } : {},
    include: { equipment: { select: { id: true, name: true, type: true } } },
    orderBy: { executedAt: 'desc' },
    take: limit,
  });
}

// ─── Breakdowns ────────────────────────────────────────────────────

export async function listBreakdowns(opts: { status?: string; category?: string; from?: Date; to?: Date }) {
  const where: Record<string, any> = {};
  if (opts.status) where.status = opts.status;
  if (opts.category) where.category = opts.category;
  if (opts.from || opts.to) {
    where.failureTime = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
  }
  return db.breakdownRecord.findMany({
    where,
    include: { equipment: { select: { id: true, name: true, type: true } } },
    orderBy: { failureTime: 'desc' },
  });
}

export async function reportBreakdown(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const equipment = await tx.maintenanceEquipment.findUnique({ where: { id: b.equipmentId } });
    if (!equipment) throw new AppError(404, 'Equipment not found');
    const rec = await tx.breakdownRecord.create({
      data: {
        equipmentId: b.equipmentId,
        reportedById: userId,
        reportedByName: b.reportedByName ?? null,
        failureTime: b.failureTime,
        symptom: b.symptom,
        category: b.category,
      },
    });
    await tx.maintenanceEquipment.update({
      where: { id: b.equipmentId },
      data: { status: 'BREAKDOWN' },
    });
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'BreakdownRecord',
      entityId: rec.id,
      changes: { equipmentId: b.equipmentId, category: b.category },
    });
    return rec;
  });
}

export async function resolveBreakdown(userId: string, id: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const rec = await tx.breakdownRecord.findUnique({ where: { id } });
    if (!rec) throw new AppError(404, 'Breakdown record not found');
    if (rec.status === 'RESOLVED') throw new AppError(409, 'Breakdown is already resolved');
    const resolvedAt = b.resolvedAt ?? new Date();
    const downtimeMinutes = Math.max(
      0,
      Math.round((new Date(resolvedAt).getTime() - new Date(rec.failureTime).getTime()) / 60000),
    );
    const saved = await tx.breakdownRecord.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        repairNotes: b.repairNotes ?? null,
        resolvedAt,
        resolvedById: userId,
        resolvedByName: b.resolvedByName ?? null,
        downtimeMinutes,
      },
    });
    await tx.maintenanceEquipment.update({
      where: { id: rec.equipmentId },
      data: { status: 'OPERATIONAL' },
    });
    await audit(tx, {
      userId,
      action: 'RESOLVE',
      entityType: 'BreakdownRecord',
      entityId: id,
      changes: { downtimeMinutes },
    });
    return saved;
  });
}

// ─── Spare parts ───────────────────────────────────────────────────

export async function listSpareParts(opts: { lowStock?: boolean; search?: string }) {
  const where: Record<string, any> = {};
  if (opts.search) {
    where.OR = [
      { partNumber: { contains: opts.search, mode: 'insensitive' } },
      { name: { contains: opts.search, mode: 'insensitive' } },
    ];
  }
  const rows = await db.sparePart.findMany({ where, orderBy: { partNumber: 'asc' } });
  const mapped = rows.map((r: any) => ({
    ...r,
    stockQty: Number(r.stockQty),
    minLevel: Number(r.minLevel),
    lowStock: Number(r.stockQty) <= Number(r.minLevel),
  }));
  return opts.lowStock ? mapped.filter((r: any) => r.lowStock) : mapped;
}

export async function createSparePart(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    try {
      const created = await tx.sparePart.create({
        data: {
          partNumber: b.partNumber,
          name: b.name,
          compatibleTypes: b.compatibleTypes ?? null,
          stockQty: new Prisma.Decimal(b.stockQty ?? 0),
          minLevel: new Prisma.Decimal(b.minLevel ?? 0),
          locationBin: b.locationBin ?? null,
          unit: b.unit ?? 'pcs',
        },
      });
      await audit(tx, {
        userId,
        action: 'CREATE',
        entityType: 'SparePart',
        entityId: created.id,
        changes: { partNumber: b.partNumber, name: b.name },
      });
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'Part number already exists');
      }
      throw err;
    }
  });
}

export async function updateSparePart(userId: string, id: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.sparePart.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Spare part not found');
    const saved = await tx.sparePart.update({
      where: { id },
      data: {
        name: b.name,
        compatibleTypes: b.compatibleTypes === undefined ? undefined : (b.compatibleTypes ?? null),
        minLevel: b.minLevel === undefined ? undefined : new Prisma.Decimal(b.minLevel),
        locationBin: b.locationBin === undefined ? undefined : (b.locationBin ?? null),
        unit: b.unit,
      },
    });
    await audit(tx, { userId, action: 'UPDATE', entityType: 'SparePart', entityId: id, changes: b });
    return saved;
  });
}

/** Stock adjustment: positive qty = receipt, negative = issue. */
export async function adjustSparePartStock(userId: string, id: string, qty: number, note?: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const part = await tx.sparePart.findUnique({ where: { id } });
    if (!part) throw new AppError(404, 'Spare part not found');
    const next = Number(part.stockQty) + qty;
    if (next < 0) throw new AppError(400, 'Adjustment would take stock below zero');
    const saved = await tx.sparePart.update({
      where: { id },
      data: { stockQty: new Prisma.Decimal(next) },
    });
    await audit(tx, {
      userId,
      action: qty >= 0 ? 'STOCK_RECEIPT' : 'STOCK_ISSUE',
      entityType: 'SparePart',
      entityId: id,
      changes: { qty, note: note ?? null, newStock: next },
    });
    return { ...saved, lowStock: next <= Number(part.minLevel) };
  });
}

/** Periodic physical verification: count vs system, store variance. */
export async function verifySparePart(userId: string, id: string, countedQty: number, notes?: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const part = await tx.sparePart.findUnique({ where: { id } });
    if (!part) throw new AppError(404, 'Spare part not found');
    const systemQty = Number(part.stockQty);
    const variance = countedQty - systemQty;
    const verification = await tx.sparePartVerification.create({
      data: {
        partId: id,
        countedQty: new Prisma.Decimal(countedQty),
        systemQty: new Prisma.Decimal(systemQty),
        variance: new Prisma.Decimal(variance),
        verifiedById: userId,
        notes: notes ?? null,
      },
    });
    await audit(tx, {
      userId,
      action: 'VERIFY',
      entityType: 'SparePartVerification',
      entityId: verification.id,
      changes: { partId: id, countedQty, systemQty, variance },
    });
    return verification;
  });
}

export async function listSparePartVerifications(partId?: string, limit = 100) {
  return db.sparePartVerification.findMany({
    where: partId ? { partId } : {},
    include: { part: { select: { partNumber: true, name: true } } },
    orderBy: { verifiedAt: 'desc' },
    take: limit,
  });
}

// ─── Work orders ───────────────────────────────────────────────────

function nextWoNumber(seq: number): string {
  return `WO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
}

export async function listWorkOrders(opts: { status?: string; priority?: string; equipmentId?: string }) {
  const where: Record<string, any> = {};
  if (opts.status) where.status = opts.status;
  if (opts.priority) where.priority = opts.priority;
  if (opts.equipmentId) where.equipmentId = opts.equipmentId;
  return db.workOrder.findMany({
    where,
    include: {
      equipment: { select: { id: true, name: true, type: true } },
      approval: true,
    },
    orderBy: { openedAt: 'desc' },
  });
}

export async function createWorkOrder(userId: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const equipment = await tx.maintenanceEquipment.findUnique({ where: { id: b.equipmentId } });
    if (!equipment) throw new AppError(404, 'Equipment not found');
    if (b.breakdownId) {
      const bd = await tx.breakdownRecord.findUnique({ where: { id: b.breakdownId } });
      if (!bd) throw new AppError(404, 'Breakdown record not found');
    }
    const count = await tx.workOrder.count();
    const wo = await tx.workOrder.create({
      data: {
        woNumber: nextWoNumber(count + 1),
        equipmentId: b.equipmentId,
        kind: b.kind ?? 'CORRECTIVE',
        priority: b.priority ?? 'MEDIUM',
        assigneeId: b.assigneeId ?? null,
        assigneeName: b.assigneeName ?? null,
        breakdownId: b.breakdownId ?? null,
        description: b.description,
        notes: b.notes ?? null,
        status: b.assigneeId ? 'ASSIGNED' : 'OPEN',
        assignedAt: b.assigneeId ? new Date() : null,
      },
    });
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WorkOrder',
      entityId: wo.id,
      changes: { woNumber: wo.woNumber, equipmentId: b.equipmentId },
    });
    return wo;
  });
}

export async function transitionWorkOrder(userId: string, id: string, b: any) {
  return prisma.$transaction(async (tx: Tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id }, include: { approval: true } });
    if (!wo) throw new AppError(404, 'Work order not found');
    const next = b.status as string;
    const allowed = WO_TRANSITIONS[wo.status] ?? [];
    if (!allowed.includes(next)) {
      throw new AppError(409, `Cannot move work order from ${wo.status} to ${next}`);
    }
    const patch: Record<string, any> = { status: next };
    const now = new Date();
    if (next === 'ASSIGNED') {
      if (b.assigneeName !== undefined) patch.assigneeName = b.assigneeName ?? null;
      if (b.assigneeId !== undefined) patch.assigneeId = b.assigneeId ?? null;
      patch.assignedAt = now;
    }
    if (next === 'IN_PROGRESS') patch.startedAt = now;
    if (next === 'COMPLETED') {
      patch.completedAt = now;
      // Create the approval row the first time a WO completes.
      await tx.repairApproval.upsert({
        where: { workOrderId: id },
        create: { workOrderId: id },
        update: {},
      });
    }
    if (next === 'VERIFIED') {
      if (wo.approval?.decision !== 'APPROVED') {
        throw new AppError(409, 'Work order must be supervisor-approved before verification');
      }
      patch.verifiedAt = now;
      patch.verifiedById = userId;
      await tx.maintenanceEquipment.update({
        where: { id: wo.equipmentId },
        data: { status: 'OPERATIONAL' },
      });
    }
    const saved = await tx.workOrder.update({ where: { id }, data: patch });
    await audit(tx, {
      userId,
      action: 'STATUS_CHANGE',
      entityType: 'WorkOrder',
      entityId: id,
      changes: { from: wo.status, to: next },
    });
    return saved;
  });
}

/** Record parts consumed by a work order; decrements stock. */
export async function recordWorkOrderParts(userId: string, id: string, items: { partId: string; qty: number }[]) {
  return prisma.$transaction(async (tx: Tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id } });
    if (!wo) throw new AppError(404, 'Work order not found');
    if (wo.status === 'VERIFIED') throw new AppError(409, 'Cannot add parts to a verified work order');
    const consumed: any[] = [];
    for (const item of items) {
      const part = await tx.sparePart.findUnique({ where: { id: item.partId } });
      if (!part) throw new AppError(404, `Spare part not found: ${item.partId}`);
      if (item.qty <= 0) throw new AppError(400, 'Part quantity must be positive');
      const next = Number(part.stockQty) - item.qty;
      if (next < 0) {
        throw new AppError(400, `Insufficient stock for ${part.partNumber} (have ${part.stockQty})`);
      }
      await tx.sparePart.update({
        where: { id: item.partId },
        data: { stockQty: new Prisma.Decimal(next) },
      });
      consumed.push({ partId: part.id, partNumber: part.partNumber, name: part.name, qty: item.qty });
    }
    const existing = Array.isArray(wo.partsUsed) ? (wo.partsUsed as any[]) : [];
    const saved = await tx.workOrder.update({
      where: { id },
      data: { partsUsed: [...existing, ...consumed] as any },
    });
    await audit(tx, {
      userId,
      action: 'PARTS_CONSUMED',
      entityType: 'WorkOrder',
      entityId: id,
      changes: { parts: consumed },
    });
    return saved;
  });
}

// ─── Repair approval ───────────────────────────────────────────────

export async function listRepairApprovals(pendingOnly: boolean) {
  const where = pendingOnly ? { decision: null } : {};
  return db.repairApproval.findMany({
    where,
    include: {
      workOrder: { include: { equipment: { select: { id: true, name: true, type: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function techSignoff(userId: string, workOrderId: string, technicianNote?: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, include: { approval: true } });
    if (!wo) throw new AppError(404, 'Work order not found');
    if (wo.status !== 'COMPLETED') throw new AppError(409, 'Only completed work orders can be signed off');
    const saved = await tx.repairApproval.upsert({
      where: { workOrderId },
      create: { workOrderId, technicianNote: technicianNote ?? null, techSignedAt: new Date(), techSignedById: userId },
      update: { technicianNote: technicianNote ?? null, techSignedAt: new Date(), techSignedById: userId },
    });
    await audit(tx, {
      userId,
      action: 'SIGNOFF',
      entityType: 'RepairApproval',
      entityId: saved.id,
      changes: { workOrderId },
    });
    return saved;
  });
}

export async function supervisorDecision(userId: string, approvalId: string, decision: 'APPROVED' | 'REJECTED', supervisorNote?: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const approval = await tx.repairApproval.findUnique({ where: { id: approvalId } });
    if (!approval) throw new AppError(404, 'Repair approval not found');
    if (!approval.techSignedAt) throw new AppError(409, 'Technician sign-off is required first');
    if (approval.decision) throw new AppError(409, 'Decision already recorded');
    const saved = await tx.repairApproval.update({
      where: { id: approvalId },
      data: {
        decision,
        supervisorNote: supervisorNote ?? null,
        approvedAt: new Date(),
        approvedById: userId,
      },
    });
    await audit(tx, {
      userId,
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityType: 'RepairApproval',
      entityId: approvalId,
      changes: { decision },
    });
    return saved;
  });
}

export async function backInService(userId: string, workOrderId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, include: { approval: true } });
    if (!wo) throw new AppError(404, 'Work order not found');
    if (wo.approval?.decision !== 'APPROVED') throw new AppError(409, 'Supervisor approval is required first');
    await tx.repairApproval.update({
      where: { workOrderId },
      data: { backInServiceAt: new Date() },
    });
    await tx.maintenanceEquipment.update({
      where: { id: wo.equipmentId },
      data: { status: 'OPERATIONAL' },
    });
    await audit(tx, {
      userId,
      action: 'BACK_IN_SERVICE',
      entityType: 'WorkOrder',
      entityId: workOrderId,
      changes: {},
    });
    return { ok: true };
  });
}

// ─── Reports ───────────────────────────────────────────────────────

export async function overdueReport() {
  const equipment = await listEquipment({ overdue: true });
  const pendingBreakdowns = await db.breakdownRecord.findMany({
    where: { status: { in: ['OPEN', 'IN_REPAIR'] } },
    include: { equipment: { select: { id: true, name: true, type: true } } },
    orderBy: { failureTime: 'asc' },
  });
  return { equipment, pendingBreakdowns };
}

export async function maintenanceKpis(from?: Date, to?: Date) {
  const where: Record<string, any> = {};
  if (from || to) {
    where.failureTime = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  const breakdowns = await db.breakdownRecord.findMany({ where });
  const resolved = breakdowns.filter((b: any) => b.status === 'RESOLVED' && b.downtimeMinutes != null);
  const totalDowntime = resolved.reduce((s: number, b: any) => s + (b.downtimeMinutes ?? 0), 0);
  // MTBF: span from first failure to last failure (or now) / failures
  const times = breakdowns.map((b: any) => new Date(b.failureTime).getTime()).sort((a: number, b2: number) => a - b2);
  let mtbfMinutes: number | null = null;
  if (times.length >= 2) {
    const span = (times[times.length - 1] - times[0]) / 60000;
    mtbfMinutes = span / times.length;
  }
  const byCategoryMap = new Map<string, { count: number; downtime: number }>();
  for (const b of breakdowns) {
    const entry = byCategoryMap.get(b.category) ?? { count: 0, downtime: 0 };
    entry.count += 1;
    entry.downtime += b.downtimeMinutes ?? 0;
    byCategoryMap.set(b.category, entry);
  }
  const byCategory = [...byCategoryMap.entries()].map(([category, v]) => ({
    category,
    count: v.count,
    avgDowntimeMinutes: v.count ? Math.round(v.downtime / v.count) : 0,
  }));

  // Parts consumption from work orders in range
  const woWhere: Record<string, any> = {};
  if (from || to) {
    woWhere.openedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  const workOrders = await db.workOrder.findMany({ where: woWhere, select: { partsUsed: true } });
  const partsMap = new Map<string, { partNumber: string; name: string; qty: number }>();
  for (const wo of workOrders) {
    const used = Array.isArray(wo.partsUsed) ? (wo.partsUsed as any[]) : [];
    for (const p of used) {
      const key = p.partNumber ?? p.partId ?? 'unknown';
      const entry = partsMap.get(key) ?? { partNumber: key, name: p.name ?? key, qty: 0 };
      entry.qty += Number(p.qty ?? 0);
      partsMap.set(key, entry);
    }
  }
  const partsConsumed = [...partsMap.values()].sort((a, b2) => b2.qty - a.qty);

  return {
    totalBreakdowns: breakdowns.length,
    resolvedCount: resolved.length,
    openCount: breakdowns.length - resolved.length,
    totalDowntimeMinutes: totalDowntime,
    mtbfMinutes: mtbfMinutes == null ? null : Math.round(mtbfMinutes),
    mttrMinutes: resolved.length ? Math.round(totalDowntime / resolved.length) : null,
    byCategory,
    partsConsumed,
  };
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}
