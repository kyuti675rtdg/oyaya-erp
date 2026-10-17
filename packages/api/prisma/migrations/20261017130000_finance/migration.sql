-- Finance expansion (Module 14): vouchers, expense claims, cash & bank accounts.
-- Deploy-safe: no destructive operations; idempotent enum creation.

DO $$ BEGIN
  CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VoucherKind" AS ENUM ('PAYMENT', 'RECEIPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CashAccountKind" AS ENUM ('CASH', 'BANK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "glAccountCode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "ExpenseClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "claimNo" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL REFERENCES "ExpenseCategory"("id"),
  "amountBirr" DECIMAL(18,2) NOT NULL,
  "glAccountCode" TEXT NOT NULL,
  "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "journalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CashBankAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" "CashAccountKind" NOT NULL,
  "bankName" TEXT,
  "accountNo" TEXT,
  "glAccountCode" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CashTransfer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transferNo" TEXT NOT NULL UNIQUE,
  "fromAccountId" TEXT NOT NULL REFERENCES "CashBankAccount"("id"),
  "toAccountId" TEXT NOT NULL REFERENCES "CashBankAccount"("id"),
  "amountBirr" DECIMAL(18,2) NOT NULL,
  "transferDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "memo" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FinanceVoucher" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "voucherNo" TEXT NOT NULL UNIQUE,
  "kind" "VoucherKind" NOT NULL,
  "counterparty" TEXT NOT NULL,
  "amountBirr" DECIMAL(18,2) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT,
  "cashBankAccountId" TEXT REFERENCES "CashBankAccount"("id"),
  "debitAccountCode" TEXT NOT NULL,
  "creditAccountCode" TEXT NOT NULL,
  "memo" TEXT,
  "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "ExpenseClaim_categoryId_idx" ON "ExpenseClaim"("categoryId");
CREATE INDEX IF NOT EXISTS "ExpenseClaim_status_idx" ON "ExpenseClaim"("status");
CREATE INDEX IF NOT EXISTS "CashTransfer_fromAccountId_idx" ON "CashTransfer"("fromAccountId");
CREATE INDEX IF NOT EXISTS "CashTransfer_toAccountId_idx" ON "CashTransfer"("toAccountId");
CREATE INDEX IF NOT EXISTS "FinanceVoucher_kind_status_idx" ON "FinanceVoucher"("kind", "status");
