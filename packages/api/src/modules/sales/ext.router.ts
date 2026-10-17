import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import {
  ORDER_TRANSITIONS,
  advanceBalance,
  addLoadItem,
  applyAdvanceToInvoice,
  approveAgreement,
  autoApplyAdvances,
  createAgentPlacement,
  createAgreement,
  createCashReconciliation,
  createDeliveryTrip,
  createInvoiceFromOrders,
  createTruckLoad,
  deliveryPerformanceReport,
  finalizeTruckLoad,
  gateExitDispatch,
  postSalesInvoice,
  quotedPrice,
  recordDeposit,
  removeLoadItem,
  replaceOrderLines,
  resolveCashReconciliation,
  salesSummaryReport,
  agentSettlementReport,
  setTripStatus,
  settleAgentPlacement,
  transitionOrderStatus,
} from './ext.service';

export const extRouter = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamsSchema = z.object({ id: z.string().min(1) });

const dateRangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const orderLineSchema = z.object({
  productId: z.string().min(1),
  packagingSizeId: z.string().min(1).nullable().optional(),
  bags: z.number().int().nonnegative(),
  quintals: z.number().positive(),
  priceBirr: z.number().positive(),
});

// ─── Order status workflow + lines ──────────────────────────────

extRouter.patch(
  '/orders/:id/status',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ status: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const { status } = req.body as { status: string };
      if (!ORDER_TRANSITIONS[status]) throw new AppError(400, `Unknown status ${status}`);
      await prisma.$transaction(async (tx) => transitionOrderStatus(tx, req.params.id, status, uid));
      res.json({ ok: true, status });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/orders/:id/cancel',
  requirePermission('sales:approve'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      await prisma.$transaction(async (tx) => transitionOrderStatus(tx, req.params.id, 'CANCELLED', uid));
      res.json({ ok: true, status: 'CANCELLED' });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.put(
  '/orders/:id/lines',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ lines: z.array(orderLineSchema).min(1) })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const { lines } = req.body as { lines: z.infer<typeof orderLineSchema>[] };
      await prisma.$transaction(async (tx) => replaceOrderLines(tx, req.params.id, lines, uid));
      res.json({ ok: true, lines: lines.length });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/orders/:id/full',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.salesOrder.findUnique({
        where: { id: req.params.id },
        include: {
          customer: true,
          lines: { include: { product: true, packagingSize: true } },
          dispatchLines: { include: { dispatch: true } },
        },
      });
      if (!row) throw new AppError(404, 'Sales order not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Customer price agreements ──────────────────────────────────

const tierSchema = z.object({
  minBags: z.number().int().nonnegative(),
  discountPct: z.number().min(0).max(100).optional(),
  priceBirr: z.number().positive().optional(),
});

const agreementLineSchema = z.object({
  productId: z.string().min(1),
  packagingSizeId: z.string().min(1).nullable().optional(),
  priceBirr: z.number().positive(),
  tiers: z.array(tierSchema).optional(),
});

const createAgreementSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  discountPct: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  lines: z.array(agreementLineSchema).min(1),
});

