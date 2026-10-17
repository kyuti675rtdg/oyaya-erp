-- Combined migration: Modules 4-11 (Production, Quality, CAPA, Hygiene, Pest, Maintenance, FG, Warehouse)


-- ─── Module 4 ───
-- Module 4: Production & Milling Management
-- New tables + WashingLog extensions (water used, pre/post impurity).

-- WashingLog extensions
ALTER TABLE "WashingLog" ADD COLUMN "waterUsedL" INTEGER;
ALTER TABLE "WashingLog" ADD COLUMN "impurityBeforePct" DECIMAL(5,2);
ALTER TABLE "WashingLog" ADD COLUMN "impurityAfterPct" DECIMAL(5,2);

CREATE TABLE "BlendRecipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "hardPct" DECIMAL(5,2) NOT NULL,
    "softPct" DECIMAL(5,2) NOT NULL,
    "foreignPct" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlendRecipe_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BlendRecipe_productType_idx" ON "BlendRecipe"("productType");
CREATE INDEX "BlendRecipe_isActive_idx" ON "BlendRecipe"("isActive");

CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "planNo" TEXT NOT NULL,
    "tankCode" TEXT,
    "batchId" TEXT,
    "targets" JSONB NOT NULL,
    "plannedWheatQ" DECIMAL(12,2) NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "shift" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "actualWheatQ" DECIMAL(12,2),
    "actualOutputQ" DECIMAL(12,2),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionPlan_planNo_key" ON "ProductionPlan"("planNo");
CREATE INDEX "ProductionPlan_batchId_idx" ON "ProductionPlan"("batchId");
CREATE INDEX "ProductionPlan_status_idx" ON "ProductionPlan"("status");
CREATE INDEX "ProductionPlan_scheduledDate_idx" ON "ProductionPlan"("scheduledDate");

