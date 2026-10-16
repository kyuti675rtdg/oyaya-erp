import { Queue } from 'bullmq';
import { redisConnection, redisState } from './redis';

export const QUEUE_NAMES = {
  sms: 'sms',
  alerts: 'alerts',
  zkteco: 'zkteco',
} as const;

export const smsQueue = new Queue(QUEUE_NAMES.sms, { connection: redisConnection });
export const alertsQueue = new Queue(QUEUE_NAMES.alerts, { connection: redisConnection });
export const zktecoQueue = new Queue(QUEUE_NAMES.zkteco, { connection: redisConnection });

/**
 * Best-effort enqueue. Returns false (without throwing or hanging) when Redis
 * is unavailable — the caller's persisted record (e.g. QUEUED SmsLog) then
 * stands as the source of truth until a worker drains it.
 */
export async function tryEnqueue(
  queue: Queue,
  name: string,
  data: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<boolean> {
  if (!redisState.available) return false;
  try {
    await Promise.race([
      queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('enqueue timeout')), timeoutMs)),
    ]);
    return true;
  } catch (err) {
    console.warn(`[queue] enqueue failed on "${queue.name}", work left persisted:`, (err as Error).message);
    redisState.available = false;
    return false;
  }
}
