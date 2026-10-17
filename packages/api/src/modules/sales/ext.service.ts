import { Prisma, RevenueStatus } from '@prisma/client';
import type { AdvancePayment, CashReconciliation, DeliveryTrip, SalesAgreement, SalesInvoice, TruckLoad } from '@prisma/client';
import type { DbClient } from '../../lib/audit';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';
import { postJournal } from '../finance/service';

// ─── Order status workflow ──────────────────────────────────────
// Draft → Confirmed → Processing → Loading → Dispatched → Delivered → Cancelled
// Legacy statuses (OPEN/LOADED/INVOICED/CLOSED) are mapped for compatibility.

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  OPEN: ['CONFIRMED', 'PROCESSING', 'LOADING', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['LOADING', 'CANCELLED'],
  LOADING: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED', 'CANCELLED'],
  LOADED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  INVOICED: [],
  CLOSED: [],
};

export const LOADABLE_STATUSES = ['OPEN', 'CONFIRMED', 'PROCESSING', 'LOADING'];

export interface OrderLineInput {
  productId: string;
  packagingSizeId?: string | null;
  bags: number;
  quintals: number;
  priceBirr: number;
}

export async function transitionOrderStatus(
  tx: DbClient,
  orderId: string,
  to: string,
  userId: string,
): Promise<void> {
  const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(404, 'Sales order not found');
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(409, `Cannot move order ${order.orderNo} from ${order.status} to ${to}`);
  }
  await tx.salesOrder.update({ where: { id: orderId }, data: { status: to } });
  await audit(tx, {
    userId,
    action: 'STATUS',
    entityType: 'SalesOrder',
    entityId: orderId,
    changes: { from: order.status, to },
  });
}

/** Replace the line items of a DRAFT order; keeps legacy totals coherent. */
export async function replaceOrderLines(
  tx: DbClient,
  orderId: string,
  lines: OrderLineInput[],
  userId: string,
): Promise<void> {
  const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(404, 'Sales order not found');
  if (order.status !== 'DRAFT') {
    throw new AppError(409, 'Only DRAFT orders can have their lines replaced');
  }
  if (lines.length === 0) throw new AppError(400, 'Order must have at least one line');

  for (const l of lines) {
    const product = await tx.product.findUnique({ where: { id: l.productId } });
    if (!product) throw new AppError(404, `Product ${l.productId} not found`);
    if (l.packagingSizeId) {
      const pack = await tx.packagingSize.findUnique({ where: { id: l.packagingSizeId } });
      if (!pack) throw new AppError(404, `Packaging size ${l.packagingSizeId} not found`);
    }
  }

  await tx.salesOrderLine.deleteMany({ where: { orderId } });
  await tx.salesOrderLine.createMany({
    data: lines.map((l) => ({
      orderId,
      productId: l.productId,
      packagingSizeId: l.packagingSizeId ?? null,
      bags: Math.round(l.bags),
      quintals: new Prisma.Decimal(l.quintals),
      priceBirr: new Prisma.Decimal(l.priceBirr),
    })),
  });

  const totalQ = lines.reduce((s, l) => s + l.quintals, 0);
  const totalV = lines.reduce((s, l) => s + l.quintals * l.priceBirr, 0);
  await tx.salesOrder.update({
    where: { id: orderId },
    data: {
      quintals: new Prisma.Decimal(totalQ),
      priceBirr: totalQ > 0 ? new Prisma.Decimal(totalV / totalQ) : new Prisma.Decimal(0),
    },
  });

  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'SalesOrder',
    entityId: orderId,
    changes: { lines: lines.length, totalQuintals: totalQ },
  });
}

// ─── Customer price agreements ──────────────────────────────────

export interface AgreementLineInput {
  productId: string;
  packagingSizeId?: string | null;
  priceBirr: number;
  tiers?: Array<{ minBags: number; discountPct?: number; priceBirr?: number }>;
}

export async function createAgreement(
  tx: DbClient,
  input: {
    customerId: string;
    name: string;
    validFrom: Date;
    validTo: Date;
    discountPct?: number;
    notes?: string;
    lines: AgreementLineInput[];
  },
  userId: string,
): Promise<SalesAgreement> {
  if (input.validTo <= input.validFrom) {
    throw new AppError(400, 'validTo must be after validFrom');
  }
  const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new AppError(404, 'Customer not found');

  const agreementNo = await nextDocNo(tx, 'salesAgreement', 'agreementNo', 'AGR');
  const agreement = await tx.salesAgreement.create({
    data: {
      agreementNo,
      customerId: customer.id,
      name: input.name,
      validFrom: input.validFrom,
      validTo: input.validTo,
      discountPct: new Prisma.Decimal(input.discountPct ?? 0),
      status: 'DRAFT',
      notes: input.notes ?? null,
      createdById: userId,
      lines: {
        create: input.lines.map((l) => ({
          productId: l.productId,
          packagingSizeId: l.packagingSizeId ?? null,
          priceBirr: new Prisma.Decimal(l.priceBirr),
          tiers: l.tiers ?? Prisma.JsonNull,
        })),
      },
    },
    include: { lines: true },
  });

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'SalesAgreement',
    entityId: agreement.id,
    changes: { agreementNo, customerId: customer.id, lines: input.lines.length },
  });
  return agreement;
}

