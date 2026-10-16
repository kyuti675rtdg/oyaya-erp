import { Prisma } from '@prisma/client';
import type { DbClient } from './audit';

// Whitelisted Prisma model -> physical table name mapping (PostgreSQL).
const TABLES = {
  wheatIntake: 'WheatIntake',
  productionBatch: 'ProductionBatch',
  capa: 'CAPA',
  salesOrder: 'SalesOrder',
  dispatch: 'Dispatch',
  apInvoice: 'APInvoice',
  apPayment: 'APPayment',
  salesInvoice: 'SalesInvoice',
  cashReceipt: 'CashReceipt',
  journalEntry: 'JournalEntry',
} as const;

export type DocTable = keyof typeof TABLES;

/**
 * Generate the next document number like PREFIX-2026-0001.
 * Counts existing rows in the same transaction to stay race-safe.
 */
export async function nextDocNo(
  db: DbClient,
  table: DocTable,
  field: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const rows = await db.$queryRaw<Array<{ n: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS "n" FROM ${Prisma.raw(`"${TABLES[table]}"`)} WHERE ${Prisma.raw(`"${field}"`)} LIKE ${stem + '%'}`,
  );
  const seq = (rows[0]?.n ?? 0) + 1;
  return `${stem}${String(seq).padStart(4, '0')}`;
}
