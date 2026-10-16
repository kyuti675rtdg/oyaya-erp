// SMS module — queueing and AfroMessage delivery (BullMQ-backed).
import type { Job } from 'bullmq';
import type { SmsLog } from '@prisma/client';
import { config } from '../../config';
import { audit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { smsQueue } from '../../lib/queues';

const AFROMESSAGE_SEND_URL = 'https://api.afromessage.com/api/send';
const AFROMESSAGE_BULK_SEND_URL = 'https://api.afromessage.com/api/bulk_send';

interface QueueSmsInput {
  to: string;
  message: string;
  trigger?: string;
}

interface QueueBulkSmsInput {
  to: string[];
  message: string;
  trigger?: string;
}

/** Queue a single SMS. Persisted as QUEUED in a tx with audit, then handed to BullMQ. */
export async function queueSms(input: QueueSmsInput): Promise<SmsLog> {
  const log = await prisma.$transaction(async (tx) => {
    const created = await tx.smsLog.create({
      data: {
        to: input.to,
        message: input.message,
        trigger: input.trigger,
        status: 'QUEUED',
      },
    });
    await audit(tx, {
      userId: null,
      action: 'CREATE',
      entityType: 'SmsLog',
      entityId: created.id,
      changes: { to: input.to, trigger: input.trigger },
    });
    return created;
  });

  await queueAdd('send', { smsLogId: log.id });
  return log;
}

/**
 * Best-effort enqueue: without Redis the SMS stays QUEUED in Postgres and the
 * request still succeeds. A worker with Redis drains the backlog later.
 */
async function queueAdd(name: 'send' | 'bulk', data: Record<string, unknown>): Promise<void> {
  try {
    await smsQueue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  } catch (err) {
    console.warn(`[sms] queue unavailable, SMS left QUEUED:`, (err as Error).message);
  }
}

/** Queue one SMS per unique recipient. Delivered by a single bulk provider call. */
export async function queueBulkSms(input: QueueBulkSmsInput): Promise<SmsLog[]> {
  const phones = [...new Set(input.to.map((p) => p.trim()).filter((p) => p.length > 0))];

  const logs = await prisma.$transaction(async (tx) => {
    const created: SmsLog[] = [];
    for (const phone of phones) {
      const log = await tx.smsLog.create({
        data: {
          to: phone,
          message: input.message,
          trigger: input.trigger,
          status: 'QUEUED',
        },
      });
      await audit(tx, {
        userId: null,
        action: 'CREATE',
        entityType: 'SmsLog',
        entityId: log.id,
        changes: { to: phone, trigger: input.trigger },
      });
      created.push(log);
    }
    return created;
  });

  await queueAdd('bulk', { smsLogIds: logs.map((l) => l.id) });
  return logs;
}

/** Resolve distinct non-empty phone numbers for active users in the given roles. */
export async function getPhonesForRoles(roleNames: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      role: { name: { in: roleNames } },
      isActive: true,
      phone: { not: null },
    },
    include: { role: true },
  });
  const phones = users.map((u) => u.phone).filter((p): p is string => !!p);
  return [...new Set(phones)];
}

function afromessageHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.afromessage.apiToken}`,
    'Content-Type': 'application/json',
  };
}

function afromessagePayload(to: string | string[], message: string): Record<string, unknown> {
  return {
    from: config.afromessage.identifierId,
    sender: config.afromessage.senderId,
    to,
    message,
    callback: config.afromessage.callbackUrl,
  };
}

/** BullMQ worker handler for a single queued SMS. Throws on HTTP failure so BullMQ retries. */
export async function processSmsJob(job: Job): Promise<void> {
  const data = job.data as { smsLogId?: string };
  if (!data.smsLogId) return;

  const log = await prisma.smsLog.findUnique({ where: { id: data.smsLogId } });
  if (!log) return;

  if (!config.afromessage.apiToken) {
    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', attempts: { increment: 1 } },
    });
    return;
  }

  const res = await fetch(AFROMESSAGE_SEND_URL, {
    method: 'POST',
    headers: afromessageHeaders(),
    body: JSON.stringify(afromessagePayload(log.to, log.message)),
  });
  if (!res.ok) {
    throw new Error(`AfroMessage HTTP ${res.status}`);
  }

  const body = (await res.json()) as { id?: unknown; messageId?: unknown };
  const providerId = String(body.id ?? body.messageId ?? '');

  await prisma.smsLog.update({
    where: { id: log.id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      providerId: providerId || null,
      attempts: { increment: 1 },
    },
  });
}

/** BullMQ worker handler for a bulk SMS batch. All rows share one provider call. */
export async function processBulkSmsJob(job: Job): Promise<void> {
  const data = job.data as { smsLogIds?: string[] };
  const ids = data.smsLogIds ?? [];
  if (ids.length === 0) return;

  const logs = await prisma.smsLog.findMany({ where: { id: { in: ids } } });
  if (logs.length === 0) return;

  const rowIds = logs.map((l) => l.id);

  if (!config.afromessage.apiToken) {
    await prisma.smsLog.updateMany({
      where: { id: { in: rowIds } },
      data: { status: 'FAILED', attempts: { increment: 1 } },
    });
    return;
  }

  const phones = logs.map((l) => l.to);
  const res = await fetch(AFROMESSAGE_BULK_SEND_URL, {
    method: 'POST',
    headers: afromessageHeaders(),
    body: JSON.stringify(afromessagePayload(phones, logs[0].message)),
  });
  if (!res.ok) {
    throw new Error(`AfroMessage HTTP ${res.status}`);
  }

  await prisma.smsLog.updateMany({
    where: { id: { in: rowIds } },
    data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
  });
}
