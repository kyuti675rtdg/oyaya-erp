import http from 'http';
import app from './app';
import { config } from './config';
import { prisma } from './lib/prisma';
import { ensureDatabase } from './lib/ensureDatabase';
import { pingRedis, redisConnection } from './lib/redis';
import { initSocket } from './lib/socket';

async function main(): Promise<void> {
  await ensureDatabase();
  await prisma.$connect();
  console.log('[api] connected to PostgreSQL');
  // pingRedis races a timeout: a bare ping() hangs forever when Redis is down.
  const redisOk = await pingRedis(5000);
  console.log(
    redisOk
      ? '[api] connected to Redis'
      : '[api] Redis unavailable — running in degraded mode (SMS stays QUEUED)',
  );

  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.port, () => {
    console.log(`[api] listening on :${config.port} (${config.env})`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('[api] shutting down...');
    server.close();
    await prisma.$disconnect();
    await redisConnection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
