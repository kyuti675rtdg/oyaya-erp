import { prisma } from '../../lib/prisma';
import { getPhonesForRoles, queueSms } from '../sms/service';

/**
 * Remind the quality team about pest-control follow-ups that are overdue
 * or fall due by the end of tomorrow.
 */
export async function pestFollowupJob(): Promise<void> {
  const now = new Date();
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
  endOfTomorrow.setHours(23, 59, 59, 999);

  const pending = await prisma.pestInspection.findMany({
    where: { followUpDone: false, followUpDate: { lte: endOfTomorrow } },
  });

  for (const inspection of pending) {
    const phones = new Set<string>(await getPhonesForRoles(['Quality / Lab Head']));
    if (inspection.inspectorId) {
      const inspector = await prisma.user.findUnique({
        where: { id: inspection.inspectorId },
        select: { phone: true },
      });
      if (inspector?.phone) phones.add(inspector.phone);
    }

    const overdue = inspection.followUpDate !== null && inspection.followUpDate < now;
    const scheduled = inspection.followUpDate?.toISOString().slice(0, 10) ?? 'n/a';
    const message =
      `[OYAYA ERP] Pest control follow-up ${overdue ? 'OVERDUE' : 'due soon'} ` +
      `for area "${inspection.area}" (scheduled ${scheduled}).`;
    for (const phone of phones) {
      await queueSms({ to: phone, message, trigger: 'PEST_FOLLOWUP' });
    }
  }
}

/**
 * Module 7: remind the quality team about overdue sanitation work —
 * area cleanings past their date that were never completed, and cleaning
 * actions past their due date.
 *
 * The Module 7 tables live in /tmp/schema-module7.prisma until the coordinator
 * merges them, so they are reached through an untyped cast.
 */
export async function sanitationReminderJob(): Promise<void> {
  const dbm = prisma as unknown as Record<string, any>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const phones = new Set<string>(await getPhonesForRoles(['Quality / Lab Head']));

  const overdueCleanings: any[] = await dbm.areaCleaningLog.findMany({
    where: { status: { not: 'DONE' }, logDate: { lt: today } },
    select: { id: true, area: true, shift: true, logDate: true },
  });

  const overdueActions: any[] = await dbm.cleaningAction.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: today } },
    select: { id: true, action: true, owner: true, dueDate: true },
  });

  const send = async (message: string) => {
    for (const phone of phones) {
      await queueSms({ to: phone, message, trigger: 'SANITATION_REMINDER' });
    }
  };

  for (const log of overdueCleanings) {
    const date = String(log.logDate).slice(0, 10);
    await send(
      `[OYAYA ERP] Sanitation OVERDUE: area "${log.area}" (${log.shift} shift) ` +
        `was scheduled for ${date} and is still not completed.`,
    );
  }

  for (const a of overdueActions) {
    const due = a.dueDate ? String(a.dueDate).slice(0, 10) : 'n/a';
    await send(
      `[OYAYA ERP] Cleaning action OVERDUE: "${String(a.action).slice(0, 80)}" ` +
        `owned by ${a.owner} (due ${due}).`,
    );
  }
}
