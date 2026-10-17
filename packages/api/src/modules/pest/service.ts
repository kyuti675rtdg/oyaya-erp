import { prisma } from '../../lib/prisma';
import type { PestScheduleEntry, PestScheduleStatus } from '@prisma/client';

export type ScheduleEffectiveStatus = PestScheduleStatus | 'OVERDUE';

/**
 * A SCHEDULED entry whose date has passed is surfaced as OVERDUE.
 * The stored status is left untouched so the schedule history stays intact.
 */
export function effectiveScheduleStatus(
  entry: Pick<PestScheduleEntry, 'status' | 'scheduledDate'>,
  now: Date = new Date(),
): ScheduleEffectiveStatus {
  if (entry.status !== 'SCHEDULED') return entry.status;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return entry.scheduledDate < today ? 'OVERDUE' : 'SCHEDULED';
}

/** Start of today (local server time) as a Date. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Regenerate derived alerts (idempotent — one open alert per source row).
 * Sources:
 *  - overdue scheduled inspections           -> OVERDUE_INSPECTION
 *  - follow-ups due today or past, pending   -> TREATMENT_DUE
 *  - open evidence with a PERSISTENT follow-up result -> PERSISTENT_INFESTATION
 * Returns the number of new alerts created.
 */
export async function refreshPestAlerts(): Promise<number> {
  const today = startOfToday();
  let created = 0;

  await prisma.$transaction(async (tx) => {
    const openAlerts = await tx.pestAlert.findMany({
      where: { acknowledged: false },
      select: { refType: true, refId: true, type: true },
    });
    const openKey = (refType: string | null, refId: string | null, type: string) =>
      `${type}|${refType}|${refId}`;
    const open = new Set(openAlerts.map((a) => openKey(a.refType, a.refId, a.type)));

    const ensure = async (input: {
      type: 'OVERDUE_INSPECTION' | 'PERSISTENT_INFESTATION' | 'TREATMENT_DUE';
      severity: 'INFO' | 'WARNING' | 'CRITICAL';
      message: string;
      refType: string;
      refId: string;
      dueDate?: Date | null;
    }) => {
      if (open.has(openKey(input.refType, input.refId, input.type))) return;
      await tx.pestAlert.create({
        data: {
          type: input.type,
          severity: input.severity,
          message: input.message,
          refType: input.refType,
          refId: input.refId,
          dueDate: input.dueDate ?? null,
        },
      });
      open.add(openKey(input.refType, input.refId, input.type));
      created += 1;
    };

    // 1. Overdue scheduled inspections.
    const overdueSchedules = await tx.pestScheduleEntry.findMany({
      where: { status: 'SCHEDULED', scheduledDate: { lt: today } },
    });
    for (const s of overdueSchedules) {
      await ensure({
        type: 'OVERDUE_INSPECTION',
        severity: 'CRITICAL',
        message: `Pest inspection overdue for "${s.area}" (scheduled ${s.scheduledDate.toISOString().slice(0, 10)}).`,
        refType: 'PestScheduleEntry',
        refId: s.id,
        dueDate: s.scheduledDate,
      });
    }

    // 2. Follow-ups due today or past that are still pending.
    const dueFollowUps = await tx.pestFollowUp.findMany({
      where: { status: 'PENDING', dueDate: { lte: today } },
      include: { evidence: true },
    });
    for (const f of dueFollowUps) {
      const late = f.dueDate < today;
      await ensure({
        type: 'TREATMENT_DUE',
        severity: late ? 'WARNING' : 'INFO',
        message:
          `Follow-up ${late ? 'overdue' : 'due today'} for ${f.evidence.pestType.toLowerCase()} evidence ` +
          `at "${f.evidence.location}" (due ${f.dueDate.toISOString().slice(0, 10)}).`,
        refType: 'PestFollowUp',
        refId: f.id,
        dueDate: f.dueDate,
      });
    }

    // 3. Persistent infestations: open evidence with a completed PERSISTENT follow-up.
    const persistent = await tx.pestEvidenceRecord.findMany({
      where: {
        status: 'OPEN',
        followUps: { some: { status: 'DONE', result: 'PERSISTENT' } },
      },
    });
    for (const e of persistent) {
      await ensure({
        type: 'PERSISTENT_INFESTATION',
        severity: 'CRITICAL',
        message:
          `Persistent ${e.pestType.toLowerCase()} infestation at "${e.location}" — ` +
          `treatment has not cleared the evidence. Escalation recommended.`,
        refType: 'PestEvidenceRecord',
        refId: e.id,
      });
    }
  });

  return created;
}

/**
 * Treatment effectiveness: share of evidence records marked CLEARED,
 * broken down by treatment type and overall.
 */
export async function treatmentEffectiveness(): Promise<{
  overall: { treated: number; cleared: number; pct: number | null };
  byTreatment: Array<{ treatment: string; treated: number; cleared: number; pct: number | null }>;
}> {
  const rows = await prisma.pestEvidenceRecord.groupBy({
    by: ['treatment', 'status'],
    _count: { _all: true },
    where: { treatment: { not: null } },
  });

  const byTreatment = new Map<string, { treated: number; cleared: number }>();
  let treated = 0;
  let cleared = 0;
  for (const r of rows) {
    const t = r.treatment as string;
    const bucket = byTreatment.get(t) ?? { treated: 0, cleared: 0 };
    bucket.treated += r._count._all;
    if (r.status === 'CLEARED') bucket.cleared += r._count._all;
    byTreatment.set(t, bucket);
    treated += r._count._all;
    if (r.status === 'CLEARED') cleared += r._count._all;
  }

  return {
    overall: { treated, cleared, pct: treated > 0 ? (cleared / treated) * 100 : null },
    byTreatment: [...byTreatment.entries()].map(([treatment, v]) => ({
      treatment,
      ...v,
      pct: v.treated > 0 ? (v.cleared / v.treated) * 100 : null,
    })),
  };
}
