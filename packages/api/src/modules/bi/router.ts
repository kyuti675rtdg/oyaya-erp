import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';

export const router = Router();

const ZERO = new Prisma.Decimal(0);

/** Local midnight boundary helpers. */
function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function lastNDays(n: number): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = daysAgo(i);
    out.push({
      key: dayKey(d),
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    });
  }
  return out;
}

/** Dry-pool balance in quintals (mirrors dashboard/kpis). */
async function dryPoolBalanceQ(): Promise<{ capacityQ: number; balanceQ: number }> {
  const loc = await prisma.storageLocation.findUnique({ where: { code: 'DRY_POOL' } });
  const ins = await prisma.storageMovement.aggregate({
    where: { locationCode: 'DRY_POOL', direction: 'IN' },
    _sum: { quintals: true }
  });
  const outs = await prisma.storageMovement.aggregate({
    where: { locationCode: 'DRY_POOL', direction: 'OUT' },
    _sum: { quintals: true }
  });
  const balance = (ins._sum.quintals ?? ZERO).minus(outs._sum.quintals ?? ZERO);
  return {
    capacityQ: loc ? loc.capacityQ.toNumber() : 0,
    balanceQ: Math.max(0, balance.toNumber())
  };
}

/** Conditioning tank levels in quintals (mirrors dashboard/kpis). */
async function tankLevelsQ(): Promise<Array<{ code: string; capacityQ: number; levelQ: number }>> {
  const out: Array<{ code: string; capacityQ: number; levelQ: number }> = [];
  for (const code of ['TANK_A', 'TANK_B', 'TANK_C']) {
    const loc = await prisma.storageLocation.findUnique({ where: { code } });
    const fills = await prisma.tankFill.aggregate({ where: { tankCode: code }, _sum: { quintals: true } });
    const empties = await prisma.tankEvent.aggregate({
      where: { tankCode: code, event: { in: ['PARTIAL_EMPTY', 'EMPTIED'] } },
      _sum: { quintals: true }
    });
    let level = (fills._sum.quintals ?? ZERO).minus(empties._sum.quintals ?? ZERO);
    if (level.lt(0)) level = ZERO;
    if (level.lte(2)) level = ZERO;
    out.push({ code, capacityQ: loc ? loc.capacityQ.toNumber() : 0, levelQ: level.toNumber() });
  }
  return out;
}

/** Average wheat purchase price (Birr/q) over the last 90 days, fallback to latest PO. */
async function avgPurchasePricePerQ(): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const agg = await prisma.purchaseOrder.aggregate({
    where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } },
    _sum: { totalBirr: true, quantityQ: true }
  });
  const total = (agg._sum.totalBirr ?? ZERO).toNumber();
  const q = (agg._sum.quantityQ ?? ZERO).toNumber();
  if (q > 0) return total / q;
  const latest = await prisma.purchaseOrder.findFirst({
    where: { status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    select: { pricePerQBirr: true }
  });
  return latest ? latest.pricePerQBirr.toNumber() : 0;
}

/** Effective selling price (Birr/q) from recent sales orders. */
async function avgSellingPricePerQ(): Promise<number> {
  const orders = await prisma.salesOrder.findMany({
    where: { status: { not: 'OPEN' } },
    orderBy: { orderDate: 'desc' },
    take: 200,
    select: { priceBirr: true, quintals: true }
  });
  let total = 0;
  let q = 0;
  for (const o of orders) {
    total += o.priceBirr.toNumber();
    q += o.quintals.toNumber();
  }
  return q > 0 ? total / q : 0;
}

