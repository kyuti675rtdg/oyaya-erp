import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import * as svc from './service';

// The coordinator mounts this router at /api/v1/warehouse.
export const router = Router();

function requireUid(req: Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const idParamSchema = z.object({ id: z.string().min(1) });
const statusQuerySchema = z.object({ status: z.string().min(1).optional() });

const locationTypeSchema = z.enum(['RAW', 'FG', 'SPARE', 'GENERAL']);

const locationCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  zone: z.string().max(100).optional().nullable(),
  type: locationTypeSchema.optional(),
  capacityQ: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});
type LocationCreateInput = z.infer<typeof locationCreateSchema>;

const locationUpdateSchema = locationCreateSchema.omit({ code: true }).partial();
type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

const stockViewQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});
type StockViewQuery = z.infer<typeof stockViewQuerySchema>;

router.get('/locations', requirePermission('warehouse:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listLocations());
  } catch (err) {
    next(err);
  }
});

router.post(
  '/locations',
  requirePermission('warehouse:manage'),
  validateBody(locationCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await svc.createLocation(requireUid(req), req.body as LocationCreateInput));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/locations/seed-defaults',
  requirePermission('warehouse:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await svc.seedDefaultLocations(requireUid(req)));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/locations/:id',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(locationUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.updateLocation(requireUid(req), id, req.body as LocationUpdateInput));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/stock',
  requirePermission('warehouse:view'),
  validateQuery(stockViewQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query as StockViewQuery;
      res.json(await svc.stockView({ locationId: q.locationId, productId: q.productId }));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/suggest-location',
  requirePermission('warehouse:view'),
  validateQuery(z.object({ type: locationTypeSchema })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type } = req.query as { type: 'RAW' | 'FG' | 'SPARE' | 'GENERAL' };
      res.json(await svc.suggestLocation(type));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Goods receiving & put-away ─────────────────────────────────────

const putAwayItemSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().max(100).optional().nullable(),
  quintals: z.number().positive(),
  bags: z.number().int().min(0).optional(),
  packagingKg: z.number().int().optional().nullable(),
  unitCostBirr: z.number().min(0).optional().nullable(),
});

const putAwayCreateSchema = z.object({
  referenceDoc: z.string().max(100).optional().nullable(),
  items: z.array(putAwayItemSchema).min(1),
});
type PutAwayCreateInput = z.infer<typeof putAwayCreateSchema>;

const placePutAwaySchema = z.object({
  placements: z.array(z.object({ itemId: z.string().min(1), locationId: z.string().min(1) })),
});
type PlacePutAwayInput = z.infer<typeof placePutAwaySchema>;

router.get(
  '/putaways',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listPutAways(status));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/putaways/:id',
  requirePermission('warehouse:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.getPutAway(id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/putaways',
  requirePermission('warehouse:manage'),
  validateBody(putAwayCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await svc.createPutAway(requireUid(req), req.body as PutAwayCreateInput));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/putaways/:id/place',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(placePutAwaySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as PlacePutAwayInput;
      res.json(await svc.placePutAway(requireUid(req), id, b.placements));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Stock transfers ────────────────────────────────────────────────

const transferItemSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().max(100).optional().nullable(),
  quintals: z.number().positive(),
  bags: z.number().int().min(0).optional(),
});

const transferCreateSchema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  reason: z.string().max(500).optional().nullable(),
  items: z.array(transferItemSchema).min(1),
});
type TransferCreateInput = z.infer<typeof transferCreateSchema>;

router.get(
  '/transfers',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listTransfers(status));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/transfers/:id',
  requirePermission('warehouse:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.getTransfer(id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/transfers',
  requirePermission('warehouse:manage'),
  validateBody(transferCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await svc.createTransfer(requireUid(req), req.body as TransferCreateInput));
    } catch (err) {
      next(err);
    }
  },
);

for (const [path, to] of [
  ['approve', 'APPROVED'],
  ['complete', 'COMPLETED'],
  ['reject', 'REJECTED'],
  ['cancel', 'CANCELLED'],
] as const) {
  router.post(
    `/transfers/:id/${path}`,
    requirePermission(to === 'APPROVED' || to === 'REJECTED' ? 'warehouse:approve' : 'warehouse:manage'),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params as { id: string };
        res.json(await svc.transitionTransfer(requireUid(req), id, to));
      } catch (err) {
        next(err);
      }
    },
  );
}

// ─── Inventory adjustments ──────────────────────────────────────────

const adjustItemSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().max(100).optional().nullable(),
  quintals: z.number().refine((n) => Math.abs(n) >= 0.005, 'Quantity cannot be zero'),
  bags: z.number().int().optional(),
  unitCostBirr: z.number().min(0).optional().nullable(),
  reason: z.enum(['DAMAGE', 'FOUND', 'RECOUNT', 'SPOILAGE', 'OTHER']),
});

const adjustmentCreateSchema = z.object({
  locationId: z.string().min(1),
  reason: z.string().max(500).optional().nullable(),
  items: z.array(adjustItemSchema).min(1),
});
type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>;

