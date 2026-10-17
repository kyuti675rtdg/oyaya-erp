import { CAPAStatus, Prisma, type CAPA, type FlourQualityTest, type LabCheck, type LabSamplingSchedule } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit, type DbClient } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';
import { getPhonesForRoles, queueSms } from '../sms/service';

export interface LabCheckInput {
  shiftRunId: string;
  sampleTime?: Date;
  impurityPct?: number | null;
  wheatMoistureBefore?: number | null;
  wheatMoistureAfter?: number | null;
  flourMoisturePct?: number | null;
  wetGlutenPct?: number | null;
  glutenElasticity?: string | null;
  dryGlutenPct?: number | null;
  ashPct?: number | null;
  colorScore?: number | null;
  granulationPct?: number | null;
}

export interface CreateLabCheckResult {
  labCheck: LabCheck;
  capa: CAPA | null;
}

const dec = (n?: number | null): Prisma.Decimal | null =>
  n === undefined || n === null ? null : new Prisma.Decimal(n);

/** Human-readable label, threshold param key, and the measured value to check. */
const THRESHOLD_CHECKS: Array<{ label: string; paramKey: string; get: (i: LabCheckInput) => number | null | undefined }> = [
  { label: 'impurity', paramKey: 'inprocess.impurity', get: (i) => i.impurityPct },
  { label: 'wheatMoistureBefore', paramKey: 'inprocess.wheatMoistureBefore', get: (i) => i.wheatMoistureBefore },
  { label: 'wheatMoistureAfter', paramKey: 'inprocess.wheatMoistureAfter', get: (i) => i.wheatMoistureAfter },
  { label: 'flourMoisture', paramKey: 'inprocess.flourMoisture', get: (i) => i.flourMoisturePct },
  { label: 'wetGluten', paramKey: 'inprocess.wetGluten', get: (i) => i.wetGlutenPct },
  { label: 'dryGluten', paramKey: 'inprocess.dryGluten', get: (i) => i.dryGlutenPct },
  { label: 'ash', paramKey: 'inprocess.ash', get: (i) => i.ashPct },
  { label: 'color', paramKey: 'inprocess.color', get: (i) => i.colorScore },
  { label: 'granulation', paramKey: 'inprocess.granulation', get: (i) => i.granulationPct },
];

/**
 * Persist a 2-hour in-process lab check. Parameters outside the configured
 * inprocess thresholds open a CAPA and alert the lab and production heads.
 */
