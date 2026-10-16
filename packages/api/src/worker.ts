import { Worker } from 'bullmq';
import { config } from './config';
import { prisma } from './lib/prisma';
import { redisConnection } from './lib/redis';
import { QUEUE_NAMES, alertsQueue, zktecoQueue } from './lib/queues';
import { processSmsJob, processBulkSmsJob } from './modules/sms/service';
import { pollDevices } from './modules/zkteco/poller';
import { pestFollowupJob } from './modules/hygiene/service';
import { labOverdueJob } from './modules/qc/service';

async function main(): Promise<void> {
  await prisma.$connect();
  console.log('[worker] connected to PostgreSQL');

  new Worker(
    QUEUE_NAMES.sms,
    async (job) => {
      if (job.name === 'bulk') await processBulkSmsJob(job);
      else await processSmsJob(job);
    },
    { connection: redisConnection, concurrency: 5 },
  );

  new Worker(
    QUEUE_NAMES.alerts,
    async (job) => {
      if (job.name === 'lab-overdue') await labOverdueJob();
      else if (job.name === 'pest-followup') await pestFollowupJob();
      else console.warn(`[worker] unknown alerts job: ${job.name}`);
    },
    { connection: redisConnection, concurrency: 2 },
  );

  new Worker(
    QUEUE_NAMES.zkteco,
    async () => {
      await pollDevices();
    },
    { connection: redisConnection, concurrency: 1 },
  );

  // Repeatable schedules (idempotent via jobId)
  await alertsQueue.add(
    'lab-overdue',
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: 'lab-overdue-repeat' },
  );
  await alertsQueue.add(
    'pest-followup',
    {},
    { repeat: { pattern: '0 6 * * *' }, jobId: 'pest-followup-repeat' },
  );
  await zktecoQueue.add(
    'poll',
    {},
    { repeat: { every: config.zkPollIntervalMin * 60 * 1000 }, jobId: 'zk-poll-repeat' },
  );

  console.log('[worker] workers started; repeat schedules registered');

  const shutdown = async (): Promise<void> => {
    console.log('[worker] shutting down...');
    await prisma.$disconnect();
    await redisConnection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('[worker] failed to start:', err);
  process.exit(1);
});
