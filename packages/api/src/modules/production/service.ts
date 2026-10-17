import { Prisma } from '@prisma/client';
import { audit, type DbClient } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { emitEvent } from '../../lib/socket';
import { getPhonesForRoles, queueBulkSms } from '../sms/service';

export interface ShiftOutputInput {
  productId: string;
  quintals: Prisma.Decimal | number;
}

export interface RecordShiftOutputsResult {
  extractionPct: Prisma.Decimal;
  belowYieldFlag: boolean;
}

const LOW_YIELD_THRESHOLD = 78;

/**
 * Persist shift outputs, compute the shift extraction percentage
 * (flour-kind quintals / total quintals * 100), stamp every output row,
 * and raise a low-yield alert when extraction drops below 78%.
 */
export async function recordShiftOutputs(
  tx: DbClient,
  shiftRunId: string,
  outputs: ShiftOutputInput[],
  userId: string,
): Promise<RecordShiftOutputsResult> {
  const shiftRun = await tx.shiftRun.findUnique({
    where: { id: shiftRunId },
    include: { batch: true },
  });
  if (!shiftRun) throw new AppError(404, 'Shift run not found');

  for (const o of outputs) {
    await tx.shiftOutput.create({
      data: {
        shiftRunId,
        productId: o.productId,
        quintals: o.quintals instanceof Prisma.Decimal ? o.quintals : new Prisma.Decimal(o.quintals),
        loggedById: userId,
      },
    });
  }

  const rows = await tx.shiftOutput.findMany({
    where: { shiftRunId },
    include: { product: true },
  });

  let duketQ = new Prisma.Decimal(0);
  let totalQ = new Prisma.Decimal(0);
  for (const row of rows) {
    totalQ = totalQ.plus(row.quintals);
    if (row.product.kind === 'flour') duketQ = duketQ.plus(row.quintals);
  }
  if (totalQ.isZero()) throw new AppError(400, 'Shift has no recorded output quantities');

  const extractionPct = duketQ.div(totalQ).times(100);
  const belowYieldFlag = extractionPct.lt(LOW_YIELD_THRESHOLD);

  await tx.shiftOutput.updateMany({
    where: { shiftRunId },
    data: { extractionPct, belowYieldFlag },
  });

  if (belowYieldFlag) {
    const phones = await getPhonesForRoles(['Production Manager', 'Owner / CEO']);
    await queueBulkSms({
      to: phones,
      message: `[OYAYA ERP] LOW YIELD: batch ${shiftRun.batch.batchNo} ${shiftRun.shift} shift extraction ${extractionPct.toFixed(2)}% below 78%.`,
      trigger: 'LOW_YIELD',
    });
    emitEvent('yield-flag', {
      shiftRunId,
      batchNo: shiftRun.batch.batchNo,
      extractionPct: extractionPct.toNumber(),
    });
  }

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'ShiftOutput',
    entityId: shiftRunId,
    changes: {
      outputs: outputs.map((o) => ({ productId: o.productId, quintals: o.quintals.toString() })),
      extractionPct: extractionPct.toFixed(2),
      belowYieldFlag,
    },
  });

  return { extractionPct, belowYieldFlag };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Module 4: Production & Milling Management
 * NOTE: the models below live in /tmp/schema-module4.prisma until the
 * coordinator merges them. They are accessed through the typed shim `m4(tx)`
 * so this file typechecks against the current Prisma client and works
 * unchanged once the client is regenerated.
 * ═══════════════════════════════════════════════════════════════════════════ */

type NewDelegate = {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  findFirst(args?: unknown): Promise<Record<string, unknown> | null>;
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  create(args: { data: unknown }): Promise<Record<string, unknown>>;
  update(args: { where: { id: string }; data: unknown }): Promise<Record<string, unknown>>;
  updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
  count(args?: { where?: unknown }): Promise<number>;
};

interface M4Client {
  blendRecipe: NewDelegate;
  productionPlan: NewDelegate;
  millingRun: NewDelegate;
  downtimeLog: NewDelegate;
  flourOutput: NewDelegate;
  yieldAlert: NewDelegate;
  shiftHandover: NewDelegate;
}

function m4(tx: DbClient): M4Client {
  return tx as unknown as M4Client;
}