export async function createLabCheck(
  tx: DbClient,
  input: LabCheckInput,
  userId: string,
): Promise<CreateLabCheckResult> {
  const shiftRun = await tx.shiftRun.findUnique({
    where: { id: input.shiftRunId },
    include: { batch: true },
  });
  if (!shiftRun) throw new AppError(404, 'Shift run not found');
  const batchId = shiftRun.batchId;
  const batchNo = shiftRun.batch.batchNo;

  const thresholds = await tx.qcThreshold.findMany({ where: { category: 'inprocess' } });
  const outOfRange = findOutOfRange(
    thresholds,
    THRESHOLD_CHECKS.map((check) => ({
      label: check.label,
      paramKey: check.paramKey,
      value: check.get(input),
    })),
  );

  const sampleTime = input.sampleTime ?? new Date();
  const labCheck = await tx.labCheck.create({
    data: {
      shiftRunId: input.shiftRunId,
      batchId,
      sampleTime,
      checkedById: userId,
      outOfRange,
      impurityPct: dec(input.impurityPct),
      wheatMoistureBefore: dec(input.wheatMoistureBefore),
      wheatMoistureAfter: dec(input.wheatMoistureAfter),
      flourMoisturePct: dec(input.flourMoisturePct),
      wetGlutenPct: dec(input.wetGlutenPct),
      glutenElasticity: input.glutenElasticity ?? null,
      dryGlutenPct: dec(input.dryGlutenPct),
      ashPct: dec(input.ashPct),
      colorScore: dec(input.colorScore),
      granulationPct: dec(input.granulationPct),
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'LabCheck',
    entityId: labCheck.id,
    changes: { shiftRunId: input.shiftRunId, batchId, outOfRange },
  });

  let capa: CAPA | null = null;
  if (outOfRange.length > 0) {
    const phones = await getPhonesForRoles(['Quality / Lab Head', 'Production Manager']);
    capa = await openOutOfRangeCapa(tx, {
      batchId,
      batchNo,
      userId,
      source: `Out-of-range 2h lab check (${sampleTime.toISOString()})`,
      outOfRange,
      phones,
    });
  }

  return { labCheck, capa };
}

/**
 * Alert lab technicians about active (not ended) shifts older than 2 hours
 * that have no lab check sampled within the last 2 hours.
 */
export async function labOverdueJob(): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeShifts = await prisma.shiftRun.findMany({
    where: { endedAt: null, startedAt: { lt: twoHoursAgo } },
    include: {
      batch: true,
      labChecks: {
        where: { sampleTime: { gt: twoHoursAgo } },
        select: { id: true },
      },
    },
  });

  for (const shift of activeShifts) {
    if (shift.labChecks.length > 0) continue;
    const phones = await getPhonesForRoles(['Lab Technician']);
    const message = `[OYAYA ERP] 2-hour lab check OVERDUE for batch ${shift.batch.batchNo} (${shift.shift} shift).`;
    for (const phone of phones) {
      await queueSms({ to: phone, message, trigger: 'LAB_OVERDUE' });
    }
  }
}

// ─── Module 5: Quality Assurance & Laboratory Management ────────────
// Shared threshold evaluation

interface ThresholdRow {
  param: string;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
}

/**
 * Evaluate measured values against configured QcThreshold rows.
 * Returns human-readable out-of-range descriptions.
 */
export function findOutOfRange(
  thresholds: ThresholdRow[],
  checks: Array<{ label: string; paramKey: string; value: number | null | undefined }>,
): string[] {
  const byParam = new Map(thresholds.map((t) => [t.param, t]));
  const outOfRange: string[] = [];
  for (const check of checks) {
    const value = check.value;
    if (value === undefined || value === null) continue;
    const t = byParam.get(check.paramKey);
    if (!t) continue;
    const min = t.minValue != null ? t.minValue.toNumber() : null;
    const max = t.maxValue != null ? t.maxValue.toNumber() : null;
    if (min !== null && value < min) {
      outOfRange.push(`${check.label} ${value.toFixed(2)} < min ${min.toFixed(2)}`);
    }
    if (max !== null && value > max) {
      outOfRange.push(`${check.label} ${value.toFixed(2)} > max ${max.toFixed(2)}`);
    }
  }
  return outOfRange;
}

/** Open a CAPA for out-of-range results and alert the given phones. */
async function openOutOfRangeCapa(
  tx: DbClient,
  args: {
    batchId: string;
    batchNo: string;
    userId: string;
    source: string;
    outOfRange: string[];
    phones: string[];
  },
): Promise<CAPA> {
  const capaNo = await nextDocNo(tx, 'capa', 'capaNo', 'CAPA');
  const capa = await tx.cAPA.create({
    data: {
      capaNo,
      batchId: args.batchId,
      issueDescription: `${args.source}: ${args.outOfRange.join('; ')}`,
      identifiedById: args.userId,
      status: 'OPEN',
    },
  });
  await audit(tx, {
    userId: args.userId,
    action: 'CREATE',
    entityType: 'CAPA',
    entityId: capa.id,
    changes: { capaNo, batchId: args.batchId, outOfRange: args.outOfRange },
  });
  const message = `[OYAYA ERP] ${args.source} for batch ${args.batchNo}: ${args.outOfRange.join('; ')}. CAPA ${capaNo} opened.`;
  for (const phone of args.phones) {
    await queueSms({ to: phone, message, trigger: 'LAB_OUT_OF_RANGE' });
  }
  return capa;
}