CREATE TABLE "MillingRun" (
    "id" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "planId" TEXT,
    "batchId" TEXT NOT NULL,
    "lineMachine" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "feedRateQHr" DECIMAL(8,2),
    "rollSettings" TEXT,
    "operator" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MillingRun_runNo_key" ON "MillingRun"("runNo");
CREATE INDEX "MillingRun_batchId_idx" ON "MillingRun"("batchId");
CREATE INDEX "MillingRun_planId_idx" ON "MillingRun"("planId");
CREATE INDEX "MillingRun_status_idx" ON "MillingRun"("status");

CREATE TABLE "DowntimeLog" (
    "id" TEXT NOT NULL,
    "machineLine" TEXT NOT NULL,
    "runId" TEXT,
    "shiftRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutesLost" INTEGER NOT NULL,
    "reasonCategory" TEXT NOT NULL,
    "description" TEXT,
    "resolvedBy" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DowntimeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DowntimeLog_machineLine_idx" ON "DowntimeLog"("machineLine");
CREATE INDEX "DowntimeLog_startedAt_idx" ON "DowntimeLog"("startedAt");
CREATE INDEX "DowntimeLog_reasonCategory_idx" ON "DowntimeLog"("reasonCategory");

CREATE TABLE "FlourOutput" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "extractionPct" DECIMAL(5,2),
    "belowYieldFlag" BOOLEAN NOT NULL DEFAULT false,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedById" TEXT,

    CONSTRAINT "FlourOutput_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FlourOutput_batchId_idx" ON "FlourOutput"("batchId");
CREATE INDEX "FlourOutput_loggedAt_idx" ON "FlourOutput"("loggedAt");
CREATE INDEX "FlourOutput_belowYieldFlag_idx" ON "FlourOutput"("belowYieldFlag");

CREATE TABLE "YieldAlert" (
    "id" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "ackNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YieldAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YieldAlert_status_idx" ON "YieldAlert"("status");
CREATE INDEX "YieldAlert_severity_idx" ON "YieldAlert"("severity");
CREATE INDEX "YieldAlert_alertType_idx" ON "YieldAlert"("alertType");
CREATE INDEX "YieldAlert_createdAt_idx" ON "YieldAlert"("createdAt");

CREATE TABLE "ShiftHandover" (
    "id" TEXT NOT NULL,
    "shiftRunId" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftHandover_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShiftHandover_shiftRunId_idx" ON "ShiftHandover"("shiftRunId");

-- Foreign keys
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MillingRun" ADD CONSTRAINT "MillingRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MillingRun" ADD CONSTRAINT "MillingRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DowntimeLog" ADD CONSTRAINT "DowntimeLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MillingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FlourOutput" ADD CONSTRAINT "FlourOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftHandover" ADD CONSTRAINT "ShiftHandover_shiftRunId_fkey" FOREIGN KEY ("shiftRunId") REFERENCES "ShiftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Module 5 ───
-- Module 5: Quality Assurance & Laboratory Management
-- Apply after the Module 5 models are merged into schema.prisma
-- (or run `npx prisma migrate dev --name module5_qc_lab` instead).

-- Finished-flour quality tests (per batch per product)
CREATE TABLE IF NOT EXISTS "FlourQualityTest" (
    "id"               TEXT NOT NULL,
    "batchId"          TEXT NOT NULL,
    "productLabel"     TEXT NOT NULL,
    "sampleTime"       TIMESTAMP(3) NOT NULL,
    "flourMoisturePct" DECIMAL(6,2),
    "wetGlutenPct"     DECIMAL(6,2),
    "dryGlutenPct"     DECIMAL(6,2),
    "ashPct"           DECIMAL(6,2),
    "colorScore"       DECIMAL(6,2),
    "granulationPct"   DECIMAL(6,2),
    "impurityPct"      DECIMAL(6,2),
    "verdict"          TEXT NOT NULL DEFAULT 'UNTESTED',
    "outOfRange"       TEXT[] NOT NULL DEFAULT '{}',
    "checkedById"      TEXT,
    "notes"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlourQualityTest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FlourQualityTest_batchId_idx" ON "FlourQualityTest"("batchId");
CREATE INDEX IF NOT EXISTS "FlourQualityTest_sampleTime_idx" ON "FlourQualityTest"("sampleTime");
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FlourQualityTest_batchId_fkey'
    ) THEN
        ALTER TABLE "FlourQualityTest"
            ADD CONSTRAINT "FlourQualityTest_batchId_fkey"
            FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Laboratory sampling schedule (2-hour shift checks, per-truck intake, per-batch flour)
CREATE TABLE IF NOT EXISTS "LabSamplingSchedule" (
    "id"            TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "label"         TEXT NOT NULL,
    "shiftRunId"    TEXT,
    "intakeId"      TEXT,
    "batchId"       TEXT,
    "dueAt"         TIMESTAMP(3) NOT NULL,
    "collectedAt"   TIMESTAMP(3),
    "collectedById" TEXT,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabSamplingSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LabSamplingSchedule_status_idx" ON "LabSamplingSchedule"("status");
CREATE INDEX IF NOT EXISTS "LabSamplingSchedule_dueAt_idx" ON "LabSamplingSchedule"("dueAt");
CREATE INDEX IF NOT EXISTS "LabSamplingSchedule_shiftRunId_idx" ON "LabSamplingSchedule"("shiftRunId");
CREATE INDEX IF NOT EXISTS "LabSamplingSchedule_intakeId_idx" ON "LabSamplingSchedule"("intakeId");
CREATE INDEX IF NOT EXISTS "LabSamplingSchedule_batchId_idx" ON "LabSamplingSchedule"("batchId");

-- ─── Module 6 ───
-- Module 6 (CAPA expansion): Nonconformity & Corrective Action Management
-- COORDINATOR: run after the main prisma migration merge. Idempotent CREATEs.

CREATE TYPE "NcSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');
CREATE TYPE "NcStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'CLOSED');
CREATE TYPE "NcSource" AS ENUM ('INTAKE', 'IN_PROCESS', 'FLOUR', 'HYGIENE', 'PEST');
CREATE TYPE "NcDecision" AS ENUM ('RELEASE', 'REWORK', 'DOWNGRADE', 'RECYCLE_FEED', 'REJECT_DISPOSE');
CREATE TYPE "NcActionType" AS ENUM ('CORRECTIVE', 'PREVENTIVE');
CREATE TYPE "NcActionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED');
CREATE TYPE "NcSignoffKind" AS ENUM ('CLOSURE', 'DISPOSITION');
CREATE TYPE "NcSignoffStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "Nonconformity" (
    "id" TEXT NOT NULL,
    "ncNo" TEXT NOT NULL,
    "source" "NcSource" NOT NULL,
    "batchId" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "severity" "NcSeverity" NOT NULL,
    "detectedBy" TEXT,
    "detectedById" TEXT,
    "dateDetected" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NcStatus" NOT NULL DEFAULT 'OPEN',
    "linkedCapaId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Nonconformity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NcRootCause" (
    "id" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "fiveWhys" JSONB NOT NULL DEFAULT '[]',
    "fishbone" JSONB NOT NULL DEFAULT '{}',
    "rootCause" TEXT,
    "analyst" TEXT,
    "analysisDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NcRootCause_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NcAction" (
    "id" TEXT NOT NULL,
    "ncId" TEXT,
    "capaId" TEXT,
    "actionType" "NcActionType" NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "NcActionStatus" NOT NULL DEFAULT 'PLANNED',
    "completedAt" TIMESTAMP(3),
    "verificationResult" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "effectivenessNote" TEXT,
    "effectivenessOk" BOOLEAN,
    "effectivenessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NcAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NcDisposition" (
    "id" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "decision" "NcDecision" NOT NULL,
    "quantityQ" DECIMAL(12,2) NOT NULL,
    "approverName" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "executedBy" TEXT,
    "executionNote" TEXT,
    CONSTRAINT "NcDisposition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NcSignoff" (
    "id" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "kind" "NcSignoffKind" NOT NULL,
    "status" "NcSignoffStatus" NOT NULL DEFAULT 'PENDING',
    "qualitySignById" TEXT,
    "qualitySignedAt" TIMESTAMP(3),
    "productionSignById" TEXT,
    "productionSignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NcSignoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Nonconformity_ncNo_key" ON "Nonconformity"("ncNo");
CREATE UNIQUE INDEX "NcRootCause_ncId_key" ON "NcRootCause"("ncId");
CREATE UNIQUE INDEX "NcDisposition_ncId_key" ON "NcDisposition"("ncId");
CREATE INDEX "Nonconformity_status_idx" ON "Nonconformity"("status");
CREATE INDEX "Nonconformity_severity_idx" ON "Nonconformity"("severity");
CREATE INDEX "NcAction_ncId_idx" ON "NcAction"("ncId");
CREATE INDEX "NcAction_capaId_idx" ON "NcAction"("capaId");
CREATE INDEX "NcAction_status_dueDate_idx" ON "NcAction"("status", "dueDate");
CREATE INDEX "NcSignoff_ncId_idx" ON "NcSignoff"("ncId");
CREATE INDEX "NcSignoff_status_idx" ON "NcSignoff"("status");

ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_linkedCapaId_fkey"
  FOREIGN KEY ("linkedCapaId") REFERENCES "CAPA"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NcRootCause" ADD CONSTRAINT "NcRootCause_ncId_fkey"
  FOREIGN KEY ("ncId") REFERENCES "Nonconformity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NcAction" ADD CONSTRAINT "NcAction_ncId_fkey"
  FOREIGN KEY ("ncId") REFERENCES "Nonconformity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NcAction" ADD CONSTRAINT "NcAction_capaId_fkey"
  FOREIGN KEY ("capaId") REFERENCES "CAPA"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NcDisposition" ADD CONSTRAINT "NcDisposition_ncId_fkey"
  FOREIGN KEY ("ncId") REFERENCES "Nonconformity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NcSignoff" ADD CONSTRAINT "NcSignoff_ncId_fkey"
  FOREIGN KEY ("ncId") REFERENCES "Nonconformity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Module 7 ───
-- Module 7 (Sanitation & Hygiene Management) migration for Oyaya Flour Mill ERP.
-- Coordinator: apply AFTER merging /tmp/schema-module7.prisma into schema.prisma.
-- Idempotent guard: wrapped in DO blocks so re-runs are safe.

-- ─── Enums ───────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "ChecklistFrequency" AS ENUM ('PER_SHIFT','DAILY','WEEKLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AreaCleaningStatus" AS ENUM ('SCHEDULED','IN_PROGRESS','DONE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "HygieneInspectionResult" AS ENUM ('PASS','FAIL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CleaningActionStatus" AS ENUM ('OPEN','IN_PROGRESS','VERIFIED','CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "HygieneApprovalSubject" AS ENUM ('CLEANING','INSPECTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "HygieneApprovalStatus" AS ENUM ('PENDING','SUPERVISOR_SIGNED','APPROVED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── CleaningChecklistTemplate ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "CleaningChecklistTemplate" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "equipment"   TEXT NOT NULL,
  "area"        TEXT,
  "frequency"   "ChecklistFrequency" NOT NULL DEFAULT 'DAILY',
  "assignedTo"  TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CleaningChecklistTemplate_equipment_isActive_idx"
  ON "CleaningChecklistTemplate"("equipment","isActive");

-- ─── ChecklistTaskItem ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChecklistTaskItem" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "CleaningChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title"      TEXT NOT NULL,
  "detail"     TEXT,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "ChecklistTaskItem_templateId_idx"
  ON "ChecklistTaskItem"("templateId");

-- ─── AreaCleaningLog ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AreaCleaningLog" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "area"        TEXT NOT NULL,
  "logDate"     DATE NOT NULL,
  "shift"       TEXT NOT NULL,
  "cleaner"     TEXT NOT NULL,
  "templateId"  TEXT,
  "startedAt"   TIMESTAMP(3),
  "endedAt"     TIMESTAMP(3),
  "status"      "AreaCleaningStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AreaCleaningLog_area_logDate_idx"
  ON "AreaCleaningLog"("area","logDate");
CREATE INDEX IF NOT EXISTS "AreaCleaningLog_status_logDate_idx"
  ON "AreaCleaningLog"("status","logDate");

-- ─── CleaningLogTask ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CleaningLogTask" (
  "id"     TEXT NOT NULL PRIMARY KEY,
  "logId"  TEXT NOT NULL REFERENCES "AreaCleaningLog"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title"  TEXT NOT NULL,
  "detail" TEXT,
  "done"   BOOLEAN NOT NULL DEFAULT false,
  "doneAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "CleaningLogTask_logId_idx" ON "CleaningLogTask"("logId");

-- ─── HygieneInspection ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HygieneInspection" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "targetType"    TEXT NOT NULL,
  "target"        TEXT NOT NULL,
  "inspector"     TEXT NOT NULL,
  "inspectedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "score"         DOUBLE PRECISION,
  "overallResult" "HygieneInspectionResult",
  "findings"      TEXT,
  "photosNote"    TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HygieneInspection_target_inspectedAt_idx"
  ON "HygieneInspection"("target","inspectedAt");
CREATE INDEX IF NOT EXISTS "HygieneInspection_overallResult_idx"
  ON "HygieneInspection"("overallResult");

-- ─── InspectionCriterion ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InspectionCriterion" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "inspectionId" TEXT NOT NULL REFERENCES "HygieneInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criterion"    TEXT NOT NULL,
  "result"       "HygieneInspectionResult" NOT NULL,
  "notes"        TEXT
);
CREATE INDEX IF NOT EXISTS "InspectionCriterion_inspectionId_idx"
  ON "InspectionCriterion"("inspectionId");

-- ─── CleaningAction ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CleaningAction" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "action"             TEXT NOT NULL,
  "owner"              TEXT NOT NULL,
  "dueDate"            DATE,
  "status"             "CleaningActionStatus" NOT NULL DEFAULT 'OPEN',
  "sourceInspectionId" TEXT,
  "verificationNotes"  TEXT,
  "verifiedById"       TEXT,
  "verifiedAt"         TIMESTAMP(3),
  "createdById"        TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CleaningAction_status_dueDate_idx"
  ON "CleaningAction"("status","dueDate");

-- ─── HygieneApproval ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HygieneApproval" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "subjectType"    "HygieneApprovalSubject" NOT NULL,
  "subjectId"      TEXT NOT NULL,
  "subjectLabel"   TEXT,
  "requestedById"  TEXT,
  "supervisorBy"   TEXT,
  "supervisorAt"   TIMESTAMP(3),
  "supervisorNote" TEXT,
  "qualityBy"      TEXT,
  "qualityAt"      TIMESTAMP(3),
  "qualityNote"    TEXT,
  "status"         "HygieneApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HygieneApproval_subjectType_subjectId_idx"
  ON "HygieneApproval"("subjectType","subjectId");
CREATE INDEX IF NOT EXISTS "HygieneApproval_status_createdAt_idx"
  ON "HygieneApproval"("status","createdAt");

-- ─── Module 8 ───
-- Pest & Termite Control Management (Module 8)
-- Enums + tables for inspection scheduling, high-risk area inspections,
-- evidence/treatment records, follow-ups and the pest alert center.

CREATE TYPE "PestScheduleStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');
CREATE TYPE "PestFrequency" AS ENUM ('WEEKLY', 'MONTHLY');
CREATE TYPE "PestType" AS ENUM ('RODENT', 'INSECT', 'TERMITE', 'BIRD');
CREATE TYPE "PestSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "TreatmentType" AS ENUM ('TRAP', 'BAIT', 'SPRAY', 'FUMIGATION');
CREATE TYPE "PestEvidenceStatus" AS ENUM ('OPEN', 'CLEARED');
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE');
CREATE TYPE "FollowUpResult" AS ENUM ('CLEARED', 'PERSISTENT', 'ESCALATED');
CREATE TYPE "PestAlertType" AS ENUM ('OVERDUE_INSPECTION', 'PERSISTENT_INFESTATION', 'TREATMENT_DUE');
CREATE TYPE "PestAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "RiskCheckpointResult" AS ENUM ('PASS', 'FAIL');

CREATE TABLE "PestScheduleEntry" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "frequency" "PestFrequency" NOT NULL,
    "inspector" TEXT,
    "status" "PestScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestScheduleEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestScheduleEntry_scheduledDate_idx" ON "PestScheduleEntry"("scheduledDate");
CREATE INDEX "PestScheduleEntry_status_idx" ON "PestScheduleEntry"("status");

CREATE TABLE "PestRiskInspection" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspector" TEXT,
    "overallPass" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestRiskInspection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestRiskInspection_area_idx" ON "PestRiskInspection"("area");
CREATE INDEX "PestRiskInspection_inspectedAt_idx" ON "PestRiskInspection"("inspectedAt");

CREATE TABLE "PestRiskCheckpoint" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "result" "RiskCheckpointResult" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PestRiskCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestRiskCheckpoint_inspectionId_idx" ON "PestRiskCheckpoint"("inspectionId");
ALTER TABLE "PestRiskCheckpoint"
    ADD CONSTRAINT "PestRiskCheckpoint_inspectionId_fkey"
    FOREIGN KEY ("inspectionId") REFERENCES "PestRiskInspection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PestEvidenceRecord" (
    "id" TEXT NOT NULL,
    "pestType" "PestType" NOT NULL,
    "location" TEXT NOT NULL,
    "severity" "PestSeverity" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "treatment" "TreatmentType",
    "chemical" TEXT,
    "dosage" TEXT,
    "treatedAt" TIMESTAMP(3),
    "applicator" TEXT,
    "status" "PestEvidenceStatus" NOT NULL DEFAULT 'OPEN',
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestEvidenceRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestEvidenceRecord_pestType_idx" ON "PestEvidenceRecord"("pestType");
CREATE INDEX "PestEvidenceRecord_status_idx" ON "PestEvidenceRecord"("status");
CREATE INDEX "PestEvidenceRecord_observedAt_idx" ON "PestEvidenceRecord"("observedAt");

CREATE TABLE "PestFollowUp" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "result" "FollowUpResult",
    "inspector" TEXT,
    "notes" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestFollowUp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestFollowUp_evidenceId_idx" ON "PestFollowUp"("evidenceId");
CREATE INDEX "PestFollowUp_dueDate_idx" ON "PestFollowUp"("dueDate");
CREATE INDEX "PestFollowUp_status_idx" ON "PestFollowUp"("status");
ALTER TABLE "PestFollowUp"
    ADD CONSTRAINT "PestFollowUp_evidenceId_fkey"
    FOREIGN KEY ("evidenceId") REFERENCES "PestEvidenceRecord"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PestAlert" (
    "id" TEXT NOT NULL,
    "type" "PestAlertType" NOT NULL,
    "severity" "PestAlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "dueDate" DATE,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PestAlert_acknowledged_idx" ON "PestAlert"("acknowledged");
CREATE INDEX "PestAlert_severity_idx" ON "PestAlert"("severity");

-- ─── Module 9 ───
-- Migration for Module 9 — Maintenance & Spare Parts (extended).
-- To be applied by the coordinator alongside /tmp/schema-module9.prisma.
-- Prisma model mapping: String -> text, DateTime -> timestamptz,
-- DateTime @db.Date -> date, Decimal(12,2) -> numeric(12,2), Json -> jsonb.

CREATE TABLE "MaintenanceEquipment" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "location" text,
  "installDate" date,
  "intervalDays" integer NOT NULL DEFAULT 30,
  "nextDueDate" date,
  "lastMaintainedAt" timestamptz,
  "status" text NOT NULL DEFAULT 'OPERATIONAL',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "MaintenanceEquipment_status_idx" ON "MaintenanceEquipment"("status");
CREATE INDEX "MaintenanceEquipment_nextDueDate_idx" ON "MaintenanceEquipment"("nextDueDate");

CREATE TABLE "PmTemplate" (
  "id" text PRIMARY KEY,
  "equipmentType" text NOT NULL,
  "name" text NOT NULL,
  "frequencyDays" integer NOT NULL,
  "estimatedMinutes" integer NOT NULL,
  "items" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("equipmentType", "name")
);

CREATE TABLE "PmExecution" (
  "id" text PRIMARY KEY,
  "equipmentId" text NOT NULL REFERENCES "MaintenanceEquipment"("id") ON DELETE RESTRICT,
  "templateId" text REFERENCES "PmTemplate"("id") ON DELETE SET NULL,
  "executedAt" timestamptz NOT NULL DEFAULT now(),
  "executedById" text,
  "checklist" jsonb NOT NULL,
  "durationMinutes" integer,
  "notes" text,
  "nextDueDate" date
);
CREATE INDEX "PmExecution_equipmentId_idx" ON "PmExecution"("equipmentId");

CREATE TABLE "BreakdownRecord" (
  "id" text PRIMARY KEY,
  "equipmentId" text NOT NULL REFERENCES "MaintenanceEquipment"("id") ON DELETE RESTRICT,
  "reportedById" text,
  "reportedByName" text,
  "failureTime" timestamptz NOT NULL,
  "symptom" text NOT NULL,
  "category" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "downtimeMinutes" integer,
  "repairNotes" text,
  "resolvedAt" timestamptz,
  "resolvedById" text,
  "resolvedByName" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "BreakdownRecord_equipmentId_idx" ON "BreakdownRecord"("equipmentId");
CREATE INDEX "BreakdownRecord_status_idx" ON "BreakdownRecord"("status");
CREATE INDEX "BreakdownRecord_category_idx" ON "BreakdownRecord"("category");

CREATE TABLE "SparePart" (
  "id" text PRIMARY KEY,
  "partNumber" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "compatibleTypes" text,
  "stockQty" numeric(12,2) NOT NULL DEFAULT 0,
  "minLevel" numeric(12,2) NOT NULL DEFAULT 0,
  "locationBin" text,
  "unit" text NOT NULL DEFAULT 'pcs',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "SparePartVerification" (
  "id" text PRIMARY KEY,
  "partId" text NOT NULL REFERENCES "SparePart"("id") ON DELETE CASCADE,
  "countedQty" numeric(12,2) NOT NULL,
  "systemQty" numeric(12,2) NOT NULL,
  "variance" numeric(12,2) NOT NULL,
  "verifiedById" text,
  "verifiedAt" timestamptz NOT NULL DEFAULT now(),
  "notes" text
);
CREATE INDEX "SparePartVerification_partId_idx" ON "SparePartVerification"("partId");

CREATE TABLE "WorkOrder" (
  "id" text PRIMARY KEY,
  "woNumber" text NOT NULL UNIQUE,
  "equipmentId" text NOT NULL REFERENCES "MaintenanceEquipment"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL DEFAULT 'CORRECTIVE',
  "status" text NOT NULL DEFAULT 'OPEN',
  "priority" text NOT NULL DEFAULT 'MEDIUM',
  "assigneeId" text,
  "assigneeName" text,
  "breakdownId" text REFERENCES "BreakdownRecord"("id") ON DELETE SET NULL,
  "description" text NOT NULL,
  "partsUsed" jsonb,
  "openedAt" timestamptz NOT NULL DEFAULT now(),
  "assignedAt" timestamptz,
  "startedAt" timestamptz,
  "completedAt" timestamptz,
  "verifiedAt" timestamptz,
  "verifiedById" text,
  "notes" text
);
CREATE INDEX "WorkOrder_equipmentId_idx" ON "WorkOrder"("equipmentId");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrder_priority_idx" ON "WorkOrder"("priority");

CREATE TABLE "RepairApproval" (
  "id" text PRIMARY KEY,
  "workOrderId" text NOT NULL UNIQUE REFERENCES "WorkOrder"("id") ON DELETE CASCADE,
  "technicianNote" text,
  "techSignedAt" timestamptz,
  "techSignedById" text,
  "supervisorNote" text,
  "approvedAt" timestamptz,
  "approvedById" text,
  "decision" text,
  "backInServiceAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- ─── Module 10 ───
-- Module 10: Finished Goods & Byproduct Management
-- Packaging run line-ops fields + flour grades, label prints,
-- byproduct stock/movements, FG stock adjustments.

-- ─── Extend PackagingRun with line-ops fields ───────────────────────────────
ALTER TABLE "PackagingRun" ADD COLUMN "line" TEXT;
ALTER TABLE "PackagingRun" ADD COLUMN "operator" TEXT;
ALTER TABLE "PackagingRun" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "PackagingRun" ADD COLUMN "endedAt" TIMESTAMP(3);

-- ─── FlourGrade ────────────────────────────────────────────────────────────
CREATE TABLE "FlourGrade" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "gradeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "moistureMax" DECIMAL(5,2) NOT NULL DEFAULT 14.0,
    "wetGlutenMin" DECIMAL(5,2) NOT NULL DEFAULT 30.0,
    "wetGlutenMax" DECIMAL(5,2) NOT NULL DEFAULT 33.0,
    "ashMax" DECIMAL(5,2) NOT NULL DEFAULT 0.7,
    "shelfLifeDays" INTEGER NOT NULL DEFAULT 180,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlourGrade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlourGrade_productId_gradeCode_key" ON "FlourGrade"("productId", "gradeCode");

ALTER TABLE "FlourGrade" ADD CONSTRAINT "FlourGrade_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── LabelPrint ────────────────────────────────────────────────────────────
CREATE TABLE "LabelPrint" (
    "id" TEXT NOT NULL,
    "packagingRunId" TEXT,
    "batchNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "bagKg" DECIMAL(6,2) NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRINTED',
    "reprintReason" TEXT,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedById" TEXT,

    CONSTRAINT "LabelPrint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LabelPrint_batchNo_idx" ON "LabelPrint"("batchNo");
CREATE INDEX "LabelPrint_productId_idx" ON "LabelPrint"("productId");

ALTER TABLE "LabelPrint" ADD CONSTRAINT "LabelPrint_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ByproductStock ────────────────────────────────────────────────────────
CREATE TABLE "ByproductStock" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "batchNo" TEXT,
    "locationCode" TEXT NOT NULL DEFAULT 'BP_WH_1',
    "quintals" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ByproductStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ByproductStock_type_batchNo_locationCode_key"
    ON "ByproductStock"("type", "batchNo", "locationCode");

-- ─── ByproductMovement ─────────────────────────────────────────────────────
CREATE TABLE "ByproductMovement" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "reason" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" TEXT,

    CONSTRAINT "ByproductMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ByproductMovement_type_movedAt_idx" ON "ByproductMovement"("type", "movedAt");

-- ─── FgStockAdjustment ─────────────────────────────────────────────────────
CREATE TABLE "FgStockAdjustment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "locationCode" TEXT NOT NULL,
    "bagsDelta" INTEGER NOT NULL DEFAULT 0,
    "quintalsDelta" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FgStockAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FgStockAdjustment_status_idx" ON "FgStockAdjustment"("status");

ALTER TABLE "FgStockAdjustment" ADD CONSTRAINT "FgStockAdjustment_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Seed default flour grades (idempotent-ish: only where products exist) ──
-- Duket normal/special, Furishka, Fino, Fernacho grade definitions.
INSERT INTO "FlourGrade" ("id", "productId", "gradeCode", "name", "moistureMax",
    "wetGlutenMin", "wetGlutenMax", "ashMax", "shelfLifeDays", "isActive",
    "notes", "createdAt", "updatedAt")
SELECT
    'seed-grade-' || p."id",
    p."id",
    g.code,
    g.gname,
    14.0, 30.0, 33.0, 0.7, 180, true,
    g.note,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p
JOIN (VALUES
    ('Duket (Normal)',  'DUKET-N', 'Duket Normal Grade',  'Standard bread flour; Duket extraction <78% auto-flag applies to this line.'),
    ('Duket (Special)', 'DUKET-S', 'Duket Special Grade', 'Premium extraction grade; tighter granulation control.'),
    ('Furishka',        'FURISHKA','Furishka Grade',      'Coarse semolina-type flour for traditional baking.'),
    ('Fino',            'FINO',    'Fino Grade',          'Fine patent flour; low ash, high gluten.'),
    ('Fernacho',        'FERNACHO','Fernacho Grade',     'All-purpose flour; balanced extraction.')
) AS g(pname, code, gname, note) ON g.pname = p."name"
WHERE NOT EXISTS (
    SELECT 1 FROM "FlourGrade" fg WHERE fg."productId" = p."id" AND fg."gradeCode" = g.code
);

-- ─── Module 11 ───
-- =============================================================================
-- MODULE 11 — Warehouse & Inventory Management
-- Plain-SQL migration (coordinator: verify against the merged schema.prisma,
-- then run; regenerate the Prisma client afterwards).
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE "WhLocationType" AS ENUM ('RAW','FG','SPARE','GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhMovementType" AS ENUM ('RECEIVE','TRANSFER_IN','TRANSFER_OUT','ADJUST_IN','ADJUST_OUT','ISSUE','DISPATCH','COUNT_IN','COUNT_OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhPutAwayStatus" AS ENUM ('DRAFT','PLACED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhTransferStatus" AS ENUM ('REQUESTED','APPROVED','COMPLETED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhAdjustReason" AS ENUM ('DAMAGE','FOUND','RECOUNT','SPOILAGE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhAdjustStatus" AS ENUM ('PENDING','APPROVED','POSTED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhReserveStatus" AS ENUM ('ACTIVE','RELEASED','EXPIRED','CONSUMED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhDispatchStatus" AS ENUM ('DRAFT','PICKED','DISPATCHED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WhCountStatus" AS ENUM ('PLANNED','IN_PROGRESS','RECOUNT','APPROVED','POSTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── WhLocation ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhLocation" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "code"      TEXT NOT NULL UNIQUE,
  "name"      TEXT NOT NULL,
  "zone"      TEXT,
  "type"      "WhLocationType" NOT NULL DEFAULT 'GENERAL',
  "capacityQ" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── WhStockLedger (immutable movement journal) ───────────────────────────────

CREATE TABLE IF NOT EXISTS "WhStockLedger" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "locationId"   TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "productId"    TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"      TEXT,
  "quintals"     DECIMAL(12,2) NOT NULL,
  "bags"         INTEGER NOT NULL DEFAULT 0,
  "unitCostBirr" DECIMAL(14,2),
  "movementType" "WhMovementType" NOT NULL,
  "reference"    TEXT,
  "refId"        TEXT,
  "movedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"  TEXT
);
CREATE INDEX IF NOT EXISTS "WhStockLedger_locationId_productId_idx" ON "WhStockLedger"("locationId","productId");
CREATE INDEX IF NOT EXISTS "WhStockLedger_movementType_movedAt_idx" ON "WhStockLedger"("movementType","movedAt");
CREATE INDEX IF NOT EXISTS "WhStockLedger_refId_idx" ON "WhStockLedger"("refId");

-- ── WhPutAway (+ items) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhPutAway" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "docNo"        TEXT NOT NULL UNIQUE,
  "referenceDoc" TEXT,
  "status"       "WhPutAwayStatus" NOT NULL DEFAULT 'DRAFT',
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"  TEXT
);

CREATE TABLE IF NOT EXISTS "WhPutAwayItem" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "putAwayId"         TEXT NOT NULL REFERENCES "WhPutAway"("id") ON DELETE CASCADE,
  "productId"         TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"           TEXT,
  "quintals"          DECIMAL(12,2) NOT NULL,
  "bags"              INTEGER NOT NULL DEFAULT 0,
  "packagingKg"       INTEGER,
  "unitCostBirr"      DECIMAL(14,2),
  "suggestedLocationId" TEXT REFERENCES "WhLocation"("id"),
  "placedLocationId"  TEXT REFERENCES "WhLocation"("id"),
  "placedAt"          TIMESTAMP(3)
);

-- ── WhStockTransfer (+ items) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhStockTransfer" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "docNo"          TEXT NOT NULL UNIQUE,
  "fromLocationId" TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "toLocationId"   TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "reason"         TEXT,
  "status"         "WhTransferStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById"  TEXT,
  "approvedById"   TEXT,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "WhStockTransferItem" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "transferId" TEXT NOT NULL REFERENCES "WhStockTransfer"("id") ON DELETE CASCADE,
  "productId"  TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"    TEXT,
  "quintals"   DECIMAL(12,2) NOT NULL,
  "bags"       INTEGER NOT NULL DEFAULT 0
);

-- ── WhAdjustment (+ items) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhAdjustment" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "docNo"        TEXT NOT NULL UNIQUE,
  "locationId"   TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "status"       "WhAdjustStatus" NOT NULL DEFAULT 'PENDING',
  "reason"       TEXT,
  "createdById"  TEXT,
  "approvedById" TEXT,
  "postedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "WhAdjustmentItem" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "adjustmentId" TEXT NOT NULL REFERENCES "WhAdjustment"("id") ON DELETE CASCADE,
  "productId"    TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"      TEXT,
  "quintals"     DECIMAL(12,2) NOT NULL,
  "bags"         INTEGER NOT NULL DEFAULT 0,
  "unitCostBirr" DECIMAL(14,2),
  "reason"       "WhAdjustReason" NOT NULL
);

-- ── WhReservation ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhReservation" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "refNo"       TEXT NOT NULL UNIQUE,
  "reference"   TEXT,
  "productId"   TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"     TEXT,
  "locationId"  TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "quintals"    DECIMAL(12,2) NOT NULL,
  "bags"        INTEGER NOT NULL DEFAULT 0,
  "expiresAt"   TIMESTAMP(3),
  "status"      "WhReserveStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt"  TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "WhReservation_status_expiresAt_idx" ON "WhReservation"("status","expiresAt");

-- ── WhDispatch (+ items) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhDispatch" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "docNo"        TEXT NOT NULL UNIQUE,
  "reference"    TEXT,
  "vehiclePlate" TEXT,
  "driverName"   TEXT,
  "status"       "WhDispatchStatus" NOT NULL DEFAULT 'DRAFT',
  "dispatchedAt" TIMESTAMP(3),
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "WhDispatchItem" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "dispatchId" TEXT NOT NULL REFERENCES "WhDispatch"("id") ON DELETE CASCADE,
  "productId"  TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"    TEXT,
  "locationId" TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "quintals"   DECIMAL(12,2) NOT NULL,
  "bags"       INTEGER NOT NULL DEFAULT 0
);

-- ── WhCountSession (+ lines) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WhCountSession" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "sessionNo"     TEXT NOT NULL UNIQUE,
  "locationId"    TEXT NOT NULL REFERENCES "WhLocation"("id"),
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "status"        "WhCountStatus" NOT NULL DEFAULT 'PLANNED',
  "createdById"   TEXT,
  "approvedById"  TEXT,
  "postedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "WhCountLine" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "sessionId"   TEXT NOT NULL REFERENCES "WhCountSession"("id") ON DELETE CASCADE,
  "productId"   TEXT NOT NULL REFERENCES "Product"("id"),
  "batchNo"     TEXT,
  "systemQ"     DECIMAL(12,2) NOT NULL,
  "systemBags"  INTEGER NOT NULL DEFAULT 0,
  "countedQ"    DECIMAL(12,2),
  "countedBags" INTEGER,
  "recountQ"    DECIMAL(12,2),
  "recountBags" INTEGER,
  "varianceQ"   DECIMAL(12,2)
);
