import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  Prisma,
  WheatCategory,
  BatchProductType,
  ShiftType,
  PieceStage,
  Disposition,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/rbac';
import { validateBody } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit, type DbClient } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { recordShiftOutputs } from '../production/service';
import { createLabCheck } from '../qc/service';
import { createDispatch, invoiceDispatch } from '../sales/service';
import { decideIntake, recordLabResult } from '../procurement/service';
import { queueSms } from '../sms/service';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

const mutationSchema = z.object({
  clientUuid: z.string().uuid(),
  entity: z.enum([
    'WheatIntake',
    'IntakeLab',
    'TankFill',
    'TankEmpty',
    'ProductionBatch',
    'BatchBlend',
    'WashingLog',
    'ShiftRun',
    'ShiftOutput',
    'ShiftDowntime',
    'LabCheck',
    'Capa',
    'PackagingRun',
    'WarehouseTransfer',
    'AdvancePayment',
    'SalesOrder',
    'Dispatch',
    'IntakeDecision',
    'DispatchInvoice',
    'PieceRateLog',
  ]),
  data: z.record(z.unknown()),
  ts: z.string().datetime(),
});

type MutationEntity = z.infer<typeof mutationSchema>['entity'];

/**
 * The web PWA queues mutations with kebab-case entity names; normalize them to
 * the canonical PascalCase names before zod validation so both forms sync.
 */
const ENTITY_ALIAS: Record<string, MutationEntity> = {
  'wheat-intake': 'WheatIntake',
  'intake-lab': 'IntakeLab',
  'tank-fill': 'TankFill',
  'tank-empty': 'TankEmpty',
  'production-batch': 'ProductionBatch',
  'batch-blend': 'BatchBlend',
  'washing-log': 'WashingLog',
  'shift-run': 'ShiftRun',
  'shift-output': 'ShiftOutput',
  'shift-downtime': 'ShiftDowntime',
  'lab-check': 'LabCheck',
  capa: 'Capa',
  'advance-payment': 'AdvancePayment',
  'sales-order': 'SalesOrder',
  dispatch: 'Dispatch',
  'piece-rate-log': 'PieceRateLog',
};

function normalizeEntities(req: Request, _res: Response, next: NextFunction): void {
  const body = req.body as { mutations?: Array<{ entity?: unknown }> } | undefined;
  if (body && Array.isArray(body.mutations)) {
    for (const m of body.mutations) {
      if (m && typeof m.entity === 'string') {
        const canonical = ENTITY_ALIAS[m.entity];
        if (canonical) m.entity = canonical;
      }
    }
  }
  next();
}

const batchSchema = z.object({
  deviceId: z.string().min(1),
  mutations: z.array(mutationSchema).min(1).max(200),
});

const ENTITY_ORDER: Record<MutationEntity, number> = {
  WheatIntake: 0,
  IntakeLab: 1,
  TankFill: 2,
  TankEmpty: 3,
  ProductionBatch: 4,
  BatchBlend: 5,
  WashingLog: 6,
  ShiftRun: 7,
  ShiftOutput: 8,
  ShiftDowntime: 9,
  LabCheck: 10,
  Capa: 11,
  PackagingRun: 12,
  WarehouseTransfer: 13,
  AdvancePayment: 14,
  SalesOrder: 15,
  Dispatch: 16,
  IntakeDecision: 17,
  DispatchInvoice: 18,
  PieceRateLog: 19,
};

function parseOr400<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

// ─── Per-entity data schemas ─────────────────────────────────────

const wheatIntakeDataSchema = z.object({
  supplierId: z.string().min(1),
  truckPlate: z.string().min(1),
  wheatCategory: z.nativeEnum(WheatCategory),
  wheatOrigin: z.string().optional(),
  bagCount: z.number().int().positive(),
  deliveryDate: z.string().datetime().optional(),
});

const tankFillDataSchema = z.object({
  tankCode: z.string().min(1),
  intakeId: z.string().optional(),
  quintals: z.number().positive(),
  blendRatio: z.record(z.unknown()).optional(),
});