// ─── Standard thresholds seed ──────────────────────────────────────

export interface StandardThreshold {
  code: string;
  category: 'intake' | 'inprocess' | 'flour';
  param: string;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
}

/**
 * Domain-standard quality thresholds.
 * INTAKE (wheat acceptance) and IN-PROCESS / FLOUR (milling) standards are
 * deliberately separate — never conflate them.
 */
export const STANDARD_THRESHOLDS: StandardThreshold[] = [
  // INTAKE — incoming wheat acceptance
  { code: 'intake.gluten', category: 'intake', param: 'gluten', minValue: 20, maxValue: null, unit: '%' },
  { code: 'intake.moisture', category: 'intake', param: 'moisture', minValue: null, maxValue: 13.5, unit: '%' },
  { code: 'intake.impurity', category: 'intake', param: 'impurity', minValue: null, maxValue: 6, unit: '%' },
  { code: 'intake.hectoliter', category: 'intake', param: 'hectoliter', minValue: 74, maxValue: null, unit: 'kg/hl' },
  { code: 'intake.germination', category: 'intake', param: 'germination', minValue: null, maxValue: 1, unit: '%' },
  // IN-PROCESS — 2-hour shift lab checks
  { code: 'inprocess.impurity', category: 'inprocess', param: 'impurity', minValue: null, maxValue: 3.0, unit: '%' },
  { code: 'inprocess.wheatMoistureBefore', category: 'inprocess', param: 'wheatMoistureBefore', minValue: 10.0, maxValue: 13.3, unit: '%' },
  { code: 'inprocess.wheatMoistureAfter', category: 'inprocess', param: 'wheatMoistureAfter', minValue: 15.0, maxValue: 16.5, unit: '%' },
  { code: 'inprocess.flourMoisture', category: 'inprocess', param: 'flourMoisture', minValue: null, maxValue: 14.0, unit: '%' },
  { code: 'inprocess.wetGluten', category: 'inprocess', param: 'wetGluten', minValue: 30, maxValue: 33, unit: '%' },
  { code: 'inprocess.dryGluten', category: 'inprocess', param: 'dryGluten', minValue: 0.8, maxValue: 1.6, unit: '%' },
  { code: 'inprocess.ash', category: 'inprocess', param: 'ash', minValue: null, maxValue: 0.7, unit: '%' },
  { code: 'inprocess.color', category: 'inprocess', param: 'color', minValue: 70, maxValue: null, unit: 'score' },
  { code: 'inprocess.granulation', category: 'inprocess', param: 'granulation', minValue: 75, maxValue: 80, unit: '%' },
  // FLOUR — finished product acceptance per batch per product
  { code: 'flour.moisture', category: 'flour', param: 'flourMoisture', minValue: null, maxValue: 14.0, unit: '%' },
  { code: 'flour.wetGluten', category: 'flour', param: 'wetGluten', minValue: 30, maxValue: 33, unit: '%' },
  { code: 'flour.dryGluten', category: 'flour', param: 'dryGluten', minValue: 0.8, maxValue: 1.6, unit: '%' },
  { code: 'flour.ash', category: 'flour', param: 'ash', minValue: null, maxValue: 0.7, unit: '%' },
  { code: 'flour.color', category: 'flour', param: 'color', minValue: 70, maxValue: null, unit: 'score' },
  { code: 'flour.granulation', category: 'flour', param: 'granulation', minValue: 75, maxValue: 80, unit: '%' },
  { code: 'flour.impurity', category: 'flour', param: 'impurity', minValue: null, maxValue: 3.0, unit: '%' },
];

const decOrNull = (d: Prisma.Decimal | null): number | null => (d == null ? null : d.toNumber());

/**
 * Idempotent seed of the standard thresholds. Creates missing rows, refreshes
 * rows that drifted from the standard, and audits every change.
 */