// ─── GET /bi/production ──────────────────────────────────────────────────────
router.get('/production', requirePermission('production:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const today = dayStart(now);
    const thirtyDaysAgo = daysAgo(30);
    const sevenDaysAgo = daysAgo(7);

    // Daily output
    const outTodayAgg = await prisma.flourOutput.aggregate({
      where: { loggedAt: { gte: today } },
      _sum: { quintals: true }
    });
    const dailyOutputQ = (outTodayAgg._sum.quintals ?? ZERO).toNumber();

    // 14-day output + extraction trend
    const days = lastNDays(14);
    const outputs = await prisma.flourOutput.findMany({
      where: { loggedAt: { gte: daysAgo(14) } },
      select: { loggedAt: true, productType: true, quintals: true, extractionPct: true }
    });
    const outputTrend = days.map((d) => {
      const rows = outputs.filter((o) => dayKey(o.loggedAt) === d.key);
      const total = rows.reduce((s, r) => s + r.quintals.toNumber(), 0);
      const ext = rows.filter((r) => r.extractionPct !== null);
      const avgExt =
        ext.length > 0 ? ext.reduce((s, r) => s + (r.extractionPct?.toNumber() ?? 0), 0) / ext.length : null;
      return { day: d.label, key: d.key, outputQ: Math.round(total * 10) / 10, extractionPct: avgExt === null ? null : Math.round(avgExt * 100) / 100 };
    });

    // Duket yield vs 78% target (last 30 days)
    const out30 = await prisma.flourOutput.findMany({
      where: { loggedAt: { gte: thirtyDaysAgo } },
      select: { productType: true, quintals: true }
    });
    const total30 = out30.reduce((s, r) => s + r.quintals.toNumber(), 0);
    const duket30 = out30
      .filter((r) => r.productType === 'DUKET_NORMAL' || r.productType === 'DUKET_SPECIAL')
      .reduce((s, r) => s + r.quintals.toNumber(), 0);
    const duketYieldPct = total30 > 0 ? (duket30 / total30) * 100 : null;
    const YIELD_TARGET = 78;

    // Average extraction (last 30 days)
    const extAgg = await prisma.flourOutput.aggregate({
      where: { loggedAt: { gte: thirtyDaysAgo }, extractionPct: { not: null } },
      _avg: { extractionPct: true }
    });
    const avgExtractionPct = extAgg._avg.extractionPct ? extAgg._avg.extractionPct.toNumber() : null;

    // Downtime (last 7 days)
    const dtAgg = await prisma.downtimeLog.aggregate({
      where: { startedAt: { gte: sevenDaysAgo } },
      _sum: { minutesLost: true },
      _count: true
    });
    const downtimeHours = Math.round(((dtAgg._sum.minutesLost ?? 0) / 60) * 10) / 10;
    const downtimeByReason = await prisma.downtimeLog.groupBy({
      by: ['reasonCategory'],
      where: { startedAt: { gte: sevenDaysAgo } },
      _sum: { minutesLost: true }
    });

    // Shift performance: share of completed shift runs with logged output (30d)
    const shifts = await prisma.shiftRun.findMany({
      where: { shiftDate: { gte: thirtyDaysAgo } },
      select: { id: true, outputs: { select: { id: true } } }
    });
    const shiftsWithOutput = shifts.filter((s) => s.outputs.length > 0).length;
    const shiftPerformancePct = shifts.length > 0 ? (shiftsWithOutput / shifts.length) * 100 : null;

    res.json({
      kpis: {
        dailyOutputQ: Math.round(dailyOutputQ * 10) / 10,
        avgExtractionPct: avgExtractionPct === null ? null : Math.round(avgExtractionPct * 100) / 100,
        duketYieldPct: duketYieldPct === null ? null : Math.round(duketYieldPct * 100) / 100,
        yieldTargetPct: YIELD_TARGET,
        downtimeHours7d: downtimeHours,
        shiftPerformancePct: shiftPerformancePct === null ? null : Math.round(shiftPerformancePct * 10) / 10
      },
      charts: {
        outputTrend,
        downtimeByReason: downtimeByReason.map((r) => ({
          reason: r.reasonCategory,
          hours: Math.round(((r._sum.minutesLost ?? 0) / 60) * 10) / 10
        }))
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/quality ─────────────────────────────────────────────────────────
router.get('/quality', requirePermission('qc:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const today = dayStart(now);
    const fourteenDaysAgo = daysAgo(14);
    const thirtyDaysAgo = daysAgo(30);

    // Pass rate (last 30 days)
    const tests30 = await prisma.flourQualityTest.groupBy({
      by: ['verdict'],
      where: { sampleTime: { gte: thirtyDaysAgo } },
      _count: true
    });
    const passed = tests30.find((t) => t.verdict === 'PASS')?._count ?? 0;
    const failed = tests30.find((t) => t.verdict === 'FAIL')?._count ?? 0;
    const passRatePct = passed + failed > 0 ? (passed / (passed + failed)) * 100 : null;

    // CAPA KPIs
    const openCapas = await prisma.cAPA.count({ where: { status: { not: 'CLOSED' } } });
    const overdueCapas = await prisma.cAPA.count({
      where: { status: { not: 'CLOSED' }, dateIdentified: { lt: new Date(Date.now() - 14 * 24 * 3600 * 1000) } }
    });
    const inspectionsToday =
      (await prisma.labCheck.count({ where: { sampleTime: { gte: today } } })) +
      (await prisma.flourQualityTest.count({ where: { sampleTime: { gte: today } } }));

    // Pass-rate trend (14d)
    const days = lastNDays(14);
    const tests = await prisma.flourQualityTest.findMany({
      where: { sampleTime: { gte: fourteenDaysAgo } },
      select: { sampleTime: true, verdict: true }
    });
    const passRateTrend = days.map((d) => {
      const rows = tests.filter((t) => dayKey(t.sampleTime) === d.key);
      const p = rows.filter((t) => t.verdict === 'PASS').length;
      const f = rows.filter((t) => t.verdict === 'FAIL').length;
      return {
        day: d.label,
        key: d.key,
        passRate: p + f > 0 ? Math.round((p / (p + f)) * 1000) / 10 : null,
        tests: rows.length
      };
    });

    // CAPA aging buckets (days since identified)
    const open = await prisma.cAPA.findMany({
      where: { status: { not: 'CLOSED' } },
      select: { dateIdentified: true, status: true }
    });
    const buckets = [
      { bucket: '0–7 days', min: 0, max: 7 },
      { bucket: '8–14 days', min: 8, max: 14 },
      { bucket: '15–30 days', min: 15, max: 30 },
      { bucket: '30+ days', min: 31, max: Infinity }
    ];
    const capaAging = buckets.map((b) => ({
      bucket: b.bucket,
      count: open.filter((c) => {
        const age = Math.floor((now.getTime() - c.dateIdentified.getTime()) / 86400000);
        return age >= b.min && age <= b.max;
      }).length
    }));

    // Defect pareto by NC severity (30d)
    const ncBySeverity = await prisma.nonconformity.groupBy({
      by: ['severity'],
      where: { dateDetected: { gte: thirtyDaysAgo } },
      _count: true
    });
    const defectPareto = ncBySeverity
      .map((n) => ({ severity: n.severity, count: n._count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      kpis: {
        passRatePct: passRatePct === null ? null : Math.round(passRatePct * 10) / 10,
        openCapas,
        overdueCapas,
        inspectionsToday
      },
      charts: { passRateTrend, capaAging, defectPareto },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/procurement ─────────────────────────────────────────────────────
router.get('/procurement', requirePermission('procurement:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const today = dayStart(now);
    const fourteenDaysAgo = daysAgo(14);
    const thirtyDaysAgo = daysAgo(30);

    const intakeTodayAgg = await prisma.wheatIntake.aggregate({
      where: { deliveryDate: { gte: today } },
      _sum: { quintals: true }
    });
    const intakeTodayQ = (intakeTodayAgg._sum.quintals ?? ZERO).toNumber();

    const pendingPOs = await prisma.purchaseOrder.count({
      where: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } }
    });

    // Payables: open/partial AP invoices minus payments
    const apInvoices = await prisma.aPInvoice.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] } },
      select: { amountBirr: true, payments: { select: { amountBirr: true } } }
    });
    let payablesBirr = 0;
    for (const inv of apInvoices) {
      const paid = inv.payments.reduce((s, p) => s + p.amountBirr.toNumber(), 0);
      payablesBirr += Math.max(0, inv.amountBirr.toNumber() - paid);
    }

    const supplierCount = await prisma.supplier.count({ where: { isActive: true } });

    // Intake trend (14d) split by wheat category
    const days = lastNDays(14);
    const intakes = await prisma.wheatIntake.findMany({
      where: { deliveryDate: { gte: fourteenDaysAgo } },
      select: { deliveryDate: true, wheatCategory: true, quintals: true }
    });
    const intakeTrend = days.map((d) => {
      const rows = intakes.filter((i) => dayKey(i.deliveryDate) === d.key);
      const pick = (cat: string) => rows.filter((r) => r.wheatCategory === cat).reduce((s, r) => s + r.quintals.toNumber(), 0);
      return {
        day: d.label,
        key: d.key,
        soft: Math.round(pick('SOFT') * 10) / 10,
        hard: Math.round(pick('HARD') * 10) / 10,
        foreign: Math.round(pick('FOREIGN') * 10) / 10
      };
    });

    // Wheat-type mix (30d)
    const mix = await prisma.wheatIntake.groupBy({
      by: ['wheatCategory'],
      where: { deliveryDate: { gte: thirtyDaysAgo } },
      _sum: { quintals: true }
    });

    // Price trend: avg pricePerQ of POs created per week (last 12 weeks)
    const pos = await prisma.purchaseOrder.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 84 * 24 * 3600 * 1000) }, status: { not: 'CANCELLED' } },
      select: { createdAt: true, pricePerQBirr: true, wheatCategory: true }
    });
    const priceTrend: Array<{ week: string; price: number }> = [];
    for (let w = 11; w >= 0; w--) {
      const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const end = new Date(now.getTime() - w * 7 * 86400000);
      const rows = pos.filter((p) => p.createdAt >= start && p.createdAt < end);
      const prices = rows.map((r) => r.pricePerQBirr.toNumber());
      priceTrend.push({
        week: end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        price: prices.length > 0 ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : 0
      });
    }

    res.json({
      kpis: {
        intakeTodayQ: Math.round(intakeTodayQ * 10) / 10,
        pendingPOs,
        payablesBirr: Math.round(payablesBirr * 100) / 100,
        supplierCount
      },
      charts: {
        intakeTrend,
        wheatMix: mix.map((m) => ({ category: m.wheatCategory, quintals: (m._sum.quintals ?? ZERO).toNumber() })),
        priceTrend
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/inventory ───────────────────────────────────────────────────────
router.get('/inventory', requirePermission('storage:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const fourteenDaysAgo = daysAgo(14);

    const dryPool = await dryPoolBalanceQ();
    const tanks = await tankLevelsQ();
    const tankCapacityQ = tanks.reduce((s, t) => s + t.capacityQ, 0);
    const tankLevelQ = tanks.reduce((s, t) => s + t.levelQ, 0);

    const fgAgg = await prisma.finishedGoodsStock.aggregate({ _sum: { quintals: true } });
    const fgStockQ = (fgAgg._sum.quintals ?? ZERO).toNumber();

    // Estimated stock values
    const avgBuyPrice = await avgPurchasePricePerQ();
    const avgSellPrice = await avgSellingPricePerQ();
    const rawStockQ = dryPool.balanceQ + tankLevelQ;
    const wheatValueBirr = rawStockQ * avgBuyPrice;
    const fgValueBirr = fgStockQ * avgSellPrice;

    // Stock levels snapshot
    const fgByProduct = await prisma.finishedGoodsStock.groupBy({
      by: ['productId'],
      _sum: { quintals: true }
    });
    const productIds = fgByProduct.map((g) => g.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    // Movement trend (14d): net dry-pool movement
    const days = lastNDays(14);
    const movements = await prisma.storageMovement.findMany({
      where: { movedAt: { gte: fourteenDaysAgo } },
      select: { movedAt: true, direction: true, quintals: true }
    });
    const movementTrend = days.map((d) => {
      const rows = movements.filter((m) => dayKey(m.movedAt) === d.key);
      const ins = rows.filter((r) => r.direction === 'IN').reduce((s, r) => s + r.quintals.toNumber(), 0);
      const outs = rows.filter((r) => r.direction === 'OUT').reduce((s, r) => s + r.quintals.toNumber(), 0);
      return {
        day: d.label,
        key: d.key,
        in: Math.round(ins * 10) / 10,
        out: Math.round(outs * 10) / 10
      };
    });

    res.json({
      kpis: {
        dryPoolQ: Math.round(dryPool.balanceQ * 10) / 10,
        dryPoolCapacityQ: dryPool.capacityQ,
        tankUtilizationPct: tankCapacityQ > 0 ? Math.round((tankLevelQ / tankCapacityQ) * 1000) / 10 : 0,
        finishedGoodsQ: Math.round(fgStockQ * 10) / 10,
        stockValueBirr: Math.round((wheatValueBirr + fgValueBirr) * 100) / 100
      },
      charts: {
        stockLevels: [
          { name: 'Dry pool', quintals: Math.round(dryPool.balanceQ * 10) / 10, capacity: dryPool.capacityQ },
          ...tanks.map((t) => ({
            name: t.code.replace('TANK_', 'Tank '),
            quintals: Math.round(t.levelQ * 10) / 10,
            capacity: t.capacityQ
          })),
          { name: 'Finished goods', quintals: Math.round(fgStockQ * 10) / 10, capacity: 0 }
        ],
        finishedGoodsByProduct: fgByProduct.map((g) => ({
          product: nameById.get(g.productId) ?? g.productId,
          quintals: Math.round((g._sum.quintals ?? ZERO).toNumber() * 10) / 10
        })),
        movementTrend
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/sales ───────────────────────────────────────────────────────────
router.get('/sales', requirePermission('sales:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const month = monthStart(now);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const revAgg = await prisma.salesInvoice.aggregate({
      where: { status: { in: ['INVOICED', 'PAID'] }, invoicedAt: { gte: month } },
      _sum: { amountBirr: true }
    });
    const revenueMTD = (revAgg._sum.amountBirr ?? ZERO).toNumber();

    const ordersPending = await prisma.salesOrder.count({ where: { status: 'OPEN' } });

    // Receivables: Σ max(0, invoiced − receipts)
    const invoices = await prisma.salesInvoice.findMany({
      where: { status: { in: ['INVOICED', 'PAID'] } },
      select: { amountBirr: true, receipts: { select: { amountBirr: true } } }
    });
    let receivablesBirr = 0;
    for (const inv of invoices) {
      const rec = inv.receipts.reduce((s, r) => s + r.amountBirr.toNumber(), 0);
      receivablesBirr += Math.max(0, inv.amountBirr.toNumber() - rec);
    }

    // OTIF: dispatched vs. requested delivery date (orders linked via dispatch lines)
    const deliveredLines = await prisma.dispatchLine.findMany({
      where: {
        dispatch: { status: 'DELIVERED' },
        order: { requestedDate: { not: null } }
      },
      select: {
        dispatch: { select: { dispatchedAt: true } },
        order: { select: { requestedDate: true } }
      }
    });
    let onTime = 0;
    for (const l of deliveredLines) {
      if (l.order?.requestedDate && l.dispatch.dispatchedAt <= l.order.requestedDate) onTime += 1;
    }
    const otifPct = deliveredLines.length > 0 ? (onTime / deliveredLines.length) * 100 : null;

    // Revenue trend: last 12 months
    const revenueTrend: Array<{ month: string; revenue: number }> = [];
    for (let m = 11; m >= 0; m--) {
      const start = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
      const agg = await prisma.salesInvoice.aggregate({
        where: { status: { in: ['INVOICED', 'PAID'] }, invoicedAt: { gte: start, lt: end } },
        _sum: { amountBirr: true }
      });
      revenueTrend.push({
        month: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        revenue: Math.round((agg._sum.amountBirr ?? ZERO).toNumber() * 100) / 100
      });
    }

    // Sales by product (MTD via dispatch lines)
    const lines = await prisma.dispatchLine.findMany({
      where: { dispatch: { dispatchedAt: { gte: month } } },
      select: { quintals: true, product: { select: { name: true } } }
    });
    const byProduct = new Map<string, number>();
    for (const l of lines) {
      byProduct.set(l.product.name, (byProduct.get(l.product.name) ?? 0) + l.quintals.toNumber());
    }

    res.json({
      kpis: {
        revenueMTD: Math.round(revenueMTD * 100) / 100,
        ordersPending,
        otifPct: otifPct === null ? null : Math.round(otifPct * 10) / 10,
        receivablesBirr: Math.round(receivablesBirr * 100) / 100
      },
      charts: {
        revenueTrend,
        salesByProduct: [...byProduct.entries()]
          .map(([product, quintals]) => ({ product, quintals: Math.round(quintals * 10) / 10 }))
          .sort((a, b) => b.quintals - a.quintals)
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/finance ─────────────────────────────────────────────────────────
router.get('/finance', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const month = monthStart(now);
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 86400000);

    // Cash position proxy: total receipts − total supplier payments
    const cashInAgg = await prisma.cashReceipt.aggregate({ _sum: { amountBirr: true } });
    const payOutAgg = await prisma.aPPayment.aggregate({ _sum: { amountBirr: true } });
    const cashBalance = (cashInAgg._sum.amountBirr ?? ZERO).toNumber() - (payOutAgg._sum.amountBirr ?? ZERO).toNumber();

    const inMTD = await prisma.cashReceipt.aggregate({
      where: { receivedAt: { gte: month } },
      _sum: { amountBirr: true }
    });
    const outMTD = await prisma.aPPayment.aggregate({
      where: { paidAt: { gte: month } },
      _sum: { amountBirr: true }
    });

    // Receivables & payables (reuse logic)
    const invoices = await prisma.salesInvoice.findMany({
      where: { status: { in: ['INVOICED', 'PAID'] } },
      select: { amountBirr: true, receipts: { select: { amountBirr: true } } }
    });
    let receivablesBirr = 0;
    for (const inv of invoices) {
      receivablesBirr += Math.max(0, inv.amountBirr.toNumber() - inv.receipts.reduce((s, r) => s + r.amountBirr.toNumber(), 0));
    }
    const apInvoices = await prisma.aPInvoice.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] } },
      select: { amountBirr: true, payments: { select: { amountBirr: true } } }
    });
    let payablesBirr = 0;
    for (const inv of apInvoices) {
      payablesBirr += Math.max(0, inv.amountBirr.toNumber() - inv.payments.reduce((s, p) => s + p.amountBirr.toNumber(), 0));
    }

    // Profit MTD: recognized revenue − accepted wheat intake value (raw-material cost proxy)
    const revMTD = await prisma.salesInvoice.aggregate({
      where: { status: { in: ['INVOICED', 'PAID'] }, invoicedAt: { gte: month } },
      _sum: { amountBirr: true }
    });
    const revenue = (revMTD._sum.amountBirr ?? ZERO).toNumber();
    const intakes = await prisma.wheatIntake.findMany({
      where: { deliveryDate: { gte: month }, status: 'ACCEPTED' },
      select: { quintals: true }
    });
    const intakeQ = intakes.reduce((s, i) => s + i.quintals.toNumber(), 0);
    const avgBuy = await avgPurchasePricePerQ();
    const profitMTD = revenue - intakeQ * avgBuy;

    // Cash flow: 12 weeks in vs out
    const receipts = await prisma.cashReceipt.findMany({
      where: { receivedAt: { gte: twelveWeeksAgo } },
      select: { receivedAt: true, amountBirr: true }
    });
    const payments = await prisma.aPPayment.findMany({
      where: { paidAt: { gte: twelveWeeksAgo } },
      select: { paidAt: true, amountBirr: true }
    });
    const cashFlow: Array<{ week: string; inflow: number; outflow: number }> = [];
    for (let w = 11; w >= 0; w--) {
      const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const end = new Date(now.getTime() - w * 7 * 86400000);
      const inflow = receipts.filter((r) => r.receivedAt >= start && r.receivedAt < end).reduce((s, r) => s + r.amountBirr.toNumber(), 0);
      const outflow = payments.filter((p) => p.paidAt >= start && p.paidAt < end).reduce((s, p) => s + p.amountBirr.toNumber(), 0);
      cashFlow.push({
        week: end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        inflow: Math.round(inflow * 100) / 100,
        outflow: Math.round(outflow * 100) / 100
      });
    }

    // Expense breakdown: top suppliers by AP invoice value (90d)
    const supplierSpend = await prisma.aPInvoice.groupBy({
      by: ['supplierId'],
      where: { issuedAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
      _sum: { amountBirr: true },
      orderBy: { _sum: { amountBirr: 'desc' } },
      take: 6
    });
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierSpend.map((s) => s.supplierId) } },
      select: { id: true, name: true }
    });
    const sName = new Map(suppliers.map((s) => [s.id, s.name]));

    res.json({
      kpis: {
        cashBalance: Math.round(cashBalance * 100) / 100,
        cashInMTD: Math.round((inMTD._sum.amountBirr ?? ZERO).toNumber() * 100) / 100,
        cashOutMTD: Math.round((outMTD._sum.amountBirr ?? ZERO).toNumber() * 100) / 100,
        receivablesBirr: Math.round(receivablesBirr * 100) / 100,
        payablesBirr: Math.round(payablesBirr * 100) / 100,
        profitMTD: Math.round(profitMTD * 100) / 100
      },
      charts: {
        cashFlow,
        expenseBreakdown: supplierSpend.map((s) => ({
          supplier: sName.get(s.supplierId) ?? s.supplierId,
          amount: Math.round((s._sum.amountBirr ?? ZERO).toNumber() * 100) / 100
        }))
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /bi/hr ──────────────────────────────────────────────────────────────
router.get('/hr', requirePermission('payroll:view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const today = dayStart(now);
    const fourteenDaysAgo = daysAgo(14);

    const headcount = await prisma.employee.count({ where: { isActive: true } });

    const punchesToday = await prisma.attendancePunch.groupBy({
      by: ['zkPin'],
      where: { punchTime: { gte: today } }
    });
    const presentToday = punchesToday.length;
    const attendancePct = headcount > 0 ? (presentToday / headcount) * 100 : null;

    // Latest payroll run (for MTD payroll cost & overtime)
    const run = await prisma.payrollRun.findFirst({
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      include: { lines: { select: { overtimeHours: true, grossBirr: true, employee: { select: { department: true } } } } }
    });
    const payrollCost = run ? run.lines.reduce((s, l) => s + l.grossBirr.toNumber(), 0) : 0;
    const overtimeHours = run ? run.lines.reduce((s, l) => s + l.overtimeHours.toNumber(), 0) : 0;

    // Headcount by department
    const deptGroups = await prisma.employee.groupBy({
      by: ['department'],
      where: { isActive: true },
      _count: true
    });

    // Attendance trend (14d): unique employees punching per day
    const punches = await prisma.attendancePunch.findMany({
      where: { punchTime: { gte: fourteenDaysAgo } },
      select: { punchTime: true, zkPin: true }
    });
    const days = lastNDays(14);
    const attendanceTrend = days.map((d) => ({
      day: d.label,
      key: d.key,
      present: new Set(punches.filter((p) => dayKey(p.punchTime) === d.key).map((p) => p.zkPin)).size
    }));

    res.json({
      kpis: {
        headcount,
        attendanceToday: presentToday,
        attendancePct: attendancePct === null ? null : Math.round(attendancePct * 10) / 10,
        overtimeHoursMTD: Math.round(overtimeHours * 10) / 10,
        payrollCostMTD: Math.round(payrollCost * 100) / 100,
        payrollPeriod: run ? `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}` : null
      },
      charts: {
        headcountByDept: deptGroups
          .map((g) => ({ department: g.department ?? 'Unspecified', count: g._count }))
          .sort((a, b) => b.count - a.count),
        attendanceTrend
      },
      generatedAt: now.toISOString()
    });
  } catch (err) {
    next(err);
  }
});
