-- Module 12: Product Traceability — RecallCase tables (deploy-safe, idempotent)

CREATE TABLE IF NOT EXISTS "RecallCase" (
    "id" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "rootType" TEXT NOT NULL,
    "rootBatchId" TEXT,
    "rootBatchNo" TEXT,
    "rootLotNo" TEXT,
    "severity" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "impactSnapshot" JSONB,
    "investigationLog" JSONB,
    "disposition" TEXT,
    "dispositionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "openedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecallCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecallCase_caseNo_key" ON "RecallCase"("caseNo");
CREATE INDEX IF NOT EXISTS "RecallCase_status_idx" ON "RecallCase"("status");
CREATE INDEX IF NOT EXISTS "RecallCase_rootBatchNo_idx" ON "RecallCase"("rootBatchNo");

CREATE TABLE IF NOT EXISTS "RecallAffectedItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "batchNo" TEXT,
    "lotNo" TEXT,
    "productName" TEXT,
    "quintals" DECIMAL(12,2),
    "bags" INTEGER,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AFFECTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallAffectedItem_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RecallAffectedItem_caseId_fkey'
    ) THEN
        ALTER TABLE "RecallAffectedItem"
            ADD CONSTRAINT "RecallAffectedItem_caseId_fkey"
            FOREIGN KEY ("caseId") REFERENCES "RecallCase"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RecallAffectedItem_caseId_idx" ON "RecallAffectedItem"("caseId");
CREATE INDEX IF NOT EXISTS "RecallAffectedItem_batchNo_idx" ON "RecallAffectedItem"("batchNo");