export async function seedStandardThresholds(userId: string): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const s of STANDARD_THRESHOLDS) {
      const existing = await tx.qcThreshold.findUnique({ where: { code: s.code } });
      const data = {
        category: s.category,
        param: s.param,
        minValue: dec(s.minValue),
        maxValue: dec(s.maxValue),
        unit: s.unit,
        isActive: true,
      };
      if (!existing) {
        const c = await tx.qcThreshold.create({ data: { code: s.code, ...data } });
        await audit(tx, {
          userId,
          action: 'CREATE',
          entityType: 'QcThreshold',
          entityId: c.id,
          changes: { code: s.code, seeded: true },
        });
        created++;
      } else {
        const changed =
          existing.category !== s.category ||
          existing.param !== s.param ||
          decOrNull(existing.minValue) !== s.minValue ||
          decOrNull(existing.maxValue) !== s.maxValue ||
          (existing.unit ?? null) !== s.unit;
        if (changed) {
          await tx.qcThreshold.update({ where: { code: s.code }, data });
          await audit(tx, {
            userId,
            action: 'UPDATE',
            entityType: 'QcThreshold',
            entityId: existing.id,
            changes: { code: s.code, reseeded: true },
          });
          updated++;
        }
      }
    }
  });
  return { created, updated };
}

// ─── Flour quality tests ───────────────────────────────────────────

export interface FlourTestInput {
  batchId: string;
  productLabel: string;
  sampleTime?: Date;
  flourMoisturePct?: number | null;
  wetGlutenPct?: number | null;
  dryGlutenPct?: number | null;
  ashPct?: number | null;
  colorScore?: number | null;
  granulationPct?: number | null;
  impurityPct?: number | null;
  notes?: string | null;
}

export interface CreateFlourTestResult {
  test: FlourQualityTest;
  capa: CAPA | null;
}

const FLOUR_CHECKS: Array<{ label: string; paramKey: string; get: (i: FlourTestInput) => number | null | undefined }> = [
  { label: 'flourMoisture', paramKey: 'flour.moisture', get: (i) => i.flourMoisturePct },
  { label: 'wetGluten', paramKey: 'flour.wetGluten', get: (i) => i.wetGlutenPct },
  { label: 'dryGluten', paramKey: 'flour.dryGluten', get: (i) => i.dryGlutenPct },
  { label: 'ash', paramKey: 'flour.ash', get: (i) => i.ashPct },
  { label: 'color', paramKey: 'flour.color', get: (i) => i.colorScore },
  { label: 'granulation', paramKey: 'flour.granulation', get: (i) => i.granulationPct },
  { label: 'impurity', paramKey: 'flour.impurity', get: (i) => i.impurityPct },
];

/**
 * Persist a finished-flour quality test for one batch / product. Parameters
 * outside the configured flour thresholds mark the test FAIL, open a CAPA,
 * and alert the lab and production heads.
 */
