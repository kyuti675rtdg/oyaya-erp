import { Router } from 'express';
import { z } from 'zod';
import { Prisma, RevenueStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { postJournal } from '../finance/service';
import { queueSms } from '../sms/service';
import { createDispatch, invoiceDispatch } from './service';

export const router = Router();

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

// ─── Sales orders ───────────────────────────────────────────────

const ordersQuerySchema = z.object({
  customerId: z.string().optional(),
  status: z.string().optional(),
});

const createOrderSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
  quintals: z.number().positive(),
  priceBirr: z.number().positive(),
  requestedDate: z.coerce.date().optional(),
  orderDate: z.coerce.date().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        packagingSizeId: z.string().min(1).nullable().optional(),
        bags: z.number().int().nonnegative(),
        quintals: z.number().positive(),
        priceBirr: z.number().positive(),
      }),
    )
    .optional(),
});

const updateOrderSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    productId: z.string().min(1).optional(),
    quintals: z.number().positive().optional(),
    priceBirr: z.number().positive().optional(),
    requestedDate: z.coerce.date().nullable().optional(),
    orderDate: z.coerce.date().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field must be provided' });

router.get(
  '/orders',
  requirePermission('sales:view'),
  validateQuery(ordersQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof ordersQuerySchema>;
      const rows = await prisma.salesOrder.findMany({
        where: { customerId: q.customerId, status: q.status },
        include: {
          customer: true,
          lines: { include: { product: true, packagingSize: true } },
        },
        orderBy: { orderDate: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/orders',
  requirePermission('sales:manage'),
  validateBody(createOrderSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createOrderSchema>;
      const order = await prisma.$transaction(async (tx) => {
        const orderNo = await nextDocNo(tx, 'salesOrder', 'orderNo', 'ORD');
        const created = await tx.salesOrder.create({
          data: {
            orderNo,
            customerId: body.customerId,
            productId: body.productId,
            quintals: new Prisma.Decimal(body.quintals),
            priceBirr: new Prisma.Decimal(body.priceBirr),
            requestedDate: body.requestedDate ?? null,
            orderDate: body.orderDate ?? new Date(),
            status: 'DRAFT',
            createdById: uid,
            ...(body.lines && body.lines.length > 0
              ? {
                  lines: {
                    create: body.lines.map((l) => ({
                      productId: l.productId,
                      packagingSizeId: l.packagingSizeId ?? null,
                      bags: l.bags,
                      quintals: new Prisma.Decimal(l.quintals),
                      priceBirr: new Prisma.Decimal(l.priceBirr),
                    })),
                  },
                }
              : {}),
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'SalesOrder',
          entityId: created.id,
          changes: { orderNo, quintals: body.quintals, priceBirr: body.priceBirr },
        });
        return created;
      });
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/orders/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.salesOrder.findUnique({
        where: { id: req.params.id },
        include: { customer: true, dispatchLines: true },
      });
      if (!row) throw new AppError(404, 'Sales order not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/orders/:id',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(updateOrderSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof updateOrderSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.salesOrder.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new AppError(404, 'Sales order not found');
        if (!['DRAFT', 'OPEN'].includes(existing.status)) {
          throw new AppError(409, `Sales order ${existing.orderNo} is ${existing.status} and cannot be edited`);
        }
        const updated = await tx.salesOrder.update({
          where: { id: req.params.id },
          data: {
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.productId !== undefined ? { productId: body.productId } : {}),
            ...(body.quintals !== undefined ? { quintals: new Prisma.Decimal(body.quintals) } : {}),
            ...(body.priceBirr !== undefined ? { priceBirr: new Prisma.Decimal(body.priceBirr) } : {}),
            ...(body.requestedDate !== undefined ? { requestedDate: body.requestedDate } : {}),
            ...(body.orderDate !== undefined ? { orderDate: body.orderDate } : {}),
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'UPDATE',
          entityType: 'SalesOrder',
          entityId: updated.id,
          changes: body,
        });
        return updated;
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Advance payments ───────────────────────────────────────────

const advancesQuerySchema = z.object({ customerId: z.string().optional() });

const createAdvanceSchema = z.object({
  customerId: z.string().min(1),
  amountBirr: z.number().positive(),
});

router.get(
  '/advances',
  requirePermission('sales:view'),
  validateQuery(advancesQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof advancesQuerySchema>;
      const rows = await prisma.advancePayment.findMany({
        where: { customerId: q.customerId },
        orderBy: { paidAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/advances',
  requirePermission('sales:manage'),
  validateBody(createAdvanceSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createAdvanceSchema>;
      const advance = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!customer) throw new AppError(404, 'Customer not found');

        const created = await tx.advancePayment.create({
          data: {
            customerId: customer.id,
            amountBirr: new Prisma.Decimal(body.amountBirr),
            receivedById: uid,
          },
        });

        if (customer.phone) {
          await queueSms({
            to: customer.phone,
            message: `[OYAYA ERP] Advance of ${body.amountBirr} ETB received. Thank you.`,
            trigger: 'ADVANCE_RECEIVED',
          });
        }

        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'AdvancePayment',
          entityId: created.id,
          changes: { customerId: customer.id, amountBirr: body.amountBirr },
        });
        return created;
      });
      res.status(201).json(advance);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Dispatches ─────────────────────────────────────────────────

const createDispatchSchema = z.object({
  vehicleId: z.string().min(1),
  area: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1),
  lines: z
    .array(
      z.object({
        orderId: z.string().min(1).optional(),
        productId: z.string().min(1),
        batchNo: z.string().min(1),
        packagingSizeId: z.string().min(1).nullable().optional(),
        bags: z.number().int().nonnegative().optional(),
        quintals: z.number().positive(),
      }),
    )
    .min(1),
  fromLocation: z.string().min(1).optional(),
  loadingCrew: z
    .array(z.object({ laborer: z.string().min(1), quintals: z.number().positive() }))
    .optional(),
  departureDate: z.coerce.date().optional(),
});

const invoiceDispatchSchema = z.object({ amountBirr: z.number().positive() });

router.get(
  '/dispatches',
  requirePermission('sales:view'),
  validateQuery(dateRangeQuery),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof dateRangeQuery>;
      const rows = await prisma.dispatch.findMany({
        where: { dispatchedAt: { gte: q.from, lte: q.to } },
        orderBy: { dispatchedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/dispatches/:id',
  requirePermission('sales:view'),
  validateParams(idParamsSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.dispatch.findUnique({
        where: { id: req.params.id },
        include: {
          lines: { include: { product: true, order: true } },
          invoice: true,
          vehicle: true,
        },
      });
      if (!row) throw new AppError(404, 'Dispatch not found');
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches',
  requirePermission('sales:manage'),
  validateBody(createDispatchSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createDispatchSchema>;
      const dispatch = await prisma.$transaction(async (tx) =>
        createDispatch(
          tx,
          {
            vehicleId: body.vehicleId,
            area: body.area,
            orderIds: body.orderIds,
            lines: body.lines,
            fromLocation: body.fromLocation,
            loadingCrew: body.loadingCrew,
            departureDate: body.departureDate,
          },
          uid,
        ),
      );
      res.status(201).json(dispatch);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches/:id/invoice',
  requirePermission('sales:manage'),
  validateParams(idParamsSchema),
  validateBody(invoiceDispatchSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof invoiceDispatchSchema>;
      const invoice = await prisma.$transaction(async (tx) =>
        invoiceDispatch(tx, req.params.id, body.amountBirr, uid),
      );
      res.json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cash receipts ──────────────────────────────────────────────

const receiptsQuerySchema = z.object({ customerId: z.string().optional() });

const createReceiptSchema = z.object({
  customerId: z.string().min(1),
  invoiceId: z.string().min(1).optional(),
  amountBirr: z.number().positive(),
  settledVia: z.string().min(1).optional(),
});

router.get(
  '/receipts',
  requirePermission('sales:view'),
  validateQuery(receiptsQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof receiptsQuerySchema>;
      const rows = await prisma.cashReceipt.findMany({
        where: { customerId: q.customerId },
        orderBy: { receivedAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/receipts',
  requirePermission('sales:manage'),
  validateBody(createReceiptSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createReceiptSchema>;
      const amount = new Prisma.Decimal(body.amountBirr);

      const receipt = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!customer) throw new AppError(404, 'Customer not found');

        const receiptNo = await nextDocNo(tx, 'cashReceipt', 'receiptNo', 'RCPT');
        const created = await tx.cashReceipt.create({
          data: {
            receiptNo,
            customerId: customer.id,
            invoiceId: body.invoiceId ?? null,
            amountBirr: amount,
            settledVia: body.settledVia ?? null,
            receivedById: uid,
          },
        });

        await postJournal(tx, {
          entryDate: new Date(),
          memo: `Cash receipt ${receiptNo}${body.settledVia ? ` via ${body.settledVia}` : ''}`,
          module: 'sales',
          referenceType: 'CashReceipt',
          referenceId: created.id,
          createdById: uid,
          lines: [
            { accountCode: '1000', debit: amount, credit: 0 },
            { accountCode: '1100', debit: 0, credit: amount },
          ],
        });

        if (body.invoiceId) {
          const invoice = await tx.salesInvoice.findUnique({ where: { id: body.invoiceId } });
          if (!invoice) throw new AppError(404, 'Sales invoice not found');
          const agg = await tx.cashReceipt.aggregate({
            _sum: { amountBirr: true },
            where: { invoiceId: invoice.id },
          });
          const paidSoFar = agg._sum.amountBirr ?? new Prisma.Decimal(0);
          if (paidSoFar.gte(invoice.amountBirr)) {
            await tx.salesInvoice.update({
              where: { id: invoice.id },
              data: { status: RevenueStatus.PAID },
            });
          }
        }

        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'CashReceipt',
          entityId: created.id,
          changes: { receiptNo, amountBirr: body.amountBirr, invoiceId: body.invoiceId ?? null },
        });
        return created;
      });

      res.status(201).json(receipt);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reconciliation gaps ────────────────────────────────────────

router.get('/reconciliation/gaps', requirePermission('sales:view'), async (_req, res, next) => {
  try {
    const [invGroups, recGroups, advGroups] = await Promise.all([
      prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: { status: { in: [RevenueStatus.INVOICED, RevenueStatus.PAID] } },
        _sum: { amountBirr: true },
      }),
      prisma.cashReceipt.groupBy({
        by: ['customerId'],
        _sum: { amountBirr: true },
      }),
      prisma.advancePayment.groupBy({
        by: ['customerId'],
        _sum: { amountBirr: true },
      }),
    ]);

    const toDec = (v: Prisma.Decimal | null): Prisma.Decimal => v ?? new Prisma.Decimal(0);
    const invoicedBy = new Map(invGroups.map((g) => [g.customerId, toDec(g._sum.amountBirr)]));
    const receivedBy = new Map(recGroups.map((g) => [g.customerId, toDec(g._sum.amountBirr)]));
    const advancesBy = new Map(advGroups.map((g) => [g.customerId, toDec(g._sum.amountBirr)]));

    const customerIds = [...new Set([...invoicedBy.keys(), ...receivedBy.keys(), ...advancesBy.keys()])];
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(customers.map((c) => [c.id, c.name]));

    let totalInvoiced = new Prisma.Decimal(0);
    let totalReceived = new Prisma.Decimal(0);
    let totalGap = new Prisma.Decimal(0);

    const rows = customerIds.map((customerId) => {
      const invoiced = invoicedBy.get(customerId) ?? new Prisma.Decimal(0);
      const received = receivedBy.get(customerId) ?? new Prisma.Decimal(0);
      const advances = advancesBy.get(customerId) ?? new Prisma.Decimal(0);
      const gap = invoiced.minus(received);
      const outstanding = gap.minus(advances);

      totalInvoiced = totalInvoiced.plus(invoiced);
      totalReceived = totalReceived.plus(received);
      totalGap = totalGap.plus(gap);

      return {
        customerId,
        customerName: nameBy.get(customerId) ?? 'Unknown',
        invoiced: invoiced.toNumber(),
        received: received.toNumber(),
        advances: advances.toNumber(),
        outstanding: outstanding.toNumber(),
        gap: gap.toNumber(),
        flagged: !gap.isZero(),
      };
    });

    res.json({
      rows,
      totals: {
        invoiced: totalInvoiced.toNumber(),
        received: totalReceived.toNumber(),
        gap: totalGap.toNumber(),
      },
    });
  } catch (err) {
    next(err);
  }
});
