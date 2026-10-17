import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { CAPAStatus, Disposition } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── CAPA ────────────────────────────────────────────────────────

const capaListQuerySchema = z.object({
  status: z.nativeEnum(CAPAStatus).optional(),
  batchId: z.string().min(1).optional(),
});
type CapaListQuery = z.infer<typeof capaListQuerySchema>;

const capaCreateSchema = z.object({
  batchId: z.string().min(1),
  issueDescription: z.string().min(1).max(2000),
  correctionType: z.string().max(200).optional().nullable(),
  correctionDetail: z.string().max(2000).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
});
type CapaCreateInput = z.infer<typeof capaCreateSchema>;

const capaUpdateSchema = z.object({
  issueDescription: z.string().min(1).max(2000).optional(),
  correctionType: z.string().max(200).optional().nullable(),
  correctionDetail: z.string().max(2000).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
  disposition: z.nativeEnum(Disposition).optional().nullable(),
});
type CapaUpdateInput = z.infer<typeof capaUpdateSchema>;

const signoffSchema = z.object({
  role: z.enum(['quality', 'production']),
});
type SignoffInput = z.infer<typeof signoffSchema>;

router.get(
  '/',
  requirePermission('capa:view'),
  validateQuery(capaListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as CapaListQuery;
      const capas = await prisma.cAPA.findMany({
        where: { status: q.status, batchId: q.batchId },
        include: { batch: true },
        orderBy: { dateIdentified: 'desc' },
      });
      res.json(capas);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/',
  requirePermission('capa:manage'),
  validateBody(capaCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as CapaCreateInput;
      const capa = await prisma.$transaction(async (tx) => {
        const batch = await tx.productionBatch.findUnique({ where: { id: b.batchId } });
        if (!batch) throw new AppError(404, 'Production batch not found');
        const capaNo = await nextDocNo(tx, 'capa', 'capaNo', 'CAPA');
        const created = await tx.cAPA.create({
          data: {
            capaNo,
            batchId: b.batchId,
            issueDescription: b.issueDescription,
            correctionType: b.correctionType ?? null,
            correctionDetail: b.correctionDetail ?? null,
            performedBy: b.performedBy ?? null,
            identifiedById: userId,
            status: CAPAStatus.OPEN,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'CAPA',
          entityId: created.id,
          changes: { capaNo, batchId: b.batchId },
        });
        return created;
      });
      res.status(201).json(capa);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const capa = await prisma.cAPA.findUnique({
        where: { id },
        include: { batch: true },
      });
      if (!capa) throw new AppError(404, 'CAPA not found');
      res.json(capa);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/:id',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(capaUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as CapaUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.cAPA.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'CAPA not found');
        if (existing.status === CAPAStatus.CLOSED) throw new AppError(409, 'CAPA is closed');
        const saved = await tx.cAPA.update({
          where: { id },
          data: {
            issueDescription: b.issueDescription,
            correctionType: b.correctionType === undefined ? undefined : (b.correctionType ?? null),
            correctionDetail: b.correctionDetail === undefined ? undefined : (b.correctionDetail ?? null),
            performedBy: b.performedBy === undefined ? undefined : (b.performedBy ?? null),
            disposition: b.disposition === undefined ? undefined : (b.disposition ?? null),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'CAPA',
          entityId: id,
          changes: b,
        });
        return saved;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:id/signoff',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(signoffSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { role } = req.body as SignoffInput;
      const signed = await prisma.$transaction(async (tx) => {
        const existing = await tx.cAPA.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'CAPA not found');
        if (existing.status === CAPAStatus.CLOSED) throw new AppError(409, 'CAPA is closed');
        const now = new Date();
        const saved = await tx.cAPA.update({
          where: { id },
          data:
            role === 'quality'
              ? { qualitySignById: userId, qualitySignedAt: now }
              : { productionSignById: userId, productionSignedAt: now },
        });
        await audit(tx, {
          userId,
          action: 'SIGNOFF',
          entityType: 'CAPA',
          entityId: id,
          changes: { role, signedAt: now.toISOString() },
        });
        return saved;
      });
      res.json(signed);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:id/close',
  requirePermission('capa:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const closed = await prisma.$transaction(async (tx) => {
        const existing = await tx.cAPA.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'CAPA not found');
        if (existing.status === CAPAStatus.CLOSED) throw new AppError(409, 'CAPA is already closed');
        if (
          !existing.qualitySignById ||
          !existing.productionSignById ||
          !existing.disposition ||
          !existing.correctionType
        ) {
          throw new AppError(
            409,
            'CAPA cannot be closed: requires quality sign-off, production sign-off, disposition and correction type',
          );
        }
        const saved = await tx.cAPA.update({
          where: { id },
          data: { status: CAPAStatus.CLOSED, closedAt: new Date() },
        });
        await audit(tx, {
          userId,
          action: 'CLOSE',
          entityType: 'CAPA',
          entityId: id,
          changes: { status: 'CLOSED' },
        });
        return saved;
      });
      res.json(closed);
    } catch (err) {
      next(err);
    }
  },
);