export async function approveAgreement(tx: DbClient, agreementId: string, userId: string): Promise<SalesAgreement> {
  const agreement = await tx.salesAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new AppError(404, 'Agreement not found');
  if (agreement.status !== 'DRAFT') {
    throw new AppError(409, `Agreement ${agreement.agreementNo} is not DRAFT`);
  }
  const updated = await tx.salesAgreement.update({
    where: { id: agreementId },
    data: { status: 'ACTIVE' },
  });
  await audit(tx, { userId, action: 'APPROVE', entityType: 'SalesAgreement', entityId: agreementId, changes: { status: 'ACTIVE' } });
  return updated;
}

/** Effective per-quintal price for a customer/product/pack-size on a date. */
export async function quotedPrice(
  tx: DbClient,
  args: { customerId: string; productId: string; packagingSizeId?: string | null; bags?: number; on?: Date },
): Promise<{ priceBirr: number; agreementNo: string | null; discountPct: number }> {
  const on = args.on ?? new Date();
  const agreement = await tx.salesAgreement.findFirst({
    where: {
      customerId: args.customerId,
      status: 'ACTIVE',
      validFrom: { lte: on },
      validTo: { gte: on },
      lines: {
        some: {
          productId: args.productId,
          OR: [{ packagingSizeId: args.packagingSizeId ?? null }, { packagingSizeId: null }],
        },
      },
    },
    orderBy: { validTo: 'desc' },
    include: { lines: true },
  });
  if (!agreement) return { priceBirr: 0, agreementNo: null, discountPct: 0 };

  const line =
    agreement.lines.find(
      (l) => l.productId === args.productId && (l.packagingSizeId ?? null) === (args.packagingSizeId ?? null),
    ) ?? agreement.lines.find((l) => l.productId === args.productId && !l.packagingSizeId);
  if (!line) return { priceBirr: 0, agreementNo: null, discountPct: 0 };

  let price = line.priceBirr.toNumber();
  let appliedDiscount = agreement.discountPct.toNumber();
  const tiers = (line.tiers as Array<{ minBags: number; discountPct?: number; priceBirr?: number }> | null) ?? [];
  const bags = args.bags ?? 0;
  const matched = tiers
    .filter((t) => bags >= t.minBags)
    .sort((a, b) => b.minBags - a.minBags)[0];
  if (matched) {
    if (matched.priceBirr !== undefined) price = matched.priceBirr;
    if (matched.discountPct !== undefined) appliedDiscount = matched.discountPct;
  }
  return { priceBirr: price, agreementNo: agreement.agreementNo, discountPct: appliedDiscount };
}

// ─── Advance payments: application to invoices ──────────────────

export async function advanceBalance(
  tx: DbClient,
  customerId: string,
): Promise<{ total: number; applied: number; available: number }> {
  const agg = await tx.advancePayment.aggregate({
    _sum: { amountBirr: true, appliedAmountBirr: true },
    where: { customerId },
  });
  const total = (agg._sum.amountBirr ?? new Prisma.Decimal(0)).toNumber();
  const applied = (agg._sum.appliedAmountBirr ?? new Prisma.Decimal(0)).toNumber();
  return { total, applied, available: total - applied };
}

export async function invoiceOutstanding(tx: DbClient, invoiceId: string): Promise<Prisma.Decimal> {
  const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError(404, 'Sales invoice not found');
  const [recAgg, appAgg] = await Promise.all([
    tx.cashReceipt.aggregate({ _sum: { amountBirr: true }, where: { invoiceId } }),
    tx.advanceApplication.aggregate({ _sum: { amountBirr: true }, where: { invoiceId } }),
  ]);
  const paid =
    (recAgg._sum.amountBirr ?? new Prisma.Decimal(0)).plus(appAgg._sum.amountBirr ?? new Prisma.Decimal(0));
  return invoice.amountBirr.minus(paid);
}

async function applyAdvanceInternal(
  tx: DbClient,
  advance: AdvancePayment,
  invoiceId: string,
  amount: Prisma.Decimal,
  userId: string,
): Promise<void> {
  await tx.advanceApplication.create({
    data: { advanceId: advance.id, invoiceId, amountBirr: amount, appliedById: userId },
  });
  const newApplied = advance.appliedAmountBirr.plus(amount);
  await tx.advancePayment.update({
    where: { id: advance.id },
    data: {
      appliedAmountBirr: newApplied,
      status: newApplied.gte(advance.amountBirr) ? 'APPLIED' : 'PARTIAL',
    },
  });
  const outstanding = await invoiceOutstanding(tx, invoiceId);
  if (outstanding.lte(0)) {
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { status: RevenueStatus.PAID } });
  }
}

