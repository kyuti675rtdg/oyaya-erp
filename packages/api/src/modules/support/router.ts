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

// ═══════════════════════ SOP DOCUMENTS & MANUALS ═══════════════════

const sopListQuerySchema = z.object({
  docType: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

router.get(
  '/sops',
  requirePermission('support:view'),
  validateQuery(sopListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof sopListQuerySchema>;
      const docs = await prisma.sopDocument.findMany({
        where: {
          docType: q.docType || undefined,
          module: q.module || undefined,
          status: q.status || undefined,
          OR: q.search
            ? [
                { title: { contains: q.search, mode: 'insensitive' } },
                { content: { contains: q.search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        orderBy: [{ docType: 'asc' }, { title: 'asc' }],
      });
      res.json(docs);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/sops/:id',
  requirePermission('support:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const doc = await prisma.sopDocument.findUnique({ where: { id } });
      if (!doc) throw new AppError(404, 'Document not found');
      res.json(doc);
    } catch (e) {
      next(e);
    }
  },
);

const sopCreateSchema = z.object({
  docType: z.enum(['MANUAL', 'SOP']),
  title: z.string().min(1).max(300),
  module: z.string().max(100).optional().nullable(),
  summary: z.string().max(2000).optional().nullable(),
  content: z.string().min(1),
  effectiveDate: z.string().optional().nullable(),
  reviewDate: z.string().optional().nullable(),
});

router.post(
  '/sops',
  requirePermission('support:manage'),
  validateBody(sopCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof sopCreateSchema>;
      const docNo = await nextDocNo(prisma, 'sopDocument', 'docNo', input.docType === 'MANUAL' ? 'MAN' : 'SOP');
      const created = await prisma.sopDocument.create({
        data: {
          docNo,
          docType: input.docType,
          title: input.title,
          module: input.module ?? null,
          summary: input.summary ?? null,
          content: input.content,
          effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null,
          reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
          createdById: uid,
        },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'SopDocument', entityId: created.id, changes: { docNo, title: input.title } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

const sopUpdateSchema = sopCreateSchema.partial().extend({
  status: z.enum(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ARCHIVED']).optional(),
  version: z.string().max(20).optional(),
});

router.patch(
  '/sops/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  validateBody(sopUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof sopUpdateSchema>;
      const updated = await prisma.sopDocument.update({
        where: { id },
        data: {
          ...input,
          effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : undefined,
          reviewDate: input.reviewDate ? new Date(input.reviewDate) : undefined,
          approvedAt: input.status === 'APPROVED' ? new Date() : undefined,
          approverId: input.status === 'APPROVED' ? uid : undefined,
        },
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'SopDocument', entityId: id, changes: input });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/sops/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.sopDocument.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'SopDocument', entityId: id });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ KNOWLEDGE BASE ════════════════════════════

const kbListQuerySchema = z.object({
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  faq: z.string().min(1).optional(),
});

router.get(
  '/kb',
  validateQuery(kbListQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof kbListQuerySchema>;
      const articles = await prisma.kbArticle.findMany({
        where: {
          category: q.category || undefined,
          faq: q.faq === 'true' ? true : undefined,
          OR: q.search
            ? [
                { title: { contains: q.search, mode: 'insensitive' } },
                { content: { contains: q.search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        orderBy: [{ pinned: 'desc' }, { views: 'desc' }],
        select: { id: true, title: true, category: true, tags: true, faq: true, pinned: true, views: true, updatedAt: true },
      });
      res.json(articles);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/kb/:id',
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const article = await prisma.kbArticle.findUnique({ where: { id } });
      if (!article) throw new AppError(404, 'Article not found');
      await prisma.kbArticle.update({ where: { id }, data: { views: { increment: 1 } } });
      res.json({ ...article, views: article.views + 1 });
    } catch (e) {
      next(e);
    }
  },
);

const kbCreateSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(['faq', 'troubleshooting', 'howto', 'guide']),
  tags: z.array(z.string()).default([]),
  content: z.string().min(1),
  faq: z.boolean().default(false),
  pinned: z.boolean().default(false),
});

router.post(
  '/kb',
  requirePermission('support:manage'),
  validateBody(kbCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const created = await prisma.kbArticle.create({
        data: { ...(req.body as z.infer<typeof kbCreateSchema>), createdById: uid },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'KbArticle', entityId: created.id, changes: { title: created.title } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/kb/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  validateBody(kbCreateSchema.partial()),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.kbArticle.update({ where: { id }, data: req.body as Partial<z.infer<typeof kbCreateSchema>> });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'KbArticle', entityId: id, changes: req.body });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/kb/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.kbArticle.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'KbArticle', entityId: id });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ ANNOUNCEMENTS ════════════════════════════

router.get(
  '/announcements',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = req.user?.id;
      const now = new Date();
      const items = await prisma.announcement.findMany({
        where: {
          publishedAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        orderBy: [{ urgent: 'desc' }, { publishedAt: 'desc' }],
        include: { reads: uid ? { where: { userId: uid }, select: { id: true } } : false },
      });
      res.json(items);
    } catch (e) {
      next(e);
    }
  },
);

const announcementCreateSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  targetRoles: z.array(z.string()).default([]),
  urgent: z.boolean().default(false),
  expiresAt: z.string().optional().nullable(),
});

router.post(
  '/announcements',
  requirePermission('support:manage'),
  validateBody(announcementCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof announcementCreateSchema>;
      const created = await prisma.announcement.create({
        data: {
          title: input.title,
          body: input.body,
          targetRoles: input.targetRoles,
          urgent: input.urgent,
          publishedAt: new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          authorId: uid,
        },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'Announcement', entityId: created.id, changes: { title: input.title } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/announcements/:id/read',
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.announcementRead.upsert({
        where: { announcementId_userId: { announcementId: id, userId: uid } },
        create: { announcementId: id, userId: uid },
        update: { readAt: new Date() },
      });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ TECH SUPPORT RECORDS ════════════════════

router.get(
  '/tech-records',
  requirePermission('support:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const records = await prisma.techSupportRecord.findMany({ orderBy: { createdAt: 'desc' } });
      res.json(records);
    } catch (e) {
      next(e);
    }
  },
);

const techRecordCreateSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(['network', 'hardware', 'software', 'training', 'other']),
  description: z.string().min(1),
  resolution: z.string().optional().nullable(),
  durationMins: z.number().int().min(0).optional().nullable(),
});

router.post(
  '/tech-records',
  requirePermission('support:manage'),
  validateBody(techRecordCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof techRecordCreateSchema>;
      const recordNo = await nextDocNo(prisma, 'techSupportRecord', 'recordNo', 'TSR');
      const created = await prisma.techSupportRecord.create({
        data: {
          ...input,
          recordNo,
          technicianId: uid,
          resolvedAt: input.resolution ? new Date() : null,
        },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'TechSupportRecord', entityId: created.id, changes: { recordNo } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/tech-records/:id',
  requirePermission('support:manage'),
  validateParams(idParamSchema),
  validateBody(techRecordCreateSchema.partial()),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as Partial<z.infer<typeof techRecordCreateSchema>>;
      const updated = await prisma.techSupportRecord.update({
        where: { id },
        data: { ...input, resolvedAt: input.resolution ? new Date() : undefined },
      });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'TechSupportRecord', entityId: id, changes: input });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ IN-SYSTEM NOTIFICATIONS ══════════════════

router.get(
  '/notifications',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const items = await prisma.appNotification.findMany({
        where: { userId: uid },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(items);
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/notifications/:id/read',
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.appNotification.updateMany({ where: { id, userId: uid }, data: { read: true } });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/notifications/read-all',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      await prisma.appNotification.updateMany({ where: { userId: uid, read: false }, data: { read: true } });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════ SMS LOG (read-only view) ═════════════════

router.get(
  '/sms-log',
  requirePermission('support:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const logs = await prisma.smsLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
      res.json(logs);
    } catch (e) {
      next(e);
    }
  },
);
