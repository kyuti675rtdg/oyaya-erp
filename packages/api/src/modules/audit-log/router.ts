import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateQuery } from '../../middleware/validate';

export const router = Router();

const auditQuerySchema = z.object({
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

// ─── Search audit logs ───────────────────────────────────────────────
router.get(
  '/',
  requirePermission('settings:view'),
  validateQuery(auditQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as z.infer<typeof auditQuerySchema>;
      const where: Record<string, unknown> = {};
      if (q.action) where.action = q.action;
      if (q.entityType) where.entityType = q.entityType;
      if (q.userId) where.userId = q.userId;
      if (q.from || q.to) {
        where.createdAt = {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        };
      }

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);

      // Apply text search in-memory for JSON changes field
      let filtered = logs;
      if (q.search) {
        const s = q.search.toLowerCase();
        filtered = logs.filter(
          (l) =>
            l.action.toLowerCase().includes(s) ||
            l.entityType.toLowerCase().includes(s) ||
            (l.entityId ?? '').toLowerCase().includes(s) ||
            (l.user?.name ?? '').toLowerCase().includes(s) ||
            JSON.stringify(l.changes ?? {}).toLowerCase().includes(s),
        );
      }

      res.json({
        data: filtered,
        pagination: {
          page: q.page,
          pageSize: q.pageSize,
          total,
          totalPages: Math.ceil(total / q.pageSize),
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

// ─── Export audit logs as CSV ────────────────────────────────────────
router.get(
  '/export',
  requirePermission('settings:view'),
  validateQuery(auditQuerySchema.omit({ page: true, pageSize: true })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as Omit<z.infer<typeof auditQuerySchema>, 'page' | 'pageSize'>;
      const where: Record<string, unknown> = {};
      if (q.action) where.action = q.action;
      if (q.entityType) where.entityType = q.entityType;
      if (q.userId) where.userId = q.userId;
      if (q.from || q.to) {
        where.createdAt = {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        };
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10000,
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      const header = 'Timestamp,User,Action,Entity Type,Entity ID,Changes\n';
      const rows = logs.map((l) => {
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return [
          l.createdAt.toISOString(),
          l.user ? `${l.user.name} (${l.user.email})` : 'System',
          l.action,
          l.entityType,
          l.entityId ?? '',
          JSON.stringify(l.changes ?? {}),
        ]
          .map(esc)
          .join(',');
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
      res.send(header + rows.join('\n'));
    } catch (e) {
      next(e);
    }
  },
);

// ─── Distinct actions & entity types (for filter dropdowns) ──────────
router.get(
  '/facets',
  requirePermission('settings:view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [actions, entityTypes] = await Promise.all([
        prisma.auditLog.findMany({ select: { action: true }, distinct: ['action'], orderBy: { action: 'asc' } }),
        prisma.auditLog.findMany({ select: { entityType: true }, distinct: ['entityType'], orderBy: { entityType: 'asc' } }),
      ]);
      res.json({
        actions: actions.map((a) => a.action),
        entityTypes: entityTypes.map((e) => e.entityType),
      });
    } catch (e) {
      next(e);
    }
  },
);