router.get(
  '/adjustments',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listAdjustments(status));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/adjustments/:id',
  requirePermission('warehouse:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.getAdjustment(id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/adjustments',
  requirePermission('warehouse:manage'),
  validateBody(adjustmentCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await svc.createAdjustment(requireUid(req), req.body as AdjustmentCreateInput);
      res.status(201).json(r);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/adjustments/:id/approve',
  requirePermission('warehouse:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.approveAdjustment(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/adjustments/:id/reject',
  requirePermission('warehouse:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.rejectAdjustment(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Stock reservations ─────────────────────────────────────────────

const reservationCreateSchema = z.object({
  reference: z.string().max(100).optional().nullable(),
  productId: z.string().min(1),
  batchNo: z.string().max(100).optional().nullable(),
  locationId: z.string().min(1),
  quintals: z.number().positive(),
  bags: z.number().int().min(0).optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});
type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;

router.get(
  '/reservations',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listReservations(status));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/reservations',
  requirePermission('warehouse:manage'),
  validateBody(reservationCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as Omit<ReservationCreateInput, 'expiresAt'> & { expiresAt?: Date | null };
      res.status(201).json(
        await svc.createReservation(requireUid(req), {
          ...b,
          expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/reservations/:id/release',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.releaseReservation(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/reservations/:id/consume',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.consumeReservation(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/reservations/expire-sweep',
  requirePermission('warehouse:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const expired = await svc.expireReservations(req.user?.id ?? null);
      res.json({ expired });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Stock issuance & dispatch ──────────────────────────────────────

const dispatchItemSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().max(100).optional().nullable(),
  locationId: z.string().min(1),
  quintals: z.number().positive(),
  bags: z.number().int().min(0).optional(),
  reservationId: z.string().min(1).optional().nullable(),
});

const dispatchCreateSchema = z.object({
  reference: z.string().max(100).optional().nullable(),
  vehiclePlate: z.string().max(30).optional().nullable(),
  driverName: z.string().max(200).optional().nullable(),
  items: z.array(dispatchItemSchema).min(1),
});
type DispatchCreateInput = z.infer<typeof dispatchCreateSchema>;

const pickDispatchSchema = z.object({
  reservationIds: z.array(z.string().min(1)).optional(),
});
type PickDispatchInput = z.infer<typeof pickDispatchSchema>;

router.get(
  '/dispatches',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listDispatches(status));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/dispatches/:id',
  requirePermission('warehouse:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.getDispatch(id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches',
  requirePermission('warehouse:manage'),
  validateBody(dispatchCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await svc.createDispatch(requireUid(req), req.body as DispatchCreateInput));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches/:id/pick',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(pickDispatchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as PickDispatchInput;
      res.json(await svc.transitionDispatch(requireUid(req), id, 'PICKED', b.reservationIds));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches/:id/dispatch',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.transitionDispatch(requireUid(req), id, 'DISPATCHED'));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/dispatches/:id/cancel',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.transitionDispatch(requireUid(req), id, 'CANCELLED'));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Physical stocktaking ───────────────────────────────────────────

const countSessionCreateSchema = z.object({
  locationId: z.string().min(1),
  scheduledDate: z.coerce.date(),
});
type CountSessionCreateInput = z.infer<typeof countSessionCreateSchema>;

const countLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        countedQ: z.number().min(0),
        countedBags: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
});

const recountLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        recountQ: z.number().min(0),
        recountBags: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
});

const requestRecountSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1),
});

router.get(
  '/count-sessions',
  requirePermission('warehouse:view'),
  validateQuery(statusQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.query as { status?: string };
      res.json(await svc.listCountSessions(status));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/count-sessions/:id',
  requirePermission('warehouse:view'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.getCountSession(id));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/count-sessions',
  requirePermission('warehouse:manage'),
  validateBody(countSessionCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as { locationId: string; scheduledDate: Date };
      res
        .status(201)
        .json(await svc.createCountSession(requireUid(req), { ...b, scheduledDate: b.scheduledDate.toISOString() }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/count-sessions/:id/submit',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(countLinesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof countLinesSchema>;
      res.json(await svc.submitCounts(requireUid(req), id, b.lines));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/count-sessions/:id/request-recount',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(requestRecountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof requestRecountSchema>;
      res.json(await svc.requestRecount(requireUid(req), id, b.lineIds));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/count-sessions/:id/submit-recount',
  requirePermission('warehouse:manage'),
  validateParams(idParamSchema),
  validateBody(recountLinesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof recountLinesSchema>;
      res.json(await svc.submitRecount(requireUid(req), id, b.lines));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/count-sessions/:id/approve',
  requirePermission('warehouse:approve'),
  validateParams(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      res.json(await svc.approveCountSession(requireUid(req), id));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Valuation & reports ────────────────────────────────────────────

const reportQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

router.get(
  '/reports/valuation',
  requirePermission('warehouse:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { locationId } = req.query as { locationId?: string };
      res.json(await svc.valuation(locationId));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/movements',
  requirePermission('warehouse:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query as { locationId?: string; from?: string; to?: string };
      res.json(await svc.movementsSummary({ locationId: q.locationId, from: q.from, to: q.to }));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/reports/aging',
  requirePermission('warehouse:view'),
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { locationId } = req.query as { locationId?: string };
      res.json(await svc.stockAging(locationId));
    } catch (err) {
      next(err);
    }
  },
);

// Health check (no real products dependency) — proves the module's tables exist.
router.get('/health', requirePermission('warehouse:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "WhLocation" LIMIT 1`);
    res.json({ ok: true, module: 'warehouse' });
  } catch (err) {
    next(err);
  }
});
