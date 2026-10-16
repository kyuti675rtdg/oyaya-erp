import { Router } from 'express';
import { Prisma, CAPAStatus, IntakeStatus, RevenueStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

const ZERO = new Prisma.Decimal(0);
const TANK_CODES = ['TANK_A', 'TANK_B', 'TANK_C'];

async function sumMovements(locationCode: string, direction: string): Promise<Prisma.Decimal> {
  const agg = await prisma.storageMovement.aggregate({
    where: { locationCode, direction },
    _sum: { quintals: true },
  });
  return agg._sum.quintals ?? ZERO;
}

async function sumTankFills(tankCode: string): Promise<Prisma.Decimal> {
  const agg = await prisma.tankFill.aggregate({
    where: { tankCode },
    _sum: { quintals: true },
  });
  return agg._sum.quintals ?? ZERO;
}

router.get('/kpis', requirePermission('dashboard:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    // ── Dry pool ──
    const dryPoolLoc = await prisma.storageLocation.findUnique({ where: { code: 'DRY_POOL' } });
    if (!dryPoolLoc) throw new AppError(404, 'Storage location DRY_POOL is not configured');
    const dryIn = await sumMovements('DRY_POOL', 'IN');
    const dryOut = await sumMovements('DRY_POOL', 'OUT');
    const dryPool = {
      capacityQ: dryPoolLoc.capacityQ.toNumber(),
      balanceQ: dryIn.minus(dryOut).toNumber(),
    };

    // ── Conditioning tanks ──
    const tanks: Array<{
      code: string;
      capacityQ: number;
      levelQ: number;
      lastFillAt: string | null;
      elapsedHrs: number | null;
    }> = [];
    for (const code of TANK_CODES) {
      const loc = await prisma.storageLocation.findUnique({ where: { code } });
      const fills = await sumTankFills(code);
      const emptyAgg = await prisma.tankEvent.aggregate({
        where: { tankCode: code, event: { in: ['PARTIAL_EMPTY', 'EMPTIED'] } },
        _sum: { quintals: true },
      });
      const empties = emptyAgg._sum.quintals ?? ZERO;
      let level = fills.minus(empties);
      if (level.lt(0)) level = ZERO;
      if (level.lte(2)) level = ZERO;
      const lastFill = await prisma.tankFill.findFirst({
        where: { tankCode: code },
        orderBy: { filledAt: 'desc' },
        select: { filledAt: true },
      });
      tanks.push({
        code,
        capacityQ: loc ? loc.capacityQ.toNumber() : 0,
        levelQ: level.toNumber(),
        lastFillAt: lastFill ? lastFill.filledAt.toISOString() : null,
        elapsedHrs: lastFill
          ? Math.round(((now.getTime() - lastFill.filledAt.getTime()) / 3600000) * 10) / 10
          : null,
      });
    }

    // ── Extraction today ──
    const extractionAgg = await prisma.shiftOutput.aggregate({
      where: { loggedAt: { gte: dayStart }, extractionPct: { not: null } },
      _avg: { extractionPct: true },
    });
    const extractionToday = extractionAgg._avg.extractionPct
      ? extractionAgg._avg.extractionPct.toNumber()
      : null;

    // ── CAPA / lab queues ──
    const openCapas = await prisma.cAPA.count({ where: { status: { not: CAPAStatus.CLOSED } } });
    const pendingLabIntakes = await prisma.wheatIntake.count({
      where: { status: { in: [IntakeStatus.PENDING_LAB, IntakeStatus.FLAGGED] } },
    });

    // ── Revenue & cash ──
    const revenueAgg = await prisma.salesInvoice.aggregate({
      where: {
        status: { in: [RevenueStatus.INVOICED, RevenueStatus.PAID] },
        invoicedAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amountBirr: true },
    });
    const monthRevenue = (revenueAgg._sum.amountBirr ?? ZERO).toNumber();

    const cashAgg = await prisma.cashReceipt.aggregate({
      where: { receivedAt: { gte: monthStart, lt: monthEnd } },
      _sum: { amountBirr: true },
    });
    const cashReceivedMonth = (cashAgg._sum.amountBirr ?? ZERO).toNumber();

    // ── Unreconciled gap: Σ max(0, invoiced − received) per customer ──
    const invoicedByCustomer = await prisma.salesInvoice.groupBy({
      by: ['customerId'],
      where: { status: { in: [RevenueStatus.INVOICED, RevenueStatus.PAID] } },
      _sum: { amountBirr: true },
    });
    const receivedByCustomer = await prisma.cashReceipt.groupBy({
      by: ['customerId'],
      _sum: { amountBirr: true },
    });
    const receivedMap = new Map<string, Prisma.Decimal>();
    for (const r of receivedByCustomer) {
      receivedMap.set(r.customerId, r._sum.amountBirr ?? ZERO);
    }
    let gap = ZERO;
    for (const inv of invoicedByCustomer) {
      const invoiced = inv._sum.amountBirr ?? ZERO;
      const received = receivedMap.get(inv.customerId) ?? ZERO;
      if (invoiced.gt(received)) gap = gap.plus(invoiced.minus(received));
    }
    const unreconciledGap = gap.toNumber();

    // ── Workforce ──
    const activeEmployees = await prisma.employee.count({ where: { isActive: true } });

    // ── QC compliance: % of shifts in last 7 days with ≥1 lab check ──
    const shifts = await prisma.shiftRun.findMany({
      where: { shiftDate: { gte: sevenDaysAgo } },
      select: { id: true, labChecks: { select: { id: true } } },
    });
    let qcCompliancePct: number | null = null;
    if (shifts.length > 0) {
      const withCheck = shifts.filter((s) => s.labChecks.length > 0).length;
      qcCompliancePct = Math.round(((withCheck / shifts.length) * 100) * 10) / 10;
    }

    res.json({
      dryPool,
      tanks,
      extractionToday,
      openCapas,
      pendingLabIntakes,
      monthRevenue,
      cashReceivedMonth,
      unreconciledGap,
      activeEmployees,
      qcCompliancePct,
    });
  } catch (err) {
    next(err);
  }
});