const productionBatchDataSchema = z.object({
  productType: z.nativeEnum(BatchProductType),
  blendSoftPct: z.number(),
  blendHardPct: z.number(),
  blendForeignPct: z.number(),
  blendSoftQ: z.number(),
  blendHardQ: z.number(),
  blendForeignQ: z.number(),
  wheatWeighedQ: z.number(),
});

const shiftRunDataSchema = z.object({
  batchId: z.string().min(1),
  shift: z.nativeEnum(ShiftType),
  shiftDate: z.string().datetime(),
  startedAt: z.string().datetime(),
  operators: z.array(z.string()).optional(),
});

const shiftOutputDataSchema = z.object({
  shiftRunId: z.string().min(1),
  productId: z.string().min(1),
  quintals: z.number().positive(),
});

const labCheckDataSchema = z.object({
  shiftRunId: z.string().min(1),
  sampleTime: z.string().datetime().optional(),
  impurityPct: z.number().optional(),
  wheatMoistureBefore: z.number().optional(),
  wheatMoistureAfter: z.number().optional(),
  flourMoisturePct: z.number().optional(),
  wetGlutenPct: z.number().optional(),
  glutenElasticity: z.string().optional(),
  dryGlutenPct: z.number().optional(),
  ashPct: z.number().optional(),
  colorScore: z.number().optional(),
  granulationPct: z.number().nullable().optional(),
});

const packagingRunDataSchema = z.object({
  batchId: z.string().min(1),
  productId: z.string().min(1),
  packagingSizeId: z.string().min(1),
  bags: z.number().int().positive(),
  quintals: z.number().positive(),
  productionDate: z.string().datetime(),
  locationCode: z.string().optional(),
});

const warehouseTransferDataSchema = z.object({
  productId: z.string().min(1),
  batchNo: z.string().min(1),
  packagingSizeId: z.string().optional(),
  fromLocation: z.string().min(1),
  toLocation: z.string().min(1),
  quintals: z.number().positive(),
  laborer: z.string().optional(),
});

const dispatchLineDataSchema = z.object({
  orderId: z.string().optional(),
  productId: z.string().min(1),
  batchNo: z.string().min(1),
  packagingSizeId: z.string().nullable().optional(),
  bags: z.number().int().optional(),
  quintals: z.number(),
});

const dispatchDataSchema = z.object({
  vehicleId: z.string().min(1),
  area: z.string().min(1),
  orderIds: z.array(z.string()),
  lines: z.array(dispatchLineDataSchema).min(1),
  fromLocation: z.string().optional(),
  loadingCrew: z
    .array(z.object({ laborer: z.string().min(1), quintals: z.number() }))
    .optional(),
  departureDate: z.string().datetime().optional(),
});

const intakeDecisionDataSchema = z.object({
  intakeId: z.string().min(1),
  decision: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().optional(),
  pricePerQuintalBirr: z.number().optional(),
  granaryDumping: z
    .array(z.object({ laborer: z.string().min(1), quintals: z.number() }))
    .optional(),
});

const intakeLabDataSchema = z.object({
  intakeId: z.string().min(1),
  glutenPct: z.number().min(0),
  moisturePct: z.number().min(0),
  impurityPct: z.number().min(0),
  hectoliterPct: z.number().min(0),
  germinationPct: z.number().min(0),
});

const tankEmptyDataSchema = z.object({
  tankCode: z.string().min(1),
  quintals: z.number().positive(),
  partial: z.boolean().optional(),
});

const batchBlendDataSchema = z.object({
  batchId: z.string().min(1),
  blendSoftPct: z.number().min(0).max(100),
  blendHardPct: z.number().min(0).max(100),
  blendForeignPct: z.number().min(0).max(100),
  blendSoftQ: z.number().nonnegative(),
  blendHardQ: z.number().nonnegative(),
  blendForeignQ: z.number().nonnegative(),
});

const washingLogDataSchema = z.object({
  tankOrSilo: z.string().min(1).max(100),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  downtimeMin: z.number().int().min(0).optional(),
  equipmentChange: z.string().max(500).optional(),
  operators: z.array(z.string()).optional(),
  batchId: z.string().min(1).optional(),
});

const shiftDowntimeDataSchema = z.object({
  shiftRunId: z.string().min(1),
  downtimeMin: z.number().int().min(0),
  downtimeReason: z.string().max(500).optional(),
});

