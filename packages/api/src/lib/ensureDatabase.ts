import { Client } from 'pg';

/**
 * Ensure the logical database named in DATABASE_URL exists on the shared
 * Postgres server (Render's free tier allows one instance; Oyaya uses its own
 * logical database `oyayaerp` alongside the other apps' databases).
 * Connects to the server's default maintenance database, creates the target
 * database if missing, then returns. Safe to run on every boot.
 */
export async function ensureDatabase(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Missing required env var: DATABASE_URL');
  const url = new URL(raw);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) throw new Error('DATABASE_URL must include a database name');

  // Connect to the maintenance database to check/create the target.
  // Render Postgres requires SSL (self-signed on the private network).
  const adminUrl = new URL(raw);
  adminUrl.pathname = '/postgres';
  const client = new Client({
    connectionString: adminUrl.toString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      // CREATE DATABASE cannot run inside a transaction block or with parameters.
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[db] created logical database "${dbName}"`);
    } else {
      console.log(`[db] logical database "${dbName}" exists`);
    }
  } finally {
    await client.end();
  }
}
