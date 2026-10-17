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
