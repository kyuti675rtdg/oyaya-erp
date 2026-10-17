-- Storage & Conditioning expansion: wheat type tracking on movements + conditioning cycles
ALTER TABLE "StorageMovement" ADD COLUMN "wheatType" TEXT;
ALTER TABLE "StorageMovement" ADD COLUMN "notes" TEXT;

CREATE TABLE "ConditioningCycle" (
    "id" TEXT NOT NULL,
    "tankCode" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "blendRatio" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredHrs" DECIMAL(6,2) NOT NULL,
    "waterAddedQ" DECIMAL(12,2),
    "moistureBefore" DECIMAL(5,2),
    "moistureAfter" DECIMAL(5,2),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "ConditioningCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConditioningCycle_batchNo_key" ON "ConditioningCycle"("batchNo");
CREATE INDEX "ConditioningCycle_tankCode_idx" ON "ConditioningCycle"("tankCode");