export async function applyAdvanceToInvoice(
  tx: DbClient,
  args: { advanceId: string; invoiceId: string; amountBirr?: number },
  userId: string,
): Promise<void> {
  const advance = await tx.advancePayment.findUnique({ where: { id: args.advanceId } });
  if (!advance) throw new AppError(404, 'Advance payment not found');
  const available = advance.amountBirr.minus(advance.appliedAmountBirr);
  if (available.lte(0)) throw new AppError(409, 'Advance payment is fully applied');

  const outstanding = await invoiceOutstanding(tx, args.invoiceId);
  if (outstanding.lte(0)) throw new AppError(409, 'Invoice has no outstanding balance');

  const wanted = args.amountBirr !== undefined ? new Prisma.Decimal(args.amountBirr) : available;
  if (wanted.lte(0)) throw new AppError(400, 'Amount must be positive');
  const amount = Prisma.Decimal.min(wanted, Prisma.Decimal.min(available, outstanding));

  await applyAdvanceInternal(tx, advance, args.invoiceId, amount, userId);
  await audit(tx, {
    userId,
    action: 'APPLY',
    entityType: 'AdvancePayment',
    entityId: advance.id,
    changes: { invoiceId: args.invoiceId, amountBirr: amount.toNumber() },
  });
}

/** Auto-apply all available advances of a customer to the oldest unpaid invoices. */
export async function autoApplyAdvances(
  tx: DbClient,
  customerId: string,
  userId: string,
): Promise<{ applied: number; invoiceCount: number }> {
  const advances = await tx.advancePayment.findMany({
    where: { customerId, status: { in: ['OPEN', 'PARTIAL'] } },
    orderBy: { paidAt: 'asc' },
  });
  const invoices = await tx.salesInvoice.findMany({
    where: { customerId, status: { in: [RevenueStatus.PLACEMENT, RevenueStatus.INVOICED] } },
    orderBy: { createdAt: 'asc' },
  });

  let appliedTotal = new Prisma.Decimal(0);
  let touched = new Set<string>();

  for (const adv of advances) {
    let available = adv.amountBirr.minus(adv.appliedAmountBirr);
    if (available.lte(0)) continue;
    for (const inv of invoices) {
      if (available.lte(0)) break;
      const outstanding = await invoiceOutstanding(tx, inv.id);
      if (outstanding.lte(0)) continue;
      const amount = Prisma.Decimal.min(available, outstanding);
      await applyAdvanceInternal(tx, adv, inv.id, amount, userId);
      available = available.minus(amount);
      appliedTotal = appliedTotal.plus(amount);
      touched.add(inv.id);
      if (available.lte(0)) break;
    }
  }

  await audit(tx, {
    userId,
    action: 'AUTO_APPLY',
    entityType: 'AdvancePayment',
    entityId: customerId,
    changes: { appliedBirr: appliedTotal.toNumber(), invoices: touched.size },
  });
  return { applied: appliedTotal.toNumber(), invoiceCount: touched.size };
}

// ─── Truck load consolidation ───────────────────────────────────

export async function createTruckLoad(
  tx: DbClient,
  input: { vehicleId?: string; route: string; capacityQuintals?: number; notes?: string },
  userId: string,
): Promise<TruckLoad> {
  if (input.vehicleId) {
    const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!v) throw new AppError(404, 'Vehicle not found');
    if (!v.isActive) throw new AppError(400, 'Vehicle is not active');
  }
  const loadNo = await nextDocNo(tx, 'truckLoad', 'loadNo', 'LOAD');
  const load = await tx.truckLoad.create({
    data: {
      loadNo,
      vehicleId: input.vehicleId ?? null,
      route: input.route,
      capacityQuintals: new Prisma.Decimal(input.capacityQuintals ?? 300),
      status: 'BUILDING',
      notes: input.notes ?? null,
      createdById: userId,
    },
  });
  await audit(tx, { userId, action: 'CREATE', entityType: 'TruckLoad', entityId: load.id, changes: { loadNo } });
  return load;
}

