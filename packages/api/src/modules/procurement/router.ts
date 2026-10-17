import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma, IntakeStatus, WheatCategory, PieceStage, POStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { requirePermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { recordLabResult, decideIntake, payApInvoice } from './service';

export const router = Router();

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function ah(fn: AsyncFn) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function requireUid(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new AppError(401, 'Unauthenticated');
  return id;
}

const view = requirePermission('procurement:view');
const manage = requirePermission('procurement:manage');
const approve = requirePermission('procurement:approve');

const idParam = z.object({ id: z.string().min(1) });
const LIST_TAKE = 500;

// ─── Wheat intakes ──────────────────────────────────────────────

const intakeQuerySchema = z.object({
  supplierId: z.string().min(1).optional(),
  wheatCategory: z.nativeEnum(WheatCategory).optional(),
  status: z.nativeEnum(IntakeStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const intakeSchema = z.object({
  deliveryDate: z.coerce.date().optional(),
  supplierId: z.string().min(1),
  truckPlate: z.string().min(1),
  wheatCategory: z.nativeEnum(WheatCategory),
  wheatOrigin: z.string().optional(),
  bagCount: z.number().int().positive(),
  purchaseOrderId: z.string().min(1).optional(),
  grossKg: z.number().positive().optional(),
  tareKg: z.number().positive().optional(),
  moistureQuick: z.number().min(0).optional(),
});

const updateIntakeSchema = z.object({
  deliveryDate: z.coerce.date().optional(),
  supplierId: z.string().min(1).optional(),
  truckPlate: z.string().min(1).optional(),
  wheatCategory: z.nativeEnum(WheatCategory).optional(),
  wheatOrigin: z.string().optional().nullable(),
  bagCount: z.number().int().positive().optional(),
});

const labSchema = z.object({
  glutenPct: z.number().min(0),
  moisturePct: z.number().min(0),
  impurityPct: z.number().min(0),
  hectoliterPct: z.number().min(0),
  germinationPct: z.number().min(0),
});

const decisionSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT', 'CONDITIONAL']),
  note: z.string().optional(),
  pricePerQuintalBirr: z.number().positive().optional(),
  returnNote: z.string().optional(),
  granaryDumping: z
    .array(z.object({ laborer: z.string().min(1), quintals: z.number().positive() }))
    .optional(),
});

const unloadingSchema = z.object({
  laborer: z.string().min(1),
  quintals: z.number().positive(),
  truckPlate: z.string().min(1).optional(),
});

router.get(
  '/intakes',
  view,
  validateQuery(intakeQuerySchema),
  ah(async (req, res) => {
    const q = intakeQuerySchema.parse(req.query);
    const where: Prisma.WheatIntakeWhereInput = {
      supplierId: q.supplierId,
      wheatCategory: q.wheatCategory,
      status: q.status,
      deliveryDate:
        q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    res.json(
      await prisma.wheatIntake.findMany({
        where,
        include: { supplier: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

router.post(
  '/intakes',
  manage,
  validateBody(intakeSchema),
  ah(async (req, res) => {
    const body = intakeSchema.parse(req.body);
    const uid = requireUid(req);
    const intake = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier) throw new AppError(404, 'Supplier not found');
      let po: { id: string; status: POStatus; wheatCategory: WheatCategory } | null = null;
      if (body.purchaseOrderId) {
        po = await tx.purchaseOrder.findUnique({ where: { id: body.purchaseOrderId } });
        if (!po) throw new AppError(404, 'Purchase order not found');
        if (po.status !== POStatus.APPROVED && po.status !== POStatus.PARTIALLY_RECEIVED) {
          throw new AppError(409, 'Intakes can only be linked to approved purchase orders');
        }
      }
      const netKg =
        body.grossKg !== undefined && body.tareKg !== undefined
          ? new Prisma.Decimal(body.grossKg).minus(body.tareKg)
          : null;
      const created = await tx.wheatIntake.create({
        data: {
          intakeNo: await nextDocNo(tx, 'wheatIntake', 'intakeNo', 'INT'),
          deliveryDate: body.deliveryDate ?? new Date(),
          supplierId: body.supplierId,
          truckPlate: body.truckPlate,
          wheatCategory: body.wheatCategory,
          wheatOrigin: body.wheatOrigin,
          bagCount: body.bagCount,
          quintals: new Prisma.Decimal(body.bagCount), // 1 bag = 1 quintal
          purchaseOrderId: po?.id ?? null,
          grossKg: body.grossKg !== undefined ? new Prisma.Decimal(body.grossKg) : null,
          tareKg: body.tareKg !== undefined ? new Prisma.Decimal(body.tareKg) : null,
          netKg,
          moistureQuick: body.moistureQuick !== undefined ? new Prisma.Decimal(body.moistureQuick) : null,
          status: IntakeStatus.PENDING_LAB,
          createdById: uid,
        },
        include: { supplier: true, purchaseOrder: true },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'WheatIntake', entityId: created.id });
      return created;
    });
    res.status(201).json(intake);
  }),
);

router.get(
  '/intakes/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const intake = await prisma.wheatIntake.findUnique({
      where: { id },
      include: { supplier: true, unloadingLabor: true, apInvoice: true },
    });
    if (!intake) throw new AppError(404, 'Intake not found');
    res.json(intake);
  }),
);

// Edits allowed only before the lab gate runs.
router.put(
  '/intakes/:id',
  manage,
  validateParams(idParam),
  validateBody(updateIntakeSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateIntakeSchema.parse(req.body);
    const uid = requireUid(req);
    const intake = await prisma.$transaction(async (tx) => {
      const existing = await tx.wheatIntake.findUnique({ where: { id } });
      if (!existing) throw new AppError(404, 'Intake not found');
      if (existing.status !== IntakeStatus.PENDING_LAB) {
        throw new AppError(409, 'Intake can only be edited while pending lab');
      }
      if (body.supplierId) {
        const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
        if (!supplier) throw new AppError(404, 'Supplier not found');
      }
      const updated = await tx.wheatIntake.update({
        where: { id },
        data: {
          deliveryDate: body.deliveryDate,
          supplierId: body.supplierId,
          truckPlate: body.truckPlate,
          wheatCategory: body.wheatCategory,
          wheatOrigin: body.wheatOrigin,
          bagCount: body.bagCount,
          quintals: body.bagCount === undefined ? undefined : new Prisma.Decimal(body.bagCount),
        },
        include: { supplier: true },
      });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'WheatIntake', entityId: id, changes: body });
      return updated;
    });
    res.json(intake);
  }),
);

