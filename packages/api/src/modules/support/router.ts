import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// ═══════════════════════ SUPPORT TICKETS ══════════════════════════════

const ticketListQuerySchema = z.object({
  status: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});

router.get(
  '/tickets',
  requirePermission('support:view'),
  validateQuery(ticketListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof ticketListQuerySchema>;
      const tickets = await prisma.supportTicket.findMany({
        where: {
          status: q.status || undefined,
          priority: q.priority || undefined,
          category: q.category || undefined,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { comments: true } },
        },
      });
      res.json(tickets);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/tickets/:id',
  requirePermission('support:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        include: {
          reporter: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          comments: {
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { id: true, name: true } } },
          },
        },
      });
      if (!ticket) throw new AppError(404, 'Ticket not found');
      res.json(ticket);
    } catch (e) {
      next(e);
    }
  },
);

const ticketCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  category: z.enum(['technical', 'hardware', 'operational']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

router.post(
  '/tickets',
  requirePermission('support:manage'),
  validateBody(ticketCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof ticketCreateSchema>;
      const ticketNo = await nextDocNo(prisma, 'supportTicket', 'ticketNo', 'TKT');
      const created = await prisma.supportTicket.create({
        data: { ...input, ticketNo, reporterId: uid },
        include: {
          reporter: { select: { id: true, name: true, email: true } },
        },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'SupportTicket', entityId: created.id, changes: { ticketNo, title: input.title } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

const ticketUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().min(1).optional().nullable(),
});

router.patch(
  '/tickets/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  validateBody(ticketUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.supportTicket.update({
        where: { id },
        data: req.body as z.infer<typeof ticketUpdateSchema>,
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'SupportTicket', entityId: id, changes: req.body });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

const commentCreateSchema = z.object({
  body: z.string().min(1).max(5000),
});

router.post(
  '/tickets/:id/comments',
  requirePermission('support:view'),
  validateParams(idParamSchema),
  validateBody(commentCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const { body } = req.body as { body: string };
      const comment = await prisma.ticketComment.create({
        data: { ticketId: id, authorId: uid, body },
        include: { author: { select: { id: true, name: true } } },
      });
      await audit(prisma, { userId: uid, action: 'COMMENT', entityType: 'SupportTicket', entityId: id, changes: { commentId: comment.id } });
      res.status(201).json(comment);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ DOCUMENTATION ═══════════════════════════════

const docListQuerySchema = z.object({
  module: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

router.get(
  '/docs',
  validateQuery(docListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof docListQuerySchema>;
      const docs = await prisma.docArticle.findMany({
        where: {
          module: q.module || undefined,
          OR: q.search
            ? [
                { title: { contains: q.search, mode: 'insensitive' } },
                { content: { contains: q.search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        select: {
          id: true, slug: true, title: true, module: true,
          role: true, sortOrder: true, updatedAt: true,
        },
      });
      res.json(docs);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/docs/:slug',
  validateParams(z.object({ slug: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug } = req.params as { slug: string };
      const doc = await prisma.docArticle.findUnique({ where: { slug } });
      if (!doc) throw new AppError(404, 'Document not found');
      res.json(doc);
    } catch (e) {
      next(e);
    }
  },
);

const docCreateSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  module: z.string().max(100).optional().nullable(),
  role: z.string().max(100).optional().nullable(),
  sortOrder: z.number().int().default(0),
});

router.post(
  '/docs',
  requirePermission('support:manage'),
  validateBody(docCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const created = await prisma.docArticle.create({
        data: req.body as z.infer<typeof docCreateSchema>,
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'DocArticle', entityId: created.id, changes: { slug: created.slug } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/docs/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  validateBody(docCreateSchema.partial()),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.docArticle.update({
        where: { id },
        data: req.body as Partial<z.infer<typeof docCreateSchema>>,
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'DocArticle', entityId: id, changes: req.body });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/docs/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.docArticle.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'DocArticle', entityId: id });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);