extRouter.get('/agreements', requirePermission('sales:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.salesAgreement.findMany({
      include: { customer: true, lines: { include: { product: true, packagingSize: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

extRouter.post(
  '/agreements',
  requirePermission('sales:manage'),
  validateBody(createAgreementSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createAgreementSchema>;
      const created = await prisma.$transaction(async (tx) => createAgreement(tx, body, uid));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/agreements/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.salesAgreement.findUnique({
        where: { id: req.params.id },
        include: { customer: true, lines: { include: { product: true, packagingSize: true } } },
      });
      if (!row) throw new AppError(404, 'Agreement not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/agreements/:id/approve',
  requirePermission('sales:approve'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const updated = await prisma.$transaction(async (tx) => approveAgreement(tx, req.params.id, uid));
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/agreements/quote/price',
  requirePermission('sales:view'),
  validateQuery(
    z.object({
      customerId: z.string().min(1),
      productId: z.string().min(1),
      packagingSizeId: z.string().optional(),
      bags: z.coerce.number().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { customerId: string; productId: string; packagingSizeId?: string; bags?: number };
      const quote = await prisma.$transaction(async (tx) =>
        quotedPrice(tx, {
          customerId: q.customerId,
          productId: q.productId,
          packagingSizeId: q.packagingSizeId ?? null,
          bags: q.bags ?? 0,
        }),
      );
      res.json(quote);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Advances: balances & auto-application ──────────────────────

extRouter.get(
  '/advances/balance',
  requirePermission('sales:view'),
  validateQuery(z.object({ customerId: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { customerId: string };
      const balance = await prisma.$transaction(async (tx) => advanceBalance(tx, q.customerId));
      const advances = await prisma.advancePayment.findMany({
        where: { customerId: q.customerId },
        include: { applications: { include: { invoice: true } } },
        orderBy: { paidAt: 'desc' },
      });
      res.json({ balance, advances });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/advances/:id/apply',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ invoiceId: z.string().min(1), amountBirr: z.number().positive().optional() })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { invoiceId: string; amountBirr?: number };
      await prisma.$transaction(async (tx) =>
        applyAdvanceToInvoice(tx, { advanceId: req.params.id, invoiceId: body.invoiceId, amountBirr: body.amountBirr }, uid),
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/advances/auto-apply',
  requirePermission('sales:manage'),
  validateBody(z.object({ customerId: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { customerId: string };
      const result = await prisma.$transaction(async (tx) => autoApplyAdvances(tx, body.customerId, uid));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Truck load consolidation ───────────────────────────────────

const createLoadSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  route: z.string().min(1),
  capacityQuintals: z.number().positive().optional(),
  notes: z.string().optional(),
});

extRouter.get('/loads', requirePermission('sales:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.truckLoad.findMany({
      include: {
        vehicle: true,
        items: { include: { order: { include: { customer: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

extRouter.post(
  '/loads',
  requirePermission('sales:manage'),
  validateBody(createLoadSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createLoadSchema>;
      const load = await prisma.$transaction(async (tx) => createTruckLoad(tx, body, uid));
      res.status(201).json(load);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/loads/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.truckLoad.findUnique({
        where: { id: req.params.id },
        include: {
          vehicle: true,
          items: { include: { order: { include: { customer: true, lines: true } } } },
        },
      });
      if (!row) throw new AppError(404, 'Truck load not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/loads/:id/items',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ orderId: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { orderId: string };
      await prisma.$transaction(async (tx) => addLoadItem(tx, req.params.id, body.orderId, uid));
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.delete(
  '/loads/items/:id',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      await prisma.$transaction(async (tx) => removeLoadItem(tx, req.params.id, uid));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/loads/:id/finalize',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const load = await prisma.$transaction(async (tx) => finalizeTruckLoad(tx, req.params.id, uid));
      res.json(load);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Delivery trips ─────────────────────────────────────────────

const createTripSchema = z.object({
  vehicleId: z.string().min(1),
  driverName: z.string().optional(),
  area: z.string().min(1),
  dispatchId: z.string().min(1).optional(),
  notes: z.string().optional(),
});

extRouter.get('/trips', requirePermission('sales:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.deliveryTrip.findMany({
      include: { vehicle: true, dispatch: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

extRouter.post(
  '/trips',
  requirePermission('sales:manage'),
  validateBody(createTripSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createTripSchema>;
      const trip = await prisma.$transaction(async (tx) => createDeliveryTrip(tx, body, uid));
      res.status(201).json(trip);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/trips/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.deliveryTrip.findUnique({
        where: { id: req.params.id },
        include: { vehicle: true, dispatch: { include: { lines: true } } },
      });
      if (!row) throw new AppError(404, 'Delivery trip not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/trips/:id/status',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(
    z.object({
      status: z.enum(['DEPARTED', 'ARRIVED', 'POD_CONFIRMED', 'CANCELLED']),
      podSignedBy: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { status: 'DEPARTED' | 'ARRIVED' | 'POD_CONFIRMED' | 'CANCELLED'; podSignedBy?: string };
      const trip = await prisma.$transaction(async (tx) =>
        setTripStatus(tx, req.params.id, body.status, { podSignedBy: body.podSignedBy }, uid),
      );
      res.json(trip);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Gate-pass workflow ─────────────────────────────────────────

extRouter.get(
  '/dispatches/at-gate',
  requirePermission('sales:view'),
  async (_req, res, next) => {
    try {
      const rows = await prisma.dispatch.findMany({
        where: { gateStatus: 'AT_GATE' },
        include: { vehicle: true },
        orderBy: { dispatchedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/dispatches/:id/gate-exit',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(
    z.object({
      sealNo: z.string().optional(),
      gateOfficer: z.string().optional(),
      gateNotes: z.string().optional(),
      atGate: z.boolean().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { sealNo?: string; gateOfficer?: string; gateNotes?: string; atGate?: boolean };
      await prisma.$transaction(async (tx) => gateExitDispatch(tx, req.params.id, body, uid));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Agent stock placement & settlement ─────────────────────────

const createPlacementSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
  packagingSizeId: z.string().min(1).nullable().optional(),
  bags: z.number().int().nonnegative(),
  quintals: z.number().positive(),
  unitPriceBirr: z.number().positive(),
  notes: z.string().optional(),
});

extRouter.get(
  '/agents/placements',
  requirePermission('sales:view'),
  validateQuery(z.object({ customerId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { customerId?: string };
      const rows = await prisma.agentStockPlacement.findMany({
        where: { customerId: q.customerId },
        include: { customer: true, product: true, packagingSize: true, settlements: true },
        orderBy: { placedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/agents/placements',
  requirePermission('sales:manage'),
  validateBody(createPlacementSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createPlacementSchema>;
      const placement = await prisma.$transaction(async (tx) => createAgentPlacement(tx, body, uid));
      res.status(201).json(placement);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/agents/placements/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.agentStockPlacement.findUnique({
        where: { id: req.params.id },
        include: { customer: true, product: true, packagingSize: true, settlements: true },
      });
      if (!row) throw new AppError(404, 'Placement not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/agents/placements/:id/settle',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ bags: z.number().int().nonnegative(), quintals: z.number().positive(), notes: z.string().optional() })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { bags: number; quintals: number; notes?: string };
      const settlement = await prisma.$transaction(async (tx) => settleAgentPlacement(tx, req.params.id, body, uid));
      res.status(201).json(settlement);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Sales invoices from delivered orders ───────────────────────

extRouter.get(
  '/invoices',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery.extend({ customerId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date; customerId?: string };
      const rows = await prisma.salesInvoice.findMany({
        where: {
          createdAt: { gte: q.from, lte: q.to },
          customerId: q.customerId,
        },
        include: { lines: { include: { product: true } }, receipts: true, applications: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/invoices',
  requirePermission('sales:manage'),
  validateBody(z.object({ orderIds: z.array(z.string().min(1)).min(1), customerId: z.string().min(1).optional() })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { orderIds: string[]; customerId?: string };
      const invoice = await prisma.$transaction(async (tx) => createInvoiceFromOrders(tx, body, uid));
      res.status(201).json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/invoices/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.salesInvoice.findUnique({
        where: { id: req.params.id },
        include: {
          lines: { include: { product: true, packagingSize: true } },
          receipts: true,
          applications: { include: { advance: true } },
          dispatch: { include: { vehicle: true } },
        },
      });
      if (!row) throw new AppError(404, 'Sales invoice not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/invoices/:id/post',
  requirePermission('sales:approve'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const invoice = await prisma.$transaction(async (tx) => postSalesInvoice(tx, req.params.id, uid));
      res.json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cash reconciliation ────────────────────────────────────────

const createReconSchema = z.object({
  reconDate: z.coerce.date(),
  expectedBirr: z.number().nonnegative().optional(),
  collectedBirr: z.number().nonnegative(),
  notes: z.string().optional(),
  depositRef: z.string().optional(),
});

extRouter.get(
  '/cash-reconciliation',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date };
      const rows = await prisma.cashReconciliation.findMany({
        where: { reconDate: { gte: q.from, lte: q.to } },
        orderBy: { reconDate: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/cash-reconciliation',
  requirePermission('sales:manage'),
  validateBody(createReconSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createReconSchema>;
      const recon = await prisma.$transaction(async (tx) =>
        createCashReconciliation(
          tx,
          {
            reconDate: body.reconDate,
            expectedBirr: body.expectedBirr,
            collectedBirr: body.collectedBirr,
            notes: body.notes,
            depositRef: body.depositRef,
          },
          uid,
        ),
      );
      res.status(201).json(recon);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/cash-reconciliation/:id/resolve',
  requirePermission('sales:approve'),
  validateParams(idParamsSchema),
  validateBody(z.object({ notes: z.string().optional() })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { notes?: string };
      const recon = await prisma.$transaction(async (tx) => resolveCashReconciliation(tx, req.params.id, body.notes, uid));
      res.json(recon);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.post(
  '/cash-reconciliation/:id/deposit',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(z.object({ depositRef: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as { depositRef: string };
      const recon = await prisma.$transaction(async (tx) => recordDeposit(tx, req.params.id, body.depositRef, uid));
      res.json(recon);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reports ────────────────────────────────────────────────────

extRouter.get(
  '/reports/summary',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date };
      const report = await prisma.$transaction(async (tx) => salesSummaryReport(tx, q.from, q.to));
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/reports/delivery-performance',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date };
      const report = await prisma.$transaction(async (tx) => deliveryPerformanceReport(tx, q.from, q.to));
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

extRouter.get(
  '/reports/agent-settlements',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as { from?: Date; to?: Date };
      const report = await prisma.$transaction(async (tx) => agentSettlementReport(tx, q.from, q.to));
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);
