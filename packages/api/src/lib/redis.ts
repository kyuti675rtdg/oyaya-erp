import IORedis from 'ioredis';
import { config } from '../config';

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 10000),
});

export const redis = redisConnection;

/** Mutable connectivity flag — true once a ping succeeds. */
export const redisState = { available: false };

redisConnection.on('error', (err: Error) => {
  console.error('[redis] connection error', err.message);
});
redisConnection.on('ready', () => {
  redisState.available = true;
});
redisConnection.on('close', () => {
  redisState.available = false;
});

/**
 * Ping with a timeout. A bare ping() hangs forever when Redis is unreachable
 * (ioredis queues the command and retries), which would stall boot — so the
 * raw promise must never be awaited without a race.
 */
export async function pingRedis(timeoutMs = 5000): Promise<boolean> {
  try {
    await Promise.race([
      redisConnection.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping timeout')), timeoutMs)),
    ]);
    redisState.available = true;
    return true;
  } catch {
    redisState.available = false;
    return false;
  }
}
