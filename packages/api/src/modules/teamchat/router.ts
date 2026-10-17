// Native team chat router — mounted at /api/v1/teamchat (authenticated).
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery } from '../../middleware/validate';
import {
  getUserChannels,
  syncDepartmentChannels,
  getChannelMessages,
  sendMessage,
  getOrCreateDM,
  deleteMessage,
  searchUsers,
} from './service';

export const router = Router();

// List my channels
router.get('/channels', requirePermission('chat:view'), async (req: any, res, next) => {
  try {
    res.json(await getUserChannels(req.user.id));
  } catch (err) {
    next(err);
  }
});

// Get messages for a channel
const messagesQuery = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  before: z.string().optional(),
});
router.get('/channels/:id/messages', requirePermission('chat:view'), validateQuery(messagesQuery), async (req: any, res, next) => {
  try {
    const q = req.query as z.infer<typeof messagesQuery>;
    res.json(await getChannelMessages(req.params.id, req.user.id, q.limit || 50, q.before));
  } catch (err) {
    next(err);
  }
});

// Send a message
const sendSchema = z.object({
  body: z.string().min(1).max(5000),
  attachments: z.array(z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().max(100),
    contentBase64: z.string().min(1),
  })).max(5).optional(),
});
router.post('/channels/:id/messages', requirePermission('chat:view'), validateBody(sendSchema), async (req: any, res, next) => {
  try {
    const { body, attachments } = req.body as z.infer<typeof sendSchema>;
    res.json(await sendMessage(req.params.id, req.user.id, body, attachments));
  } catch (err) {
    next(err);
  }
});

// Delete a message
router.delete('/messages/:id', requirePermission('chat:view'), async (req: any, res, next) => {
  try {
    res.json(await deleteMessage(req.params.id, req.user.id));
  } catch (err) {
    next(err);
  }
});

// Start or get DM
router.post('/dm/:userId', requirePermission('chat:view'), async (req: any, res, next) => {
  try {
    res.json(await getOrCreateDM(req.user.id, req.params.userId));
  } catch (err) {
    next(err);
  }
});

// Search users for DM
const searchQuery = z.object({ q: z.string().min(1).max(100) });
router.get('/users/search', requirePermission('chat:view'), validateQuery(searchQuery), async (req: any, res, next) => {
  try {
    res.json(await searchUsers((req.query as any).q, req.user.id));
  } catch (err) {
    next(err);
  }
});

// Admin: sync department channels
router.post('/sync', requirePermission('chat:manage'), async (_req, res, next) => {
  try {
    res.json(await syncDepartmentChannels());
  } catch (err) {
    next(err);
  }
});
