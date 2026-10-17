import { Router } from 'express';
import { z } from 'zod';
import {
  Prisma,
  AccountType,
  ClaimStatus,
  VoucherKind,
  VoucherStatus,
  CashAccountKind
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { postJournal } from './service';
import { nextDocNo } from '../../lib/numbers';

export const router = Router();

function uidOf(req: Express.Request): string {
  const uid = req.user?.id;
  if (!uid) throw new AppError(401, 'Unauthenticated');
  return uid;
}

// ─── Chart of accounts ──────────────────────────────────────────

const coaCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.nativeEnum(AccountType),
  parentId: z.string().min(1).optional(),
});

const coaUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: z.nativeEnum(AccountType).optional(),
  parentId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

const coaIdSchema = z.object({ id: z.string().min(1) });

router.get('/coa', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.chartOfAccount.findMany({ orderBy: { code: 'asc' } });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/coa',
  requirePermission('finance:manage'),
  validateBody(coaCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof coaCreateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.chartOfAccount.create({
          data: {
            code: body.code,
            name: body.name,
            type: body.type,
            parentId: body.parentId ?? null,
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'ChartOfAccount',
          entityId: created.id,
          changes: { code: body.code, name: body.name, type: body.type },
        });
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/coa/:id',
  requirePermission('finance:manage'),
  validateParams(coaIdSchema),
  validateBody(coaUpdateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof coaUpdateSchema>;
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.chartOfAccount.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new AppError(404, 'Account not found');
        const updated = await tx.chartOfAccount.update({
          where: { id: req.params.id },
          data: {
            ...(body.code !== undefined ? { code: body.code } : {}),
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await audit(tx, {
          userId: uid,
          action: 'UPDATE',
          entityType: 'ChartOfAccount',
          entityId: updated.id,
          changes: body,
        });
        return updated;
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Journal entries ────────────────────────────────────────────

const journalLineSchema = z.object({
  accountCode: z.string().min(1),
  debit: z.number().min(0),
  credit: z.number().min(0),
  memo: z.string().optional(),
});

const createEntrySchema = z.object({
  entryDate: z.coerce.date().optional(),
  memo: z.string().optional(),
  module: z.string().min(1),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  lines: z.array(journalLineSchema).min(1),
});

const entriesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  module: z.string().optional(),
  accountCode: z.string().optional(),
  q: z.string().optional(),
});

router.get(
  '/entries',
  requirePermission('finance:view'),
  validateQuery(entriesQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof entriesQuerySchema>;
      const rows = await prisma.journalEntry.findMany({
        where: {
          module: q.module,
          entryDate: { gte: q.from, lte: q.to },
          ...(q.q ? { memo: { contains: q.q, mode: 'insensitive' } } : {}),
          ...(q.accountCode
            ? { lines: { some: { account: { code: q.accountCode } } } }
            : {}),
        },
        include: { lines: { include: { account: true } } },
        orderBy: { entryDate: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/entries/:id',
  requirePermission('finance:view'),
  validateParams(coaIdSchema),
  async (req, res, next) => {
    try {
      const entry = await prisma.journalEntry.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { account: true } } },
      });
      if (!entry) throw new AppError(404, 'Journal entry not found');
      res.json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// ─── General ledger — account drill-down with running balance ───

const ledgerQuerySchema = z.object({
  accountCode: z.string().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Normal-balance sign: debit-normal accounts (Asset/Expense) keep debit-minus-credit. */
function signedBalance(type: AccountType, debit: Prisma.Decimal, credit: Prisma.Decimal): Prisma.Decimal {
  if (type === AccountType.ASSET || type === AccountType.EXPENSE) return debit.minus(credit);
  return credit.minus(debit);
}

router.get(
  '/ledger',
  requirePermission('finance:view'),
  validateQuery(ledgerQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof ledgerQuerySchema>;
      const account = await prisma.chartOfAccount.findUnique({ where: { code: q.accountCode } });
      if (!account) throw new AppError(404, `Account ${q.accountCode} not found`);

      const lines = await prisma.journalLine.findMany({
        where: {
          accountId: account.id,
          entry: { entryDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } },
        },
        include: { entry: true, account: true },
        orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { entryNo: 'asc' } }],
      });

      let opening = new Prisma.Decimal(0);
      if (q.from) {
        const prior = await prisma.journalLine.findMany({
          where: { accountId: account.id, entry: { entryDate: { lt: q.from } } },
        });
        for (const l of prior) {
          opening = opening.plus(signedBalance(account.type, l.debit, l.credit));
        }
      }

      let running = opening;
      const rows = lines.map((l) => {
        running = running.plus(signedBalance(account.type, l.debit, l.credit));
        return {
          id: l.id,
          entryId: l.entryId,
          entryNo: l.entry.entryNo,
          entryDate: l.entry.entryDate,
          memo: l.memo ?? l.entry.memo ?? null,
          module: l.entry.module,
          debit: l.debit.toNumber(),
          credit: l.credit.toNumber(),
          balance: running.toNumber(),
        };
      });

      res.json({
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        openingBalance: opening.toNumber(),
        lines: rows,
        totals: {
          debit: rows.reduce((s, r) => s + r.debit, 0),
          credit: rows.reduce((s, r) => s + r.credit, 0),
          closingBalance: running.toNumber(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/entries',
  requirePermission('finance:manage'),
  validateBody(createEntrySchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof createEntrySchema>;
      const entry = await prisma.$transaction(async (tx) =>
        postJournal(tx, {
          entryDate: body.entryDate,
          memo: body.memo,
          module: body.module,
          referenceType: body.referenceType,
          referenceId: body.referenceId,
          createdById: uid,
          lines: body.lines,
        }),
      );
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

const generalEntrySchema = z.object({
  entryDate: z.coerce.date().optional(),
  description: z.string().min(1),
  amountBirr: z.number().positive(),
  kind: z.enum(['income', 'expense']),
  accountCode: z.string().min(1).optional(),
});

router.post(
  '/entries/general',
  requirePermission('finance:manage'),
  validateBody(generalEntrySchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof generalEntrySchema>;
      const amount = body.amountBirr;

      let lines: Array<{ accountCode: string; debit: number; credit: number }>;
      if (body.kind === 'income') {
        lines = [
          { accountCode: '1000', debit: amount, credit: 0 },
          { accountCode: body.accountCode ?? '4000', debit: 0, credit: amount },
        ];
      } else {
        if (!body.accountCode) throw new AppError(400, 'accountCode is required for expense entries');
        lines = [
          { accountCode: body.accountCode, debit: amount, credit: 0 },
          { accountCode: '1000', debit: 0, credit: amount },
        ];
      }

      const entry = await prisma.$transaction(async (tx) =>
        postJournal(tx, {
          entryDate: body.entryDate,
          memo: body.description,
          module: 'general',
          createdById: uid,
          lines,
        }),
      );
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reports ────────────────────────────────────────────────────

interface AccountTotals {
  code: string;
  name: string;
  type: AccountType;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

async function loadLines(from?: Date, to?: Date, asOf?: Date) {
  return prisma.journalLine.findMany({
    where: {
      entry: {
        entryDate: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
          ...(asOf ? { lte: asOf } : {}),
        },
      },
    },
    include: { account: true },
  });
}

const rangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/reports/trial-balance',
  requirePermission('finance:view'),
  validateQuery(rangeQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof rangeQuerySchema>;
      const lines = await loadLines(q.from, q.to);

      const byAccount = new Map<string, AccountTotals>();
      for (const l of lines) {
        const row =
          byAccount.get(l.accountId) ??
          ({
            code: l.account.code,
            name: l.account.name,
            type: l.account.type,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(0),
          } as AccountTotals);
        row.debit = row.debit.plus(l.debit);
        row.credit = row.credit.plus(l.credit);
        byAccount.set(l.accountId, row);
      }

      const accounts = [...byAccount.values()]
        .map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          debit: r.debit.toNumber(),
          credit: r.credit.toNumber(),
          balance: r.debit.minus(r.credit).toNumber(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      const totals = {
        debit: accounts.reduce((s, a) => s + a.debit, 0),
        credit: accounts.reduce((s, a) => s + a.credit, 0),
      };

      res.json({ accounts, totals });
    } catch (err) {
      next(err);
    }
  },
);

const incomeCompareSchema = rangeQuerySchema.extend({
  compareFrom: z.coerce.date().optional(),
  compareTo: z.coerce.date().optional(),
});

interface TypeBreakdown {
  code: string;
  name: string;
  amount: number;
}

function breakdownLines(
  lines: Array<{ account: { code: string; name: string; type: AccountType }; debit: Prisma.Decimal; credit: Prisma.Decimal }>,
  types: AccountType[],
  debitNormal: boolean,
): { total: Prisma.Decimal; items: TypeBreakdown[] } {
  const byAccount = new Map<string, { name: string; amount: Prisma.Decimal }>();
  for (const l of lines) {
    if (!types.includes(l.account.type)) continue;
    const signed = debitNormal ? l.debit.minus(l.credit) : l.credit.minus(l.debit);
    const cur = byAccount.get(l.account.code) ?? { name: l.account.name, amount: new Prisma.Decimal(0) };
    cur.amount = cur.amount.plus(signed);
    byAccount.set(l.account.code, cur);
  }
  const items = [...byAccount.entries()]
    .map(([code, v]) => ({ code, name: v.name, amount: v.amount.toNumber() }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const total = items.reduce((s, i) => s + i.amount, 0);
  return { total: new Prisma.Decimal(total), items };
}

router.get(
  '/reports/income-statement',
  requirePermission('finance:view'),
  validateQuery(incomeCompareSchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof incomeCompareSchema>;
      const lines = await loadLines(q.from, q.to);

      const revenue = breakdownLines(lines, [AccountType.REVENUE], false);
      // COGS: expense accounts in the 5xxx range.
      const cogsLines = lines.filter(
        (l) => l.account.type === AccountType.EXPENSE && l.account.code.startsWith('5'),
      );
      const cogs = breakdownLines(cogsLines, [AccountType.EXPENSE], true);
      const otherExpenses = breakdownLines(
        lines.filter((l) => !(l.account.type === AccountType.EXPENSE && l.account.code.startsWith('5'))),
        [AccountType.EXPENSE],
        true,
      );

      const grossProfit = revenue.total.minus(cogs.total);
      const netIncome = grossProfit.minus(otherExpenses.total);

      // Optional previous-period comparison.
      let previous: { revenue: number; expenses: number; netIncome: number; from: unknown; to: unknown } | null = null;
      if (q.compareFrom || q.compareTo) {
        const plines = await loadLines(q.compareFrom, q.compareTo);
        let pRev = new Prisma.Decimal(0);
        let pExp = new Prisma.Decimal(0);
        for (const l of plines) {
          if (l.account.type === AccountType.REVENUE) pRev = pRev.plus(l.credit.minus(l.debit));
          else if (l.account.type === AccountType.EXPENSE) pExp = pExp.plus(l.debit.minus(l.credit));
        }
        previous = {
          revenue: pRev.toNumber(),
          expenses: pExp.toNumber(),
          netIncome: pRev.minus(pExp).toNumber(),
          from: q.compareFrom ?? null,
          to: q.compareTo ?? null,
        };
      }

      res.json({
        revenue: { total: revenue.total.toNumber(), items: revenue.items },
        cogs: { total: cogs.total.toNumber(), items: cogs.items },
        grossProfit: grossProfit.toNumber(),
        expenses: { total: otherExpenses.total.toNumber(), items: otherExpenses.items },
        netIncome: netIncome.toNumber(),
        previous,
        from: q.from ?? null,
        to: q.to ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

const balanceSheetQuerySchema = z.object({
  asOf: z.coerce.date().optional(),
});

router.get(
  '/reports/balance-sheet',
  requirePermission('finance:view'),
  validateQuery(balanceSheetQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof balanceSheetQuerySchema>;
      const asOf = q.asOf ?? new Date();
      const lines = await loadLines(undefined, undefined, asOf);

      const byType = new Map<AccountType, Map<string, { name: string; amount: Prisma.Decimal }>>();
      for (const l of lines) {
        const signed = signedBalance(l.account.type, l.debit, l.credit);
        let m = byType.get(l.account.type);
        if (!m) {
          m = new Map();
          byType.set(l.account.type, m);
        }
        const cur = m.get(l.account.code) ?? { name: l.account.name, amount: new Prisma.Decimal(0) };
        cur.amount = cur.amount.plus(signed);
        m.set(l.account.code, cur);
      }
      const section = (t: AccountType) =>
        [...(byType.get(t)?.entries() ?? [])]
          .map(([code, v]) => ({ code, name: v.name, amount: v.amount.toNumber() }))
          .filter((r) => Math.abs(r.amount) > 0.005)
          .sort((a, b) => a.code.localeCompare(b.code));
      const sum = (t: AccountType) => section(t).reduce((s, r) => s + r.amount, 0);

      const assets = sum(AccountType.ASSET);
      const liabilities = sum(AccountType.LIABILITY);
      const equityBase = sum(AccountType.EQUITY);
      const revenue = sum(AccountType.REVENUE);
      const expenses = sum(AccountType.EXPENSE);

      const netIncome = revenue - expenses;
      const equity = equityBase + netIncome;
      const balanced = Math.abs(assets - (liabilities + equity)) <= 0.01;

      res.json({
        assets: { total: assets, items: section(AccountType.ASSET) },
        liabilities: { total: liabilities, items: section(AccountType.LIABILITY) },
        equity: { total: equity, equityBase: { total: equityBase, items: section(AccountType.EQUITY) } },
        netIncome,
        balanced,
        asOf,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payment & receipt vouchers ────────────────────────────────

const voucherCreateSchema = z.object({
  kind: z.nativeEnum(VoucherKind),
  counterparty: z.string().min(1),
  amountBirr: z.number().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE']),
  reference: z.string().optional(),
  cashBankAccountId: z.string().min(1).optional(),
  /** GL account on the non-cash side: debited for payments, credited for receipts. */
  accountCode: z.string().min(1),
  memo: z.string().optional(),
});

const voucherFilterSchema = z.object({
  kind: z.nativeEnum(VoucherKind).optional(),
  status: z.nativeEnum(VoucherStatus).optional(),
});

router.get(
  '/vouchers',
  requirePermission('finance:view'),
  validateQuery(voucherFilterSchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof voucherFilterSchema>;
      const rows = await prisma.financeVoucher.findMany({
        where: { kind: q.kind, status: q.status },
        include: { cashBankAccount: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vouchers',
  requirePermission('finance:manage'),
  validateBody(voucherCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof voucherCreateSchema>;
      const voucher = await prisma.$transaction(async (tx) => {
        // Resolve the cash side: explicit cash/bank account, else the seeded Cash and Bank GL account.
        let cashGlCode = '1000';
        let cashBankAccountId: string | null = null;
        if (body.cashBankAccountId) {
          const cb = await tx.cashBankAccount.findUnique({ where: { id: body.cashBankAccountId } });
          if (!cb || !cb.isActive) throw new AppError(400, 'Cash/bank account not found or inactive');
          cashGlCode = cb.glAccountCode;
          cashBankAccountId = cb.id;
        }
        const other = await tx.chartOfAccount.findUnique({ where: { code: body.accountCode } });
        if (!other || !other.isActive) throw new AppError(400, `Account ${body.accountCode} not found or inactive`);

        const isPayment = body.kind === VoucherKind.PAYMENT;
        const debitAccountCode = isPayment ? body.accountCode : cashGlCode;
        const creditAccountCode = isPayment ? cashGlCode : body.accountCode;
        const voucherNo = await nextDocNo(tx, 'financeVoucher', 'voucherNo', isPayment ? 'PV' : 'RV');

        const created = await tx.financeVoucher.create({
          data: {
            voucherNo,
            kind: body.kind,
            counterparty: body.counterparty,
            amountBirr: new Prisma.Decimal(body.amountBirr),
            method: body.method,
            reference: body.reference ?? null,
            cashBankAccountId,
            debitAccountCode,
            creditAccountCode,
            memo: body.memo ?? null,
            createdById: uid,
          },
          include: { cashBankAccount: true },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'FinanceVoucher',
          entityId: created.id,
          changes: { voucherNo, kind: body.kind, amountBirr: body.amountBirr },
        });
        return created;
      });
      res.status(201).json(voucher);
    } catch (err) {
      next(err);
    }
  },
);

const voucherIdSchema = z.object({ id: z.string().min(1) });

router.get(
  '/vouchers/:id',
  requirePermission('finance:view'),
  validateParams(voucherIdSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.financeVoucher.findUnique({
        where: { id: req.params.id },
        include: { cashBankAccount: true },
      });
      if (!row) throw new AppError(404, 'Voucher not found');
      const entry = await prisma.journalEntry.findFirst({
        where: { referenceType: 'FinanceVoucher', referenceId: row.id },
      });
      res.json({ ...row, journalEntry: entry });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vouchers/:id/approve',
  requirePermission('finance:approve'),
  validateParams(voucherIdSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const updated = await prisma.$transaction(async (tx) => {
        const v = await tx.financeVoucher.findUnique({ where: { id: req.params.id } });
        if (!v) throw new AppError(404, 'Voucher not found');
        if (v.status !== VoucherStatus.DRAFT) throw new AppError(409, 'Only DRAFT vouchers can be approved');
        const row = await tx.financeVoucher.update({
          where: { id: v.id },
          data: { status: VoucherStatus.APPROVED, approvedById: uid, approvedAt: new Date() },
        });
        await audit(tx, { userId: uid, action: 'APPROVE', entityType: 'FinanceVoucher', entityId: v.id });
        return row;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vouchers/:id/post',
  requirePermission('finance:approve'),
  validateParams(voucherIdSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const updated = await prisma.$transaction(async (tx) => {
        const v = await tx.financeVoucher.findUnique({ where: { id: req.params.id } });
        if (!v) throw new AppError(404, 'Voucher not found');
        if (v.status === VoucherStatus.POSTED) throw new AppError(409, 'Voucher already posted');
        if (v.status !== VoucherStatus.APPROVED) throw new AppError(409, 'Voucher must be approved before posting');
        const amount = new Prisma.Decimal(v.amountBirr.toString());
        await postJournal(tx, {
          entryDate: new Date(),
          memo: `${v.kind === VoucherKind.PAYMENT ? 'Payment' : 'Receipt'} voucher ${v.voucherNo} — ${v.counterparty}`,
          module: 'finance',
          referenceType: 'FinanceVoucher',
          referenceId: v.id,
          createdById: uid,
          lines: [
            { accountCode: v.debitAccountCode, debit: amount, credit: new Prisma.Decimal(0) },
            { accountCode: v.creditAccountCode, debit: new Prisma.Decimal(0), credit: amount },
          ],
        });
        const row = await tx.financeVoucher.update({
          where: { id: v.id },
          data: { status: VoucherStatus.POSTED, postedAt: new Date() },
          include: { cashBankAccount: true },
        });
        await audit(tx, { userId: uid, action: 'POST', entityType: 'FinanceVoucher', entityId: v.id });
        return row;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/vouchers/:id/cancel',
  requirePermission('finance:approve'),
  validateParams(voucherIdSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const updated = await prisma.$transaction(async (tx) => {
        const v = await tx.financeVoucher.findUnique({ where: { id: req.params.id } });
        if (!v) throw new AppError(404, 'Voucher not found');
        if (v.status === VoucherStatus.POSTED) throw new AppError(409, 'Posted vouchers cannot be cancelled');
        const row = await tx.financeVoucher.update({
          where: { id: v.id },
          data: { status: VoucherStatus.CANCELLED },
        });
        await audit(tx, { userId: uid, action: 'CANCEL', entityType: 'FinanceVoucher', entityId: v.id });
        return row;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Expense categories & claims ───────────────────────────────

const expenseCategoryCreateSchema = z.object({
  name: z.string().min(1),
  glAccountCode: z.string().optional(),
});

const expenseCategoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  glAccountCode: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get('/expense-categories', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    res.json(await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/expense-categories',
  requirePermission('finance:manage'),
  validateBody(expenseCategoryCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof expenseCategoryCreateSchema>;
      const row = await prisma.expenseCategory.create({
        data: { name: body.name, glAccountCode: body.glAccountCode ?? null },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'ExpenseCategory',
        entityId: row.id,
        changes: { name: body.name },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/expense-categories/:id',
  requirePermission('finance:manage'),
  validateParams(coaIdSchema),
  validateBody(expenseCategoryUpdateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof expenseCategoryUpdateSchema>;
      const row = await prisma.expenseCategory.update({
        where: { id: req.params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.glAccountCode !== undefined ? { glAccountCode: body.glAccountCode } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

const claimCreateSchema = z.object({
  title: z.string().min(1),
  categoryId: z.string().min(1),
  amountBirr: z.number().positive(),
  glAccountCode: z.string().optional(),
  notes: z.string().optional(),
});

const claimFilterSchema = z.object({
  status: z.nativeEnum(ClaimStatus).optional(),
});

router.get(
  '/expense-claims',
  requirePermission('finance:view'),
  validateQuery(claimFilterSchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof claimFilterSchema>;
      const rows = await prisma.expenseClaim.findMany({
        where: { status: q.status },
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/expense-claims',
  requirePermission('finance:manage'),
  validateBody(claimCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof claimCreateSchema>;
      const claim = await prisma.$transaction(async (tx) => {
        const category = await tx.expenseCategory.findUnique({ where: { id: body.categoryId } });
        if (!category || !category.isActive) throw new AppError(400, 'Expense category not found or inactive');
        const glAccountCode = body.glAccountCode ?? category.glAccountCode ?? '6000';
        const acct = await tx.chartOfAccount.findUnique({ where: { code: glAccountCode } });
        if (!acct || !acct.isActive) throw new AppError(400, `Account ${glAccountCode} not found or inactive`);
        if (acct.type !== AccountType.EXPENSE && acct.type !== AccountType.ASSET) {
          throw new AppError(400, 'Expense account must be an Expense or Asset account');
        }
        const claimNo = await nextDocNo(tx, 'expenseClaim', 'claimNo', 'EXP');
        const created = await tx.expenseClaim.create({
          data: {
            claimNo,
            title: body.title,
            categoryId: category.id,
            amountBirr: new Prisma.Decimal(body.amountBirr),
            glAccountCode,
            notes: body.notes ?? null,
            requestedById: uid,
          },
          include: { category: true },
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'ExpenseClaim',
          entityId: created.id,
          changes: { claimNo, amountBirr: body.amountBirr },
        });
        return created;
      });
      res.status(201).json(claim);
    } catch (err) {
      next(err);
    }
  },
);

const claimIdSchema = z.object({ id: z.string().min(1) });

async function transitionClaim(
  uid: string,
  id: string,
  from: ClaimStatus[],
  to: ClaimStatus,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.expenseClaim.findUnique({ where: { id }, include: { category: true } });
    if (!claim) throw new AppError(404, 'Expense claim not found');
    if (!from.includes(claim.status)) throw new AppError(409, `Claim is ${claim.status}; expected ${from.join(' or ')}`);

    // Paying a claim posts the balanced GL journal: debit expense, credit Cash and Bank.
    if (to === ClaimStatus.PAID) {
      const existing = await tx.journalEntry.findFirst({
        where: { referenceType: 'ExpenseClaim', referenceId: claim.id },
      });
      if (existing) throw new AppError(409, 'Claim already posted to the ledger');
      const amount = new Prisma.Decimal(claim.amountBirr.toString());
      const entry = await postJournal(tx, {
        entryDate: new Date(),
        memo: `Expense claim ${claim.claimNo} — ${claim.title}`,
        module: 'finance',
        referenceType: 'ExpenseClaim',
        referenceId: claim.id,
        createdById: uid,
        lines: [
          { accountCode: claim.glAccountCode, debit: amount, credit: new Prisma.Decimal(0) },
          { accountCode: '1000', debit: new Prisma.Decimal(0), credit: amount },
        ],
      });
      extra = { ...extra, journalId: entry.id };
    }

    const row = await tx.expenseClaim.update({ where: { id: claim.id }, data: { status: to, ...extra }, include: { category: true } });
    await audit(tx, { userId: uid, action: to, entityType: 'ExpenseClaim', entityId: claim.id });
    return row;
  });
}

router.post(
  '/expense-claims/:id/submit',
  requirePermission('finance:manage'),
  validateParams(claimIdSchema),
  async (req, res, next) => {
    try {
      res.json(await transitionClaim(uidOf(req), req.params.id, [ClaimStatus.DRAFT], ClaimStatus.SUBMITTED));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/expense-claims/:id/approve',
  requirePermission('finance:approve'),
  validateParams(claimIdSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      res.json(
        await transitionClaim(uid, req.params.id, [ClaimStatus.SUBMITTED], ClaimStatus.APPROVED, {
          approvedById: uid,
          approvedAt: new Date(),
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/expense-claims/:id/reject',
  requirePermission('finance:approve'),
  validateParams(claimIdSchema),
  async (req, res, next) => {
    try {
      res.json(await transitionClaim(uidOf(req), req.params.id, [ClaimStatus.SUBMITTED], ClaimStatus.REJECTED));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/expense-claims/:id/pay',
  requirePermission('finance:approve'),
  validateParams(claimIdSchema),
  async (req, res, next) => {
    try {
      res.json(await transitionClaim(uidOf(req), req.params.id, [ClaimStatus.APPROVED], ClaimStatus.PAID));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cash & bank management ────────────────────────────────────

const cashAccountCreateSchema = z.object({
  name: z.string().min(1),
  kind: z.nativeEnum(CashAccountKind),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  glAccountCode: z.string().min(1),
});

const cashAccountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  bankName: z.string().nullable().optional(),
  accountNo: z.string().nullable().optional(),
  glAccountCode: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

router.get('/cash-bank-accounts', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const accounts = await prisma.cashBankAccount.findMany({ orderBy: { name: 'asc' } });
    const codes = [...new Set(accounts.map((a) => a.glAccountCode))];
    const coa = await prisma.chartOfAccount.findMany({ where: { code: { in: codes } } });
    const accountByCode = new Map(coa.map((c) => [c.code, c]));
    const lines = await prisma.journalLine.findMany({
      where: { account: { code: { in: codes } } },
      include: { account: true },
    });
    const balByCode = new Map<string, number>();
    for (const l of lines) {
      const signed = signedBalance(l.account.type, l.debit, l.credit).toNumber();
      balByCode.set(l.account.code, (balByCode.get(l.account.code) ?? 0) + signed);
    }
    res.json(
      accounts.map((a) => ({
        ...a,
        balance: balByCode.get(a.glAccountCode) ?? 0,
        glAccountName: accountByCode.get(a.glAccountCode)?.name ?? a.glAccountCode,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  '/cash-bank-accounts',
  requirePermission('finance:manage'),
  validateBody(cashAccountCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof cashAccountCreateSchema>;
      const acct = await prisma.chartOfAccount.findUnique({ where: { code: body.glAccountCode } });
      if (!acct || !acct.isActive) throw new AppError(400, `Account ${body.glAccountCode} not found or inactive`);
      if (acct.type !== AccountType.ASSET) throw new AppError(400, 'Cash/bank accounts must link to an Asset account');
      const row = await prisma.cashBankAccount.create({
        data: {
          name: body.name,
          kind: body.kind,
          bankName: body.bankName ?? null,
          accountNo: body.accountNo ?? null,
          glAccountCode: body.glAccountCode,
        },
      });
      await audit(prisma, {
        userId: uid,
        action: 'CREATE',
        entityType: 'CashBankAccount',
        entityId: row.id,
        changes: { name: body.name, kind: body.kind },
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/cash-bank-accounts/:id',
  requirePermission('finance:manage'),
  validateParams(coaIdSchema),
  validateBody(cashAccountUpdateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof cashAccountUpdateSchema>;
      if (body.glAccountCode) {
        const acct = await prisma.chartOfAccount.findUnique({ where: { code: body.glAccountCode } });
        if (!acct || !acct.isActive) throw new AppError(400, `Account ${body.glAccountCode} not found or inactive`);
        if (acct.type !== AccountType.ASSET) throw new AppError(400, 'Cash/bank accounts must link to an Asset account');
      }
      const row = await prisma.cashBankAccount.update({
        where: { id: req.params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.bankName !== undefined ? { bankName: body.bankName } : {}),
          ...(body.accountNo !== undefined ? { accountNo: body.accountNo } : {}),
          ...(body.glAccountCode !== undefined ? { glAccountCode: body.glAccountCode } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cash transfers ────────────────────────────────────────────

const transferCreateSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountBirr: z.number().positive(),
  memo: z.string().optional(),
});

router.get('/transfers', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const rows = await prisma.cashTransfer.findMany({
      include: { fromAccount: true, toAccount: true },
      orderBy: { transferDate: 'desc' },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/transfers',
  requirePermission('finance:manage'),
  validateBody(transferCreateSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const body = req.body as z.infer<typeof transferCreateSchema>;
      if (body.fromAccountId === body.toAccountId) throw new AppError(400, 'Source and destination must differ');
      const transfer = await prisma.$transaction(async (tx) => {
        const from = await tx.cashBankAccount.findUnique({ where: { id: body.fromAccountId } });
        const to = await tx.cashBankAccount.findUnique({ where: { id: body.toAccountId } });
        if (!from || !from.isActive) throw new AppError(400, 'Source account not found or inactive');
        if (!to || !to.isActive) throw new AppError(400, 'Destination account not found or inactive');
        const amount = new Prisma.Decimal(body.amountBirr);
        const transferNo = await nextDocNo(tx, 'cashTransfer', 'transferNo', 'CT');
        const created = await tx.cashTransfer.create({
          data: {
            transferNo,
            fromAccountId: from.id,
            toAccountId: to.id,
            amountBirr: amount,
            memo: body.memo ?? null,
            createdById: uid,
          },
          include: { fromAccount: true, toAccount: true },
        });
        // Double-entry: debit destination, credit source.
        await postJournal(tx, {
          entryDate: new Date(),
          memo: `Cash transfer ${transferNo} — ${from.name} → ${to.name}`,
          module: 'finance',
          referenceType: 'CashTransfer',
          referenceId: created.id,
          createdById: uid,
          lines: [
            { accountCode: to.glAccountCode, debit: amount, credit: new Prisma.Decimal(0) },
            { accountCode: from.glAccountCode, debit: new Prisma.Decimal(0), credit: amount },
          ],
        });
        await audit(tx, {
          userId: uid,
          action: 'CREATE',
          entityType: 'CashTransfer',
          entityId: created.id,
          changes: { transferNo, amountBirr: body.amountBirr },
        });
        return created;
      });
      res.status(201).json(transfer);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Accounts receivable & payable summaries (finance view) ────

const DAY_MS = 86_400_000;

function agingBucket(days: number): string {
  if (days <= 30) return 'current';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

router.get('/ar', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const invoices = await prisma.salesInvoice.findMany({
      include: { receipts: true },
      orderBy: { createdAt: 'desc' },
    });
    const customerIds = [...new Set(invoices.map((i) => i.customerId))];
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } } });
    const nameById = new Map(customers.map((c) => [c.id, c.name]));
    const now = Date.now();
    const rows = invoices.map((inv) => {
      const total = new Prisma.Decimal(inv.amountBirr.toString()).toNumber();
      const paid = inv.receipts.reduce(
        (s: number, r: { amountBirr: Prisma.Decimal }) =>
          s + new Prisma.Decimal(r.amountBirr.toString()).toNumber(),
        0,
      );
      const balance = Math.round((total - paid) * 100) / 100;
      const base = inv.invoicedAt ?? inv.createdAt;
      const days = Math.max(0, Math.floor((now - new Date(base).getTime()) / DAY_MS));
      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        customerId: inv.customerId,
        customerName: nameById.get(inv.customerId) ?? '—',
        total,
        paid,
        balance,
        status: inv.status,
        issuedAt: inv.invoicedAt ?? inv.createdAt,
        daysOpen: days,
        bucket: balance > 0.005 ? agingBucket(days) : 'paid',
      };
    });
    const outstanding = rows.filter((r) => r.balance > 0.005);
    const buckets: Record<string, { count: number; total: number }> = {
      current: { count: 0, total: 0 },
      '31-60': { count: 0, total: 0 },
      '61-90': { count: 0, total: 0 },
      '90+': { count: 0, total: 0 },
    };
    for (const r of outstanding) {
      const b = buckets[r.bucket];
      if (b) {
        b.count += 1;
        b.total = Math.round((b.total + r.balance) * 100) / 100;
      }
    }
    res.json({
      rows,
      summary: {
        totalInvoiced: rows.reduce((s, r) => s + r.total, 0),
        totalPaid: rows.reduce((s, r) => s + r.paid, 0),
        totalOutstanding: rows.reduce((s, r) => s + r.balance, 0),
        buckets,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/ap-summary', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const invoices = await prisma.aPInvoice.findMany({
      include: { payments: true },
      orderBy: { issuedAt: 'desc' },
    });
    const now = Date.now();
    const rows = invoices.map((inv) => {
      const total = new Prisma.Decimal(inv.amountBirr.toString()).toNumber();
      const paid = inv.payments.reduce(
        (s, p) => s + new Prisma.Decimal(p.amountBirr.toString()).toNumber(),
        0,
      );
      const balance = Math.round((total - paid) * 100) / 100;
      const base = inv.dueDate ?? inv.issuedAt;
      const days = Math.max(0, Math.floor((now - new Date(base).getTime()) / DAY_MS));
      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        supplierId: inv.supplierId,
        total,
        paid,
        balance,
        status: inv.status,
        issuedAt: inv.issuedAt,
        dueDate: inv.dueDate,
        daysOpen: days,
        bucket: balance > 0.005 ? agingBucket(days) : 'paid',
      };
    });
    res.json({
      rows,
      summary: {
        totalInvoiced: rows.reduce((s, r) => s + r.total, 0),
        totalPaid: rows.reduce((s, r) => s + r.paid, 0),
        totalOutstanding: rows.reduce((s, r) => s + r.balance, 0),
        openCount: rows.filter((r) => r.balance > 0.005).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Payroll journal integration ─────────────────────────────────

router.get('/payroll-runs', requirePermission('finance:view'), async (_req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      include: { lines: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    const refs = await prisma.journalEntry.findMany({
      where: { referenceType: 'PayrollRun', referenceId: { in: runs.map((r) => r.id) } },
      select: { referenceId: true, entryNo: true, id: true },
    });
    const entryByRun = new Map(refs.map((r) => [r.referenceId, r]));
    res.json(
      runs.map((run) => {
        const total = run.lines.reduce(
          (s, l) => s + new Prisma.Decimal(l.grossBirr.toString()).toNumber(),
          0,
        );
        const entry = entryByRun.get(run.id) ?? null;
        return {
          id: run.id,
          periodYear: run.periodYear,
          periodMonth: run.periodMonth,
          status: run.status,
          lineCount: run.lines.length,
          totalBirr: total,
          journalPosted: Boolean(entry),
          journalEntryId: entry?.id ?? null,
          journalEntryNo: entry?.entryNo ?? null,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

const payrollPostParamsSchema = z.object({ runId: z.string().min(1) });

router.post(
  '/payroll-runs/:runId/post',
  requirePermission('finance:approve'),
  validateParams(payrollPostParamsSchema),
  async (req, res, next) => {
    try {
      const uid = uidOf(req);
      const entry = await prisma.$transaction(async (tx) => {
        const run = await tx.payrollRun.findUnique({
          where: { id: req.params.runId },
          include: { lines: true },
        });
        if (!run) throw new AppError(404, 'Payroll run not found');
        if (run.status !== 'POSTED') throw new AppError(409, 'Only approved (POSTED) payroll runs can be posted to the ledger');
        const existing = await tx.journalEntry.findFirst({
          where: { referenceType: 'PayrollRun', referenceId: run.id },
        });
        if (existing) throw new AppError(409, `Journal ${existing.entryNo} already posted for this run`);
        if (run.lines.length === 0) throw new AppError(409, 'Payroll run has no lines');
        let total = new Prisma.Decimal(0);
        for (const line of run.lines) total = total.plus(line.grossBirr);
        // Double-entry: debit Payroll Expense, credit Accounts Payable (salary payable).
        return postJournal(tx, {
          entryDate: new Date(),
          memo: `Payroll journal ${run.periodYear}-${String(run.periodMonth).padStart(2, '0')} — ${run.lines.length} employees`,
          module: 'payroll',
          referenceType: 'PayrollRun',
          referenceId: run.id,
          createdById: uid,
          lines: [
            { accountCode: '6000', debit: total, credit: new Prisma.Decimal(0) },
            { accountCode: '2000', debit: new Prisma.Decimal(0), credit: total },
          ],
        });
      });
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);