router.post(
  '/intakes/:id/lab',
  manage,
  validateParams(idParam),
  validateBody(labSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = labSchema.parse(req.body);
    const uid = requireUid(req);
    const intake = await prisma.$transaction(async (tx) =>
      recordLabResult(tx, id, body, uid),
    );
    res.json(intake);
  }),
);

router.post(
  '/intakes/:id/decision',
  approve,
  validateParams(idParam),
  validateBody(decisionSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = decisionSchema.parse(req.body);
    const uid = requireUid(req);
    const intake = await prisma.$transaction(async (tx) =>
      decideIntake(tx, id, body, uid),
    );
    res.json(intake);
  }),
);

router.post(
  '/intakes/:id/unloading',
  manage,
  validateParams(idParam),
  validateBody(unloadingSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = unloadingSchema.parse(req.body);
    const uid = requireUid(req);
    const result = await prisma.$transaction(async (tx) => {
      const intake = await tx.wheatIntake.findUnique({ where: { id } });
      if (!intake) throw new AppError(404, 'Intake not found');
      const quintals = new Prisma.Decimal(body.quintals);
      const truckPlate = body.truckPlate ?? intake.truckPlate;
      const labor = await tx.unloadingLabor.create({
        data: { intakeId: id, laborer: body.laborer, quintals, truckPlate, loggedById: uid },
      });
      await tx.pieceRateLog.create({
        data: {
          stage: PieceStage.UNLOADING,
          laborer: body.laborer,
          quintals,
          truckPlate,
          loggedById: uid,
        },
      });
      await audit(tx, {
        userId: uid,
        action: 'CREATE',
        entityType: 'UnloadingLabor',
        entityId: labor.id,
        changes: { intakeId: id, laborer: body.laborer, quintals: body.quintals },
      });
      return labor;
    });
    res.status(201).json(result);
  }),
);

// ─── Purchase Orders ────────────────────────────────────────────

