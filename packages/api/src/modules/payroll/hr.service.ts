import { Prisma, type PayrollRun } from '@prisma/client';
import { config } from '../../config';
import { audit, type DbClient } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { postJournal } from '../finance/service';

const ZERO = new Prisma.Decimal(0);

function toDecimal(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export interface ComputeHrRunOptions {
  year: number;
  month: number;
  employeeIds?: string[];
  userId: string;
}

/**
 * Overtime for one employee over a set of (date -> worked hours), applying
 * the mill's OT rule: 1.5x on weekdays, 2x on weekends/holidays, applied to
 * hours beyond the standard shift length.
 */
function overtimeBirrFor(
  dailyHours: Map<string, number>,
  baseSalary: Prisma.Decimal,
): { hours: number; birr: Prisma.Decimal } {
  const hourly = baseSalary.gt(0) ? baseSalary.div(30 * config.standardShiftHours) : ZERO;
  let hours = 0;
  let birr = ZERO;
  for (const [key, worked] of dailyHours) {
    const ot = Math.max(0, worked - config.standardShiftHours);
    if (ot <= 0) continue;
    hours += ot;
    const mult = isWeekend(new Date(`${key}T00:00:00Z`)) ? 2 : 1.5;
    birr = birr.plus(toDecimal(ot).times(hourly).times(mult));
  }
  return { hours, birr: birr.toDecimalPlaces(2) };
}

/**
 * Compute a full HR payroll run for a calendar month (status DRAFT) covering
 * the three payroll modes:
 *  - FIXED: base salary + overtime from attendance records (ZKTeco/manual/CSV),
 *    1.5x weekday / 2x weekend, minus deductions, plus allowances.
 *  - PIECE_RATE: PieceRateWork records (bags + quintals x rate) plus legacy
 *    PieceRateLog rows.
 *  - TRIP_BASED: DriverTripPay monthly record (trips x fixed trip rate +
 *    allowances), falling back to fleet trip counts x active driver trip rate.
 * Allowances/deductions: recurring assignments apply every run; one-time
 * assignments apply when their oneTimeDate falls inside the pay month.
 * Existing non-POSTED runs for the period are recomputed; POSTED runs are
 * locked and cannot be recomputed.
 */
export async function computeHrPayrollRun(
  tx: DbClient,
  opts: ComputeHrRunOptions,
): Promise<PayrollRun> {
  const { year, month, userId } = opts;
  const { start: monthStart, end: monthEnd } = monthRange(year, month);

  const existing = await tx.payrollRun.findUnique({
    where: { periodYear_periodMonth: { periodYear: year, periodMonth: month } },
  });
  if (existing && existing.status === 'POSTED') {
    throw new AppError(409, 'Payroll run for this period is posted and locked');
  }

  const employees = await tx.employee.findMany({
    where: {
      isActive: true,
      ...(opts.employeeIds?.length ? { id: { in: opts.employeeIds } } : {}),
    },
  });

  const run =
    existing ??
    (await tx.payrollRun.create({
      data: { periodYear: year, periodMonth: month, status: 'DRAFT', createdById: userId },
    }));
  // Recompute: clear previous lines/payslips for a DRAFT/APPROVED run.
  await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });
  await tx.payrollLine.deleteMany({ where: { payrollRunId: run.id } });

  const rateConfigs = await tx.pieceRateConfig.findMany({ where: { isActive: true } });
  const rateByStage = new Map<string, Prisma.Decimal>();
  for (const c of rateConfigs) rateByStage.set(c.stage, c.rateBirrPerQ);
  const tripRate = await tx.driverTripRate.findFirst({
    where: { isActive: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  const activeTripRate = tripRate?.rateBirrPerTrip ?? ZERO;

  for (const employee of employees) {
    const mode = employee.payrollMode;
    const base = employee.baseSalary ?? ZERO;

    let overtimeHours = 0;
    let overtimeBirr = ZERO;
    let pieceQuintals = ZERO;
    let pieceBirr = ZERO;
    let trips = 0;
    let tripBirr = ZERO;

    if (mode === 'FIXED') {
      const records = await tx.attendanceRecord.findMany({
        where: { employeeId: employee.id, date: { gte: monthStart, lt: monthEnd } },
      });
      if (records.length > 0) {
        const daily = new Map<string, number>();
        for (const r of records) {
          const key = dayKey(r.date);
          const worked = Number(r.workHours) + Number(r.overtimeHours);
          daily.set(key, (daily.get(key) ?? 0) + worked);
        }
        const ot = overtimeBirrFor(daily, base);
        overtimeHours = ot.hours;
        overtimeBirr = ot.birr;
      } else if (employee.zkPin) {
        // Fallback: raw ZKTeco punches paired in/out per day.
        const punches = await tx.attendancePunch.findMany({
          where: { zkPin: employee.zkPin, punchTime: { gte: monthStart, lt: monthEnd } },
          orderBy: { punchTime: 'asc' },
        });
        const byDay = new Map<string, typeof punches>();
        for (const p of punches) {
          const key = dayKey(p.punchTime);
          const arr = byDay.get(key);
          if (arr) arr.push(p);
          else byDay.set(key, [p]);
        }
        const daily = new Map<string, number>();
        for (const [key, dayPunches] of byDay) {
          let ms = 0;
          let i = 0;
          while (i < dayPunches.length) {
            const p = dayPunches[i];
            if (p.status === 'CHECK_IN') {
              const next = dayPunches.slice(i + 1).find((q) => q.status === 'CHECK_OUT');
              if (next) {
                ms += next.punchTime.getTime() - p.punchTime.getTime();
                i = dayPunches.indexOf(next);
              } else {
                i += 1;
              }
            } else {
              i += 1;
            }
          }
          daily.set(key, ms / 3600000);
        }
        const ot = overtimeBirrFor(daily, base);
        overtimeHours = ot.hours;
        overtimeBirr = ot.birr;
      }
    }

    if (mode === 'PIECE_RATE') {
      const work = await tx.pieceRateWork.findMany({
        where: {
          workDate: { gte: monthStart, lt: monthEnd },
          OR: [{ employeeId: employee.id }, { laborer: employee.name }],
        },
      });
      for (const w of work) {
        pieceQuintals = pieceQuintals.plus(w.quintals);
        pieceBirr = pieceBirr.plus(w.payBirr);
      }
      // Legacy string-based logs.
      const logs = await tx.pieceRateLog.findMany({
        where: { laborer: employee.name, loggedAt: { gte: monthStart, lt: monthEnd } },
      });
      for (const log of logs) {
        const rate = rateByStage.get(log.stage) ?? ZERO;
        pieceQuintals = pieceQuintals.plus(log.quintals);
        pieceBirr = pieceBirr.plus(log.quintals.times(rate));
      }
    }

    if (mode === 'TRIP_BASED') {
      const tripPay = await tx.driverTripPay.findUnique({
        where: { employeeId_year_month: { employeeId: employee.id, year, month } },
      });
      if (tripPay) {
        trips = tripPay.trips;
        tripBirr = toDecimal(tripPay.trips)
          .times(tripPay.rateBirrPerTrip)
          .plus(tripPay.allowanceBirr)
          .toDecimalPlaces(2);
      } else {
        const tripRows = await tx.trip.findMany({
          where: { driverName: employee.name, departureDate: { gte: monthStart, lt: monthEnd } },
        });
        trips = tripRows.length;
        tripBirr = toDecimal(trips).times(activeTripRate).toDecimalPlaces(2);
      }
    }

    // Allowances & deductions.
    const assignments = await tx.employeeAllowance.findMany({
      where: { employeeId: employee.id, isActive: true },
      include: { type: true },
    });
    let allowanceBirr = ZERO;
    let deductionBirr = ZERO;
    for (const a of assignments) {
      const t = a.type;
      if (!t.isActive) continue;
      if (t.appliesTo.length > 0 && !t.appliesTo.includes(mode)) continue;
      const isRecurring = t.recurrence === 'RECURRING' && !a.oneTimeDate;
      const inMonth =
        a.oneTimeDate && a.oneTimeDate >= monthStart && a.oneTimeDate < monthEnd;
      if (!isRecurring && !inMonth) continue;
      const raw = a.overrideAmount ?? t.amount;
      const value =
        t.calc === 'PERCENT' ? base.times(raw).div(100).toDecimalPlaces(2) : raw;
      if (t.kind === 'ALLOWANCE') allowanceBirr = allowanceBirr.plus(value);
      else deductionBirr = deductionBirr.plus(value);
    }

    const gross = base.plus(overtimeBirr).plus(pieceBirr).plus(tripBirr);
    const net = gross.plus(allowanceBirr).minus(deductionBirr);

    await tx.payrollLine.create({
      data: {
        payrollRunId: run.id,
        employeeId: employee.id,
        mode,
        baseBirr: base,
        overtimeHours: toDecimal(overtimeHours).toDecimalPlaces(2),
        overtimeBirr,
        pieceQuintals,
        pieceBirr,
        trips,
        tripBirr,
        grossBirr: gross.toDecimalPlaces(2),
        allowanceBirr: allowanceBirr.toDecimalPlaces(2),
        deductionBirr: deductionBirr.toDecimalPlaces(2),
        netBirr: net.toDecimalPlaces(2),
      },
    });
  }

  await audit(tx, {
    userId,
    action: existing ? 'UPDATE' : 'CREATE',
    entityType: 'PayrollRun',
    entityId: run.id,
    changes: { periodYear: year, periodMonth: month, recompute: !!existing },
  });

  return tx.payrollRun.findUniqueOrThrow({
    where: { id: run.id },
    include: { lines: { include: { employee: true } } },
  });
}

/** DRAFT -> APPROVED. Requires hr:approve. */
export async function approveHrPayrollRun(
  tx: DbClient,
  runId: string,
  userId: string,
): Promise<PayrollRun> {
  const run = await tx.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, 'Payroll run not found');
  if (run.status !== 'DRAFT') throw new AppError(409, 'Only DRAFT runs can be approved');
  const updated = await tx.payrollRun.update({
    where: { id: runId },
    data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
  });
  await audit(tx, {
    userId,
    action: 'APPROVE',
    entityType: 'PayrollRun',
    entityId: runId,
    changes: { status: 'APPROVED' },
  });
  return updated;
}

/**
 * FINANCE INTEGRATION POINT — payroll journal posting.
 *
 * Journal layout (balances by construction):
 *   Dr 6000 Payroll Expense        grossBirr + allowanceBirr   (total payroll cost)
 *   Cr 2000 Accounts Payable       deductionBirr               (withheld amounts)
 *   Cr 2000 Accounts Payable       netBirr                     (net pay payable to staff)
 * module = 'payroll', referenceType = 'PayrollRun', referenceId = run.id.
 *
 * After posting, a Payslip row is generated per payroll line so staff can
 * view/print individual slips. POSTED runs are locked: compute/approve
 * endpoints reject any further mutation of the period.
 */
export async function postHrPayrollRun(
  tx: DbClient,
  runId: string,
  userId: string,
): Promise<PayrollRun> {
  const run = await tx.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { employee: true } } },
  });
  if (!run) throw new AppError(404, 'Payroll run not found');
  if (run.status !== 'APPROVED') throw new AppError(409, 'Only APPROVED runs can be posted');
  if (run.journalEntryId) throw new AppError(409, 'Run already posted to finance');

  let totalCost = ZERO;
  let totalDeductions = ZERO;
  let totalNet = ZERO;
  for (const line of run.lines) {
    totalCost = totalCost.plus(line.grossBirr).plus(line.allowanceBirr);
    totalDeductions = totalDeductions.plus(line.deductionBirr);
    totalNet = totalNet.plus(line.netBirr);
  }
  if (totalCost.lte(0)) throw new AppError(400, 'Cannot post an empty payroll run');

  const entry = await postJournal(tx, {
    entryDate: new Date(),
    memo: `Payroll ${run.periodYear}-${String(run.periodMonth).padStart(2, '0')} — net ${totalNet.toFixed(2)} ETB`,
    module: 'payroll',
    referenceType: 'PayrollRun',
    referenceId: run.id,
    createdById: userId,
    lines: [
      { accountCode: '6000', debit: totalCost, credit: ZERO },
      {
        accountCode: '2000',
        debit: ZERO,
        credit: totalDeductions,
        memo: 'Payroll deductions withheld',
      },
      { accountCode: '2000', debit: ZERO, credit: totalNet, memo: 'Net pay payable to staff' },
    ],
  });

  await generatePayslips(tx, runId);

  const updated = await tx.payrollRun.update({
    where: { id: runId },
    data: { status: 'POSTED', postedAt: new Date(), journalEntryId: entry.id },
    include: { lines: { include: { employee: true } } },
  });
  await audit(tx, {
    userId,
    action: 'POST',
    entityType: 'PayrollRun',
    entityId: runId,
    changes: { status: 'POSTED', journalEntryId: entry.id },
  });
  return updated;
}