export async function createFlourTest(
  tx: DbClient,
  input: FlourTestInput,
  userId: string,
): Promise<CreateFlourTestResult> {
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new AppError(404, 'Production batch not found');

  const thresholds = await tx.qcThreshold.findMany({ where: { category: 'flour', isActive: true } });
  const outOfRange = findOutOfRange(
    thresholds,
    FLOUR_CHECKS.map((check) => ({ label: check.label, paramKey: check.paramKey, value: check.get(input) })),
  );

  const measured = FLOUR_CHECKS.map((c) => c.get(input)).filter((v) => v !== undefined && v !== null);
  const verdict: 'PASS' | 'FAIL' | 'UNTESTED' =
    measured.length === 0 ? 'UNTESTED' : outOfRange.length > 0 ? 'FAIL' : 'PASS';

  const sampleTime = input.sampleTime ?? new Date();
  const test = await tx.flourQualityTest.create({
    data: {
      batchId: input.batchId,
      productLabel: input.productLabel,
      sampleTime,
      verdict,
      outOfRange,
      checkedById: userId,
      notes: input.notes ?? null,
      flourMoisturePct: dec(input.flourMoisturePct),
      wetGlutenPct: dec(input.wetGlutenPct),
      dryGlutenPct: dec(input.dryGlutenPct),
      ashPct: dec(input.ashPct),
      colorScore: dec(input.colorScore),
      granulationPct: dec(input.granulationPct),
      impurityPct: dec(input.impurityPct),
    },
  });
  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'FlourQualityTest',
    entityId: test.id,
    changes: { batchId: input.batchId, productLabel: input.productLabel, verdict, outOfRange },
  });

  let capa: CAPA | null = null;
  if (verdict === 'FAIL') {
    const phones = await getPhonesForRoles(['Quality / Lab Head', 'Production Manager']);
    capa = await openOutOfRangeCapa(tx, {
      batchId: batch.id,
      batchNo: batch.batchNo,
      userId,
      source: `Out-of-range flour test (${input.productLabel}, ${sampleTime.toISOString()})`,
      outOfRange,
      phones,
    });
  }

  return { test, capa };
}

// ─── Laboratory sampling schedule ──────────────────────────────────

export type SamplingKind = 'SHIFT_2H' | 'INTAKE_TRUCK' | 'FLOUR_BATCH';

const OPEN_SAMPLING_STATUSES = ['PENDING', 'OVERDUE'];

/**
 * Generate sampling entries for: active shifts (2h checks), intakes awaiting
 * lab (per truck), and batches in production without a flour test.
 * Idempotent — never duplicates an open entry for the same source.
 */
export async function generateSamplingSchedule(): Promise<{ created: number; markedOverdue: number }> {
  const now = new Date();
  let created = 0;

  const overdue = await prisma.labSamplingSchedule.updateMany({
    where: { status: 'PENDING', dueAt: { lt: now } },
    data: { status: 'OVERDUE' },
  });

  // 1. 2-hour checks for active shifts
  const activeShifts = await prisma.shiftRun.findMany({
    where: { endedAt: null },
    include: {
      batch: { select: { batchNo: true } },
      labChecks: { orderBy: { sampleTime: 'desc' }, take: 1, select: { sampleTime: true } },
    },
  });
  for (const s of activeShifts) {
    const existing = await prisma.labSamplingSchedule.findFirst({
      where: { kind: 'SHIFT_2H', shiftRunId: s.id, status: { in: OPEN_SAMPLING_STATUSES } },
    });
    if (existing) continue;
    const lastSample = s.labChecks[0]?.sampleTime ?? s.startedAt;
    const dueAt = new Date(Math.max(new Date(lastSample).getTime() + 2 * 60 * 60 * 1000, now.getTime()));
    await prisma.labSamplingSchedule.create({
      data: {
        kind: 'SHIFT_2H',
        label: `2-hour lab check — Batch ${s.batch.batchNo} (${s.shift})`,
        shiftRunId: s.id,
        batchId: s.batchId,
        dueAt,
        status: dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'PENDING',
      },
    });
    created++;
  }

  // 2. Per-truck intake samples
  const pendingIntakes = await prisma.wheatIntake.findMany({
    where: { status: 'PENDING_LAB' },
    select: { id: true, intakeNo: true, truckPlate: true },
  });
  for (const i of pendingIntakes) {
    const existing = await prisma.labSamplingSchedule.findFirst({
      where: { kind: 'INTAKE_TRUCK', intakeId: i.id, status: { in: OPEN_SAMPLING_STATUSES } },
    });
    if (existing) continue;
    await prisma.labSamplingSchedule.create({
      data: {
        kind: 'INTAKE_TRUCK',
        label: `Intake lab sample — Truck ${i.truckPlate} (${i.intakeNo})`,
        intakeId: i.id,
        dueAt: now,
        status: 'PENDING',
      },
    });
    created++;
  }

  // 3. Per-batch flour samples for batches in production without a flour test
  const batches = await prisma.productionBatch.findMany({
    where: { status: { in: ['OPEN', 'MILLING'] }, shifts: { some: {} } },
    select: { id: true, batchNo: true, flourTests: { select: { id: true } } },
  });
  for (const b of batches) {
    if (b.flourTests.length > 0) continue;
    const existing = await prisma.labSamplingSchedule.findFirst({
      where: { kind: 'FLOUR_BATCH', batchId: b.id, status: { in: OPEN_SAMPLING_STATUSES } },
    });
    if (existing) continue;
    await prisma.labSamplingSchedule.create({
      data: {
        kind: 'FLOUR_BATCH',
        label: `Finished flour sample — Batch ${b.batchNo}`,
        batchId: b.id,
        dueAt: now,
        status: 'PENDING',
      },
    });
    created++;
  }

  return { created, markedOverdue: overdue.count };
}

