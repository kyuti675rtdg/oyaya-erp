import { ensureDatabase } from './lib/ensureDatabase';

/**
 * One-shot boot step for Render: create the logical database before migrate.
 * Non-fatal by design — if the database already exists (redeploys) or the
 * check itself hiccups, `prisma migrate deploy` will surface any real problem.
 */
ensureDatabase()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.warn('[ensure-db] non-fatal:', (err as Error).message);
    process.exit(0);
  });
