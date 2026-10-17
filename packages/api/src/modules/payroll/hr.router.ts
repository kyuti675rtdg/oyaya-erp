import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PieceStage, PayrollMode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit } from '../../lib/audit';
import { approveHrPayrollRun, computeHrPayrollRun, postHrPayrollRun } from './hr.service';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParams = z.object({ id: z.string().min(1) });

// ─── Departments ────────────────────────────────────────────────

router.get('/departments', requirePermission('hr:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true, positions: true } } },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/departments/tree', requirePermission('hr:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.department.findMany({
      where: { isActive: true },
      include: { children: { where: { isActive: true }, orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    res.json(rows.filter((d) => !d.parentId));
  } catch (err) {
    next(err);
  }
});

const departmentSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

router.post(
  '/departments',
  requirePermission('hr:manage'),
  validateBody(departmentSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof departmentSchema>;
      const row = await prisma.department.create({ data: body });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'Department',
        entityId: row.id,
        changes: body,
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        next(new AppError(409, 'Department code already exists'));
        return;
      }
      next(err);
    }
  },
);

router.put(
  '/departments/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  validateBody(departmentSchema.partial()),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof departmentSchema> & { isActive?: boolean };
      const row = await prisma.department.update({ where: { id: req.params.id }, data: body });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'Department',
        entityId: row.id,
        changes: body,
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Positions ──────────────────────────────────────────────────

router.get(
  '/positions',
  requirePermission('hr:view'),
  validateQuery(z.object({ departmentId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as { departmentId?: string };
      const rows = await prisma.position.findMany({
        where: q.departmentId ? { departmentId: q.departmentId } : {},
        include: { department: true },
        orderBy: { title: 'asc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const positionSchema = z.object({
  code: z.string().min(1).max(20),
  title: z.string().min(1).max(120),
  departmentId: z.string().optional().nullable(),
  grade: z.string().max(20).optional().nullable(),
  bandMin: z.number().nonnegative().optional().nullable(),
  bandMax: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
});

router.post(
  '/positions',
  requirePermission('hr:manage'),
  validateBody(positionSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof positionSchema>;
      const row = await prisma.position.create({
        data: {
          ...body,
          bandMin: body.bandMin != null ? new Prisma.Decimal(body.bandMin) : null,
          bandMax: body.bandMax != null ? new Prisma.Decimal(body.bandMax) : null,
        },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'Position',
        entityId: row.id,
        changes: body,
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        next(new AppError(409, 'Position code already exists'));
        return;
      }
      next(err);
    }
  },
);

router.put(
  '/positions/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  validateBody(positionSchema.partial()),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as Partial<z.infer<typeof positionSchema>>;
      const row = await prisma.position.update({
        where: { id: req.params.id },
        data: {
          ...body,
          bandMin: body.bandMin === null ? null : body.bandMin != null ? new Prisma.Decimal(body.bandMin) : undefined,
          bandMax: body.bandMax === null ? null : body.bandMax != null ? new Prisma.Decimal(body.bandMax) : undefined,
        },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'Position',
        entityId: row.id,
        changes: body,
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Employees ──────────────────────────────────────────────────

const employeeQuerySchema = z.object({
  q: z.string().optional(),
  departmentId: z.string().optional(),
  payrollMode: z.nativeEnum(PayrollMode).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

router.get(
  '/employees',
  requirePermission('hr:view'),
  validateQuery(employeeQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof employeeQuerySchema>;
      const rows = await prisma.employee.findMany({
        where: {
          ...(q.q
            ? {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' } },
                  { employeeNo: { contains: q.q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
          ...(q.payrollMode ? { payrollMode: q.payrollMode } : {}),
          ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
        },
        include: { departmentRef: true, position: true },
        orderBy: { name: 'asc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const employeeSchema = z.object({
  employeeNo: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  phone: z.string().max(30).optional().nullable(),
  jobTitle: z.string().min(1).max(120),
  departmentId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  payrollMode: z.nativeEnum(PayrollMode),
  baseSalary: z.number().nonnegative().optional().nullable(),
  bankName: z.string().max(80).optional().nullable(),
  bankAccount: z.string().max(60).optional().nullable(),
  zkPin: z.string().max(30).optional().nullable(),
  isActive: z.boolean().optional(),
  hiredAt: z.string().datetime().optional(),
});

router.post(
  '/employees',
  requirePermission('hr:manage'),
  validateBody(employeeSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof employeeSchema>;
      const row = await prisma.employee.create({
        data: {
          ...body,
          baseSalary: body.baseSalary != null ? new Prisma.Decimal(body.baseSalary) : null,
          hiredAt: body.hiredAt ? new Date(body.hiredAt) : undefined,
        },
        include: { departmentRef: true, position: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'Employee',
        entityId: row.id,
        changes: { employeeNo: body.employeeNo, name: body.name },
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        next(new AppError(409, 'Employee number or ZKTeco PIN already exists'));
        return;
      }
      next(err);
    }
  },
);

router.get(
  '/employees/:id',
  requirePermission('hr:view'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const row = await prisma.employee.findUnique({
        where: { id: req.params.id },
        include: { departmentRef: true, position: true, allowances: { include: { type: true } } },
      });
      if (!row) throw new AppError(404, 'Employee not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/employees/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  validateBody(employeeSchema.partial()),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as Partial<z.infer<typeof employeeSchema>>;
      const row = await prisma.employee.update({
        where: { id: req.params.id },
        data: {
          ...body,
          baseSalary:
            body.baseSalary === null ? null : body.baseSalary != null ? new Prisma.Decimal(body.baseSalary) : undefined,
          hiredAt: body.hiredAt ? new Date(body.hiredAt) : undefined,
        },
        include: { departmentRef: true, position: true },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'Employee',
        entityId: row.id,
        changes: body,
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

/** Soft-delete: deactivates the employee instead of removing history. */
router.delete(
  '/employees/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const row = await prisma.employee.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      await audit(prisma, {
        userId: uid,
        action: 'DEACTIVATE',
        entityType: 'Employee',
        entityId: row.id,
        changes: { isActive: false },
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Attendance records ─────────────────────────────────────────

const attendanceQuerySchema = z.object({
  employeeId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

router.get(
  '/attendance',
  requirePermission('hr:view'),
  validateQuery(attendanceQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof attendanceQuerySchema>;
      const rows = await prisma.attendanceRecord.findMany({
        where: {
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
          ...(q.from || q.to
            ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
            : {}),
        },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
        orderBy: { date: 'desc' },
        take: 500,
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const attendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().datetime(),
  status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY']).default('PRESENT'),
  checkIn: z.string().datetime().optional().nullable(),
  checkOut: z.string().datetime().optional().nullable(),
  workHours: z.number().nonnegative().optional(),
  overtimeHours: z.number().nonnegative().optional(),
  lateMinutes: z.number().int().nonnegative().optional(),
  source: z.enum(['ZKTECO', 'MANUAL', 'CSV']).default('MANUAL'),
  notes: z.string().optional().nullable(),
});

/** Normalize a datetime to midnight UTC so (employeeId, date) is unique per day. */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

router.post(
  '/attendance',
  requirePermission('hr:manage'),
  validateBody(attendanceSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof attendanceSchema>;
      const date = startOfUtcDay(new Date(body.date));
      const row = await prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: body.employeeId, date } },
        create: {
          employeeId: body.employeeId,
          date,
          status: body.status,
          checkIn: body.checkIn ? new Date(body.checkIn) : null,
          checkOut: body.checkOut ? new Date(body.checkOut) : null,
          workHours: new Prisma.Decimal(body.workHours ?? 0),
          overtimeHours: new Prisma.Decimal(body.overtimeHours ?? 0),
          lateMinutes: body.lateMinutes ?? 0,
          source: body.source,
          notes: body.notes ?? null,
        },
        update: {
          status: body.status,
          checkIn: body.checkIn ? new Date(body.checkIn) : null,
          checkOut: body.checkOut ? new Date(body.checkOut) : null,
          workHours: new Prisma.Decimal(body.workHours ?? 0),
          overtimeHours: new Prisma.Decimal(body.overtimeHours ?? 0),
          lateMinutes: body.lateMinutes ?? 0,
          source: body.source,
          notes: body.notes ?? null,
        },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPSERT',
        entityType: 'AttendanceRecord',
        entityId: row.id,
        changes: { employeeId: body.employeeId, date: date.toISOString(), status: body.status },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * CSV import (ZKTeco import placeholder): each row
 *   employeeNo,date(YYYY-MM-DD),checkIn(HH:MM),checkOut(HH:MM),status,notes
 * Work hours, overtime (>8h) and late minutes (>08:00 check-in) are derived.
 */
const csvImportSchema = z.object({ csv: z.string().min(1) });

router.post(
  '/attendance/import',
  requirePermission('hr:manage'),
  validateBody(csvImportSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof csvImportSchema>;
      const lines = body.csv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      const dataLines = lines[0]?.toLowerCase().startsWith('employeeno') ? lines.slice(1) : lines;
      let imported = 0;
      const errors: string[] = [];
      for (const [idx, line] of dataLines.entries()) {
        const cols = line.split(',').map((c) => c.trim());
        const [employeeNo, dateStr, inStr, outStr, statusStr, notes] = cols;
        if (!employeeNo || !dateStr) {
          errors.push(`row ${idx + 1}: employeeNo and date are required`);
          continue;
        }
        const emp = await prisma.employee.findUnique({ where: { employeeNo } });
        if (!emp) {
          errors.push(`row ${idx + 1}: unknown employeeNo ${employeeNo}`);
          continue;
        }
        const date = startOfUtcDay(new Date(`${dateStr}T00:00:00Z`));
        if (Number.isNaN(date.getTime())) {
          errors.push(`row ${idx + 1}: invalid date ${dateStr}`);
          continue;
        }
        const checkIn = inStr ? new Date(`${dateStr}T${inStr}:00Z`) : null;
        const checkOut = outStr ? new Date(`${dateStr}T${outStr}:00Z`) : null;
        let workHours = 0;
        let overtimeHours = 0;
        let lateMinutes = 0;
        if (checkIn && checkOut && checkOut > checkIn) {
          workHours = (checkOut.getTime() - checkIn.getTime()) / 3600000;
          overtimeHours = Math.max(0, workHours - 8);
          const shiftStart = new Date(`${dateStr}T08:00:00Z`);
          if (checkIn > shiftStart) lateMinutes = Math.round((checkIn.getTime() - shiftStart.getTime()) / 60000);
        }
        const status = (statusStr || (lateMinutes > 0 ? 'LATE' : 'PRESENT')).toUpperCase();
        const validStatus = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY'].includes(status)
          ? (status as 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HALF_DAY')
          : 'PRESENT';
        await prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: emp.id, date } },
          create: {
            employeeId: emp.id,
            date,
            status: validStatus,
            checkIn,
            checkOut,
            workHours: new Prisma.Decimal(workHours.toFixed(2)),
            overtimeHours: new Prisma.Decimal(overtimeHours.toFixed(2)),
            lateMinutes,
            source: 'CSV',
            notes: notes || null,
          },
          update: {
            status: validStatus,
            checkIn,
            checkOut,
            workHours: new Prisma.Decimal(workHours.toFixed(2)),
            overtimeHours: new Prisma.Decimal(overtimeHours.toFixed(2)),
            lateMinutes,
            source: 'CSV',
            notes: notes || null,
          },
        });
        imported += 1;
      }
      await audit(prisma, {
        userId: uid,
        action: 'IMPORT',
        entityType: 'AttendanceRecord',
        entityId: null,
        changes: { imported, errors: errors.length },
      });
      res.status(201).json({ imported, errors });
    } catch (err) {
      next(err);
    }
  },
);

/** Per-employee attendance summary for a pay month. */
router.get(
  '/attendance/summary',
  requirePermission('hr:view'),
  validateQuery(z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12) })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { year: number; month: number };
      const start = new Date(q.year, q.month - 1, 1);
      const end = new Date(q.year, q.month, 1);
      const rows = await prisma.attendanceRecord.findMany({
        where: { date: { gte: start, lt: end } },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
      });
      const byEmp = new Map<string, { employee: { id: string; employeeNo: string; name: string }; present: number; late: number; absent: number; leave: number; overtimeHours: number; lateMinutes: number }>();
      for (const r of rows) {
        let agg = byEmp.get(r.employeeId);
        if (!agg) {
          agg = { employee: r.employee, present: 0, late: 0, absent: 0, leave: 0, overtimeHours: 0, lateMinutes: 0 };
          byEmp.set(r.employeeId, agg);
        }
        if (r.status === 'PRESENT') agg.present += 1;
        if (r.status === 'LATE') agg.late += 1;
        if (r.status === 'ABSENT') agg.absent += 1;
        if (r.status === 'LEAVE' || r.status === 'HALF_DAY') agg.leave += 1;
        agg.overtimeHours += Number(r.overtimeHours);
        agg.lateMinutes += r.lateMinutes;
      }
      res.json([...byEmp.values()]);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Piece-rate work ────────────────────────────────────────────

const pieceWorkQuerySchema = z.object({
  employeeId: z.string().optional(),
  stage: z.nativeEnum(PieceStage).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

router.get(
  '/piece-work',
  requirePermission('hr:view'),
  validateQuery(pieceWorkQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof pieceWorkQuerySchema>;
      const rows = await prisma.pieceRateWork.findMany({
        where: {
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.from || q.to
            ? { workDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
            : {}),
        },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
        orderBy: { workDate: 'desc' },
        take: 500,
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const pieceWorkSchema = z.object({
  employeeId: z.string().optional().nullable(),
  laborer: z.string().min(1).max(120),
  stage: z.nativeEnum(PieceStage),
  bags: z.number().int().nonnegative().default(0),
  quintals: z.number().positive(),
  rateBirrPerQ: z.number().positive().optional(),
  workDate: z.string().datetime().optional(),
  truckPlate: z.string().max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  '/piece-work',
  requirePermission('hr:manage'),
  validateBody(pieceWorkSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof pieceWorkSchema>;
      let rate = body.rateBirrPerQ;
      if (rate == null) {
        const cfg = await prisma.pieceRateConfig.findFirst({
          where: { stage: body.stage, isActive: true },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!cfg) throw new AppError(400, `No active rate configured for stage ${body.stage}`);
        rate = Number(cfg.rateBirrPerQ);
      }
      const pay = new Prisma.Decimal(body.quintals).times(rate).toDecimalPlaces(2);
      const row = await prisma.pieceRateWork.create({
        data: {
          employeeId: body.employeeId ?? null,
          laborer: body.laborer,
          stage: body.stage,
          bags: body.bags,
          quintals: new Prisma.Decimal(body.quintals),
          rateBirrPerQ: new Prisma.Decimal(rate),
          payBirr: pay,
          workDate: body.workDate ? new Date(body.workDate) : new Date(),
          truckPlate: body.truckPlate ?? null,
          loggedById: uid,
          notes: body.notes ?? null,
        },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'PieceRateWork',
        entityId: row.id,
        changes: { laborer: body.laborer, quintals: body.quintals, payBirr: pay.toString() },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Driver trip pay ────────────────────────────────────────────

router.get(
  '/driver-trip-pay',
  requirePermission('hr:view'),
  validateQuery(z.object({ year: z.coerce.number().int().optional(), month: z.coerce.number().int().min(1).max(12).optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { year?: number; month?: number };
      const rows = await prisma.driverTripPay.findMany({
        where: { ...(q.year ? { year: q.year } : {}), ...(q.month ? { month: q.month } : {}) },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const driverTripPaySchema = z.object({
  employeeId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  trips: z.number().int().nonnegative(),
  rateBirrPerTrip: z.number().positive().optional(),
  allowanceBirr: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});

router.post(
  '/driver-trip-pay',
  requirePermission('hr:manage'),
  validateBody(driverTripPaySchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof driverTripPaySchema>;
      let rate = body.rateBirrPerTrip;
      if (rate == null) {
        const cfg = await prisma.driverTripRate.findFirst({
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!cfg) throw new AppError(400, 'No active driver trip rate configured');
        rate = Number(cfg.rateBirrPerTrip);
      }
      const total = new Prisma.Decimal(body.trips)
        .times(rate)
        .plus(body.allowanceBirr)
        .toDecimalPlaces(2);
      const row = await prisma.driverTripPay.upsert({
        where: { employeeId_year_month: { employeeId: body.employeeId, year: body.year, month: body.month } },
        create: {
          employeeId: body.employeeId,
          year: body.year,
          month: body.month,
          trips: body.trips,
          rateBirrPerTrip: new Prisma.Decimal(rate),
          allowanceBirr: new Prisma.Decimal(body.allowanceBirr),
          totalBirr: total,
          notes: body.notes ?? null,
          createdById: uid,
        },
        update: {
          trips: body.trips,
          rateBirrPerTrip: new Prisma.Decimal(rate),
          allowanceBirr: new Prisma.Decimal(body.allowanceBirr),
          totalBirr: total,
          notes: body.notes ?? null,
        },
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPSERT',
        entityType: 'DriverTripPay',
        entityId: row.id,
        changes: { employeeId: body.employeeId, year: body.year, month: body.month, totalBirr: total.toString() },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Allowance & deduction types ────────────────────────────────

router.get('/allowance-types', requirePermission('hr:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.allowanceDeductionType.findMany({ orderBy: { name: 'asc' } });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const allowanceTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  kind: z.enum(['ALLOWANCE', 'DEDUCTION']),
  calc: z.enum(['FIXED', 'PERCENT']).default('FIXED'),
  amount: z.number().nonnegative(),
  appliesTo: z.array(z.nativeEnum(PayrollMode)).default([]),
  recurrence: z.enum(['RECURRING', 'ONE_TIME']).default('RECURRING'),
  isActive: z.boolean().optional(),
});

router.post(
  '/allowance-types',
  requirePermission('hr:manage'),
  validateBody(allowanceTypeSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof allowanceTypeSchema>;
      const row = await prisma.allowanceDeductionType.create({
        data: { ...body, amount: new Prisma.Decimal(body.amount) },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'AllowanceDeductionType',
        entityId: row.id,
        changes: { code: body.code, name: body.name },
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        next(new AppError(409, 'Allowance type code already exists'));
        return;
      }
      next(err);
    }
  },
);

router.put(
  '/allowance-types/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  validateBody(allowanceTypeSchema.partial()),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as Partial<z.infer<typeof allowanceTypeSchema>>;
      const row = await prisma.allowanceDeductionType.update({
        where: { id: req.params.id },
        data: { ...body, amount: body.amount != null ? new Prisma.Decimal(body.amount) : undefined },
      });
      await audit(prisma, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'AllowanceDeductionType',
        entityId: row.id,
        changes: body,
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Employee allowance assignments ─────────────────────────────

router.get(
  '/allowances',
  requirePermission('hr:view'),
  validateQuery(z.object({ employeeId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as { employeeId?: string };
      const rows = await prisma.employeeAllowance.findMany({
        where: q.employeeId ? { employeeId: q.employeeId } : {},
        include: {
          type: true,
          employee: { select: { id: true, employeeNo: true, name: true } },
        },
        orderBy: { employee: { name: 'asc' } },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const allowanceAssignSchema = z.object({
  employeeId: z.string().min(1),
  typeId: z.string().min(1),
  oneTimeDate: z.string().datetime().optional().nullable(),
  overrideAmount: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

router.post(
  '/allowances',
  requirePermission('hr:manage'),
  validateBody(allowanceAssignSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof allowanceAssignSchema>;
      const row = await prisma.employeeAllowance.create({
        data: {
          employeeId: body.employeeId,
          typeId: body.typeId,
          oneTimeDate: body.oneTimeDate ? new Date(body.oneTimeDate) : null,
          overrideAmount: body.overrideAmount != null ? new Prisma.Decimal(body.overrideAmount) : null,
          isActive: body.isActive ?? true,
          notes: body.notes ?? null,
        },
        include: { type: true, employee: { select: { id: true, employeeNo: true, name: true } } },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'EmployeeAllowance',
        entityId: row.id,
        changes: { employeeId: body.employeeId, typeId: body.typeId },
      });
      res.status(201).json(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        next(new AppError(409, 'This allowance type is already assigned to the employee'));
        return;
      }
      next(err);
    }
  },
);

router.delete(
  '/allowances/:id',
  requirePermission('hr:manage'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      await prisma.employeeAllowance.delete({ where: { id: req.params.id } });
      await audit(prisma, {
        userId: uid,
        action: 'DELETE',
        entityType: 'EmployeeAllowance',
        entityId: req.params.id,
        changes: {},
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payroll runs ───────────────────────────────────────────────

router.get('/payroll-runs', requirePermission('hr:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.payrollRun.findMany({
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      include: { _count: { select: { lines: true } } },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const computeHrRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeIds: z.array(z.string()).optional(),
});

router.post(
  '/payroll-runs',
  requirePermission('hr:manage'),
  validateBody(computeHrRunSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof computeHrRunSchema>;
      const run = await prisma.$transaction((tx) =>
        computeHrPayrollRun(tx, { ...body, userId: uid }),
      );
      res.status(201).json(run);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/payroll-runs/:id',
  requirePermission('hr:view'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const row = await prisma.payrollRun.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { employee: { select: { id: true, employeeNo: true, name: true } } } }, payslips: true },
      });
      if (!row) throw new AppError(404, 'Payroll run not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

/** DRAFT -> APPROVED. Permission: hr:approve. */
router.post(
  '/payroll-runs/:id/approve',
  requirePermission('hr:approve'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const run = await prisma.$transaction((tx) => approveHrPayrollRun(tx, req.params.id, uid));
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * APPROVED -> POSTED. Permission: hr:approve.
 * Posts the payroll journal to finance (see postHrPayrollRun) and generates
 * payslips. POSTED runs are locked.
 */
router.post(
  '/payroll-runs/:id/post',
  requirePermission('hr:approve'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const run = await prisma.$transaction((tx) => postHrPayrollRun(tx, req.params.id, uid));
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payslips ───────────────────────────────────────────────────

router.get(
  '/payslips',
  requirePermission('hr:view'),
  validateQuery(z.object({ runId: z.string().optional(), employeeId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as { runId?: string; employeeId?: string };
      const rows = await prisma.payslip.findMany({
        where: {
          ...(q.runId ? { payrollRunId: q.runId } : {}),
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        },
        include: {
          employee: { select: { id: true, employeeNo: true, name: true, jobTitle: true } },
          payrollRun: { select: { id: true, periodYear: true, periodMonth: true, status: true } },
        },
        orderBy: { generatedAt: 'desc' },
        take: 500,
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/payslips/:id',
  requirePermission('hr:view'),
  validateParams(idParams),
  async (req, res, next) => {
    try {
      const row = await prisma.payslip.findUnique({
        where: { id: req.params.id },
        include: {
          employee: true,
          payrollRun: true,
        },
      });
      if (!row) throw new AppError(404, 'Payslip not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);
