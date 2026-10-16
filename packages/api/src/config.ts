import dotenv from 'dotenv';

dotenv.config();

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function num(key: string, def: number): number {
  const v = process.env[key];
  if (!v) return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Invalid numeric env var: ${key}`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  // Render injects PORT; API_PORT is the local/dev override.
  port: num('PORT', num('API_PORT', 8902)),
  databaseUrl: req('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: req('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  afromessage: {
    apiToken: process.env.AFROMESSAGE_API_TOKEN ?? '',
    identifierId: process.env.AFROMESSAGE_IDENTIFIER_ID ?? '',
    senderId: process.env.AFROMESSAGE_SENDER_ID ?? 'OYAYA_MILL',
    callbackUrl: process.env.AFROMESSAGE_CALLBACK_URL ?? '',
  },
  zkPollIntervalMin: num('ZK_POLL_INTERVAL_MIN', 5),
  zkDeviceTimeoutMs: num('ZK_DEVICE_TIMEOUT_MS', 5000),
  standardShiftHours: num('STANDARD_SHIFT_HOURS', 8),
  overtimeRateMultiplier: num('OVERTIME_RATE_MULTIPLIER', 1.5),
} as const;