export async function addLoadItem(tx: DbClient, loadId: string, orderId: string, userId: string): Promise<void> {
  const load = await tx.truckLoad.findUnique({ where: { id: loadId }, include: { items: true } });
  if (!load) throw new AppError(404, 'Truck load not found');
  if (load.status !== 'BUILDING') throw new AppError(409, `Load ${load.loadNo} is ${load.status} and cannot accept items`);

  const order = await tx.salesOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order) throw new AppError(404, 'Sales order not found');
  if (!LOADABLE_STATUSES.includes(order.status)) {
    throw new AppError(409, `Order ${order.orderNo} is ${order.status} and cannot be loaded`);
  }

  const orderQ = order.lines.length > 0
    ? order.lines.reduce((s, l) => s.plus(l.quintals), new Prisma.Decimal(0))
    : order.quintals;
  const orderBags = order.lines.reduce((s, l) => s + l.bags, 0);

  const currentQ = load.items.reduce((s, i) => s.plus(i.quintals), new Prisma.Decimal(0));
  const after = currentQ.plus(orderQ);
  if (after.gt(load.capacityQuintals)) {
    throw new AppError(409, `Adding ${order.orderNo} (${orderQ.toString()} q) exceeds capacity ${load.capacityQuintals.toString()} q`);
  }

  await tx.truckLoadItem.create({
    data: { loadId, orderId, bags: orderBags, quintals: orderQ },
  });
  await tx.salesOrder.update({ where: { id: orderId }, data: { status: 'PROCESSING' } });
  await audit(tx, { userId, action: 'ADD_ITEM', entityType: 'TruckLoad', entityId: loadId, changes: { orderId, quintals: orderQ.toNumber() } });
}

export async function removeLoadItem(tx: DbClient, itemId: string, userId: string): Promise<void> {
  const item = await tx.truckLoadItem.findUnique({ where: { id: itemId }, include: { load: true } });
  if (!item) throw new AppError(404, 'Load item not found');
  if (item.load.status !== 'BUILDING') throw new AppError(409, `Load ${item.load.loadNo} is ${item.load.status}`);
  await tx.truckLoadItem.delete({ where: { id: itemId } });
  await audit(tx, { userId, action: 'REMOVE_ITEM', entityType: 'TruckLoad', entityId: item.loadId, changes: { itemId } });
}

export async function finalizeTruckLoad(tx: DbClient, loadId: string, userId: string): Promise<TruckLoad> {
  const load = await tx.truckLoad.findUnique({ where: { id: loadId }, include: { items: true } });
  if (!load) throw new AppError(404, 'Truck load not found');
  if (load.status !== 'BUILDING') throw new AppError(409, `Load ${load.loadNo} is ${load.status}`);
  if (load.items.length === 0) throw new AppError(409, 'Cannot finalize an empty load');
  const updated = await tx.truckLoad.update({ where: { id: loadId }, data: { status: 'READY' } });
  await audit(tx, { userId, action: 'FINALIZE', entityType: 'TruckLoad', entityId: loadId, changes: { items: load.items.length } });
  return updated;
}

// ─── Delivery trips ─────────────────────────────────────────────

const TRIP_TRANSITIONS: Record<string, string[]> = {
  PLANNED: ['DEPARTED', 'CANCELLED'],
  DEPARTED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['POD_CONFIRMED'],
  POD_CONFIRMED: [],
  CANCELLED: [],
};

export async function createDeliveryTrip(
  tx: DbClient,
  input: { vehicleId: string; driverName?: string; area: string; dispatchId?: string; notes?: string },
  userId: string,
): Promise<DeliveryTrip> {
  const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw new AppError(404, 'Vehicle not found');
  if (input.dispatchId) {
    const d = await tx.dispatch.findUnique({ where: { id: input.dispatchId } });
    if (!d) throw new AppError(404, 'Dispatch not found');
  }
  const tripNo = await nextDocNo(tx, 'deliveryTrip', 'tripNo', 'TRIP');
  const trip = await tx.deliveryTrip.create({
    data: {
      tripNo,
      vehicleId: vehicle.id,
      driverName: input.driverName ?? null,
      area: input.area,
      status: 'PLANNED',
      dispatchId: input.dispatchId ?? null,
      notes: input.notes ?? null,
      createdById: userId,
    },
  });
  await audit(tx, { userId, action: 'CREATE', entityType: 'DeliveryTrip', entityId: trip.id, changes: { tripNo } });
  return trip;
}

export async function setTripStatus(
  tx: DbClient,
  tripId: string,
  to: 'DEPARTED' | 'ARRIVED' | 'POD_CONFIRMED' | 'CANCELLED',
  extra: { podSignedBy?: string } | undefined,
  userId: string,
): Promise<DeliveryTrip> {
  const trip = await tx.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new AppError(404, 'Delivery trip not found');
  if (!(TRIP_TRANSITIONS[trip.status] ?? []).includes(to)) {
    throw new AppError(409, `Cannot move trip ${trip.tripNo} from ${trip.status} to ${to}`);
  }
  const now = new Date();
  const data: Record<string, unknown> = { status: to };
  if (to === 'DEPARTED') data.departedAt = now;
  if (to === 'ARRIVED') data.arrivedAt = now;
  if (to === 'POD_CONFIRMED') {
    data.podReceivedAt = now;
    data.podSignedBy = extra?.podSignedBy ?? null;
  }
  const updated = await tx.deliveryTrip.update({ where: { id: tripId }, data });
  await audit(tx, { userId, action: 'STATUS', entityType: 'DeliveryTrip', entityId: tripId, changes: { from: trip.status, to } });
  return updated;
}