/** Generate one Payslip per payroll line with a full earnings breakdown. */
export async function generatePayslips(tx: DbClient, runId: string): Promise<number> {
  const run = await tx.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { employee: true } } },
  });
  if (!run) throw new AppError(404, 'Payroll run not found');
  await tx.payslip.deleteMany({ where: { payrollRunId: runId } });
  for (const line of run.lines) {
    await tx.payslip.create({
      data: {
        payrollRunId: runId,
        employeeId: line.employeeId,
        grossBirr: line.grossBirr,
        allowanceBirr: line.allowanceBirr,
        deductionBirr: line.deductionBirr,
        netBirr: line.netBirr,
        breakdown: {
          period: `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`,
          employeeNo: line.employee?.employeeNo,
          name: line.employee?.name,
          mode: line.mode,
          base: line.baseBirr.toString(),
          overtimeHours: line.overtimeHours.toString(),
          overtime: line.overtimeBirr.toString(),
          pieceQuintals: line.pieceQuintals.toString(),
          piece: line.pieceBirr.toString(),
          trips: line.trips,
          trip: line.tripBirr.toString(),
          allowances: line.allowanceBirr.toString(),
          deductions: line.deductionBirr.toString(),
          gross: line.grossBirr.toString(),
          net: line.netBirr.toString(),
        } as Prisma.InputJsonValue,
      },
    });
  }
  return run.lines.length;
}
