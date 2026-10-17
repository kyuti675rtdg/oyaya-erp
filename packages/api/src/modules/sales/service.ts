import { Prisma, PieceStage, RevenueStatus } from '@prisma/client';
import type { Dispatch, SalesInvoice } from '@prisma/client';
import type { DbClient } from '../../lib/audit';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';
import { postJournal } from '../finance/service';
import { queueSms } from '../sms/service';

const DEFAULT_FG_LOCATION = 'FG_WH_1';

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export interface DispatchLineInput {
  orderId?: string;
  productId: string;
  batchNo: string;
  packagingSizeId?: string | null;
  bags?: number;
  quintals: number;
}

export interface CreateDispatchInput {
  vehicleId: string;
  area: string;
  orderIds: string[];
  lines: DispatchLineInput[];
  fromLocation?: string;
  loadingCrew?: Array<{ laborer: string; quintals: number }>;
  departureDate?: Date;
}

/**
 * Create a dispatch: validate vehicle/orders/stock, decrement FG stock,
 * create dispatch + lines, upsert the fixed trip rule row, mark orders DISPATCHED,
 * cut a PLACEMENT sales invoice, log piece-rate loading labor, and SMS the customer.
 * Must run inside the caller's transaction.
 */
export async function createDispatch(
  tx: DbClient,
  input: CreateDispatchInput,
  userId: string,
): Promise<Dispatch> {
  const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw new AppError(404, 'Vehicle not found');
  if (!vehicle.isActive) throw new AppError(400, 'Vehicle is not active');

  if (input.orderIds.length === 0) throw new AppError(400, 'orderIds must not be empty');

  const orders = await tx.salesOrder.findMany({ where: { id: { in: input.orderIds } } });
  if (orders.length !== input.orderIds.length) {
    throw new AppError(404, 'One or more sales orders not found');
  }
  const LOADABLE = ['OPEN', 'CONFIRMED', 'PROCESSING', 'LOADING'];
  const notOpen = orders.find((o) => !LOADABLE.includes(o.status));
  if (notOpen) {
    throw new AppError(409, `Sales order ${notOpen.orderNo} is not loadable (status: ${notOpen.status})`);
  }
  const customerId = orders[0].customerId;
  if (orders.some((o) => o.customerId !== customerId)) {
    throw new AppError(400, 'All orders in a dispatch must belong to the same customer');
  }

  const fromLocation = input.fromLocation ?? DEFAULT_FG_LOCATION;

  // Validate stock availability and resolve pricing before writing anything.
  const prepared: Array<{
    line: DispatchLineInput;
    qty: Prisma.Decimal;
    stockId: string;
  }> = [];
  let totalQ = new Prisma.Decimal(0);
  let amountBirr = new Prisma.Decimal(0);

  for (const line of input.lines) {
    if (!line.orderId) throw new AppError(400, 'Each dispatch line requires an orderId');
    const order = orders.find((o) => o.id === line.orderId);
    if (!order) throw new AppError(400, `Order ${line.orderId} is not part of this dispatch`);

    const qty = new Prisma.Decimal(line.quintals);
    const stock = await tx.finishedGoodsStock.findFirst({
      where: {
        productId: line.productId,
        batchNo: line.batchNo,
        packagingSizeId: line.packagingSizeId ?? null,
        locationCode: fromLocation,
      },
    });
    if (!stock) {
      throw new AppError(
        404,
        `Stock not found for product ${line.productId}, batch ${line.batchNo} at ${fromLocation}`,
      );
    }
    if (stock.quintals.lt(qty)) {
      throw new AppError(
        400,
        `Insufficient stock for batch ${line.batchNo}: have ${stock.quintals.toString()} q, need ${qty.toString()} q`,
      );
    }

    prepared.push({ line, qty, stockId: stock.id });
    totalQ = totalQ.plus(qty);
    amountBirr = amountBirr.plus(qty.times(order.priceBirr));
  }

  const exitNoteNo = await nextDocNo(tx, 'dispatch', 'exitNoteNo', 'EXIT');
  const loadingLabor =
    input.loadingCrew && input.loadingCrew.length > 0
      ? input.loadingCrew.map((c) => c.laborer).join(', ')
      : null;

  const dispatch = await tx.dispatch.create({
    data: {
      exitNoteNo,
      vehicleId: vehicle.id,
      area: input.area,
      loadingLabor,
      status: 'DISPATCHED',
      createdById: userId,
    },
  });

  for (const p of prepared) {
    await tx.finishedGoodsStock.update({
      where: { id: p.stockId },
      data: { quintals: { decrement: p.qty } },
    });
    await tx.dispatchLine.create({
      data: {
        dispatchId: dispatch.id,
        orderId: p.line.orderId,
        productId: p.line.productId,
        batchNo: p.line.batchNo,
        packagingSizeId: p.line.packagingSizeId ?? null,
        bags: p.line.bags ?? 0,
        quintals: p.qty,
      },
    });
  }

  // Fixed trip rule: one trip per vehicle + destination area + departure date.
  const depDate = startOfDay(input.departureDate ?? new Date());
  const existingTrip = await tx.trip.findUnique({
    where: {
      vehicleId_area_departureDate: {
        vehicleId: vehicle.id,
        area: input.area,
        departureDate: depDate,
      },
    },
  });
  const trip = existingTrip
    ? await tx.trip.update({
        where: { id: existingTrip.id },
        data: {
          stops: { increment: input.orderIds.length },
          totalQuintals: { increment: totalQ },
        },
      })
    : await tx.trip.create({
        data: {
          vehicleId: vehicle.id,
          area: input.area,
          departureDate: depDate,
          stops: input.orderIds.length,
          totalQuintals: totalQ,
        },
      });
  await tx.dispatch.update({ where: { id: dispatch.id }, data: { tripId: trip.id } });

  await tx.salesOrder.updateMany({
    where: { id: { in: input.orderIds } },
    data: { status: 'DISPATCHED' },
  });

  const invoiceNo = await nextDocNo(tx, 'salesInvoice', 'invoiceNo', 'INV');
  await tx.salesInvoice.create({
    data: {
      invoiceNo,
      dispatchId: dispatch.id,
      customerId,
      amountBirr,
      status: RevenueStatus.PLACEMENT,
    },
  });

  if (input.loadingCrew) {
    for (const crew of input.loadingCrew) {
      await tx.pieceRateLog.create({
        data: {
          stage: PieceStage.TRUCK_LOADING,
          laborer: crew.laborer,
          quintals: new Prisma.Decimal(crew.quintals),
          truckPlate: vehicle.plateNo,
          loggedById: userId,
        },
      });
    }
  }

  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (customer?.phone) {
    await queueSms({
      to: customer.phone,
      message: `[OYAYA ERP] Dispatch ${exitNoteNo} loaded: ${totalQ.toString()} quintals for ${input.area}. Exit note issued.`,
      trigger: 'DISPATCH',
    });
  }

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'Dispatch',
    entityId: dispatch.id,
    changes: {
      exitNoteNo,
      orderIds: input.orderIds,
      totalQuintals: totalQ.toNumber(),
      amountBirr: amountBirr.toNumber(),
    },
  });

  return dispatch;
}