const capaDataSchema = z.object({
  batchId: z.string().min(1),
  issueDescription: z.string().min(1).max(2000),
  correctionType: z.string().max(200).optional(),
  correctionDetail: z.string().max(2000).optional(),
  performedBy: z.string().max(200).optional(),
  disposition: z.nativeEnum(Disposition).optional(),
});

const advancePaymentDataSchema = z.object({
  customerId: z.string().min(1),
  amountBirr: z.number().positive(),
});

const salesOrderDataSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
  quintals: z.number().positive(),
  priceBirr: z.number().positive(),
  requestedDate: z.string().datetime().optional(),
  orderDate: z.string().datetime().optional(),
});

const pieceRateLogDataSchema = z.object({
  stage: z.nativeEnum(PieceStage),
  laborer: z.string().min(1),
  quintals: z.number().positive(),
  truckPlate: z.string().optional(),
});

const dispatchInvoiceDataSchema = z.object({
  dispatchId: z.string().min(1),
  amountBirr: z.number().positive(),
});

interface LabCheckInput {
  shiftRunId: string;
  sampleTime?: Date;
  impurityPct?: number;
  wheatMoistureBefore?: number;
  wheatMoistureAfter?: number;
  flourMoisturePct?: number;
  wetGlutenPct?: number;
  glutenElasticity?: string;
  dryGlutenPct?: number;
  ashPct?: number;
  colorScore?: number;
  granulationPct?: number | null;
}

