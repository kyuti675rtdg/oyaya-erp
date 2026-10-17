import { Prisma, type CAPA, type LabCheck } from '@prisma/client';
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
  const byParam = new Map(thresholds.map((t) => [t.param, t]));

  const outOfRange: string[] = [];
  for (const check of THRESHOLD_CHECKS) {
    const value = check.get(input);
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
    const capaNo = await nextDocNo(tx, 'capa', 'capaNo', 'CAPA');
    capa = await tx.cAPA.create({
      data: {
        capaNo,
        batchId,
        issueDescription: `Out-of-range 2h lab check (${sampleTime.toISOString()}): ${outOfRange.join('; ')}`,
        identifiedById: userId,
        status: 'OPEN',
      },
    });
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'CAPA',
      entityId: capa.id,
      changes: { capaNo, batchId, outOfRange },
    });
    const phones = await getPhonesForRoles(['Quality / Lab Head', 'Production Manager']);
    const message = `[OYAYA ERP] Lab check out of range for batch ${batchNo}: ${outOfRange.join('; ')}. CAPA ${capaNo} opened.`;
    for (const phone of phones) {
      await queueSms({ to: phone, message, trigger: 'LAB_OUT_OF_RANGE' });
    }
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