/**
 * Move a dispatch invoice from PLACEMENT to INVOICED and post the
 * AR/revenue journal (Dr 1100 / Cr 4000). Must run inside the caller's transaction.
 */
export async function invoiceDispatch(
  tx: DbClient,
  dispatchId: string,
  amountBirr: Prisma.Decimal | number,
  userId: string,
): Promise<SalesInvoice> {
  const dispatch = await tx.dispatch.findUnique({
    where: { id: dispatchId },
    include: { invoice: true },
  });
  if (!dispatch) throw new AppError(404, 'Dispatch not found');
  const invoice = dispatch.invoice;
  if (!invoice || invoice.status !== RevenueStatus.PLACEMENT) {
    throw new AppError(409, 'Dispatch invoice is not in PLACEMENT status');
  }

  const amount = amountBirr instanceof Prisma.Decimal ? amountBirr : new Prisma.Decimal(amountBirr);

  const updated = await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      status: RevenueStatus.INVOICED,
      invoicedAt: new Date(),
      amountBirr: amount,
    },
  });

  await postJournal(tx, {
    entryDate: new Date(),
    memo: `Sales invoice ${invoice.invoiceNo} - dispatch ${dispatch.exitNoteNo}`,
    module: 'sales',
    referenceType: 'SalesInvoice',
    referenceId: invoice.id,
    createdById: userId,
    lines: [
      { accountCode: '1100', debit: amount, credit: 0 },
      { accountCode: '4000', debit: 0, credit: amount },
    ],
  });

  await audit(tx, {
    userId,
    action: 'POST',
    entityType: 'SalesInvoice',
    entityId: invoice.id,
    changes: { status: 'INVOICED', amountBirr: amount.toNumber() },
  });

  return updated;
}
