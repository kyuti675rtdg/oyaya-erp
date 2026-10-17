-- HR & Payroll expansion (Module 15): departments, positions, attendance
-- records, piece-rate work, driver trip pay, allowance/deduction types &
-- assignments, payslips, plus new columns on Employee / PayrollRun / PayrollLine.
-- Deploy-safe: every statement is idempotent (IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS / enum guards) so concurrent workers' migrations cannot double-apply.

-- ─── enums ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkSource" AS ENUM ('ZKTECO', 'MANUAL', 'CSV');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AllowanceKind" AS ENUM ('ALLOWANCE', 'DEDUCTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AllowanceCalc" AS ENUM ('FIXED', 'PERCENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AllowanceRecurrence" AS ENUM ('RECURRING', 'ONE_TIME');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Department ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Department" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Department_code_key" ON "Department"("code");
DO $$ BEGIN
  ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Position ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Position" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "departmentId" TEXT,
  "grade" TEXT,
  "bandMin" DECIMAL(18,2),
  "bandMax" DECIMAL(18,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Position_code_key" ON "Position"("code");
DO $$ BEGIN
  ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Employee: new columns ──────────────────────────────────────
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "positionId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankAccount" TEXT;
DO $$ BEGIN
  ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── AttendanceRecord ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMPTZ NOT NULL,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "checkIn" TIMESTAMPTZ,
  "checkOut" TIMESTAMPTZ,
  "workHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "source" "WorkSource" NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT,
  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");
DO $$ BEGIN
  ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── PieceRateWork ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PieceRateWork" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT,
  "laborer" TEXT NOT NULL,
  "stage" "PieceStage" NOT NULL,
  "bags" INTEGER NOT NULL DEFAULT 0,
  "quintals" DECIMAL(12,2) NOT NULL,
  "rateBirrPerQ" DECIMAL(12,2) NOT NULL,
  "payBirr" DECIMAL(18,2) NOT NULL,
  "workDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "truckPlate" TEXT,
  "loggedById" TEXT,
  "notes" TEXT,
  CONSTRAINT "PieceRateWork_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PieceRateWork_employeeId_workDate_idx" ON "PieceRateWork"("employeeId", "workDate");
CREATE INDEX IF NOT EXISTS "PieceRateWork_workDate_idx" ON "PieceRateWork"("workDate");
DO $$ BEGIN
  ALTER TABLE "PieceRateWork" ADD CONSTRAINT "PieceRateWork_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── DriverTripPay ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DriverTripPay" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "trips" INTEGER NOT NULL DEFAULT 0,
  "rateBirrPerTrip" DECIMAL(12,2) NOT NULL,
  "allowanceBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "totalBirr" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  CONSTRAINT "DriverTripPay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DriverTripPay_employeeId_year_month_key" ON "DriverTripPay"("employeeId", "year", "month");
DO $$ BEGIN
  ALTER TABLE "DriverTripPay" ADD CONSTRAINT "DriverTripPay_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── AllowanceDeductionType ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AllowanceDeductionType" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "AllowanceKind" NOT NULL,
  "calc" "AllowanceCalc" NOT NULL DEFAULT 'FIXED',
  "amount" DECIMAL(18,2) NOT NULL,
  "appliesTo" "PayrollMode"[] NOT NULL DEFAULT '{}',
  "recurrence" "AllowanceRecurrence" NOT NULL DEFAULT 'RECURRING',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AllowanceDeductionType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AllowanceDeductionType_code_key" ON "AllowanceDeductionType"("code");

-- ─── EmployeeAllowance ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmployeeAllowance" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "typeId" TEXT NOT NULL,
  "oneTimeDate" TIMESTAMPTZ,
  "overrideAmount" DECIMAL(18,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  CONSTRAINT "EmployeeAllowance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeAllowance_employeeId_typeId_key" ON "EmployeeAllowance"("employeeId", "typeId");
DO $$ BEGIN
  ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "AllowanceDeductionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── PayrollRun: new columns ────────────────────────────────────
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "postedAt" TIMESTAMPTZ;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT;

-- ─── PayrollLine: new columns ───────────────────────────────────
ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "allowanceBirr" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "deductionBirr" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "netBirr" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ─── Payslip ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Payslip" (
  "id" TEXT NOT NULL,
  "payrollRunId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "grossBirr" DECIMAL(18,2) NOT NULL,
  "allowanceBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "deductionBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netBirr" DECIMAL(18,2) NOT NULL,
  "breakdown" JSONB NOT NULL DEFAULT '{}',
  "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_payrollRunId_employeeId_key" ON "Payslip"("payrollRunId", "employeeId");
DO $$ BEGIN
  ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