/** Mark a sampling entry as collected (sample taken). */
export async function collectSamplingEntry(
  tx: DbClient,
  id: string,
  userId: string,
  notes?: string | null,
): Promise<LabSamplingSchedule> {
  const entry = await tx.labSamplingSchedule.findUnique({ where: { id } });
  if (!entry) throw new AppError(404, 'Sampling entry not found');
  if (entry.status === 'COLLECTED') throw new AppError(409, 'Sample already collected');
  const updated = await tx.labSamplingSchedule.update({
    where: { id },
    data: {
      status: 'COLLECTED',
      collectedAt: new Date(),
      collectedById: userId,
      notes: notes ?? entry.notes,
    },
  });
  await audit(tx, {
    userId,
    action: 'UPDATE',
    entityType: 'LabSamplingSchedule',
    entityId: id,
    changes: { status: 'COLLECTED', kind: entry.kind, label: entry.label },
  });
  return updated;
}

// ─── Quality approval & product release ────────────────────────────

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ReleaseChecklist {
  batchId: string;
  batchNo: string;
  status: string;
  canRelease: boolean;
  items: ReleaseChecklistItem[];
  openCapas: Array<{ id: string; capaNo: string; issueDescription: string; status: string }>;
}

/**
 * Release-readiness checklist for a production batch:
 * all 2h in-process checks in range, at least one passing flour test,
 * and no open nonconformities (CAPA).
 */
export async function getReleaseChecklist(tx: DbClient, batchId: string): Promise<ReleaseChecklist> {
  const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError(404, 'Production batch not found');

  const checks = await tx.labCheck.findMany({
    where: { batchId },
    orderBy: { sampleTime: 'desc' },
    take: 100,
  });
  const badChecks = checks.filter((c) => c.outOfRange.length > 0);

  const flour = await tx.flourQualityTest.findMany({
    where: { batchId },
    orderBy: { sampleTime: 'desc' },
    take: 50,
  });
  const badFlour = flour.filter((t) => t.verdict === 'FAIL');

  const openCapas = await tx.cAPA.findMany({
    where: { batchId, status: { in: [CAPAStatus.OPEN, CAPAStatus.IN_PROGRESS] } },
    orderBy: { dateIdentified: 'desc' },
  });

  const items: ReleaseChecklistItem[] = [
    {
      key: 'inprocess',
      label: 'All 2-hour in-process lab checks within standard',
      passed: checks.length > 0 && badChecks.length === 0,
      detail:
        checks.length === 0
          ? 'No 2-hour lab checks recorded for this batch'
          : `${checks.length} checks recorded, ${badChecks.length} out of range`,
    },
    {
      key: 'flour',
      label: 'Finished flour tests passed (per product)',
      passed: flour.length > 0 && badFlour.length === 0,
      detail:
        flour.length === 0
          ? 'No finished flour tests recorded for this batch'
          : `${flour.length} flour test(s) recorded, ${badFlour.length} failed`,
    },
    {
      key: 'capa',
      label: 'No open nonconformities (CAPA)',
      passed: openCapas.length === 0,
      detail: openCapas.length === 0 ? 'All CAPAs are closed' : `${openCapas.length} open CAPA(s)`,
    },
  ];

  return {
    batchId,
    batchNo: batch.batchNo,
    status: batch.status,
    canRelease: items.every((i) => i.passed),
    items,
    openCapas: openCapas.map((c) => ({
      id: c.id,
      capaNo: c.capaNo,
      issueDescription: c.issueDescription,
      status: c.status,
    })),
  };
}

