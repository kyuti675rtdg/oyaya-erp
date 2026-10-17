import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CAPAStatus,
  Disposition,
  NcActionStatus,
  NcActionType,
  NcDecision,
  NcSeverity,
  NcSignoffKind,
  NcSignoffStatus,
  NcSource,
  NcStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import type { DbClient } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { ageInDays, getNc, getOpenNc, isActionOverdue, nextNcDocNo } from './service';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── Nonconformity & Defect Register (Module 6 expansion) ───────────────
// NOTE: all /nc, /signoffs, /actions/:id and /reports/* routes are registered
// before the legacy '/:id' CAPA routes so single-segment paths can't shadow them.

const ncListQuerySchema = z.object({
  status: z.nativeEnum(NcStatus).optional(),
  severity: z.nativeEnum(NcSeverity).optional(),
  source: z.nativeEnum(NcSource).optional(),
});
type NcListQuery = z.infer<typeof ncListQuerySchema>;

const ncCreateSchema = z.object({
  source: z.nativeEnum(NcSource),
  batchId: z.string().min(1).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  description: z.string().min(1).max(4000),
  severity: z.nativeEnum(NcSeverity),
  detectedBy: z.string().max(200).optional().nullable(),
});
type NcCreateInput = z.infer<typeof ncCreateSchema>;

const ncUpdateSchema = z.object({
  description: z.string().min(1).max(4000).optional(),
  severity: z.nativeEnum(NcSeverity).optional(),
  source: z.nativeEnum(NcSource).optional(),
  batchId: z.string().min(1).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  detectedBy: z.string().max(200).nullable().optional(),
  status: z.enum(['OPEN', 'UNDER_REVIEW']).optional(),
});
type NcUpdateInput = z.infer<typeof ncUpdateSchema>;

