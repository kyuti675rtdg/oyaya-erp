import { Prisma } from '@prisma/client';
import type { DbClient } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';

// Document-number sequences for the Module 6 expansion tables.
// Mirrors lib/numbers.nextDocNo without touching its whitelisted TABLE map.
const SEQUENCES = {
  nonconformity: { table: '"Nonconformity"', field: '"ncNo"', prefix: 'NC' },
  action: { table: '"NcAction"', field: '"id"', prefix: 'ACT' },
  signoff: { table: '"NcSignoff"', field: '"id"', prefix: 'SIGN' },
} as const;

type SequenceKind = keyof typeof SEQUENCES;

export async function nextNcDocNo(db: DbClient, kind: SequenceKind): Promise<string> {
  const { table, field, prefix } = SEQUENCES[kind];
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const rows = await db.$queryRaw<Array<{ n: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS "n" FROM ${Prisma.raw(table)} WHERE ${Prisma.raw(field)} LIKE ${stem + '%'}`,
  );
  const seq = (rows[0]?.n ?? 0) + 1;
  return `${stem}${String(seq).padStart(4, '0')}`;
}

const ncDetailInclude = {
  batch: { select: { id: true, batchNo: true, productType: true } },
  linkedCapa: { select: { id: true, capaNo: true, status: true } },
  rootCause: true,
  actions: { orderBy: { dueDate: 'asc' as const } },
  disposition: true,
  signoffs: { orderBy: { createdAt: 'desc' as const } },
} as const;

/** Load an NC (or throw 404). */
export async function getNc(tx: DbClient, id: string) {
  const nc = await tx.nonconformity.findUnique({
    where: { id },
    include: ncDetailInclude,
  });
  if (!nc) throw new AppError(404, 'Nonconformity not found');
  return nc;
}

/** Load an NC that is still open (or throw). */
export async function getOpenNc(tx: DbClient, id: string) {
  const nc = await getNc(tx, id);
  if (nc.status === 'CLOSED') throw new AppError(409, 'Nonconformity is closed');
  return nc;
}

export function isActionOverdue(dueDate: Date, status: string): boolean {
  return (
    status !== 'COMPLETED' &&
    status !== 'VERIFIED' &&
    new Date(dueDate).getTime() < Date.now()
  );
}

export function ageInDays(from: Date | string): number {
  const ms = Date.now() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
