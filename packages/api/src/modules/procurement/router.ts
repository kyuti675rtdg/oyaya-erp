import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma, IntakeStatus, WheatCategory, PieceStage } from '@prisma/client';
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
  decision: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().optional(),
  pricePerQuintalBirr: z.number().positive().optional(),
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
          status: IntakeStatus.PENDING_LAB,
          createdById: uid,
        },
        include: { supplier: true },
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