// ─── Gate-pass workflow ─────────────────────────────────────────

export async function gateExitDispatch(
  tx: DbClient,
  dispatchId: string,
  input: { sealNo?: string; gateOfficer?: string; gateNotes?: string; atGate?: boolean },
  userId: string,
): Promise<void> {
  const dispatch = await tx.dispatch.findUnique({ where: { id: dispatchId } });
  if (!dispatch) throw new AppError(404, 'Dispatch not found');
  const to = input.atGate ? 'AT_GATE' : 'EXITED';
  if (to === 'EXITED' && dispatch.gateStatus === 'EXITED') {
    throw new AppError(409, `Dispatch ${dispatch.exitNoteNo} already exited`);
  }
  await tx.dispatch.update({
    where: { id: dispatchId },
    data: {
      gateStatus: to,
      gateCheckedAt: new Date(),
      sealNo: input.sealNo ?? dispatch.sealNo,
      gateOfficer: input.gateOfficer ?? dispatch.gateOfficer,
      gateNotes: input.gateNotes ?? dispatch.gateNotes,
    },
  });
  await audit(tx, {
    userId,
    action: to === 'EXITED' ? 'GATE_EXIT' : 'GATE_ARRIVE',
    entityType: 'Dispatch',
    entityId: dispatchId,
    changes: { gateStatus: to, sealNo: input.sealNo ?? null },
  });
}

// ─── Invoicing from delivered orders ────────────────────────────

export async function createInvoiceFromOrders(
  tx: DbClient,
  input: { orderIds: string[]; customerId?: string },
  userId: string,
): Promise<SalesInvoice> {
  if (input.orderIds.length === 0) throw new AppError(400, 'orderIds must not be empty');
  const orders = await tx.salesOrder.findMany({
    where: { id: { in: input.orderIds } },
    include: { lines: { include: { product: true } } },
  });
  if (orders.length !== input.orderIds.length) {
    throw new AppError(404, 'One or more sales orders not found');
  }
  const notReady = orders.find((o) => !['DISPATCHED', 'DELIVERED'].includes(o.status));
  if (notReady) {
    throw new AppError(409, `Order ${notReady.orderNo} is ${notReady.status}; only DISPATCHED/DELIVERED orders can be invoiced`);
  }
  const customerId = input.customerId ?? orders[0].customerId;
  if (orders.some((o) => o.customerId !== customerId)) {
    throw new AppError(400, 'All orders in an invoice must belong to the same customer');
  }

  let amount = new Prisma.Decimal(0);
  const invoiceLines: Array<{
    orderId: string;
    productId: string;
    packagingSizeId: string | null;
    bags: number;
    quintals: Prisma.Decimal;
    unitPriceBirr: Prisma.Decimal;
    lineTotalBirr: Prisma.Decimal;
  }> = [];

  for (const order of orders) {
    if (order.lines.length > 0) {
      for (const l of order.lines) {
        const lineTotal = l.quintals.times(l.priceBirr);
        amount = amount.plus(lineTotal);
        invoiceLines.push({
          orderId: order.id,
          productId: l.productId,
          packagingSizeId: l.packagingSizeId,
          bags: l.bags,
          quintals: l.quintals,
          unitPriceBirr: l.priceBirr,
          lineTotalBirr: lineTotal,
        });
      }
    } else {
      const lineTotal = order.quintals.times(order.priceBirr);
      amount = amount.plus(lineTotal);
      invoiceLines.push({
        orderId: order.id,
        productId: order.productId,
        packagingSizeId: null,
        bags: 0,
        quintals: order.quintals,
        unitPriceBirr: order.priceBirr,
        lineTotalBirr: lineTotal,
      });
    }
  }

  const invoiceNo = await nextDocNo(tx, 'salesInvoice', 'invoiceNo', 'INV');
  const invoice = await tx.salesInvoice.create({
    data: {
      invoiceNo,
      dispatchId: null,
      customerId,
      amountBirr: amount,
      status: RevenueStatus.PLACEMENT,
      source: 'ORDER',
      orderIds: input.orderIds,
      lines: { create: invoiceLines },
    },
    include: { lines: true },
  });

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'SalesInvoice',
    entityId: invoice.id,
    changes: { invoiceNo, source: 'ORDER', orderIds: input.orderIds, amountBirr: amount.toNumber() },
  });
  return invoice;
}