const poQuerySchema = z.object({
  supplierId: z.string().min(1).optional(),
  status: z.nativeEnum(POStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const poCreateSchema = z.object({
  supplierId: z.string().min(1),
  wheatCategory: z.nativeEnum(WheatCategory),
  quantityQ: z.number().positive(),
  pricePerQBirr: z.number().positive(),
  deliveryDate: z.coerce.date().optional(),
  terms: z.string().optional(),
});

const poUpdateSchema = z.object({
  wheatCategory: z.nativeEnum(WheatCategory).optional(),
  quantityQ: z.number().positive().optional(),
  pricePerQBirr: z.number().positive().optional(),
  deliveryDate: z.coerce.date().nullable().optional(),
  terms: z.string().nullable().optional(),
});

const poCancelSchema = z.object({
  reason: z.string().min(1),
});

router.get(
  '/purchase-orders',
  view,
  validateQuery(poQuerySchema),
  ah(async (req, res) => {
    const q = poQuerySchema.parse(req.query);
    res.json(
      await prisma.purchaseOrder.findMany({
        where: {
          supplierId: q.supplierId,
          status: q.status,
          createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
        },
        include: { supplier: true, _count: { select: { intakes: true } } },
        orderBy: { createdAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

router.post(
  '/purchase-orders',
  manage,
  validateBody(poCreateSchema),
  ah(async (req, res) => {
    const body = poCreateSchema.parse(req.body);
    const uid = requireUid(req);
    const po = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier) throw new AppError(404, 'Supplier not found');
      if (!supplier.isActive) throw new AppError(409, 'Supplier is inactive');
      const qty = new Prisma.Decimal(body.quantityQ);
      const price = new Prisma.Decimal(body.pricePerQBirr);
      const created = await tx.purchaseOrder.create({
        data: {
          poNo: await nextDocNo(tx, 'purchaseOrder', 'poNo', 'PO'),
          supplierId: body.supplierId,
          wheatCategory: body.wheatCategory,
          quantityQ: qty,
          pricePerQBirr: price,
          totalBirr: qty.times(price),
          deliveryDate: body.deliveryDate,
          terms: body.terms,
          status: POStatus.DRAFT,
          createdById: uid,
        },
        include: { supplier: true },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'PurchaseOrder', entityId: created.id });
      return created;
    });
    res.status(201).json(po);
  }),
);

router.get(
  '/purchase-orders/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, intakes: { include: { supplier: true }, orderBy: { deliveryDate: 'desc' } } },
    });
    if (!po) throw new AppError(404, 'Purchase order not found');
    res.json(po);
  }),
);

router.put(
  '/purchase-orders/:id',
  manage,
  validateParams(idParam),
  validateBody(poUpdateSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = poUpdateSchema.parse(req.body);
    const uid = requireUid(req);
    const po = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new AppError(404, 'Purchase order not found');
      if (existing.status !== POStatus.DRAFT) {
        throw new AppError(409, 'Only draft purchase orders can be edited');
      }
      const qty = body.quantityQ !== undefined ? new Prisma.Decimal(body.quantityQ) : existing.quantityQ;
      const price = body.pricePerQBirr !== undefined ? new Prisma.Decimal(body.pricePerQBirr) : existing.pricePerQBirr;
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          wheatCategory: body.wheatCategory,
          quantityQ: body.quantityQ === undefined ? undefined : qty,
          pricePerQBirr: body.pricePerQBirr === undefined ? undefined : price,
          totalBirr: qty.times(price),
          deliveryDate: body.deliveryDate,
          terms: body.terms,
        },
        include: { supplier: true },
      });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'PurchaseOrder', entityId: id, changes: body });
      return updated;
    });
    res.json(po);
  }),
);

router.post(
  '/purchase-orders/:id/approve',
  approve,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    const po = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new AppError(404, 'Purchase order not found');
      if (existing.status !== POStatus.DRAFT) {
        throw new AppError(409, 'Only draft purchase orders can be approved');
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: POStatus.APPROVED, approvedById: uid, approvedAt: new Date() },
        include: { supplier: true },
      });
      await audit(tx, { userId: uid, action: 'APPROVE', entityType: 'PurchaseOrder', entityId: id });
      return updated;
    });
    res.json(po);
  }),
);

router.post(
  '/purchase-orders/:id/cancel',
  approve,
  validateParams(idParam),
  validateBody(poCancelSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = poCancelSchema.parse(req.body);
    const uid = requireUid(req);
    const po = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new AppError(404, 'Purchase order not found');
      if (existing.status === POStatus.COMPLETED || existing.status === POStatus.CANCELLED) {
        throw new AppError(409, 'Completed or cancelled purchase orders cannot be cancelled');
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: POStatus.CANCELLED,
          cancelledById: uid,
          cancelledAt: new Date(),
          cancelReason: body.reason,
        },
        include: { supplier: true },
      });
      await audit(tx, { userId: uid, action: 'CANCEL', entityType: 'PurchaseOrder', entityId: id, changes: { reason: body.reason } });
      return updated;
    });
    res.json(po);
  }),
);

// ─── AP invoices ────────────────────────────────────────────────

const apInvoiceQuerySchema = z.object({
  status: z.string().min(1).optional(),
});

const paySchema = z.object({
  amountBirr: z.number().positive(),
  method: z.enum(['BANK_TRANSFER', 'CHEQUE']),
  reference: z.string().optional(),
});

router.get(
  '/ap-invoices',
  view,
  validateQuery(apInvoiceQuerySchema),
  ah(async (req, res) => {
    const q = apInvoiceQuerySchema.parse(req.query);
    res.json(
      await prisma.aPInvoice.findMany({
        where: q.status ? { status: q.status } : undefined,
        include: { intake: { include: { supplier: true } }, payments: true },
        orderBy: { issuedAt: 'desc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

router.get(
  '/ap-invoices/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const invoice = await prisma.aPInvoice.findUnique({
      where: { id },
      include: { intake: { include: { supplier: true } }, payments: true },
    });
    if (!invoice) throw new AppError(404, 'AP invoice not found');
    res.json(invoice);
  }),
);

router.post(
  '/ap-invoices/:id/pay',
  manage,
  validateParams(idParam),
  validateBody(paySchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = paySchema.parse(req.body);
    const uid = requireUid(req);
    const payment = await prisma.$transaction(async (tx) =>
      payApInvoice(tx, id, body, uid),
    );
    res.status(201).json(payment);
  }),
);
