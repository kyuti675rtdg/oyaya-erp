import { Router, type NextFunction, type Request, type Response } from 'express';
import express from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

// File storage on local disk (organized by year/month).
// NOTE: Render free-tier disk is ephemeral — files are lost on redeploy/restart.
// Metadata stays in Postgres; for durable storage wire S3/R2 in future.
const STORAGE_ROOT = process.env.DOC_STORAGE_ROOT || path.join(process.cwd(), 'storage', 'documents');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function storagePathFor(fileName: string): { abs: string; rel: string } {
  const now = new Date();
  const relDir = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const safe = `${randomUUID()}-${path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  ensureDir(path.join(STORAGE_ROOT, relDir));
  return { abs: path.join(STORAGE_ROOT, relDir, safe), rel: path.join(relDir, safe) };
}

function writeFile(rel: string, contentBase64: string): { size: number } {
  const abs = path.join(STORAGE_ROOT, rel);
  ensureDir(path.dirname(abs));
  const buf = Buffer.from(contentBase64, 'base64');
  fs.writeFileSync(abs, buf);
  return { size: buf.length };
}

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });

// Upload route accepts base64 file content (no multer dependency).
// Larger JSON limit applies to this router only.
router.use(express.json({ limit: '25mb' }));

// ═══════════════════════════ FOLDERS ═══════════════════════════

const folderListQuery = z.object({ module: z.string().min(1).optional() });

router.get(
  '/folders',
  requirePermission('documents:view'),
  validateQuery(folderListQuery),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof folderListQuery>;
      const folders = await prisma.docFolder.findMany({
        where: { module: q.module || undefined },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { documents: true, children: true } } },
      });
      res.json(folders);
    } catch (e) {
      next(e);
    }
  },
);

const folderCreateSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
  module: z.string().min(1).max(60).nullable().optional(),
});

router.post(
  '/folders',
  requirePermission('documents:manage'),
  validateBody(folderCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof folderCreateSchema>;
      const created = await prisma.docFolder.create({
        data: { name: input.name, parentId: input.parentId ?? null, module: input.module ?? null, createdById: uid },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'DocFolder', entityId: created.id, changes: { name: input.name } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

const folderUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parentId: z.string().min(1).nullable().optional(),
  module: z.string().min(1).max(60).nullable().optional(),
});

router.patch(
  '/folders/:id',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(folderUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof folderUpdateSchema>;
      if (input.parentId === id) throw new AppError(400, 'Folder cannot be its own parent');
      const updated = await prisma.docFolder.update({ where: { id }, data: input });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'DocFolder', entityId: id, changes: input });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/folders/:id',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.docFolder.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'DocFolder', entityId: id, changes: {} });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════ DOCUMENTS ═══════════════════════════

const docListQuery = z.object({
  status: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  folderId: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

router.get(
  '/',
  requirePermission('documents:view'),
  validateQuery(docListQuery),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as z.infer<typeof docListQuery>;
      const docs = await prisma.document.findMany({
        where: {
          status: q.archived === 'true' ? 'ARCHIVED' : q.archived === 'false' ? { not: 'ARCHIVED' } : q.status || undefined,
          category: q.category || undefined,
          folderId: q.folderId || undefined,
          ...(q.search
            ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { fileName: { contains: q.search, mode: 'insensitive' } }] }
            : {}),
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          folder: { select: { id: true, name: true } },
          _count: { select: { versions: true, approvals: true, shares: true } },
        },
      });
      res.json(docs);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id',
  requirePermission('documents:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({
        where: { id },
        include: {
          folder: true,
          versions: { orderBy: { createdAt: 'desc' } },
          approvals: { orderBy: { createdAt: 'desc' } },
          shares: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!doc) throw new AppError(404, 'Document not found');
      res.json(doc);
    } catch (e) {
      next(e);
    }
  },
);

const docUploadSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().min(1).max(60).default('General'),
  tags: z.array(z.string().max(40)).max(20).default([]),
  folderId: z.string().min(1).nullable().optional(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(120).default('application/octet-stream'),
  contentBase64: z.string().min(1),
  retentionUntil: z.string().min(1).nullable().optional(),
});

router.post(
  '/',
  requirePermission('documents:manage'),
  validateBody(docUploadSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof docUploadSchema>;
      const docNo = await nextDocNo(prisma, 'document', 'docNo', 'DOC');
      const { rel } = storagePathFor(input.fileName);
      const { size } = writeFile(rel, input.contentBase64);
      const created = await prisma.document.create({
        data: {
          docNo,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          tags: input.tags,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: size,
          storagePath: rel,
          folderId: input.folderId ?? null,
          retentionUntil: input.retentionUntil ? new Date(input.retentionUntil) : null,
          uploadedById: uid,
          versions: { create: { version: '1.0', fileName: input.fileName, fileSize: size, storagePath: rel, changeNote: 'Initial upload', createdById: uid } },
        },
      });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'Document', entityId: created.id, changes: { docNo, title: input.title } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/download',
  requirePermission('documents:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc || !doc.storagePath) throw new AppError(404, 'File not found');
      const abs = path.join(STORAGE_ROOT, doc.storagePath);
      if (!fs.existsSync(abs)) throw new AppError(404, 'File missing from storage (ephemeral disk may have been recycled)');
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      next(e);
    }
  },
);

const docUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  folderId: z.string().min(1).nullable().optional(),
  status: z.enum(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
  retentionUntil: z.string().min(1).nullable().optional(),
});

router.patch(
  '/:id',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(docUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof docUpdateSchema>;
      const data: Record<string, unknown> = { ...input };
      if ('retentionUntil' in input) data.retentionUntil = input.retentionUntil ? new Date(input.retentionUntil) : null;
      const updated = await prisma.document.update({ where: { id }, data });
      await audit(prisma, { userId: uid, action: 'UPDATE', entityType: 'Document', entityId: id, changes: input });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id } });
      await prisma.document.delete({ where: { id } });
      if (doc?.storagePath) {
        const abs = path.join(STORAGE_ROOT, doc.storagePath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      }
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'Document', entityId: id, changes: { docNo: doc?.docNo } });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// ── Check-in / check-out ──

router.post(
  '/:id/checkout',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc) throw new AppError(404, 'Document not found');
      if (doc.checkedOutById && doc.checkedOutById !== uid) throw new AppError(409, 'Document is checked out by another user');
      const updated = await prisma.document.update({ where: { id }, data: { checkedOutById: uid } });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

const checkinSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(120).default('application/octet-stream'),
  contentBase64: z.string().min(1),
  changeNote: z.string().max(1000).optional().nullable(),
});

function bumpVersion(v: string): string {
  const parts = v.split('.').map((p) => parseInt(p, 10) || 0);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

router.post(
  '/:id/checkin',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(checkinSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof checkinSchema>;
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc) throw new AppError(404, 'Document not found');
      if (doc.checkedOutById && doc.checkedOutById !== uid) throw new AppError(409, 'Document is checked out by another user');
      const newVersion = bumpVersion(doc.version);
      const { rel } = storagePathFor(input.fileName);
      const { size } = writeFile(rel, input.contentBase64);
      const updated = await prisma.document.update({
        where: { id },
        data: {
          version: newVersion,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: size,
          storagePath: rel,
          checkedOutById: null,
          versions: { create: { version: newVersion, fileName: input.fileName, fileSize: size, storagePath: rel, changeNote: input.changeNote ?? null, createdById: uid } },
        },
        include: { versions: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
      await audit(prisma, { userId: uid, action: 'VERSION', entityType: 'Document', entityId: id, changes: { version: newVersion } });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ── Version restore ──

router.post(
  '/:id/versions/:vid/restore',
  requirePermission('documents:manage'),
  validateParams(z.object({ id: z.string().min(1), vid: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id, vid } = req.params as { id: string; vid: string };
      const version = await prisma.docVersion.findFirst({ where: { id: vid, documentId: id } });
      if (!version || !version.storagePath) throw new AppError(404, 'Version not found');
      const src = path.join(STORAGE_ROOT, version.storagePath);
      if (!fs.existsSync(src)) throw new AppError(404, 'Version file missing from storage');
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc) throw new AppError(404, 'Document not found');
      const newVersion = bumpVersion(doc.version);
      const { rel } = storagePathFor(version.fileName);
      fs.copyFileSync(src, path.join(STORAGE_ROOT, rel));
      const stat = fs.statSync(path.join(STORAGE_ROOT, rel));
      const updated = await prisma.document.update({
        where: { id },
        data: {
          version: newVersion,
          fileName: version.fileName,
          fileSize: stat.size,
          storagePath: rel,
          versions: { create: { version: newVersion, fileName: version.fileName, fileSize: stat.size, storagePath: rel, changeNote: `Restored from v${version.version}`, createdById: uid } },
        },
      });
      await audit(prisma, { userId: uid, action: 'VERSION_RESTORE', entityType: 'Document', entityId: id, changes: { from: version.version, to: newVersion } });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════ APPROVALS ═══════════════════════════

const approvalCreateSchema = z.object({
  approverId: z.string().min(1),
  comment: z.string().max(2000).optional().nullable(),
});

router.post(
  '/:id/approvals',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(approvalCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof approvalCreateSchema>;
      const approval = await prisma.docApproval.create({
        data: { documentId: id, approverId: input.approverId, comment: input.comment ?? null },
      });
      await prisma.document.update({ where: { id }, data: { status: 'UNDER_REVIEW' } });
      await audit(prisma, { userId: uid, action: 'APPROVAL_REQUEST', entityType: 'Document', entityId: id, changes: { approverId: input.approverId } });
      res.status(201).json(approval);
    } catch (e) {
      next(e);
    }
  },
);

const approvalDecideSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).optional().nullable(),
});

router.patch(
  '/approvals/:aid',
  requirePermission('documents:approve'),
  validateParams(z.object({ aid: z.string().min(1) })),
  validateBody(approvalDecideSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { aid } = req.params as { aid: string };
      const input = req.body as z.infer<typeof approvalDecideSchema>;
      const approval = await prisma.docApproval.update({
        where: { id: aid },
        data: { status: input.status, comment: input.comment ?? null, decidedAt: new Date() },
      });
      // If approved, mark document approved; if rejected, back to draft
      await prisma.document.update({
        where: { id: approval.documentId },
        data: { status: input.status === 'APPROVED' ? 'APPROVED' : 'DRAFT' },
      });
      await audit(prisma, { userId: uid, action: 'APPROVAL_DECIDE', entityType: 'DocApproval', entityId: aid, changes: { status: input.status } });
      res.json(approval);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════ TEMPLATES ═══════════════════════════

router.get(
  '/templates/list',
  requirePermission('documents:view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const templates = await prisma.docTemplate.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
      res.json(templates);
    } catch (e) {
      next(e);
    }
  },
);

const templateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(60).default('General'),
  description: z.string().max(1000).optional().nullable(),
  content: z.string().max(50000).default(''),
});

router.post(
  '/templates',
  requirePermission('documents:manage'),
  validateBody(templateCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const input = req.body as z.infer<typeof templateCreateSchema>;
      const created = await prisma.docTemplate.create({ data: { ...input, description: input.description ?? null, createdById: uid } });
      await audit(prisma, { userId: uid, action: 'CREATE', entityType: 'DocTemplate', entityId: created.id, changes: { name: input.name } });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/templates/:id',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      await prisma.docTemplate.delete({ where: { id } });
      await audit(prisma, { userId: uid, action: 'DELETE', entityType: 'DocTemplate', entityId: id, changes: {} });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// Create a document from a template (metadata only — content as text file)
router.post(
  '/templates/:id/instantiate',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(z.object({ title: z.string().min(1).max(300), folderId: z.string().min(1).nullable().optional() })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const { title, folderId } = req.body as { title: string; folderId?: string | null };
      const template = await prisma.docTemplate.findUnique({ where: { id } });
      if (!template) throw new AppError(404, 'Template not found');
      const docNo = await nextDocNo(prisma, 'document', 'docNo', 'DOC');
      const fileName = `${title.replace(/[^a-zA-Z0-9._-]/g, '_')}.md`;
      const { rel } = storagePathFor(fileName);
      const buf = Buffer.from(template.content, 'utf-8');
      ensureDir(path.dirname(path.join(STORAGE_ROOT, rel)));
      fs.writeFileSync(path.join(STORAGE_ROOT, rel), buf);
      const created = await prisma.document.create({
        data: {
          docNo, title, category: template.category, fileName, mimeType: 'text/markdown',
          fileSize: buf.length, storagePath: rel, folderId: folderId ?? null,
          uploadedById: uid,
          versions: { create: { version: '1.0', fileName, fileSize: buf.length, storagePath: rel, changeNote: `Created from template "${template.name}"`, createdById: uid } },
        },
      });
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════ ARCHIVE ═══════════════════════════

router.post(
  '/:id/archive',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.document.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await audit(prisma, { userId: uid, action: 'ARCHIVE', entityType: 'Document', entityId: id, changes: {} });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/restore',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const updated = await prisma.document.update({ where: { id }, data: { status: 'DRAFT' } });
      await audit(prisma, { userId: uid, action: 'RESTORE', entityType: 'Document', entityId: id, changes: {} });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════ SHARING ═══════════════════════════

const shareCreateSchema = z.object({
  sharedWithId: z.string().min(1).nullable().optional(),
  role: z.string().min(1).max(60).nullable().optional(),
  permission: z.enum(['VIEW', 'EDIT']).default('VIEW'),
  expiresAt: z.string().min(1).nullable().optional(),
  createLink: z.boolean().default(false),
});

router.post(
  '/:id/shares',
  requirePermission('documents:manage'),
  validateParams(idParamSchema),
  validateBody(shareCreateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { id } = req.params as { id: string };
      const input = req.body as z.infer<typeof shareCreateSchema>;
      const share = await prisma.docShare.create({
        data: {
          documentId: id,
          sharedWithId: input.sharedWithId ?? null,
          role: input.role ?? null,
          permission: input.permission,
          token: input.createLink ? randomUUID().replace(/-/g, '') : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdById: uid,
        },
      });
      await audit(prisma, { userId: uid, action: 'SHARE', entityType: 'Document', entityId: id, changes: { permission: input.permission } });
      res.status(201).json(share);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/shares',
  requirePermission('documents:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const shares = await prisma.docShare.findMany({ where: { documentId: id }, orderBy: { createdAt: 'desc' } });
      res.json(shares);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/shares/:sid',
  requirePermission('documents:manage'),
  validateParams(z.object({ sid: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = requireUid(req);
      const { sid } = req.params as { sid: string };
      await prisma.docShare.delete({ where: { id: sid } });
      await audit(prisma, { userId: uid, action: 'UNSHARE', entityType: 'DocShare', entityId: sid, changes: {} });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// Public-ish link access (token-based, no permission check — token is the secret)
router.get(
  '/shared/:token',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const share = await prisma.docShare.findUnique({ where: { token }, include: { document: true } });
      if (!share) throw new AppError(404, 'Share link not found');
      if (share.expiresAt && share.expiresAt < new Date()) throw new AppError(410, 'Share link expired');
      const doc = share.document;
      if (!doc.storagePath) throw new AppError(404, 'File not found');
      const abs = path.join(STORAGE_ROOT, doc.storagePath);
      if (!fs.existsSync(abs)) throw new AppError(404, 'File missing from storage');
      await prisma.docShare.update({ where: { id: share.id }, data: { accessCount: { increment: 1 } } });
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      next(e);
    }
  },
);