/** nextDocNo equivalent for tables not whitelisted in lib/numbers. */
async function m4NextDocNo(
  tx: DbClient,
  table: string,
  field: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const rows = await tx.$queryRaw<Array<{ n: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS "n" FROM ${Prisma.raw(`"${table}"`)} WHERE ${Prisma.raw(`"${field}"`)} LIKE ${stem + '%'}`,
  );
  const seq = (rows[0]?.n ?? 0) + 1;
  return `${stem}${String(seq).padStart(4, '0')}`;
}

export const FLOUR_PRODUCT_TYPES = [
  'DUKET_NORMAL',
  'DUKET_SPECIAL',
  'FURISHKA',
  'FINO',
  'FERNACHO',
] as const;

export type FlourProductType = (typeof FLOUR_PRODUCT_TYPES)[number];

export const DOWNTIME_CATEGORIES = ['POWER', 'MECHANICAL', 'ELECTRICAL', 'PLANNED', 'OTHER'] as const;

const LOW_YIELD_EXTRACTION_MIN = 78;
const EXCESS_DOWNTIME_DAILY_MIN = 120;

function pctSumOk(hard: number, soft: number, foreign: number): boolean {
  return Math.abs(hard + soft + foreign - 100) <= 0.01;
}

function toDec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

// ─── Blend recipes ─────────────────────────────────────────────────────────

export interface BlendRecipeInput {
  name: string;
  productType: FlourProductType;
  hardPct: number;
  softPct: number;
  foreignPct: number;
  isActive?: boolean;
  notes?: string | null;
}

function validateRecipeInput(r: BlendRecipeInput): void {
  for (const v of [r.hardPct, r.softPct, r.foreignPct]) {
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new AppError(400, 'Blend percentages must be between 0 and 100');
  }
  if (!pctSumOk(r.hardPct, r.softPct, r.foreignPct)) {
    throw new AppError(
      400,
      `Blend percentages must sum to 100 (got ${(r.hardPct + r.softPct + r.foreignPct).toFixed(2)})`,
    );
  }
}

export async function createBlendRecipe(
  tx: DbClient,
  input: BlendRecipeInput,
  userId: string,
): Promise<Record<string, unknown>> {
  validateRecipeInput(input);
  const db = m4(tx);
  if (input.isActive) {
    await db.blendRecipe.updateMany({
      where: { productType: input.productType },
      data: { isActive: false },
    });
  }
  const recipe = await db.blendRecipe.create({
    data: {
      name: input.name,
      productType: input.productType,
      hardPct: toDec(input.hardPct),
      softPct: toDec(input.softPct),
      foreignPct: toDec(input.foreignPct),
      isActive: input.isActive ?? false,
      notes: input.notes ?? null,
      createdById: userId,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'BlendRecipe',
    entityId: String(recipe.id),
    changes: { name: input.name, productType: input.productType },
  });
  return recipe;
}

export async function activateBlendRecipe(
  tx: DbClient,
  id: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const db = m4(tx);
  const recipe = await db.blendRecipe.findUnique({ where: { id } });
  if (!recipe) throw new AppError(404, 'Blend recipe not found');
  await db.blendRecipe.updateMany({
    where: { productType: String(recipe.productType) },
    data: { isActive: false },
  });
  const activated = await db.blendRecipe.update({ where: { id }, data: { isActive: true } });
  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'BlendRecipe',
    entityId: id,
    changes: { isActive: true },
  });
  return activated;
}

export interface BlendCompliance {
  recipe: Record<string, unknown> | null;
  actual: { hardPct: number; softPct: number; foreignPct: number };
  deviation: { hard: number; soft: number; foreign: number };
  withinTolerance: boolean;
  tolerancePct: number;
}

/**
 * Compare a production batch's locked blend against the active recipe for a
 * flour product. Duket Normal defaults for HARD_FLOUR batches, Furishka for
 * SOFT_FLOUR — caller may override via productType.
 */
export async function checkBlendCompliance(
  tx: DbClient,
  batchId: string,
  productType: FlourProductType,
  tolerancePct = 2,
): Promise<BlendCompliance> {
  const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError(404, 'Production batch not found');
  const db = m4(tx);
  const recipe = await db.blendRecipe.findFirst({
    where: { productType, isActive: true },
  });
  const actual = {
    hardPct: batch.blendHardPct.toNumber(),
    softPct: batch.blendSoftPct.toNumber(),
    foreignPct: batch.blendForeignPct.toNumber(),
  };
  const deviation = { hard: 0, soft: 0, foreign: 0 };
  let withinTolerance = recipe === null;
  if (recipe) {
    deviation.hard = actual.hardPct - Number(recipe.hardPct);
    deviation.soft = actual.softPct - Number(recipe.softPct);
    deviation.foreign = actual.foreignPct - Number(recipe.foreignPct);
    withinTolerance =
      Math.abs(deviation.hard) <= tolerancePct &&
      Math.abs(deviation.soft) <= tolerancePct &&
      Math.abs(deviation.foreign) <= tolerancePct;
  }
  return { recipe, actual, deviation, withinTolerance, tolerancePct };
}

// ─── Production plans ──────────────────────────────────────────────────────

export interface PlanTarget {
  productType: FlourProductType;
  plannedQ: number;
}

export interface ProductionPlanInput {
  tankCode?: string | null;
  batchId?: string | null;
  targets: PlanTarget[];
  plannedWheatQ: number;
  scheduledDate: Date;
  shift: 'MORNING' | 'NIGHT';
  notes?: string | null;
}

const PLAN_STATUS = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

function validatePlanInput(p: ProductionPlanInput): void {
  if (!Array.isArray(p.targets) || p.targets.length === 0) {
    throw new AppError(400, 'At least one target product is required');
  }
  for (const t of p.targets) {
    if (!FLOUR_PRODUCT_TYPES.includes(t.productType as FlourProductType)) {
      throw new AppError(400, `Unknown product type: ${t.productType}`);
    }
    if (!Number.isFinite(t.plannedQ) || t.plannedQ <= 0) {
      throw new AppError(400, 'Target quantities must be positive');
    }
  }
  if (!Number.isFinite(p.plannedWheatQ) || p.plannedWheatQ <= 0) {
    throw new AppError(400, 'Planned wheat quantity must be positive');
  }
}

export async function createProductionPlan(
  tx: DbClient,
  input: ProductionPlanInput,
  userId: string,
): Promise<Record<string, unknown>> {
  validatePlanInput(input);
  if (input.batchId) {
    const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new AppError(404, 'Production batch not found');
  }
  const planNo = await m4NextDocNo(tx, 'ProductionPlan', 'planNo', 'PB');
  const plan = await m4(tx).productionPlan.create({
    data: {
      planNo,
      tankCode: input.tankCode ?? null,
      batchId: input.batchId ?? null,
      targets: input.targets as unknown as Prisma.InputJsonValue,
      plannedWheatQ: toDec(input.plannedWheatQ),
      scheduledDate: input.scheduledDate,
      shift: input.shift,
      status: 'PLANNED',
      notes: input.notes ?? null,
      createdById: userId,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'ProductionPlan',
    entityId: String(plan.id),
    changes: { planNo, batchId: input.batchId ?? null },
  });
  return plan;
}

export async function transitionProductionPlan(
  tx: DbClient,
  id: string,
  to: PlanStatus,
  userId: string,
  actuals?: { actualWheatQ?: number; actualOutputQ?: number },
): Promise<Record<string, unknown>> {
  if (!PLAN_STATUS.includes(to)) throw new AppError(400, `Unknown plan status: ${to}`);
  const db = m4(tx);
  const plan = await db.productionPlan.findUnique({ where: { id } });
  if (!plan) throw new AppError(404, 'Production plan not found');
  const from = String(plan.status) as PlanStatus;
  if (!PLAN_TRANSITIONS[from].includes(to)) {
    throw new AppError(409, `Cannot move plan ${String(plan.planNo)} from ${from} to ${to}`);
  }
  const data: Record<string, unknown> = { status: to };
  if (actuals?.actualWheatQ !== undefined) {
    if (!Number.isFinite(actuals.actualWheatQ) || actuals.actualWheatQ < 0) {
      throw new AppError(400, 'Actual wheat quantity must be non-negative');
    }
    data.actualWheatQ = toDec(actuals.actualWheatQ);
  }
  if (actuals?.actualOutputQ !== undefined) {
    if (!Number.isFinite(actuals.actualOutputQ) || actuals.actualOutputQ < 0) {
      throw new AppError(400, 'Actual output quantity must be non-negative');
    }
    data.actualOutputQ = toDec(actuals.actualOutputQ);
  }
  const updated = await db.productionPlan.update({ where: { id }, data });
  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'ProductionPlan',
    entityId: id,
    changes: { from, to, ...actuals },
  });
  if (to === 'COMPLETED') {
    await checkPlanOutputVariance(tx, updated, userId);
  }
  return updated;
}

/** Raise an alert when a completed plan produced less than 90% of its target. */
async function checkPlanOutputVariance(
  tx: DbClient,
  plan: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const targets = (plan.targets ?? []) as PlanTarget[];
  const plannedTotal = targets.reduce((s, t) => s + Number(t.plannedQ ?? 0), 0);
  const actual = Number(plan.actualOutputQ ?? 0);
  if (plannedTotal > 0 && actual < plannedTotal * 0.9) {
    await raiseYieldAlert(tx, {
      alertType: 'LOW_OUTPUT_VS_PLAN',
      entityType: 'PLAN',
      entityId: String(plan.id),
      entityLabel: String(plan.planNo),
      message: `Plan ${String(plan.planNo)} produced ${actual.toFixed(1)} q vs ${plannedTotal.toFixed(1)} q planned (${((actual / plannedTotal) * 100).toFixed(1)}%)`,
      severity: 'AMBER',
    }, userId);
  }
}

// ─── Milling runs ──────────────────────────────────────────────────────────

export interface MillingRunInput {
  planId?: string | null;
  batchId: string;
  lineMachine: string;
  startedAt: Date;
  feedRateQHr?: number | null;
  rollSettings?: string | null;
  operator: string;
}

export async function startMillingRun(
  tx: DbClient,
  input: MillingRunInput,
  userId: string,
): Promise<Record<string, unknown>> {
  if (!input.batchId || !input.lineMachine.trim() || !input.operator.trim()) {
    throw new AppError(400, 'Batch, line/machine and operator are required');
  }
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new AppError(404, 'Production batch not found');
  if (input.planId) {
    const plan = await m4(tx).productionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new AppError(404, 'Production plan not found');
  }
  if (input.feedRateQHr !== undefined && input.feedRateQHr !== null &&
      (!Number.isFinite(input.feedRateQHr) || input.feedRateQHr <= 0)) {
    throw new AppError(400, 'Feed rate must be positive');
  }
  const runNo = await m4NextDocNo(tx, 'MillingRun', 'runNo', 'RUN');
  const run = await m4(tx).millingRun.create({
    data: {
      runNo,
      planId: input.planId ?? null,
      batchId: input.batchId,
      lineMachine: input.lineMachine.trim(),
      startedAt: input.startedAt,
      feedRateQHr: input.feedRateQHr != null ? toDec(input.feedRateQHr) : null,
      rollSettings: input.rollSettings?.trim() || null,
      operator: input.operator.trim(),
      status: 'RUNNING',
      createdById: userId,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'MillingRun',
    entityId: String(run.id),
    changes: { runNo, batchId: input.batchId, lineMachine: input.lineMachine },
  });
  return run;
}

export async function endMillingRun(
  tx: DbClient,
  id: string,
  userId: string,
  input: { endedAt: Date; status?: 'COMPLETED' | 'STOPPED'; feedRateQHr?: number | null; rollSettings?: string | null },
): Promise<Record<string, unknown>> {
  const db = m4(tx);
  const run = await db.millingRun.findUnique({ where: { id } });
  if (!run) throw new AppError(404, 'Milling run not found');
  if (String(run.status) !== 'RUNNING') throw new AppError(409, 'Only RUNNING runs can be ended');
  const start = new Date(String(run.startedAt)).getTime();
  if (input.endedAt.getTime() < start) throw new AppError(400, 'End time cannot be before start time');
  const durationMin = Math.round((input.endedAt.getTime() - start) / 60000);
  const data: Record<string, unknown> = {
    endedAt: input.endedAt,
    durationMin,
    status: input.status ?? 'COMPLETED',
  };
  if (input.feedRateQHr !== undefined && input.feedRateQHr !== null) {
    if (!Number.isFinite(input.feedRateQHr) || input.feedRateQHr <= 0) {
      throw new AppError(400, 'Feed rate must be positive');
    }
    data.feedRateQHr = toDec(input.feedRateQHr);
  }
  if (input.rollSettings !== undefined) data.rollSettings = input.rollSettings?.trim() || null;
  const updated = await db.millingRun.update({ where: { id }, data });
  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'MillingRun',
    entityId: id,
    changes: { status: data.status, durationMin },
  });
  return updated;
}

// ─── Downtime logs ─────────────────────────────────────────────────────────

export interface DowntimeInput {
  machineLine: string;
  runId?: string | null;
  shiftRunId?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  minutesLost: number;
  reasonCategory: (typeof DOWNTIME_CATEGORIES)[number];
  description?: string | null;
  resolvedBy?: string | null;
}

export async function logDowntime(
  tx: DbClient,
  input: DowntimeInput,
  userId: string,
): Promise<Record<string, unknown>> {
  if (!input.machineLine.trim()) throw new AppError(400, 'Machine/line is required');
  if (!Number.isInteger(input.minutesLost) || input.minutesLost <= 0) {
    throw new AppError(400, 'Minutes lost must be a positive integer');
  }
  if (!DOWNTIME_CATEGORIES.includes(input.reasonCategory)) {
    throw new AppError(400, `Unknown downtime category: ${input.reasonCategory}`);
  }
  if (input.endedAt && input.endedAt.getTime() < input.startedAt.getTime()) {
    throw new AppError(400, 'Downtime end cannot be before its start');
  }
  const entry = await m4(tx).downtimeLog.create({
    data: {
      machineLine: input.machineLine.trim(),
      runId: input.runId ?? null,
      shiftRunId: input.shiftRunId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      minutesLost: input.minutesLost,
      reasonCategory: input.reasonCategory,
      description: input.description?.trim() || null,
      resolvedBy: input.resolvedBy?.trim() || null,
      createdById: userId,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'DowntimeLog',
    entityId: String(entry.id),
    changes: { machineLine: input.machineLine, minutesLost: input.minutesLost, reasonCategory: input.reasonCategory },
  });
  // Excess-downtime alert: > EXCESS_DOWNTIME_DAILY_MIN minutes on this machine in 24h
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const recent = await m4(tx).downtimeLog.findMany({
    where: { machineLine: input.machineLine.trim(), startedAt: { gte: dayAgo } },
  });
  const total = recent.reduce((s, r) => s + Number(r.minutesLost ?? 0), 0);
  if (total >= EXCESS_DOWNTIME_DAILY_MIN) {
    await raiseYieldAlert(tx, {
      alertType: 'EXCESS_DOWNTIME',
      entityType: 'MILLING_RUN',
      entityId: String(entry.id),
      entityLabel: input.machineLine.trim(),
      message: `${input.machineLine.trim()} lost ${total} min to downtime in the last 24h (threshold ${EXCESS_DOWNTIME_DAILY_MIN} min)`,
      severity: 'AMBER',
    }, userId);
  }
  return entry;
}

export interface DowntimeSummaryRow {
  id: string;
  machineLine: string;
  events: number;
  minutesLost: number;
  byCategory: Record<string, number>;
  uptimePct: number;
}

export async function downtimeSummary(
  tx: DbClient,
  from: Date,
  to: Date,
): Promise<DowntimeSummaryRow[]> {
  const logs = await m4(tx).downtimeLog.findMany({
    where: { startedAt: { gte: from, lte: to } },
  });
  const windowMin = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  const byMachine = new Map<string, DowntimeSummaryRow>();
  for (const l of logs) {
    const key = String(l.machineLine);
    let row = byMachine.get(key);
    if (!row) {
      row = { id: key, machineLine: key, events: 0, minutesLost: 0, byCategory: {}, uptimePct: 100 };
      byMachine.set(key, row);
    }
    row.events += 1;
    row.minutesLost += Number(l.minutesLost ?? 0);
    const cat = String(l.reasonCategory);
    row.byCategory[cat] = (row.byCategory[cat] ?? 0) + Number(l.minutesLost ?? 0);
  }
  for (const row of byMachine.values()) {
    row.uptimePct = Math.max(0, (1 - row.minutesLost / windowMin) * 100);
  }
  return [...byMachine.values()].sort((a, b) => b.minutesLost - a.minutesLost);
}

// ─── Flour output & extraction ─────────────────────────────────────────────

export interface FlourOutputInput {
  batchId: string;
  productType: FlourProductType;
  quintals: number;
}

export interface FlourOutputResult {
  output: Record<string, unknown>;
  extractionPct: number;
  belowYieldFlag: boolean;
}

export async function recordFlourOutput(
  tx: DbClient,
  input: FlourOutputInput,
  userId: string,
): Promise<FlourOutputResult> {
  if (!FLOUR_PRODUCT_TYPES.includes(input.productType)) {
    throw new AppError(400, `Unknown product type: ${input.productType}`);
  }
  if (!Number.isFinite(input.quintals) || input.quintals <= 0) {
    throw new AppError(400, 'Output quantity must be positive');
  }
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new AppError(404, 'Production batch not found');
  const wheatQ = batch.wheatWeighedQ.toNumber();
  if (wheatQ <= 0) throw new AppError(400, 'Batch has no weighed wheat quantity');
  const extractionPct = (input.quintals / wheatQ) * 100;
  const isDuket = input.productType === 'DUKET_NORMAL' || input.productType === 'DUKET_SPECIAL';
  const belowYieldFlag = extractionPct < LOW_YIELD_EXTRACTION_MIN;
  const severity = isDuket && belowYieldFlag ? 'RED' : belowYieldFlag ? 'AMBER' : null;

  const db = m4(tx);
  const output = await db.flourOutput.create({
    data: {
      batchId: input.batchId,
      productType: input.productType,
      quintals: toDec(input.quintals),
      extractionPct: toDec(Number(extractionPct.toFixed(2))),
      belowYieldFlag,
      loggedById: userId,
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'FlourOutput',
    entityId: String(output.id),
    changes: { batchId: input.batchId, productType: input.productType, quintals: input.quintals, extractionPct: Number(extractionPct.toFixed(2)), belowYieldFlag },
  });
  if (belowYieldFlag && severity) {
    await raiseYieldAlert(tx, {
      alertType: 'LOW_EXTRACTION',
      entityType: 'BATCH',
      entityId: input.batchId,
      entityLabel: batch.batchNo,
      message: `Batch ${batch.batchNo} ${input.productType.replace('_', ' ')} extraction ${extractionPct.toFixed(1)}% is below ${LOW_YIELD_EXTRACTION_MIN}%`,
      severity,
    }, userId);
  }
  const result = { output, extractionPct: Number(extractionPct.toFixed(2)), belowYieldFlag };
  if (belowYieldFlag) {
    const phones = await getPhonesForRoles(['Production Manager', 'Owner / CEO']);
    await queueBulkSms({
      to: phones,
      message: `[OYAYA ERP] LOW YIELD: batch ${batch.batchNo} ${input.productType.replace('_', ' ')} extraction ${extractionPct.toFixed(1)}% below ${LOW_YIELD_EXTRACTION_MIN}%.`,
      trigger: 'LOW_YIELD',
    });
    emitEvent('yield-flag', {
      batchId: input.batchId,
      batchNo: batch.batchNo,
      productType: input.productType,
      extractionPct: Number(extractionPct.toFixed(2)),
    });
  }
  return result;
}

// ─── Yield alerts ──────────────────────────────────────────────────────────

export interface YieldAlertInput {
  alertType: 'LOW_EXTRACTION' | 'LOW_OUTPUT_VS_PLAN' | 'EXCESS_DOWNTIME';
  entityType: 'BATCH' | 'PLAN' | 'SHIFT_RUN' | 'MILLING_RUN';
  entityId: string;
  entityLabel?: string | null;
  message: string;
  severity: 'AMBER' | 'RED';
}

export async function raiseYieldAlert(
  tx: DbClient,
  input: YieldAlertInput,
  userId: string,
): Promise<Record<string, unknown>> {
  const alert = await m4(tx).yieldAlert.create({
    data: {
      alertType: input.alertType,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel ?? null,
      message: input.message,
      severity: input.severity,
      status: 'OPEN',
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'YieldAlert',
    entityId: String(alert.id),
    changes: { alertType: input.alertType, severity: input.severity },
  });
  emitEvent('yield-alert', {
    id: String(alert.id),
    alertType: input.alertType,
    severity: input.severity,
    message: input.message,
  });
  return alert;
}

export async function acknowledgeYieldAlert(
  tx: DbClient,
  id: string,
  userId: string,
  ackNotes?: string | null,
): Promise<Record<string, unknown>> {
  const db = m4(tx);
  const alert = await db.yieldAlert.findUnique({ where: { id } });
  if (!alert) throw new AppError(404, 'Yield alert not found');
  if (String(alert.status) !== 'OPEN') throw new AppError(409, 'Only OPEN alerts can be acknowledged');
  const saved = await db.yieldAlert.update({
    where: { id },
    data: {
      status: 'ACKNOWLEDGED',
      acknowledgedById: userId,
      acknowledgedAt: new Date(),
      ackNotes: ackNotes?.trim() || null,
    },
  });
  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'YieldAlert',
    entityId: id,
    changes: { status: 'ACKNOWLEDGED', ackNotes: ackNotes?.trim() || null },
  });
  return saved;
}

// ─── Shift handovers (Shift.tsx enhancement) ───────────────────────────────

export async function createShiftHandover(
  tx: DbClient,
  shiftRunId: string,
  userId: string,
  noteType: 'HANDOVER' | 'OPERATOR_NOTE',
  content: string,
): Promise<Record<string, unknown>> {
  if (!content.trim()) throw new AppError(400, 'Note content is required');
  const shift = await tx.shiftRun.findUnique({ where: { id: shiftRunId } });
  if (!shift) throw new AppError(404, 'Shift run not found');
  const note = await m4(tx).shiftHandover.create({
    data: { shiftRunId, noteType, content: content.trim(), authorId: userId },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'ShiftHandover',
    entityId: String(note.id),
    changes: { shiftRunId, noteType },
  });
  return note;
}

// ─── Reports ───────────────────────────────────────────────────────────────

export interface DailyReportKpis {
  intakeQ: number;
  totalFlourOutputQ: number;
  weightedExtractionPct: number | null;
  batchesWorked: number;
  totalDowntimeMin: number;
  plansCompleted: number;
  openAlerts: number;
  redAlerts: number;
}

export interface DailyReportBatchRow {
  batchId: string;
  batchNo: string;
  productType: string;
  wheatWeighedQ: number;
  flourOutputQ: number;
  extractionPct: number | null;
  flagged: boolean;
}

export interface DailyReportShiftRow {
  shiftRunId: string;
  shiftDate: string;
  shift: string;
  batchNo: string | null;
  operators: string[];
  outputQ: number;
  extractionPct: number | null;
  downtimeMin: number;
}

function dayBounds(dateStr: string): { from: Date; to: Date } {
  const from = new Date(`${dateStr}T00:00:00`);
  const to = new Date(`${dateStr}T23:59:59.999`);
  if (Number.isNaN(from.getTime())) throw new AppError(400, 'Invalid date, expected YYYY-MM-DD');
  return { from, to };
}

export async function dailyProductionReport(
  tx: DbClient,
  dateStr: string,
): Promise<{
  date: string;
  kpis: DailyReportKpis;
  perBatch: DailyReportBatchRow[];
  perShift: DailyReportShiftRow[];
}> {
  const { from, to } = dayBounds(dateStr);
  const db = m4(tx);

  const outputs = await db.flourOutput.findMany({ where: { loggedAt: { gte: from, lte: to } } });
  const batches = await tx.productionBatch.findMany({});
  const batchById = new Map(batches.map((b) => [b.id, b]));

  let totalFlourOutputQ = 0;
  let totalWheatQ = 0;
  const perBatchMap = new Map<string, DailyReportBatchRow>();
  for (const o of outputs) {
    const batch = batchById.get(String(o.batchId));
    if (!batch) continue;
    const q = Number(o.quintals ?? 0);
    totalFlourOutputQ += q;
    totalWheatQ += batch.wheatWeighedQ.toNumber();
    const key = batch.id;
    const row =
      perBatchMap.get(key) ??
      ({
        id: batch.id,
        batchId: batch.id,
        batchNo: batch.batchNo,
        productType: batch.productType,
        wheatWeighedQ: batch.wheatWeighedQ.toNumber(),
        flourOutputQ: 0,
        extractionPct: null,
        flagged: false,
      } as DailyReportBatchRow);
    row.flourOutputQ += q;
    row.extractionPct =
      row.wheatWeighedQ > 0 ? (row.flourOutputQ / row.wheatWeighedQ) * 100 : null;
    row.flagged = row.flagged || Boolean(o.belowYieldFlag);
    perBatchMap.set(key, row);
  }

  const shiftRuns = await tx.shiftRun.findMany({
    where: { shiftDate: { gte: from, lte: to } },
    include: { outputs: { include: { product: true } }, batch: true },
  });
  const perShift: DailyReportShiftRow[] = shiftRuns.map((s) => {
    let flour = 0;
    let total = 0;
    for (const o of s.outputs) {
      total += o.quintals.toNumber();
      if (o.product.kind === 'flour') flour += o.quintals.toNumber();
    }
    return {
      id: s.id,
      shiftRunId: s.id,
      shiftDate: s.shiftDate.toISOString(),
      shift: s.shift,
      batchNo: s.batch?.batchNo ?? null,
      operators: s.operators ?? [],
      outputQ: total,
      extractionPct: total > 0 ? (flour / total) * 100 : null,
      downtimeMin: s.downtimeMin ?? 0,
    };
  });

  const downtimeLogs = await db.downtimeLog.findMany({
    where: { startedAt: { gte: from, lte: to } },
  });
  const totalDowntimeMin = downtimeLogs.reduce((s, d) => s + Number(d.minutesLost ?? 0), 0);

  const plansCompleted = await db.productionPlan.count({
    where: { status: 'COMPLETED', updatedAt: { gte: from, lte: to } },
  });
  const openAlerts = await db.yieldAlert.count({ where: { status: 'OPEN' } });
  const redAlerts = await db.yieldAlert.count({ where: { status: 'OPEN', severity: 'RED' } });

  const intakes = await tx.wheatIntake.findMany({
    where: { deliveryDate: { gte: from, lte: to }, status: 'ACCEPTED' },
    select: { quintals: true },
  });
  const intakeQ = Number(intakes.reduce((s, i) => s + i.quintals.toNumber(), 0).toFixed(1));

  return {
    date: dateStr,
    kpis: {
      intakeQ,
      totalFlourOutputQ: Number(totalFlourOutputQ.toFixed(1)),
      weightedExtractionPct:
        totalWheatQ > 0 ? Number(((totalFlourOutputQ / totalWheatQ) * 100).toFixed(1)) : null,
      batchesWorked: perBatchMap.size,
      totalDowntimeMin,
      plansCompleted,
      openAlerts,
      redAlerts,
    },
    perBatch: [...perBatchMap.values()].sort((a, b) => a.batchNo.localeCompare(b.batchNo)),
    perShift: perShift.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate)),
  };
}

export async function shiftProductionReport(
  tx: DbClient,
  dateStr: string,
  shift: 'MORNING' | 'NIGHT',
): Promise<{ date: string; shift: string; rows: DailyReportShiftRow[]; totalOutputQ: number; totalDowntimeMin: number }> {
  const { from, to } = dayBounds(dateStr);
  const shiftRuns = await tx.shiftRun.findMany({
    where: { shiftDate: { gte: from, lte: to }, shift },
    include: { outputs: { include: { product: true } }, batch: true },
    orderBy: { startedAt: 'asc' },
  });
  const rows: DailyReportShiftRow[] = shiftRuns.map((s) => {
    let flour = 0;
    let total = 0;
    for (const o of s.outputs) {
      total += o.quintals.toNumber();
      if (o.product.kind === 'flour') flour += o.quintals.toNumber();
    }
    return {
      id: s.id,
      shiftRunId: s.id,
      shiftDate: s.shiftDate.toISOString(),
      shift: s.shift,
      batchNo: s.batch?.batchNo ?? null,
      operators: s.operators ?? [],
      outputQ: total,
      extractionPct: total > 0 ? (flour / total) * 100 : null,
      downtimeMin: s.downtimeMin ?? 0,
    };
  });
  return {
    date: dateStr,
    shift,
    rows,
    totalOutputQ: Number(rows.reduce((s, r) => s + r.outputQ, 0).toFixed(1)),
    totalDowntimeMin: rows.reduce((s, r) => s + r.downtimeMin, 0),
  };
}
