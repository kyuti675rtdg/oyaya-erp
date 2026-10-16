import IORedis from 'ioredis';
import { config } from '../config';

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const redis = redisConnection;

redisConnection.on('error', (err: Error) => {
  console.error('[redis] connection error', err.message);
});