/** Finalize a PLACEMENT invoice (order- or dispatch-sourced): mark INVOICED + post AR/revenue journal. */
export async function postSalesInvoice(tx: DbClient, invoiceId: string, userId: string): Promise<SalesInvoice> {
  const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError(404, 'Sales invoice not found');
  if (invoice.status !== RevenueStatus.PLACEMENT) {
    throw new AppError(409, 'Invoice is not in PLACEMENT status');
  }
  const updated = await tx.salesInvoice.update({
    where: { id: invoiceId },
    data: { status: RevenueStatus.INVOICED, invoicedAt: new Date() },
  });
  await postJournal(tx, {
    entryDate: new Date(),
    memo: `Sales invoice ${invoice.invoiceNo} (orders ${invoice.orderIds.length > 0 ? invoice.orderIds.length : 'dispatch'})`,
    module: 'sales',
    referenceType: 'SalesInvoice',
    referenceId: invoice.id,
    createdById: userId,
    lines: [
      { accountCode: '1100', debit: invoice.amountBirr, credit: 0 },
      { accountCode: '4000', debit: 0, credit: invoice.amountBirr },
    ],
  });
  await audit(tx, { userId, action: 'POST', entityType: 'SalesInvoice', entityId: invoiceId, changes: { status: 'INVOICED' } });
  return updated;
}

// ─── Agent stock placement & consignment settlement ─────────────

export async function createAgentPlacement(
  tx: DbClient,
  input: {
    customerId: string;
    productId: string;
    packagingSizeId?: string | null;
    bags: number;
    quintals: number;
    unitPriceBirr: number;
    notes?: string;
  },
  userId: string,
) {
  const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new AppError(404, 'Customer (agent) not found');
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, 'Product not found');

  const placementNo = await nextDocNo(tx, 'agentStockPlacement', 'placementNo', 'PLACE');
  const placement = await tx.agentStockPlacement.create({
    data: {
      placementNo,
      customerId: customer.id,
      productId: product.id,
      packagingSizeId: input.packagingSizeId ?? null,
      bags: Math.round(input.bags),
      quintals: new Prisma.Decimal(input.quintals),
      unitPriceBirr: new Prisma.Decimal(input.unitPriceBirr),
      status: 'PLACED',
      notes: input.notes ?? null,
      createdById: userId,
    },
  });
  await audit(tx, { userId, action: 'CREATE', entityType: 'AgentStockPlacement', entityId: placement.id, changes: { placementNo, quintals: input.quintals } });
  return placement;
}

export async function settleAgentPlacement(
  tx: DbClient,
  placementId: string,
  input: { bags: number; quintals: number; notes?: string },
  userId: string,
) {
  const placement = await tx.agentStockPlacement.findUnique({
    where: { id: placementId },
    include: { settlements: true },
  });
  if (!placement) throw new AppError(404, 'Placement not found');
  if (['SETTLED', 'RETURNED'].includes(placement.status)) {
    throw new AppError(409, `Placement ${placement.placementNo} is already ${placement.status}`);
  }

  const settledQ = placement.settlements.reduce((s, x) => s.plus(x.quintals), new Prisma.Decimal(0));
  const q = new Prisma.Decimal(input.quintals);
  if (q.lte(0)) throw new AppError(400, 'Quantity must be positive');
  if (settledQ.plus(q).gt(placement.quintals)) {
    throw new AppError(409, `Settlement exceeds placed quantity: placed ${placement.quintals.toString()} q`);
  }

  const amount = q.times(placement.unitPriceBirr);
  const settlement = await tx.agentStockSettlement.create({
    data: {
      placementId,
      bags: Math.round(input.bags),
      quintals: q,
      amountBirr: amount,
      settledById: userId,
      notes: input.notes ?? null,
    },
  });

  const fullySettled = settledQ.plus(q).gte(placement.quintals);
  await tx.agentStockPlacement.update({
    where: { id: placementId },
    data: {
      status: fullySettled ? 'SETTLED' : 'PARTIALLY_SETTLED',
      settledAt: fullySettled ? new Date() : null,
    },
  });

  // Revenue recognized at settlement (consignment sale): Dr 1000 cash / Cr 4000 revenue.
  await postJournal(tx, {
    entryDate: new Date(),
    memo: `Agent stock settlement ${placement.placementNo}`,
    module: 'sales',
    referenceType: 'AgentStockSettlement',
    referenceId: settlement.id,
    createdById: userId,
    lines: [
      { accountCode: '1000', debit: amount, credit: 0 },
      { accountCode: '4000', debit: 0, credit: amount },
    ],
  });

  await audit(tx, { userId, action: 'SETTLE', entityType: 'AgentStockPlacement', entityId: placementId, changes: { quintals: q.toNumber(), amountBirr: amount.toNumber() } });
  return settlement;
}

// ─── Cash reconciliation ────────────────────────────────────────

