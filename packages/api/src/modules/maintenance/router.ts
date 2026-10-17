import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
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

// ─── Maintenance logs ────────────────────────────────────────────

const logListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
type LogListQuery = z.infer<typeof logListQuerySchema>;

const logCreateSchema = z.object({
  equipment: z.string().min(1).max(200),
  inspectionDate: z.coerce.date(),
  inspector: z.string().max(200).optional().nullable(),
  outcome: z.string().max(2000).optional().nullable(),
  followUpAction: z.string().max(2000).optional().nullable(),
  partReplaced: z.string().max(500).optional().nullable(),
});
type LogCreateInput = z.infer<typeof logCreateSchema>;

const logUpdateSchema = z.object({
  equipment: z.string().min(1).max(200).optional(),
  inspectionDate: z.coerce.date().optional(),
  inspector: z.string().max(200).optional().nullable(),
  outcome: z.string().max(2000).optional().nullable(),
  followUpAction: z.string().max(2000).optional().nullable(),
  partReplaced: z.string().max(500).optional().nullable(),
  isOverdue: z.boolean().optional(),
});
type LogUpdateInput = z.infer<typeof logUpdateSchema>;

router.get(
  '/logs',
  requirePermission('maintenance:view'),
  validateQuery(logListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as LogListQuery;
      const where: Prisma.MaintenanceLogWhereInput = {};
      if (q.from !== undefined || q.to !== undefined) {
        where.inspectionDate = {
          ...(q.from !== undefined ? { gte: q.from } : {}),
          ...(q.to !== undefined ? { lte: q.to } : {}),
        };
      }
      if (q.overdue !== undefined) where.isOverdue = q.overdue === 'true';
      const logs = await prisma.maintenanceLog.findMany({
        where,
        orderBy: { inspectionDate: 'desc' },
      });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/logs',
  requirePermission('maintenance:manage'),
  validateBody(logCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as LogCreateInput;
      const log = await prisma.$transaction(async (tx) => {
        const created = await tx.maintenanceLog.create({
          data: {
            equipment: b.equipment,
            inspectionDate: b.inspectionDate,
            inspector: b.inspector ?? null,
            outcome: b.outcome ?? null,
            followUpAction: b.followUpAction ?? null,
            partReplaced: b.partReplaced ?? null,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'MaintenanceLog',
          entityId: created.id,
          changes: { equipment: b.equipment, inspectionDate: b.inspectionDate },
        });
        return created;
      });
      res.status(201).json(log);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/logs/:id',
  requirePermission('maintenance:manage'),
  validateParams(idParamSchema),
  validateBody(logUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const { id } = req.params as { id: string };
      const b = req.body as LogUpdateInput;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.maintenanceLog.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Maintenance log not found');
        const saved = await tx.maintenanceLog.update({
          where: { id },
          data: {
            equipment: b.equipment,
            inspectionDate: b.inspectionDate,
            inspector: b.inspector === undefined ? undefined : (b.inspector ?? null),
            outcome: b.outcome === undefined ? undefined : (b.outcome ?? null),
            followUpAction: b.followUpAction === undefined ? undefined : (b.followUpAction ?? null),
            partReplaced: b.partReplaced === undefined ? undefined : (b.partReplaced ?? null),
            isOverdue: b.isOverdue,
          },
        });
        await audit(tx, {
          userId,
          action: 'UPDATE',
          entityType: 'MaintenanceLog',
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

// ─── Spare part checks ───────────────────────────────────────────

const sparePartCreateSchema = z.object({
  partName: z.string().min(1).max(200),
  equipment: z.string().max(200).optional().nullable(),
  checkType: z.enum(['STOCK_LEVEL', 'PHYSICAL_CONDITION']),
  condition: z.string().max(1000).optional().nullable(),
});
type SparePartCreateInput = z.infer<typeof sparePartCreateSchema>;

router.get(
  '/spare-parts',
  requirePermission('maintenance:view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const checks = await prisma.sparePartCheck.findMany({
        orderBy: { checkedAt: 'desc' },
      });
      res.json(checks);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/spare-parts',
  requirePermission('maintenance:manage'),
  validateBody(sparePartCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = requireUid(req);
      const b = req.body as SparePartCreateInput;
      const check = await prisma.$transaction(async (tx) => {
        const created = await tx.sparePartCheck.create({
          data: {
            partName: b.partName,
            equipment: b.equipment ?? null,
            checkType: b.checkType,
            condition: b.condition ?? null,
            checkedById: userId,
          },
        });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'SparePartCheck',
          entityId: created.id,
          changes: { partName: b.partName, checkType: b.checkType },
        });
        return created;
      });
      res.status(201).json(check);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Module 9 extended endpoints (service layer) ───────────────────

import * as svc from './service';

const view = requirePermission('maintenance:view');
const manage = requirePermission('maintenance:manage');
const approve = requirePermission('maintenance:approve');

const equipmentListQuerySchema = z.object({
  overdue: z.enum(['true', 'false']).optional(),
  dueSoonDays: z.coerce.number().int().positive().optional(),
  type: z.string().max(50).optional(),
  search: z.string().max(100).optional(),
});
type EquipmentListQuery = z.infer<typeof equipmentListQuerySchema>;

const equipmentBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  location: z.string().max(200).optional().nullable(),
  installDate: z.coerce.date().optional().nullable(),
  intervalDays: z.coerce.number().int().positive().max(3650).optional(),
  nextDueDate: z.coerce.date().optional().nullable(),
  status: z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'BREAKDOWN']).optional(),
});
type EquipmentBody = z.infer<typeof equipmentBodySchema>;

router.get(
  '/equipment',
  view,
  validateQuery(equipmentListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as EquipmentListQuery;
      res.json(
        await svc.listEquipment({
          overdue: q.overdue === 'true' ? true : q.overdue === 'false' ? false : undefined,
          dueSoonDays: q.dueSoonDays,
          type: q.type,
          search: q.search,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/equipment',
  manage,
  validateBody(equipmentBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.createEquipment(requireUid(req), req.body as EquipmentBody));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/equipment/:id',
  manage,
  validateParams(idParamSchema),
  validateBody(equipmentBodySchema.partial()),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.updateEquipment(requireUid(req), id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

// ─── PM templates ──────────────────────────────────────────────────

const checklistItemSchema = z.object({ id: z.string().min(1), label: z.string().min(1).max(300) });

const pmTemplateBodySchema = z.object({
  equipmentType: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  frequencyDays: z.coerce.number().int().positive().max(3650),
  estimatedMinutes: z.coerce.number().int().positive().max(10080),
  items: z.array(checklistItemSchema).min(1).max(100),
});

router.get(
  '/pm-templates',
  view,
  validateQuery(z.object({ type: z.string().max(50).optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await svc.listPmTemplates((req.query as { type?: string }).type));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/pm-templates',
  manage,
  validateBody(pmTemplateBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.createPmTemplate(requireUid(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/pm-templates/:id',
  manage,
  validateParams(idParamSchema),
  validateBody(pmTemplateBodySchema.partial()),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.updatePmTemplate(requireUid(req), id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

// ─── PM executions ─────────────────────────────────────────────────

const pmExecutionBodySchema = z.object({
  equipmentId: z.string().min(1),
  templateId: z.string().min(1).optional().nullable(),
  checklist: z.array(z.object({ id: z.string(), label: z.string(), checked: z.boolean() })).min(1),
  durationMinutes: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  intervalDays: z.coerce.number().int().positive().optional(),
});

router.get(
  '/pm-executions',
  view,
  validateQuery(z.object({ equipmentId: z.string().min(1).optional(), limit: z.coerce.number().int().positive().max(500).optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as { equipmentId?: string; limit?: number };
      res.json(await svc.listPmExecutions(q.equipmentId, q.limit ?? 100));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/pm-executions',
  manage,
  validateBody(pmExecutionBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.executePm(requireUid(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Breakdowns ────────────────────────────────────────────────────

const breakdownBodySchema = z.object({
  equipmentId: z.string().min(1),
  failureTime: z.coerce.date(),
  symptom: z.string().min(1).max(2000),
  category: z.enum(['MECHANICAL', 'ELECTRICAL', 'PNEUMATIC', 'OTHER']),
  reportedByName: z.string().max(200).optional().nullable(),
});

const breakdownResolveSchema = z.object({
  repairNotes: z.string().max(4000).optional().nullable(),
  resolvedAt: z.coerce.date().optional(),
  resolvedByName: z.string().max(200).optional().nullable(),
});

router.get(
  '/breakdowns',
  view,
  validateQuery(
    z.object({
      status: z.string().max(30).optional(),
      category: z.string().max(30).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as { status?: string; category?: string; from?: Date; to?: Date };
      res.json(await svc.listBreakdowns(q));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/breakdowns',
  manage,
  validateBody(breakdownBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.reportBreakdown(requireUid(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/breakdowns/:id',
  manage,
  validateParams(idParamSchema),
  validateBody(breakdownResolveSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.resolveBreakdown(requireUid(req), id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Spare parts catalog ───────────────────────────────────────────

const partBodySchema = z.object({
  partNumber: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  compatibleTypes: z.string().max(500).optional().nullable(),
  stockQty: z.coerce.number().nonnegative().optional(),
  minLevel: z.coerce.number().nonnegative().optional(),
  locationBin: z.string().max(100).optional().nullable(),
  unit: z.string().max(20).optional(),
});

router.get(
  '/parts',
  view,
  validateQuery(z.object({ lowStock: z.enum(['true', 'false']).optional(), search: z.string().max(100).optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as { lowStock?: string; search?: string };
      res.json(await svc.listSpareParts({ lowStock: q.lowStock === 'true', search: q.search }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/parts',
  manage,
  validateBody(partBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.createSparePart(requireUid(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/parts/:id',
  manage,
  validateParams(idParamSchema),
  validateBody(partBodySchema.partial().omit({ partNumber: true, stockQty: true })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.updateSparePart(requireUid(req), id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/parts/:id/adjust',
  manage,
  validateParams(idParamSchema),
  validateBody(z.object({ qty: z.coerce.number().refine((n) => n !== 0, 'Quantity must be non-zero'), note: z.string().max(500).optional().nullable() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as { qty: number; note?: string | null };
      res.json(await svc.adjustSparePartStock(requireUid(req), id, b.qty, b.note ?? undefined));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/parts/:id/verify',
  manage,
  validateParams(idParamSchema),
  validateBody(z.object({ countedQty: z.coerce.number().nonnegative(), notes: z.string().max(1000).optional().nullable() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as { countedQty: number; notes?: string | null };
      res.status(201).json(await svc.verifySparePart(requireUid(req), id, b.countedQty, b.notes ?? undefined));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/verifications',
  view,
  validateQuery(z.object({ partId: z.string().min(1).optional(), limit: z.coerce.number().int().positive().max(500).optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as { partId?: string; limit?: number };
      res.json(await svc.listSparePartVerifications(q.partId, q.limit ?? 100));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Work orders ───────────────────────────────────────────────────

const workOrderBodySchema = z.object({
  equipmentId: z.string().min(1),
  kind: z.enum(['PREVENTIVE', 'CORRECTIVE', 'INSPECTION']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assigneeId: z.string().min(1).optional().nullable(),
  assigneeName: z.string().max(200).optional().nullable(),
  breakdownId: z.string().min(1).optional().nullable(),
  description: z.string().min(1).max(4000),
  notes: z.string().max(4000).optional().nullable(),
});

router.get(
  '/work-orders',
  view,
  validateQuery(
    z.object({
      status: z.string().max(30).optional(),
      priority: z.string().max(30).optional(),
      equipmentId: z.string().min(1).optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await svc.listWorkOrders(req.query as { status?: string; priority?: string; equipmentId?: string }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/work-orders',
  manage,
  validateBody(workOrderBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await svc.createWorkOrder(requireUid(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/work-orders/:id',
  manage,
  validateParams(idParamSchema),
  validateBody(
    z.object({
      status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED']),
      assigneeId: z.string().min(1).optional().nullable(),
      assigneeName: z.string().max(200).optional().nullable(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.transitionWorkOrder(requireUid(req), id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/work-orders/:id/parts',
  manage,
  validateParams(idParamSchema),
  validateBody(z.object({ items: z.array(z.object({ partId: z.string().min(1), qty: z.coerce.number().positive().max(100000) })).min(1).max(100) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as { items: { partId: string; qty: number }[] };
      res.json(await svc.recordWorkOrderParts(requireUid(req), id, b.items));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Repair approvals ──────────────────────────────────────────────

router.get(
  '/repair-approvals',
  view,
  validateQuery(z.object({ pending: z.enum(['true', 'false']).optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await svc.listRepairApprovals((req.query as { pending?: string }).pending !== 'false'));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/work-orders/:id/tech-signoff',
  manage,
  validateParams(idParamSchema),
  validateBody(z.object({ technicianNote: z.string().max(4000).optional().nullable() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as { technicianNote?: string | null };
      res.json(await svc.techSignoff(requireUid(req), id, b.technicianNote ?? undefined));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/repair-approvals/:id/decision',
  approve,
  validateParams(idParamSchema),
  validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), supervisorNote: z.string().max(4000).optional().nullable() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as { decision: 'APPROVED' | 'REJECTED'; supervisorNote?: string | null };
      res.json(await svc.supervisorDecision(requireUid(req), id, b.decision, b.supervisorNote ?? undefined));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/work-orders/:id/back-in-service',
  approve,
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.backInService(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reports ───────────────────────────────────────────────────────

router.get('/reports/overdue', view, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await svc.overdueReport());
  } catch (err) {
    next(err);
  }
});

router.get(
  '/reports/kpis',
  view,
  validateQuery(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as { from?: Date; to?: Date };
      res.json(await svc.maintenanceKpis(q.from, q.to));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/export',
  view,
  validateQuery(z.object({ kind: z.enum(['overdue', 'kpis', 'breakdowns', 'parts']) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kind = (req.query as { kind: string }).kind;
      let csv = '';
      let filename = 'maintenance-export.csv';
      if (kind === 'overdue') {
        const data = await svc.overdueReport();
        csv = svc.toCsv(
          ['type', 'equipment', 'equipment_type', 'due_date', 'days_overdue'],
          data.equipment.map((e: any) => [
            'OVERDUE_PM',
            e.name,
            e.type,
            e.nextDueDate ?? '',
            e.nextDueDate ? Math.floor((Date.now() - new Date(e.nextDueDate).getTime()) / 86400000) : '',
          ]),
        );
        filename = 'overdue-maintenance.csv';
      } else if (kind === 'kpis') {
        const k = await svc.maintenanceKpis();
        csv = svc.toCsv(
          ['category', 'count', 'avg_downtime_minutes'],
          k.byCategory.map((c: any) => [c.category, c.count, c.avgDowntimeMinutes]),
        );
        filename = 'maintenance-kpis.csv';
      } else if (kind === 'breakdowns') {
        const rows = await svc.listBreakdowns({});
        csv = svc.toCsv(
          ['failure_time', 'equipment', 'category', 'symptom', 'status', 'downtime_minutes'],
          rows.map((r: any) => [r.failureTime, r.equipment?.name ?? '', r.category, r.symptom, r.status, r.downtimeMinutes ?? '']),
        );
        filename = 'breakdown-records.csv';
      } else {
        const rows = await svc.listSpareParts({});
        csv = svc.toCsv(
          ['part_number', 'name', 'stock_qty', 'min_level', 'low_stock', 'bin'],
          rows.map((r: any) => [r.partNumber, r.name, r.stockQty, r.minLevel, r.lowStock ? 'YES' : 'NO', r.locationBin ?? '']),
        );
        filename = 'spare-parts.csv';
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);
