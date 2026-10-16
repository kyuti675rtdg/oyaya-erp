import { Router } from 'express';
import { z } from 'zod';
import { Prisma, AccountType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { postJournal } from './service';

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

router.get(
  '/reports/income-statement',
  requirePermission('finance:view'),
  validateQuery(rangeQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof rangeQuerySchema>;
      const lines = await loadLines(q.from, q.to);

      let revenue = new Prisma.Decimal(0);
      let expenses = new Prisma.Decimal(0);
      for (const l of lines) {
        if (l.account.type === AccountType.REVENUE) {
          revenue = revenue.plus(l.credit.minus(l.debit));
        } else if (l.account.type === AccountType.EXPENSE) {
          expenses = expenses.plus(l.debit.minus(l.credit));
        }
      }
      const netIncome = revenue.minus(expenses);

      res.json({
        revenue: revenue.toNumber(),
        expenses: expenses.toNumber(),
        netIncome: netIncome.toNumber(),
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

      let assets = new Prisma.Decimal(0);
      let liabilities = new Prisma.Decimal(0);
      let equityBase = new Prisma.Decimal(0);
      let revenue = new Prisma.Decimal(0);
      let expenses = new Prisma.Decimal(0);

      for (const l of lines) {
        switch (l.account.type) {
          case AccountType.ASSET:
            assets = assets.plus(l.debit.minus(l.credit));
            break;
          case AccountType.LIABILITY:
            liabilities = liabilities.plus(l.credit.minus(l.debit));
            break;
          case AccountType.EQUITY:
            equityBase = equityBase.plus(l.credit.minus(l.debit));
            break;
          case AccountType.REVENUE:
            revenue = revenue.plus(l.credit.minus(l.debit));
            break;
          case AccountType.EXPENSE:
            expenses = expenses.plus(l.debit.minus(l.credit));
            break;
        }
      }

      const netIncome = revenue.minus(expenses);
      const equity = equityBase.plus(netIncome);
      const balanced = Math.abs(assets.minus(liabilities.plus(equity)).toNumber()) <= 0.01;

      res.json({
        assets: assets.toNumber(),
        liabilities: liabilities.toNumber(),
        equity: equity.toNumber(),
        netIncome: netIncome.toNumber(),
        balanced,
        asOf,
      });
    } catch (err) {
      next(err);
    }
  },
);