async function applyMutation(
  tx: DbClient,
  entity: MutationEntity,
  data: unknown,
  uid: string,
  hasPerm: (code: string) => boolean,
): Promise<string> {
  switch (entity) {
    case 'WheatIntake': {
      const d = parseOr400(wheatIntakeDataSchema, data);
      const intake = await tx.wheatIntake.create({
        data: {
          intakeNo: await nextDocNo(tx, 'wheatIntake', 'intakeNo', 'INT'),
          deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : new Date(),
          supplierId: d.supplierId,
          truckPlate: d.truckPlate,
          wheatCategory: d.wheatCategory,
          wheatOrigin: d.wheatOrigin ?? null,
          bagCount: d.bagCount,
          quintals: new Prisma.Decimal(d.bagCount),
          status: 'PENDING_LAB',
          createdById: uid,
        },
      });
      return intake.id;
    }

    case 'TankFill': {
      const d = parseOr400(tankFillDataSchema, data);
      const quintals = new Prisma.Decimal(d.quintals);
      const fill = await tx.tankFill.create({
        data: {
          tankCode: d.tankCode,
          intakeId: d.intakeId ?? null,
          quintals,
          blendRatio: d.blendRatio
            ? (d.blendRatio as unknown as Prisma.InputJsonValue)
            : undefined,
          filledById: uid,
        },
      });
      await tx.storageMovement.create({
        data: {
          locationCode: 'DRY_POOL',
          direction: 'OUT',
          quintals,
          reference: `TANK_FILL:${fill.id}`,
          movedById: uid,
        },
      });
      return fill.id;
    }

    case 'ProductionBatch': {
      const d = parseOr400(productionBatchDataSchema, data);
      const pctSum = d.blendSoftPct + d.blendHardPct + d.blendForeignPct;
      if (Math.abs(pctSum - 100) > 0.01) {
        throw new AppError(400, 'Blend percentages must sum to 100');
      }
      const batch = await tx.productionBatch.create({
        data: {
          batchNo: await nextDocNo(tx, 'productionBatch', 'batchNo', 'BATCH'),
          productType: d.productType,
          blendSoftPct: new Prisma.Decimal(d.blendSoftPct),
          blendHardPct: new Prisma.Decimal(d.blendHardPct),
          blendForeignPct: new Prisma.Decimal(d.blendForeignPct),
          blendSoftQ: new Prisma.Decimal(d.blendSoftQ),
          blendHardQ: new Prisma.Decimal(d.blendHardQ),
          blendForeignQ: new Prisma.Decimal(d.blendForeignQ),
          wheatWeighedQ: new Prisma.Decimal(d.wheatWeighedQ),
          createdById: uid,
        },
      });
      return batch.id;
    }

    case 'ShiftRun': {
      const d = parseOr400(shiftRunDataSchema, data);
      const run = await tx.shiftRun.create({
        data: {
          batchId: d.batchId,
          shift: d.shift,
          shiftDate: new Date(d.shiftDate),
          startedAt: new Date(d.startedAt),
          operators: d.operators ?? [],
          createdById: uid,
        },
      });
      return run.id;
    }

    case 'ShiftOutput': {
      const d = parseOr400(shiftOutputDataSchema, data);
      await recordShiftOutputs(
        tx,
        d.shiftRunId,
        [{ productId: d.productId, quintals: new Prisma.Decimal(d.quintals) }],
        uid,
      );
      const created = await tx.shiftOutput.findFirst({
        where: { shiftRunId: d.shiftRunId, productId: d.productId },
        orderBy: { loggedAt: 'desc' },
      });
      if (!created) throw new AppError(500, 'Shift output was not recorded');
      return created.id;
    }

    case 'LabCheck': {
      const d = parseOr400(labCheckDataSchema, data);
      const input: LabCheckInput = { shiftRunId: d.shiftRunId };
      if (d.sampleTime) input.sampleTime = new Date(d.sampleTime);
      if (d.impurityPct !== undefined) input.impurityPct = d.impurityPct;
      if (d.wheatMoistureBefore !== undefined) input.wheatMoistureBefore = d.wheatMoistureBefore;
      if (d.wheatMoistureAfter !== undefined) input.wheatMoistureAfter = d.wheatMoistureAfter;
      if (d.flourMoisturePct !== undefined) input.flourMoisturePct = d.flourMoisturePct;
      if (d.wetGlutenPct !== undefined) input.wetGlutenPct = d.wetGlutenPct;
      if (d.glutenElasticity !== undefined) input.glutenElasticity = d.glutenElasticity;
      if (d.dryGlutenPct !== undefined) input.dryGlutenPct = d.dryGlutenPct;
      if (d.ashPct !== undefined) input.ashPct = d.ashPct;
      if (d.colorScore !== undefined) input.colorScore = d.colorScore;
      if (d.granulationPct !== undefined) input.granulationPct = d.granulationPct;
      const { labCheck } = await createLabCheck(tx, input, uid);
      return labCheck.id;
    }

    case 'IntakeLab': {
      const d = parseOr400(intakeLabDataSchema, data);
      await recordLabResult(
        tx,
        d.intakeId,
        {
          glutenPct: d.glutenPct,
          moisturePct: d.moisturePct,
          impurityPct: d.impurityPct,
          hectoliterPct: d.hectoliterPct,
          germinationPct: d.germinationPct,
        },
        uid,
      );
      return d.intakeId;
    }

    case 'TankEmpty': {
      const d = parseOr400(tankEmptyDataSchema, data);
      const [fills, events] = await Promise.all([
        tx.tankFill.aggregate({
          where: { tankCode: d.tankCode },
          _sum: { quintals: true },
        }),
        tx.tankEvent.aggregate({
          where: { tankCode: d.tankCode, event: { in: ['PARTIAL_EMPTY', 'EMPTIED'] } },
          _sum: { quintals: true },
        }),
      ]);
      const level = (fills._sum.quintals ?? new Prisma.Decimal(0)).minus(
        events._sum.quintals ?? new Prisma.Decimal(0),
      );
      const requested = new Prisma.Decimal(d.quintals);
      if (requested.gt(level)) {
        throw new AppError(
          400,
          `Requested ${requested.toFixed(2)}q exceeds tank ${d.tankCode} level of ${level.toFixed(2)}q`,
        );
      }
      const event = d.partial
        ? await tx.tankEvent.create({
            data: { tankCode: d.tankCode, event: 'PARTIAL_EMPTY', quintals: requested, byId: uid },
          })
        : await tx.tankEvent.create({
            data: {
              tankCode: d.tankCode,
              event: 'EMPTIED',
              quintals: level,
              note: 'full drain; residual ≤2q absorbed',
              byId: uid,
            },
          });
      return event.id;
    }

    case 'BatchBlend': {
      const d = parseOr400(batchBlendDataSchema, data);
      const pctSum = d.blendSoftPct + d.blendHardPct + d.blendForeignPct;
      if (Math.abs(pctSum - 100) > 0.01) {
        throw new AppError(400, 'Blend percentages must sum to 100');
      }
      const batch = await tx.productionBatch.findUnique({ where: { id: d.batchId } });
      if (!batch) throw new AppError(404, 'Production batch not found');
      if (batch.status !== 'OPEN') throw new AppError(409, 'Only OPEN batches can be edited');
      await tx.productionBatch.update({
        where: { id: d.batchId },
        data: {
          blendSoftPct: new Prisma.Decimal(d.blendSoftPct),
          blendHardPct: new Prisma.Decimal(d.blendHardPct),
          blendForeignPct: new Prisma.Decimal(d.blendForeignPct),
          blendSoftQ: new Prisma.Decimal(d.blendSoftQ),
          blendHardQ: new Prisma.Decimal(d.blendHardQ),
          blendForeignQ: new Prisma.Decimal(d.blendForeignQ),
        },
      });
      return batch.id;
    }

    case 'WashingLog': {
      const d = parseOr400(washingLogDataSchema, data);
      if (d.batchId) {
        const batch = await tx.productionBatch.findUnique({ where: { id: d.batchId } });
        if (!batch) throw new AppError(404, 'Production batch not found');
      }
      const startedAt = new Date(d.startedAt);
      const endedAt = d.endedAt ? new Date(d.endedAt) : null;
      const log = await tx.washingLog.create({
        data: {
          tankOrSilo: d.tankOrSilo,
          startedAt,
          endedAt,
          durationMin: endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
            : null,
          downtimeMin: d.downtimeMin ?? 0,
          equipmentChange: d.equipmentChange ?? null,
          operators: d.operators ?? [],
          batchId: d.batchId ?? null,
          createdById: uid,
        },
      });
      return log.id;
    }

    case 'ShiftDowntime': {
      const d = parseOr400(shiftDowntimeDataSchema, data);
      const existing = await tx.shiftRun.findUnique({ where: { id: d.shiftRunId } });
      if (!existing) throw new AppError(404, 'Shift run not found');
      // Offline downtime entries accumulate; the latest reason is kept.
      await tx.shiftRun.update({
        where: { id: d.shiftRunId },
        data: {
          downtimeMin: (existing.downtimeMin ?? 0) + d.downtimeMin,
          downtimeReason: d.downtimeReason ?? existing.downtimeReason,
        },
      });
      return existing.id;
    }

    case 'Capa': {
      const d = parseOr400(capaDataSchema, data);
      const batch = await tx.productionBatch.findUnique({ where: { id: d.batchId } });
      if (!batch) throw new AppError(404, 'Production batch not found');
      const created = await tx.cAPA.create({
        data: {
          capaNo: await nextDocNo(tx, 'capa', 'capaNo', 'CAPA'),
          batchId: d.batchId,
          issueDescription: d.issueDescription,
          correctionType: d.correctionType ?? null,
          correctionDetail: d.correctionDetail ?? null,
          performedBy: d.performedBy ?? null,
          disposition: d.disposition ?? null,
          identifiedById: uid,
          status: 'OPEN',
        },
      });
      return created.id;
    }

    case 'AdvancePayment': {
      const d = parseOr400(advancePaymentDataSchema, data);
      const customer = await tx.customer.findUnique({ where: { id: d.customerId } });
      if (!customer) throw new AppError(404, 'Customer not found');
      const created = await tx.advancePayment.create({
        data: {
          customerId: customer.id,
          amountBirr: new Prisma.Decimal(d.amountBirr),
          receivedById: uid,
        },
      });
      if (customer.phone) {
        await queueSms({
          to: customer.phone,
          message: `[OYAYA ERP] Advance of ${d.amountBirr} ETB received. Thank you.`,
          trigger: 'ADVANCE_RECEIVED',
        });
      }
      return created.id;
    }

    case 'SalesOrder': {
      const d = parseOr400(salesOrderDataSchema, data);
      const created = await tx.salesOrder.create({
        data: {
          orderNo: await nextDocNo(tx, 'salesOrder', 'orderNo', 'ORD'),
          customerId: d.customerId,
          productId: d.productId,
          quintals: new Prisma.Decimal(d.quintals),
          priceBirr: new Prisma.Decimal(d.priceBirr),
          requestedDate: d.requestedDate ? new Date(d.requestedDate) : null,
          orderDate: d.orderDate ? new Date(d.orderDate) : new Date(),
          status: 'OPEN',
          createdById: uid,
        },
      });
      return created.id;
    }

    case 'PieceRateLog': {
      const d = parseOr400(pieceRateLogDataSchema, data);
      const created = await tx.pieceRateLog.create({
        data: {
          stage: d.stage,
          laborer: d.laborer,
          quintals: new Prisma.Decimal(d.quintals),
          truckPlate: d.truckPlate ?? null,
          loggedById: uid,
        },
      });
      return created.id;
    }

    case 'PackagingRun': {
      const d = parseOr400(packagingRunDataSchema, data);
      const batch = await tx.productionBatch.findUniqueOrThrow({ where: { id: d.batchId } });
      if (batch.status !== 'APPROVED') {
        throw new AppError(409, 'Batch must be APPROVED before packaging');
      }
      const locationCode = d.locationCode ?? 'FG_WH_1';
      const quintals = new Prisma.Decimal(d.quintals);
      const run = await tx.packagingRun.create({
        data: {
          batchId: d.batchId,
          productId: d.productId,
          packagingSizeId: d.packagingSizeId,
          bags: d.bags,
          quintals,
          productionDate: new Date(d.productionDate),
          packedById: uid,
        },
      });
      await tx.finishedGoodsStock.upsert({
        where: {
          productId_batchNo_packagingSizeId_locationCode: {
            productId: d.productId,
            batchNo: batch.batchNo,
            packagingSizeId: d.packagingSizeId,
            locationCode,
          },
        },
        update: { bags: { increment: d.bags }, quintals: { increment: quintals } },
        create: {
          productId: d.productId,
          batchNo: batch.batchNo,
          packagingSizeId: d.packagingSizeId,
          locationCode,
          bags: d.bags,
          quintals,
        },
      });
      return run.id;
    }

    case 'WarehouseTransfer': {
      const d = parseOr400(warehouseTransferDataSchema, data);
      const quintals = new Prisma.Decimal(d.quintals);
      const composite = {
        productId: d.productId,
        batchNo: d.batchNo,
        packagingSizeId: d.packagingSizeId ?? null,
        locationCode: d.fromLocation,
      };
      const source = await tx.finishedGoodsStock.findFirst({
        where: {
          productId: d.productId,
          batchNo: d.batchNo,
          packagingSizeId: d.packagingSizeId ?? null,
          locationCode: d.fromLocation,
        },
      });
      if (!source || source.quintals.lt(quintals)) {
        throw new AppError(400, 'Insufficient stock at source location');
      }
      await tx.finishedGoodsStock.update({
        where: { id: source.id },
        data: { quintals: source.quintals.minus(quintals) },
      });
      const dest = await tx.finishedGoodsStock.findFirst({
        where: {
          productId: d.productId,
          batchNo: d.batchNo,
          packagingSizeId: d.packagingSizeId ?? null,
          locationCode: d.toLocation,
        },
      });
      if (dest) {
        await tx.finishedGoodsStock.update({
          where: { id: dest.id },
          data: { quintals: { increment: quintals } },
        });
      } else {
        await tx.finishedGoodsStock.create({
          data: {
            productId: d.productId,
            batchNo: d.batchNo,
            packagingSizeId: d.packagingSizeId ?? null,
            locationCode: d.toLocation,
            bags: 0,
            quintals,
          },
        });
      }
      const transfer = await tx.warehouseTransfer.create({
        data: {
          productId: d.productId,
          batchNo: d.batchNo,
          fromLocation: d.fromLocation,
          toLocation: d.toLocation,
          quintals,
          laborer: d.laborer ?? null,
          movedById: uid,
        },
      });
      if (d.laborer) {
        await tx.pieceRateLog.create({
          data: {
            stage: PieceStage.STORE_MOVEMENT,
            laborer: d.laborer,
            quintals,
            loggedById: uid,
          },
        });
      }
      return transfer.id;
    }

    case 'Dispatch': {
      const d = parseOr400(dispatchDataSchema, data);
      const dispatch = await createDispatch(
        tx,
        {
          vehicleId: d.vehicleId,
          area: d.area,
          orderIds: d.orderIds,
          lines: d.lines.map((l) => ({
            orderId: l.orderId,
            productId: l.productId,
            batchNo: l.batchNo,
            packagingSizeId: l.packagingSizeId ?? null,
            bags: l.bags,
            quintals: l.quintals,
          })),
          fromLocation: d.fromLocation,
          loadingCrew: d.loadingCrew,
          departureDate: d.departureDate ? new Date(d.departureDate) : undefined,
        },
        uid,
      );
      return dispatch.id;
    }

    case 'IntakeDecision': {
      if (!hasPerm('procurement:approve')) {
        throw new AppError(403, 'Forbidden: requires permission procurement:approve');
      }
      const d = parseOr400(intakeDecisionDataSchema, data);
      const intake = await decideIntake(
        tx,
        d.intakeId,
        {
          decision: d.decision,
          note: d.note,
          pricePerQuintalBirr: d.pricePerQuintalBirr,
          granaryDumping: d.granaryDumping,
        },
        uid,
      );
      return intake.id;
    }

    case 'DispatchInvoice': {
      if (!hasPerm('sales:manage')) {
        throw new AppError(403, 'Forbidden: requires permission sales:manage');
      }
      const d = parseOr400(dispatchInvoiceDataSchema, data);
      const invoice = await invoiceDispatch(
        tx,
        d.dispatchId,
        new Prisma.Decimal(d.amountBirr),
        uid,
      );
      return invoice.id;
    }

    default: {
      const exhaustive: never = entity;
      throw new AppError(400, `Unsupported entity: ${String(exhaustive)}`);
    }
  }
}