/** Release a batch to finished goods (APPROVED) or put it on QC hold. */
export async function releaseBatch(
  tx: DbClient,
  batchId: string,
  userId: string,
  decision: 'RELEASE' | 'HOLD',
  notes?: string | null,
): Promise<{ batch: { id: string; batchNo: string; status: string }; checklist: ReleaseChecklist }> {
  const checklist = await getReleaseChecklist(tx, batchId);
  if (decision === 'RELEASE' && !checklist.canRelease) {
    throw new AppError(409, 'Release blocked: quality checklist is not complete');
  }
  const status = decision === 'RELEASE' ? 'APPROVED' : 'QC_HOLD';
  const batch = await tx.productionBatch.update({ where: { id: batchId }, data: { status } });
  await audit(tx, {
    userId,
    action: decision === 'RELEASE' ? 'APPROVE' : 'REJECT',
    entityType: 'ProductionBatch',
    entityId: batchId,
    changes: {
      status,
      notes: notes ?? null,
      checklist: checklist.items.map((i) => ({ key: i.key, passed: i.passed })),
    },
  });
  return { batch: { id: batch.id, batchNo: batch.batchNo, status: batch.status }, checklist };
}

// ─── Quality trends & inspection reports ──────────────────────────

export interface TrendPoint {
  t: string;
  v: number;
}

export interface DayCount {
  date: string;
  total: number;
  failed: number;
}

export interface QcReportsSummary {
  range: { from: string; to: string };
  labChecks: { total: number; passed: number; failed: number; passRate: number; byDay: DayCount[] };
  flourTests: { total: number; passed: number; failed: number; passRate: number; byDay: DayCount[] };
  intakeTests: { total: number; passed: number; failed: number; passRate: number };
  paramTrends: Record<string, TrendPoint[]>;
  thresholds: Array<{
    code: string;
    category: string;
    param: string;
    minValue: number | null;
    maxValue: number | null;
    unit: string | null;
  }>;
}

// Intake domain standards (mirrors the seeded QcThreshold rows).
const INTAKE_DOMAIN: Array<{ key: string; mode: 'min' | 'max'; threshold: number }> = [
  { key: 'glutenPct', mode: 'min', threshold: 20 },
  { key: 'moisturePct', mode: 'max', threshold: 13.5 },
  { key: 'impurityPct', mode: 'max', threshold: 6 },
  { key: 'hectoliterPct', mode: 'min', threshold: 74 },
  { key: 'germinationPct', mode: 'max', threshold: 1 },
];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function intakeVerdict(intake: {
  glutenPct: Prisma.Decimal | null;
  moisturePct: Prisma.Decimal | null;
  impurityPct: Prisma.Decimal | null;
  hectoliterPct: Prisma.Decimal | null;
  germinationPct: Prisma.Decimal | null;
}): 'PASS' | 'FAIL' | 'UNTESTED' {
  const values: Record<string, number | null> = {
    glutenPct: intake.glutenPct?.toNumber() ?? null,
    moisturePct: intake.moisturePct?.toNumber() ?? null,
    impurityPct: intake.impurityPct?.toNumber() ?? null,
    hectoliterPct: intake.hectoliterPct?.toNumber() ?? null,
    germinationPct: intake.germinationPct?.toNumber() ?? null,
  };
  if (Object.values(values).some((v) => v === null)) return 'UNTESTED';
  for (const t of INTAKE_DOMAIN) {
    const v = values[t.key] as number;
    if (t.mode === 'min' ? v < t.threshold : v > t.threshold) return 'FAIL';
  }
  return 'PASS';
}

