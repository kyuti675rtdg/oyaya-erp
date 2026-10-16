import { Prisma, type PayrollRun } from '@prisma/client';
import { config } from '../../config';
import { audit, type DbClient } from '../../lib/audit';

const ZERO = new Prisma.Decimal(0);

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

/**
 * Compute a full payroll run for a calendar month and persist it as DRAFT
 * with one PayrollLine per active employee.
 *
 * - FIXED: base salary + ZKTeco overtime (hours over config.standardShiftHours per day)
 * - PIECE_RATE: piece-rate logs x latest active per-stage rate
 * - TRIP_BASED: driver trips x latest active driver trip rate
 */
export async function computePayrollRun(
  tx: DbClient,
  year: number,
  month: number,
  userId: string,
): Promise<PayrollRun> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const employees = await tx.employee.findMany({ where: { isActive: true } });

  const run = await tx.payrollRun.create({
    data: { periodYear: year, periodMonth: month, status: 'DRAFT', createdById: userId },
  });

  for (const employee of employees) {
    const mode = employee.payrollMode;
    const base = employee.baseSalary ?? ZERO;

    let totalOT = 0;
    let overtimeBirr = ZERO;
    let pieceQuintals = ZERO;
    let pieceBirr = ZERO;
    let trips = 0;
    let tripBirr = ZERO;

    if (mode === 'FIXED' && employee.zkPin) {
      const punches = await tx.attendancePunch.findMany({
        where: { zkPin: employee.zkPin, punchTime: { gte: monthStart, lt: monthEnd } },
        orderBy: { punchTime: 'asc' },
      });
      const byDay = new Map<string, typeof punches>();
      for (const p of punches) {
        const key = p.punchTime.toISOString().slice(0, 10);
        const arr = byDay.get(key);
        if (arr) {
          arr.push(p);
        } else {
          byDay.set(key, [p]);
        }
      }
      for (const dayPunches of byDay.values()) {
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
        const hours = ms / 3600000;
        totalOT += Math.max(0, hours - config.standardShiftHours);
      }
      const hourly = base.gt(0) ? base.div(30 * config.standardShiftHours) : ZERO;
      overtimeBirr = toDecimal(totalOT)
        .times(hourly)
        .times(config.overtimeRateMultiplier)
        .toDecimalPlaces(2);
    }

    if (mode === 'PIECE_RATE') {
      const logs = await tx.pieceRateLog.findMany({
        where: { laborer: employee.name, loggedAt: { gte: monthStart, lt: monthEnd } },
      });
      const configs = await tx.pieceRateConfig.findMany({ where: { isActive: true } });
      const rateByStage = new Map<string, Prisma.Decimal>();
      for (const c of configs) {
        rateByStage.set(c.stage, c.rateBirrPerQ);
      }
      for (const log of logs) {
        const rate = rateByStage.get(log.stage) ?? ZERO;
        pieceQuintals = pieceQuintals.plus(log.quintals);
        pieceBirr = pieceBirr.plus(log.quintals.times(rate));
      }
    }

    if (mode === 'TRIP_BASED') {
      const tripRows = await tx.trip.findMany({
        where: { driverName: employee.name, departureDate: { gte: monthStart, lt: monthEnd } },
      });
      trips = tripRows.length;
      const rate = await tx.driverTripRate.findFirst({
        where: { isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      });
      const r = rate?.rateBirrPerTrip ?? ZERO;
      tripBirr = toDecimal(trips).times(r);
    }

    const gross = base.plus(overtimeBirr).plus(pieceBirr).plus(tripBirr);

    await tx.payrollLine.create({
      data: {
        payrollRunId: run.id,
        employeeId: employee.id,
        mode,
        baseBirr: base,
        overtimeHours: toDecimal(totalOT).toDecimalPlaces(2),
        overtimeBirr,
        pieceQuintals,
        pieceBirr,
        trips,
        tripBirr,
        grossBirr: gross,
      },
    });
  }

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'PayrollRun',
    entityId: run.id,
    changes: { periodYear: year, periodMonth: month },
  });

  return tx.payrollRun.findUniqueOrThrow({
    where: { id: run.id },
    include: { lines: true },
  });
}