// ─── POST /batch ─────────────────────────────────────────────────

router.post(
  '/batch',
  requirePermission('sync:manage'),
  normalizeEntities,
  validateBody(batchSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof batchSchema>;

      const accepted: string[] = [];
      const rejected: Array<{ clientUuid: string; reason: string }> = [];

      const me = await prisma.user.findUnique({
        where: { id: uid },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });
      if (!me) throw new AppError(401, 'Unauthenticated');
      const hasPerm = (code: string): boolean =>
        me.role.permissions.some(
          (p) => p.permission.code === code || p.permission.code.startsWith(`${code}:`),
        );

      // Idempotent replay: already-seen clientUuids are accepted without re-applying.
      const uuids = body.mutations.map((m) => m.clientUuid);
      const existing = await prisma.idempotencyLedger.findMany({
        where: { clientUuid: { in: uuids } },
        select: { clientUuid: true },
      });
      const existingSet = new Set(existing.map((e) => e.clientUuid));
      const fresh = body.mutations.filter((m) => {
        if (existingSet.has(m.clientUuid)) {
          accepted.push(m.clientUuid);
          return false;
        }
        return true;
      });

      // Apply in dependency order, then by client timestamp.
      fresh.sort(
        (a, b) =>
          ENTITY_ORDER[a.entity] - ENTITY_ORDER[b.entity] ||
          (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0),
      );

      for (const m of fresh) {
        try {
          let entityId: string | null = null;
          await prisma.$transaction(async (tx) => {
            const raced = await tx.idempotencyLedger.findUnique({
              where: { clientUuid: m.clientUuid },
            });
            if (raced) return;
            entityId = await applyMutation(tx, m.entity, m.data, uid, hasPerm);
            await tx.idempotencyLedger.create({
              data: {
                clientUuid: m.clientUuid,
                entityType: m.entity,
                entityId,
                deviceId: body.deviceId,
              },
            });
            await audit(tx, {
              userId: uid,
              action: 'SYNC',
              entityType: m.entity,
              entityId,
            });
          });
          accepted.push(m.clientUuid);
        } catch (err) {
          rejected.push({
            clientUuid: m.clientUuid,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      res.json({ accepted, rejected });
    } catch (err) {
      next(err);
    }
  },
);