router.get(
  '/nc',
  requirePermission('capa:view'),
  validateQuery(ncListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as NcListQuery;
      const list = await prisma.nonconformity.findMany({
        where: { status: q.status, severity: q.severity, source: q.source },
        include: {
          batch: { select: { batchNo: true } },
          linkedCapa: { select: { capaNo: true } },
          disposition: { select: { decision: true } },
          _count: { select: { actions: true, signoffs: true } },
        },
        orderBy: { dateDetected: 'desc' },
      });
      res.json(list);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nc',
  requirePermission('capa:manage'),
  validateBody(ncCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as NcCreateInput;
      const nc = await prisma.$transaction(async (tx) => {
        if (b.batchId) {
          const batch = await tx.productionBatch.findUnique({ where: { id: b.batchId } });
          if (!batch) throw new AppError(404, 'Production batch not found');
        }
        const ncNo = await nextNcDocNo(tx, 'nonconformity');
        const created = await tx.nonconformity.create({
          data: {
            ncNo,
            source: b.source,
            batchId: b.batchId ?? null,
            reference: b.reference ?? null,
            description: b.description,
            severity: b.severity,
            detectedBy: b.detectedBy ?? null,
            detectedById: userId,
            status: NcStatus.OPEN,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'Nonconformity',
          entityId: created.id,
          changes: { ncNo, source: b.source, severity: b.severity },
        });
        return created;
      });
      res.status(201).json(nc);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/nc/:id',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const nc = await getNc(prisma, id);
      res.json(nc);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/nc/:id',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(ncUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as NcUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        await getOpenNc(tx, id);
        if (b.batchId) {
          const batch = await tx.productionBatch.findUnique({ where: { id: b.batchId } });
          if (!batch) throw new AppError(404, 'Production batch not found');
        }
        const saved = await tx.nonconformity.update({
          where: { id },
          data: {
            description: b.description,
            severity: b.severity,
            source: b.source,
            batchId: b.batchId === undefined ? undefined : b.batchId,
            reference: b.reference === undefined ? undefined : b.reference,
            detectedBy: b.detectedBy === undefined ? undefined : b.detectedBy,
            status:
              b.status === undefined
                ? undefined
                : b.status === 'OPEN'
                  ? NcStatus.OPEN
                  : NcStatus.UNDER_REVIEW,
          },
          include: {
            batch: { select: { batchNo: true } },
            linkedCapa: { select: { capaNo: true } },
            disposition: { select: { decision: true } },
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'Nonconformity',
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
  '/nc/:id/link-capa',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const result = await prisma.$transaction(async (tx) => {
        const nc = await getOpenNc(tx, id);
        if (nc.linkedCapaId) throw new AppError(409, 'Nonconformity is already linked to a CAPA');
        if (!nc.batchId) throw new AppError(409, 'A linked CAPA requires an affected batch');
        const capaNo = await nextDocNo(tx, 'capa', 'capaNo', 'CAPA');
        const capa = await tx.cAPA.create({
          data: {
            capaNo,
            batchId: nc.batchId,
            issueDescription: `[${nc.ncNo}] ${nc.description}`,
            performedBy: nc.detectedBy ?? null,
            identifiedById: userId,
            disposition:
              nc.disposition?.decision === 'RECYCLE_FEED' ? Disposition.FULLY_RECYCLED : null,
            status: CAPAStatus.OPEN,
          },
        });
        const updatedNc = await tx.nonconformity.update({
          where: { id },
          data: { linkedCapaId: capa.id, status: NcStatus.UNDER_REVIEW },
        });
        await audit(tx, {
          userId,
          action: 'LINK_CAPA',
          entityType: 'Nonconformity',
          entityId: id,
          changes: { capaId: capa.id, capaNo },
        });
        return { nc: updatedNc, capa };
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nc/:id/close',
  requirePermission('capa:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const closed = await prisma.$transaction(async (tx) => {
        const nc = await getOpenNc(tx, id);
        if (!nc.rootCause) throw new AppError(409, 'Close blocked: root cause analysis is missing');
        if (!nc.disposition) throw new AppError(409, 'Close blocked: product disposition is missing');
        const closureSignoff = nc.signoffs.find(
          (s) => s.kind === NcSignoffKind.CLOSURE && s.status === NcSignoffStatus.COMPLETED,
        );
        if (!closureSignoff) {
          throw new AppError(409, 'Close blocked: completed dual sign-off is missing');
        }
        const saved = await tx.nonconformity.update({
          where: { id },
          data: { status: NcStatus.CLOSED, closedAt: new Date() },
        });
        await audit(tx, {
          userId,
          action: 'CLOSE',
          entityType: 'Nonconformity',
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

// ─── Root Cause Analysis ─────────────────────────────────────────────

const rootCauseSchema = z.object({
  fiveWhys: z.array(z.string().max(500)).max(10).default([]),
  fishbone: z.record(z.string().max(500)).default({}),
  rootCause: z.string().max(2000).optional().nullable(),
  analyst: z.string().max(200).optional().nullable(),
});
type RootCauseInput = z.infer<typeof rootCauseSchema>;

router.get(
  '/nc/:id/root-cause',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const nc = await getNc(prisma, id);
      res.json(nc.rootCause);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/nc/:id/root-cause',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(rootCauseSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as RootCauseInput;
      const saved = await prisma.$transaction(async (tx) => {
        await getOpenNc(tx, id);
        const rc = await tx.ncRootCause.upsert({
          where: { ncId: id },
          create: {
            ncId: id,
            fiveWhys: b.fiveWhys,
            fishbone: b.fishbone,
            rootCause: b.rootCause ?? null,
            analyst: b.analyst ?? null,
          },
          update: {
            fiveWhys: b.fiveWhys,
            fishbone: b.fishbone,
            rootCause: b.rootCause ?? null,
            analyst: b.analyst ?? null,
            analysisDate: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'UPSERT',
          entityType: 'NcRootCause',
          entityId: rc.id,
          changes: { ncId: id },
        });
        return rc;
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Corrective & Preventive Actions ─────────────────────────────────

const ncActionCreateSchema = z.object({
  actionType: z.nativeEnum(NcActionType),
  description: z.string().min(1).max(2000),
  owner: z.string().min(1).max(200),
  dueDate: z.coerce.date(),
});
type NcActionCreateInput = z.infer<typeof ncActionCreateSchema>;

const ncActionUpdateSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  owner: z.string().min(1).max(200).optional(),
  dueDate: z.coerce.date().optional(),
  status: z.nativeEnum(NcActionStatus).optional(),
});
type NcActionUpdateInput = z.infer<typeof ncActionUpdateSchema>;

async function createAction(
  tx: DbClient,
  userId: string,
  b: NcActionCreateInput,
  link: { ncId?: string; capaId?: string },
) {
  if (link.ncId) await getOpenNc(tx, link.ncId);
  if (link.capaId) {
    const capa = await tx.cAPA.findUnique({ where: { id: link.capaId } });
    if (!capa) throw new AppError(404, 'CAPA not found');
    if (capa.status === CAPAStatus.CLOSED) throw new AppError(409, 'CAPA is closed');
  }
  const created = await tx.ncAction.create({
    data: {
      ncId: link.ncId ?? null,
      capaId: link.capaId ?? null,
      actionType: b.actionType,
      description: b.description,
      owner: b.owner,
      dueDate: b.dueDate,
      status: NcActionStatus.PLANNED,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'NcAction',
    entityId: created.id,
    changes: { ...link, actionType: b.actionType, owner: b.owner },
  });
  return created;
}

router.get(
  '/nc/:id/actions',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      await getNc(prisma, id);
      const actions = await prisma.ncAction.findMany({
        where: { ncId: id },
        orderBy: { dueDate: 'asc' },
      });
      res.json(actions);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nc/:id/actions',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(ncActionCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as NcActionCreateInput;
      const created = await prisma.$transaction((tx) => createAction(tx, userId, b, { ncId: id }));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

// CAPA-level actions (powers the Actions tab added to the Capa page).
router.get(
  '/:id/actions',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const capa = await prisma.cAPA.findUnique({ where: { id } });
      if (!capa) throw new AppError(404, 'CAPA not found');
      const actions = await prisma.ncAction.findMany({
        where: { capaId: id },
        orderBy: { dueDate: 'asc' },
      });
      res.json(actions);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:id/actions',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(ncActionCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as NcActionCreateInput;
      const created = await prisma.$transaction((tx) => createAction(tx, userId, b, { capaId: id }));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/actions/:id',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(ncActionUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as NcActionUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.ncAction.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Action not found');
        if (existing.status === NcActionStatus.VERIFIED) {
          throw new AppError(409, 'Verified actions cannot be changed');
        }
        const saved = await tx.ncAction.update({
          where: { id },
          data: {
            description: b.description,
            owner: b.owner,
            dueDate: b.dueDate,
            status: b.status,
            completedAt: b.status === NcActionStatus.COMPLETED ? new Date() : undefined,
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'NcAction',
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
  '/actions/:id/verify',
  requirePermission('capa:approve'),
  validateParams(idParamSchema),
  validateBody(z.object({ verificationResult: z.string().min(1).max(2000) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { verificationResult } = req.body as { verificationResult: string };
      const verified = await prisma.$transaction(async (tx) => {
        const existing = await tx.ncAction.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Action not found');
        if (existing.status !== NcActionStatus.COMPLETED) {
          throw new AppError(409, 'Only completed actions can be verified');
        }
        const saved = await tx.ncAction.update({
          where: { id },
          data: {
            status: NcActionStatus.VERIFIED,
            verificationResult,
            verifiedAt: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'VERIFY',
          entityType: 'NcAction',
          entityId: id,
          changes: { verificationResult },
        });
        return saved;
      });
      res.json(verified);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/actions/:id/effectiveness',
  requirePermission('capa:approve'),
  validateParams(idParamSchema),
  validateBody(
    z.object({
      effectivenessOk: z.boolean(),
      effectivenessNote: z.string().max(2000).optional().nullable(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { effectivenessOk, effectivenessNote } = req.body as {
        effectivenessOk: boolean;
        effectivenessNote?: string | null;
      };
      const saved = await prisma.$transaction(async (tx) => {
        const existing = await tx.ncAction.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Action not found');
        if (existing.status !== NcActionStatus.VERIFIED) {
          throw new AppError(409, 'Effectiveness can only be checked on verified actions');
        }
        const updated = await tx.ncAction.update({
          where: { id },
          data: {
            effectivenessOk,
            effectivenessNote: effectivenessNote ?? null,
            effectivenessAt: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'EFFECTIVENESS_CHECK',
          entityType: 'NcAction',
          entityId: id,
          changes: { effectivenessOk, effectivenessNote },
        });
        return updated;
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Product Disposition & Recycling ─────────────────────────────────

const dispositionSchema = z.object({
  decision: z.nativeEnum(NcDecision),
  quantityQ: z.coerce.number().positive().max(1_000_000),
  approverName: z.string().max(200).optional().nullable(),
});
type DispositionInput = z.infer<typeof dispositionSchema>;

const dispositionExecuteSchema = z.object({
  executedBy: z.string().max(200).optional().nullable(),
  executionNote: z.string().max(2000).optional().nullable(),
});
type DispositionExecuteInput = z.infer<typeof dispositionExecuteSchema>;

router.get(
  '/nc/:id/disposition',
  requirePermission('capa:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const nc = await getNc(prisma, id);
      if (!nc.disposition) throw new AppError(404, 'Disposition not recorded');
      res.json(nc.disposition);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nc/:id/disposition',
  requirePermission('capa:approve'),
  validateParams(idParamSchema),
  validateBody(dispositionSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as DispositionInput;
      const saved = await prisma.$transaction(async (tx) => {
        await getOpenNc(tx, id);
        const disp = await tx.ncDisposition.upsert({
          where: { ncId: id },
          create: {
            ncId: id,
            decision: b.decision,
            quantityQ: b.quantityQ,
            approverName: b.approverName ?? null,
            approvedById: userId,
          },
          update: {
            decision: b.decision,
            quantityQ: b.quantityQ,
            approverName: b.approverName ?? null,
            approvedById: userId,
            approvedAt: new Date(),
          },
        });
        await audit(tx, {
          userId,
          action: 'DISPOSITION',
          entityType: 'NcDisposition',
          entityId: disp.id,
          changes: { ncId: id, decision: b.decision, quantityQ: b.quantityQ },
        });
        return disp;
      });
      res.json(saved);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispositions/:id/execute',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(dispositionExecuteSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as DispositionExecuteInput;
      const executed = await prisma.$transaction(async (tx) => {
        const existing = await tx.ncDisposition.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Disposition not found');
        if (existing.executedAt) throw new AppError(409, 'Disposition already executed');
        const saved = await tx.ncDisposition.update({
          where: { id },
          data: {
            executedAt: new Date(),
            executedBy: b.executedBy ?? null,
            executionNote: b.executionNote ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'EXECUTE',
          entityType: 'NcDisposition',
          entityId: id,
          changes: { executedBy: b.executedBy, executionNote: b.executionNote },
        });
        return saved;
      });
      res.json(executed);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Dual sign-off queue ─────────────────────────────────────────────

const signoffListQuerySchema = z.object({
  status: z.nativeEnum(NcSignoffStatus).optional(),
});
type SignoffListQuery = z.infer<typeof signoffListQuerySchema>;

const signoffRequestSchema = z.object({
  kind: z.nativeEnum(NcSignoffKind),
});

const ncSignoffSignSchema = z.object({
  role: z.enum(['quality', 'production']),
});
type NcSignoffSignInput = z.infer<typeof ncSignoffSignSchema>;

router.get(
  '/signoffs',
  requirePermission('capa:view'),
  validateQuery(signoffListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as SignoffListQuery;
      const queue = await prisma.ncSignoff.findMany({
        where: { status: q.status },
        include: {
          nc: {
            select: {
              ncNo: true,
              description: true,
              severity: true,
              status: true,
              disposition: { select: { decision: true, quantityQ: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(queue);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/nc/:id/signoffs',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(signoffRequestSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { kind } = req.body as { kind: NcSignoffKind };
      const created = await prisma.$transaction(async (tx) => {
        const nc = await getOpenNc(tx, id);
        if (kind === NcSignoffKind.CLOSURE) {
          if (!nc.rootCause) throw new AppError(409, 'Root cause analysis is required first');
          if (!nc.disposition) throw new AppError(409, 'Product disposition is required first');
        } else if (!nc.disposition) {
          throw new AppError(409, 'Product disposition is required first');
        }
        const existing = await tx.ncSignoff.findFirst({
          where: { ncId: id, kind, status: NcSignoffStatus.PENDING },
        });
        if (existing) throw new AppError(409, 'A pending sign-off of this kind already exists');
        const req2 = await tx.ncSignoff.create({
          data: { ncId: id, kind, status: NcSignoffStatus.PENDING },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'NcSignoff',
          entityId: req2.id,
          changes: { ncId: id, kind },
        });
        return req2;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/signoffs/:id/sign',
  requirePermission('capa:manage'),
  validateParams(idParamSchema),
  validateBody(ncSignoffSignSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const { role } = req.body as NcSignoffSignInput;
      const signed = await prisma.$transaction(async (tx) => {
        const existing = await tx.ncSignoff.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Sign-off request not found');
        if (existing.status === NcSignoffStatus.COMPLETED) {
          throw new AppError(409, 'Sign-off is already completed');
        }
        const now = new Date();
        const saved = await tx.ncSignoff.update({
          where: { id },
          data:
            role === 'quality'
              ? { qualitySignById: userId, qualitySignedAt: now }
              : { productionSignById: userId, productionSignedAt: now },
        });
        if (saved.qualitySignById && saved.productionSignById) {
          await tx.ncSignoff.update({ where: { id }, data: { status: NcSignoffStatus.COMPLETED } });
        }
        await audit(tx, {
          userId,
          action: 'SIGNOFF',
          entityType: 'NcSignoff',
          entityId: id,
          changes: { role, signedAt: now.toISOString() },
        });
        return tx.ncSignoff.findUnique({ where: { id } });
      });
      res.json(signed);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Tracking & reports ──────────────────────────────────────────────

router.get(
  '/reports/aging',
  requirePermission('capa:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const openNcs = await prisma.nonconformity.findMany({
        where: { status: { in: [NcStatus.OPEN, NcStatus.UNDER_REVIEW] } },
        select: {
          id: true,
          ncNo: true,
          source: true,
          severity: true,
          status: true,
          description: true,
          dateDetected: true,
          batch: { select: { batchNo: true } },
        },
        orderBy: { dateDetected: 'asc' },
      });
      res.json(
        openNcs.map((nc) => ({
          ...nc,
          ageDays: ageInDays(nc.dateDetected),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/overdue',
  requirePermission('capa:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actions = await prisma.ncAction.findMany({
        where: {
          status: { in: [NcActionStatus.PLANNED, NcActionStatus.IN_PROGRESS] },
          dueDate: { lt: new Date() },
        },
        include: {
          nc: { select: { ncNo: true } },
          capa: { select: { capaNo: true } },
        },
        orderBy: { dueDate: 'asc' },
      });
      res.json(
        actions.map((a) => ({
          ...a,
          daysOverdue: ageInDays(a.dueDate),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/recurrence',
  requirePermission('capa:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const all = await prisma.nonconformity.findMany({
        select: { source: true, severity: true, dateDetected: true },
      });
      const bySource: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      const byMonth: Record<string, number> = {};
      for (const nc of all) {
        bySource[nc.source] = (bySource[nc.source] ?? 0) + 1;
        bySeverity[nc.severity] = (bySeverity[nc.severity] ?? 0) + 1;
        const d = new Date(nc.dateDetected);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        byMonth[key] = (byMonth[key] ?? 0) + 1;
      }
      res.json({
        total: all.length,
        bySource,
        bySeverity,
        byMonth: Object.entries(byMonth)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([month, count]) => ({ month, count })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/effectiveness',
  requirePermission('capa:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const checked = await prisma.ncAction.findMany({
        where: { effectivenessAt: { not: null } },
        include: {
          nc: { select: { ncNo: true } },
          capa: { select: { capaNo: true } },
        },
        orderBy: { effectivenessAt: 'desc' },
      });
      const effective = checked.filter((a) => a.effectivenessOk).length;
      res.json({
        totalChecked: checked.length,
        effective,
        ineffective: checked.length - effective,
        rate: checked.length > 0 ? Math.round((effective / checked.length) * 100) : null,
        results: checked,
      });
    } catch (err) {
      next(err);
    }
  },
);

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