export async function createCashReconciliation(
  tx: DbClient,
  input: { reconDate: Date; expectedBirr?: number; collectedBirr: number; notes?: string; depositRef?: string },
  userId: string,
): Promise<CashReconciliation> {
  const day = new Date(input.reconDate);
  day.setHours(0, 0, 0, 0);
  const exists = await tx.cashReconciliation.findUnique({ where: { reconDate: day } });
  if (exists) throw new AppError(409, 'A reconciliation already exists for this date');

  let expected = input.expectedBirr !== undefined ? new Prisma.Decimal(input.expectedBirr) : null;
  if (!expected) {
    // Expected = cash receipts collected that day + cash-equivalent agent settlements.
    const start = new Date(day);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    const [recAgg, setAgg] = await Promise.all([
      tx.cashReceipt.aggregate({ _sum: { amountBirr: true }, where: { receivedAt: { gte: start, lt: end } } }),
      tx.agentStockSettlement.aggregate({ _sum: { amountBirr: true }, where: { settledAt: { gte: start, lt: end } } }),
    ]);
    expected = (recAgg._sum.amountBirr ?? new Prisma.Decimal(0)).plus(setAgg._sum.amountBirr ?? new Prisma.Decimal(0));
  }

  const collected = new Prisma.Decimal(input.collectedBirr);
  const variance = collected.minus(expected);
  const recon = await tx.cashReconciliation.create({
    data: {
      reconDate: day,
      expectedBirr: expected,
      collectedBirr: collected,
      varianceBirr: variance,
      status: variance.isZero() ? 'BALANCED' : 'VARIANCE_OPEN',
      notes: input.notes ?? null,
      depositRef: input.depositRef ?? null,
      reconciledById: userId,
    },
  });
  await audit(tx, { userId, action: 'CREATE', entityType: 'CashReconciliation', entityId: recon.id, changes: { variance: variance.toNumber() } });
  return recon;
}

export async function resolveCashReconciliation(tx: DbClient, reconId: string, notes: string | undefined, userId: string): Promise<CashReconciliation> {
  const recon = await tx.cashReconciliation.findUnique({ where: { id: reconId } });
  if (!recon) throw new AppError(404, 'Reconciliation not found');
  if (recon.status !== 'VARIANCE_OPEN') throw new AppError(409, `Reconciliation is ${recon.status}`);
  const updated = await tx.cashReconciliation.update({
    where: { id: reconId },
    data: { status: 'RESOLVED', notes: notes ?? recon.notes },
  });
  await audit(tx, { userId, action: 'RESOLVE', entityType: 'CashReconciliation', entityId: reconId, changes: { notes: notes ?? null } });
  return updated;
}

export async function recordDeposit(tx: DbClient, reconId: string, depositRef: string, userId: string): Promise<CashReconciliation> {
  const recon = await tx.cashReconciliation.findUnique({ where: { id: reconId } });
  if (!recon) throw new AppError(404, 'Reconciliation not found');
  const updated = await tx.cashReconciliation.update({
    where: { id: reconId },
    data: { depositRef, depositedAt: new Date() },
  });
  await audit(tx, { userId, action: 'DEPOSIT', entityType: 'CashReconciliation', entityId: reconId, changes: { depositRef } });
  return updated;
}

// ─── Sales & distribution reports ───────────────────────────────

function rangeOf(from?: Date, to?: Date): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = from;
  if (to) r.lte = to;
  return r;
}

