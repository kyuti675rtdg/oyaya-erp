import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ─── List all module toggles ─────────────────────────────────────────
router.get(
  '/',
  requirePermission('settings:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const toggles = await prisma.moduleToggle.findMany({
        orderBy: { name: 'asc' },
      });
      res.json(toggles);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Get enabled module keys (for dynamic navigation) ───────────────
router.get(
  '/enabled',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const toggles = await prisma.moduleToggle.findMany({
        where: { enabled: true },
        select: { moduleKey: true },
      });
      res.json(toggles.map((t) => t.moduleKey));
    } catch (e) {
      next(e);
    }
  },
);

// ─── Toggle a module on/off ──────────────────────────────────────────
const toggleSchema = z.object({
  enabled: z.boolean(),
});

router.patch(
  '/:id/toggle',
  requirePermission('settings:manage'),
  validateParams(idParamSchema),
  validateBody(toggleSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const { enabled } = req.body as { enabled: boolean };

      const existing = await prisma.moduleToggle.findUnique({ where: { id } });
      if (!existing) throw new AppError(404, 'Module toggle not found');

      const updated = await prisma.moduleToggle.update({
        where: { id },
        data: { enabled },
      });

      await audit(prisma, {
        userId: uid,
        action: enabled ? 'MODULE_ENABLE' : 'MODULE_DISABLE',
        entityType: 'ModuleToggle',
        entityId: id,
        changes: { moduleKey: existing.moduleKey, name: existing.name, from: existing.enabled, to: enabled },
      });

      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Update module metadata ──────────────────────────────────────────
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
});

router.patch(
  '/:id',
  requirePermission('settings:manage'),
  validateParams(idParamSchema),
  validateBody(updateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.moduleToggle.update({
        where: { id },
        data: req.body as { name?: string; description?: string | null },
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'ModuleToggle', entityId: id, changes: req.body });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);
