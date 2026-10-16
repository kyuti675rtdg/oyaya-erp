import { Queue } from 'bullmq';
import { redisConnection } from './redis';

export const QUEUE_NAMES = {
  sms: 'sms',
  alerts: 'alerts',
  zkteco: 'zkteco',
} as const;

export const smsQueue = new Queue(QUEUE_NAMES.sms, { connection: redisConnection });
export const alertsQueue = new Queue(QUEUE_NAMES.alerts, { connection: redisConnection });
export const zktecoQueue = new Queue(QUEUE_NAMES.zkteco, { connection: redisConnection });