export async function salesSummaryReport(tx: DbClient, from?: Date, to?: Date) {
  const dateRange = rangeOf(from, to);
  const [byProduct, byCustomer, byMonth, byPack] = await Promise.all([
    tx.dispatchLine.groupBy({
      by: ['productId'],
      where: { dispatch: { dispatchedAt: dateRange } },
      _sum: { quintals: true, bags: true },
    }),
    tx.dispatch.groupBy({
      by: ['area'],
      where: { dispatchedAt: dateRange },
      _count: { _all: true },
    }),
    tx.salesInvoice.groupBy({
      by: ['status'],
      where: { createdAt: dateRange },
      _sum: { amountBirr: true },
      _count: { _all: true },
    }),
    tx.dispatchLine.groupBy({
      by: ['packagingSizeId'],
      where: { dispatch: { dispatchedAt: dateRange } },
      _sum: { bags: true },
    }),
  ]);

  const productIds = [...new Set(byProduct.map((g) => g.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const productName = new Map(products.map((p) => [p.id, p.name]));

  const packs = await tx.packagingSize.findMany({ select: { id: true, label: true } });
  const packLabel = new Map(packs.map((p) => [p.id, p.label]));

  // Orders by customer (value) — for the customer subsection.
  const ordersByCustomer = await tx.salesOrder.groupBy({
    by: ['customerId'],
    where: { orderDate: dateRange, status: { notIn: ['CANCELLED'] } },
    _sum: { quintals: true },
    _count: { _all: true },
  });
  const custIds = [...new Set(ordersByCustomer.map((g) => g.customerId))];
  const custs = await tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } });
  const custName = new Map(custs.map((c) => [c.id, c.name]));

  // Revenue by month from invoiced invoices.
  const invoices = await tx.salesInvoice.findMany({
    where: { status: { in: [RevenueStatus.INVOICED, RevenueStatus.PAID] }, invoicedAt: dateRange },
    select: { amountBirr: true, invoicedAt: true },
  });
  const monthMap = new Map<string, number>();
  for (const inv of invoices) {
    const k = (inv.invoicedAt ?? new Date()).toISOString().slice(0, 7);
    monthMap.set(k, (monthMap.get(k) ?? 0) + inv.amountBirr.toNumber());
  }

  return {
    byProduct: byProduct.map((g) => ({
      productId: g.productId,
      productName: productName.get(g.productId) ?? g.productId,
      quintals: (g._sum.quintals ?? new Prisma.Decimal(0)).toNumber(),
      bags: g._sum.bags ?? 0,
    })),
    byCustomer: ordersByCustomer.map((g) => ({
      customerId: g.customerId,
      customerName: custName.get(g.customerId) ?? g.customerId,
      orders: g._count._all,
      quintals: (g._sum.quintals ?? new Prisma.Decimal(0)).toNumber(),
    })),
    byDestination: byCustomer.map((g) => ({ area: g.area, dispatches: g._count._all })),
    byInvoiceStatus: byMonth.map((g) => ({
      status: g.status,
      count: g._count._all,
      amountBirr: (g._sum.amountBirr ?? new Prisma.Decimal(0)).toNumber(),
    })),
    byPackSize: byPack.map((g) => ({
      packSizeId: g.packagingSizeId,
      label: g.packagingSizeId ? (packLabel.get(g.packagingSizeId) ?? '-') : 'Bulk',
      bags: g._sum.bags ?? 0,
    })),
    revenueByMonth: [...monthMap.entries()]
      .map(([month, amountBirr]) => ({ month, amountBirr }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export async function deliveryPerformanceReport(tx: DbClient, from?: Date, to?: Date) {
  const dateRange = rangeOf(from, to);
  const dispatches = await tx.dispatch.findMany({
    where: { dispatchedAt: dateRange },
    include: { lines: { include: { order: true } }, vehicle: true },
    orderBy: { dispatchedAt: 'desc' },
    take: 500,
  });

  let onTime = 0;
  let late = 0;
  let noDate = 0;
  const rows = dispatches.map((d) => {
    const requested = d.lines.map((l) => l.order?.requestedDate).find(Boolean) ?? null;
    let verdict: 'ON_TIME' | 'LATE' | 'NO_DATE' = 'NO_DATE';
    if (requested) {
      const req = new Date(requested);
      req.setHours(0, 0, 0, 0);
      const dep = new Date(d.dispatchedAt);
      dep.setHours(0, 0, 0, 0);
      verdict = dep <= req ? 'ON_TIME' : 'LATE';
    }
    if (verdict === 'ON_TIME') onTime++;
    else if (verdict === 'LATE') late++;
    else noDate++;

    return {
      id: d.id,
      exitNoteNo: d.exitNoteNo,
      plateNo: d.vehicle?.plateNo ?? null,
      area: d.area,
      dispatchedAt: d.dispatchedAt,
      requestedDate: requested,
      verdict,
      gateStatus: d.gateStatus,
      status: d.status,
      quintals: d.lines.reduce((s, l) => s + l.quintals.toNumber(), 0),
    };
  });

  return {
    totals: { dispatches: dispatches.length, onTime, late, noDate },
    onTimePct: dispatches.length > 0 ? Math.round((onTime / dispatches.length) * 100) : 0,
    rows,
  };
}

export async function agentSettlementReport(tx: DbClient, from?: Date, to?: Date) {
  const dateRange = rangeOf(from, to);
  const placements = await tx.agentStockPlacement.findMany({
    where: { placedAt: dateRange },
    include: { customer: true, product: true, settlements: true },
    orderBy: { placedAt: 'desc' },
  });

  return placements.map((p) => {
    const settledQ = p.settlements.reduce((s, x) => s.plus(x.quintals), new Prisma.Decimal(0));
    const settledAmt = p.settlements.reduce((s, x) => s.plus(x.amountBirr), new Prisma.Decimal(0));
    return {
      id: p.id,
      placementNo: p.placementNo,
      agentName: p.customer.name,
      productName: p.product.name,
      placedQuintals: p.quintals.toNumber(),
      placedBags: p.bags,
      unitPriceBirr: p.unitPriceBirr.toNumber(),
      settledQuintals: settledQ.toNumber(),
      settledAmountBirr: settledAmt.toNumber(),
      outstandingQuintals: p.quintals.minus(settledQ).toNumber(),
      status: p.status,
      placedAt: p.placedAt,
    };
  });
}