/** Aggregate pass/fail counts, daily series, and parameter trends for reports. */
export async function getReportsSummary(from: Date, to: Date): Promise<QcReportsSummary> {
  const checks = await prisma.labCheck.findMany({
    where: { sampleTime: { gte: from, lte: to } },
    orderBy: { sampleTime: 'asc' },
  });
  const flour = await prisma.flourQualityTest.findMany({
    where: { sampleTime: { gte: from, lte: to } },
    orderBy: { sampleTime: 'asc' },
  });
  const intakes = await prisma.wheatIntake.findMany({
    where: { labTestedAt: { gte: from, lte: to } },
    select: {
      glutenPct: true,
      moisturePct: true,
      impurityPct: true,
      hectoliterPct: true,
      germinationPct: true,
    },
  });
  const thresholds = await prisma.qcThreshold.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { param: 'asc' }],
  });

  const byDay = (rows: Array<{ sampleTime: Date; failed: boolean }>): DayCount[] => {
    const map = new Map<string, DayCount>();
    for (const r of rows) {
      const k = dayKey(new Date(r.sampleTime));
      const cur = map.get(k) ?? { date: k, total: 0, failed: 0 };
      cur.total++;
      if (r.failed) cur.failed++;
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  };

  const failedChecks = checks.filter((c) => c.outOfRange.length > 0).length;
  const failedFlour = flour.filter((t) => t.verdict === 'FAIL').length;
  const intakeVerdicts = intakes.map(intakeVerdict);
  const testedIntakes = intakeVerdicts.filter((v) => v !== 'UNTESTED');
  const failedIntakes = testedIntakes.filter((v) => v === 'FAIL').length;

  const trendKeys = [
    'impurityPct',
    'wheatMoistureBefore',
    'wheatMoistureAfter',
    'flourMoisturePct',
    'wetGlutenPct',
    'dryGlutenPct',
    'ashPct',
    'colorScore',
    'granulationPct',
  ] as const;
  const paramTrends: Record<string, TrendPoint[]> = {};
  for (const key of trendKeys) {
    const pts: TrendPoint[] = [];
    for (const c of checks) {
      const raw = c[key] as Prisma.Decimal | null;
      if (raw == null) continue;
      pts.push({ t: new Date(c.sampleTime).toISOString(), v: raw.toNumber() });
    }
    paramTrends[key] = pts.slice(-300);
  }

  const pct = (pass: number, total: number): number =>
    total === 0 ? 0 : Math.round((pass / total) * 1000) / 10;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    labChecks: {
      total: checks.length,
      passed: checks.length - failedChecks,
      failed: failedChecks,
      passRate: pct(checks.length - failedChecks, checks.length),
      byDay: byDay(checks.map((c) => ({ sampleTime: c.sampleTime, failed: c.outOfRange.length > 0 }))),
    },
    flourTests: {
      total: flour.length,
      passed: flour.length - failedFlour,
      failed: failedFlour,
      passRate: pct(flour.length - failedFlour, flour.length),
      byDay: byDay(flour.map((t) => ({ sampleTime: t.sampleTime, failed: t.verdict === 'FAIL' }))),
    },
    intakeTests: {
      total: testedIntakes.length,
      passed: testedIntakes.length - failedIntakes,
      failed: failedIntakes,
      passRate: pct(testedIntakes.length - failedIntakes, testedIntakes.length),
    },
    paramTrends,
    thresholds: thresholds.map((t) => ({
      code: t.code,
      category: t.category,
      param: t.param,
      minValue: t.minValue?.toNumber() ?? null,
      maxValue: t.maxValue?.toNumber() ?? null,
      unit: t.unit ?? null,
    })),
  };
}
