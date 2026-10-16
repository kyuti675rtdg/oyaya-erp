import { ensureDatabase } from './lib/ensureDatabase';

/** One-shot boot step for Render: create the logical database before migrate. */
ensureDatabase()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[ensure-db] failed:', err);
    process.exit(1);
  });
