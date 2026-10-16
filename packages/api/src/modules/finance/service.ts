import { Prisma } from '@prisma/client';
import type { JournalEntry, JournalLine } from '@prisma/client';
import type { DbClient } from '../../lib/audit';
import { audit } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';

export interface JournalLineInput {
  accountCode: string;
  debit: Prisma.Decimal | number;
  credit: Prisma.Decimal | number;
  memo?: string;
}

export interface PostJournalInput {
  entryDate?: Date;
  memo?: string;
  module: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string;
  lines: JournalLineInput[];
}

function toDec(n: Prisma.Decimal | number): Prisma.Decimal {
  return n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Post a balanced journal entry inside the caller's transaction.
 * Validates that every account exists and is active, and that
 * total debit equals total credit and is greater than zero.
 */
export async function postJournal(
  tx: DbClient,
  input: PostJournalInput,
): Promise<JournalEntry & { lines: JournalLine[] }> {
  if (!input.lines || input.lines.length === 0) {
    throw new AppError(400, 'Journal entry requires at least one line');
  }

  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accounts = await tx.chartOfAccount.findMany({ where: { code: { in: codes } } });
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  const resolved = input.lines.map((line) => {
    const account = accountByCode.get(line.accountCode);
    if (!account || !account.isActive) {
      throw new AppError(400, `Account ${line.accountCode} not found or inactive`);
    }
    return { account, line };
  });

  let sumDebit = new Prisma.Decimal(0);
  let sumCredit = new Prisma.Decimal(0);
  for (const { line } of resolved) {
    sumDebit = sumDebit.plus(toDec(line.debit));
    sumCredit = sumCredit.plus(toDec(line.credit));
  }
  if (sumDebit.lte(0) || !sumDebit.equals(sumCredit)) {
    throw new AppError(
      400,
      'Journal entry must balance: total debit must equal total credit and be greater than zero',
    );
  }

  const entryNo = await nextDocNo(tx, 'journalEntry', 'entryNo', 'JE');

  const entry = await tx.journalEntry.create({
    data: {
      entryNo,
      entryDate: startOfDay(input.entryDate ?? new Date()),
      memo: input.memo ?? null,
      module: input.module,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      createdById: input.createdById ?? null,
      lines: {
        create: resolved.map(({ account, line }) => ({
          accountId: account.id,
          debit: toDec(line.debit),
          credit: toDec(line.credit),
          memo: line.memo ?? null,
        })),
      },
    },
    include: { lines: true },
  });

  await audit(tx, {
    userId: input.createdById ?? null,
    action: 'CREATE',
    entityType: 'JournalEntry',
    entityId: entry.id,
    changes: { entryNo, module: input.module, totalDebit: sumDebit.toNumber() },
  });

  return entry;
}
