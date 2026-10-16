-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('INDIVIDUAL_FARMER', 'ASSOCIATION', 'TRADER');

-- CreateEnum
CREATE TYPE "WheatCategory" AS ENUM ('SOFT', 'HARD', 'FOREIGN');

-- CreateEnum
CREATE TYPE "StorageKind" AS ENUM ('DRY_POOL', 'CONDITIONING_TANK', 'FG_WAREHOUSE');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PENDING_LAB', 'FLAGGED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BatchProductType" AS ENUM ('HARD_FLOUR', 'SOFT_FLOUR');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('MORNING', 'NIGHT');

-- CreateEnum
CREATE TYPE "CAPAStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('BLENDED_ELSEWHERE', 'FULLY_RECYCLED');

-- CreateEnum
CREATE TYPE "CleaningGrade" AS ENUM ('NOT_PERFORMED', 'NOT_SATISFACTORY', 'SATISFACTORY', 'GOOD');

-- CreateEnum
CREATE TYPE "RevenueStatus" AS ENUM ('PLACEMENT', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PayrollMode" AS ENUM ('FIXED', 'PIECE_RATE', 'TRIP_BASED');

-- CreateEnum
CREATE TYPE "PieceStage" AS ENUM ('UNLOADING', 'GRANARY_DUMPING', 'STORE_MOVEMENT', 'TRUCK_LOADING');

-- CreateEnum
CREATE TYPE "PunchStatus" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'DELIVERED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "taxId" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'all',

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SupplierType" NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceBirr" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'quintal',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingSize" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kg" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackagingSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StorageKind" NOT NULL,
    "capacityQ" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheatIntake" (
    "id" TEXT NOT NULL,
    "intakeNo" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "truckPlate" TEXT NOT NULL,
    "wheatCategory" "WheatCategory" NOT NULL,
    "wheatOrigin" TEXT,
    "bagCount" INTEGER NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "glutenPct" DECIMAL(6,2),
    "moisturePct" DECIMAL(6,2),
    "impurityPct" DECIMAL(6,2),
    "hectoliterPct" DECIMAL(6,2),
    "germinationPct" DECIMAL(6,2),
    "labTestedAt" TIMESTAMP(3),
    "labTestedById" TEXT,
    "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING_LAB',
    "flaggedReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WheatIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnloadingLabor" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "laborer" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "truckPlate" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedById" TEXT,

    CONSTRAINT "UnloadingLabor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APPayment" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "apInvoiceId" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" TEXT,

    CONSTRAINT "APPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageMovement" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" TEXT,

    CONSTRAINT "StorageMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankFill" (
    "id" TEXT NOT NULL,
    "tankCode" TEXT NOT NULL,
    "intakeId" TEXT,
    "quintals" DECIMAL(12,2) NOT NULL,
    "blendRatio" JSONB,
    "filledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledById" TEXT,

    CONSTRAINT "TankFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankEvent" (
    "id" TEXT NOT NULL,
    "tankCode" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "quintals" DECIMAL(12,2),
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,

    CONSTRAINT "TankEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashingLog" (
    "id" TEXT NOT NULL,
    "tankOrSilo" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "downtimeMin" INTEGER DEFAULT 0,
    "equipmentChange" TEXT,
    "operators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "WashingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "productType" "BatchProductType" NOT NULL,
    "blendSoftPct" DECIMAL(5,2) NOT NULL,
    "blendHardPct" DECIMAL(5,2) NOT NULL,
    "blendForeignPct" DECIMAL(5,2) NOT NULL,
    "blendSoftQ" DECIMAL(12,2) NOT NULL,
    "blendHardQ" DECIMAL(12,2) NOT NULL,
    "blendForeignQ" DECIMAL(12,2) NOT NULL,
    "wheatWeighedQ" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchIntakeSource" (
    "batchId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "BatchIntakeSource_pkey" PRIMARY KEY ("batchId","intakeId")
);

-- CreateTable
CREATE TABLE "ShiftRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "shift" "ShiftType" NOT NULL,
    "shiftDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "operators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "downtimeMin" INTEGER DEFAULT 0,
    "downtimeReason" TEXT,
    "createdById" TEXT,

    CONSTRAINT "ShiftRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftOutput" (
    "id" TEXT NOT NULL,
    "shiftRunId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "extractionPct" DECIMAL(6,2),
    "belowYieldFlag" BOOLEAN NOT NULL DEFAULT false,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedById" TEXT,

    CONSTRAINT "ShiftOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcThreshold" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "param" TEXT NOT NULL,
    "minValue" DECIMAL(8,3),
    "maxValue" DECIMAL(8,3),
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QcThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabCheck" (
    "id" TEXT NOT NULL,
    "shiftRunId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sampleTime" TIMESTAMP(3) NOT NULL,
    "impurityPct" DECIMAL(6,2),
    "wheatMoistureBefore" DECIMAL(6,2),
    "wheatMoistureAfter" DECIMAL(6,2),
    "flourMoisturePct" DECIMAL(6,2),
    "wetGlutenPct" DECIMAL(6,2),
    "glutenElasticity" TEXT,
    "dryGlutenPct" DECIMAL(6,2),
    "ashPct" DECIMAL(6,2),
    "colorScore" DECIMAL(6,2),
    "granulationPct" DECIMAL(6,2),
    "outOfRange" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CAPA" (
    "id" TEXT NOT NULL,
    "capaNo" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "dateIdentified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issueDescription" TEXT NOT NULL,
    "identifiedById" TEXT,
    "correctionType" TEXT,
    "correctionDetail" TEXT,
    "performedBy" TEXT,
    "disposition" "Disposition",
    "qualitySignById" TEXT,
    "qualitySignedAt" TIMESTAMP(3),
    "productionSignById" TEXT,
    "productionSignedAt" TIMESTAMP(3),
    "status" "CAPAStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CAPA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentCleaning" (
    "id" TEXT NOT NULL,
    "checkMonth" DATE NOT NULL,
    "section" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "grade" "CleaningGrade" NOT NULL,
    "nonconformity" TEXT,
    "actionTaken" TEXT,
    "checkedById" TEXT,

    CONSTRAINT "EquipmentCleaning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCleaningReport" (
    "id" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "area" TEXT NOT NULL,
    "dryCleaned" BOOLEAN NOT NULL DEFAULT false,
    "wetCleaned" BOOLEAN NOT NULL DEFAULT false,
    "janitor" TEXT,
    "overallStatus" TEXT,
    "supervisorSign" TEXT,
    "qualitySign" TEXT,
    "createdById" TEXT,

    CONSTRAINT "DailyCleaningReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PestInspection" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signsObserved" TEXT,
    "evidenceFound" TEXT,
    "correctiveAction" TEXT,
    "followUpDate" TIMESTAMP(3),
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "inspectorId" TEXT,

    CONSTRAINT "PestInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "inspectionDate" DATE NOT NULL,
    "inspector" TEXT,
    "outcome" TEXT,
    "followUpAction" TEXT,
    "partReplaced" TEXT,
    "signOffById" TEXT,
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparePartCheck" (
    "id" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "equipment" TEXT,
    "checkType" TEXT NOT NULL,
    "condition" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,

    CONSTRAINT "SparePartCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "productionDate" DATE NOT NULL,
    "packedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packedById" TEXT,

    CONSTRAINT "PackagingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodsStock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "locationCode" TEXT NOT NULL,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodsStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseTransfer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "fromLocation" TEXT NOT NULL,
    "toLocation" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "laborer" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" TEXT,

    CONSTRAINT "WarehouseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedDate" TIMESTAMP(3),
    "productId" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "priceBirr" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,

    CONSTRAINT "AdvancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "vehicleType" TEXT,
    "ownership" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverName" TEXT,
    "area" TEXT NOT NULL,
    "departureDate" DATE NOT NULL,
    "stops" INTEGER NOT NULL DEFAULT 1,
    "totalQuintals" DECIMAL(12,2) NOT NULL,
    "tripPayBirr" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "exitNoteNo" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadingLabor" TEXT,
    "tripId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "createdById" TEXT,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchLine" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "orderId" TEXT,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT,
    "packagingSizeId" TEXT,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DispatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "status" "RevenueStatus" NOT NULL DEFAULT 'PLACEMENT',
    "invoicedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReceipt" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "settledVia" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,

    CONSTRAINT "CashReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "memo" TEXT,
    "module" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "jobTitle" TEXT NOT NULL,
    "department" TEXT,
    "payrollMode" "PayrollMode" NOT NULL DEFAULT 'FIXED',
    "baseSalary" DECIMAL(18,2),
    "zkPin" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "hiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PieceRateConfig" (
    "id" TEXT NOT NULL,
    "stage" "PieceStage" NOT NULL,
    "rateBirrPerQ" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PieceRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PieceRateLog" (
    "id" TEXT NOT NULL,
    "stage" "PieceStage" NOT NULL,
    "laborer" TEXT NOT NULL,
    "quintals" DECIMAL(12,2) NOT NULL,
    "truckPlate" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedById" TEXT,

    CONSTRAINT "PieceRateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverTripRate" (
    "id" TEXT NOT NULL,
    "rateBirrPerTrip" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DriverTripRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mode" "PayrollMode" NOT NULL,
    "baseBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pieceQuintals" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pieceBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "trips" INTEGER NOT NULL DEFAULT 0,
    "tripBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossBirr" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZKTecoDevice" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "name" TEXT,
    "location" TEXT,
    "ipAddress" TEXT,
    "lastSeen" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ZKTecoDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "zkPin" TEXT NOT NULL,
    "employeeId" TEXT,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "status" "PunchStatus" NOT NULL,
    "verifyMode" TEXT,
    "workCode" TEXT,
    "deviceSn" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "trigger" TEXT,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyLedger" (
    "clientUuid" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "deviceId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyLedger_pkey" PRIMARY KEY ("clientUuid")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPrice_customerId_productId_key" ON "CustomerPrice"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingSize_label_key" ON "PackagingSize"("label");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_code_key" ON "StorageLocation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WheatIntake_intakeNo_key" ON "WheatIntake"("intakeNo");

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_invoiceNo_key" ON "APInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_intakeId_key" ON "APInvoice"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "APPayment_voucherNo_key" ON "APPayment"("voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_batchNo_key" ON "ProductionBatch"("batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "QcThreshold_code_key" ON "QcThreshold"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CAPA_capaNo_key" ON "CAPA"("capaNo");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCleaningReport_reportDate_area_key" ON "DailyCleaningReport"("reportDate", "area");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodsStock_productId_batchNo_packagingSizeId_locati_key" ON "FinishedGoodsStock"("productId", "batchNo", "packagingSizeId", "locationCode");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNo_key" ON "SalesOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNo_key" ON "Vehicle"("plateNo");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_vehicleId_area_departureDate_key" ON "Trip"("vehicleId", "area", "departureDate");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_exitNoteNo_key" ON "Dispatch"("exitNoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_invoiceNo_key" ON "SalesInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_dispatchId_key" ON "SalesInvoice"("dispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReceipt_receiptNo_key" ON "CashReceipt"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_code_key" ON "ChartOfAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_zkPin_key" ON "Employee"("zkPin");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PieceRateConfig_stage_key" ON "PieceRateConfig"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_periodYear_periodMonth_key" ON "PayrollRun"("periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ZKTecoDevice_serialNo_key" ON "ZKTecoDevice"("serialNo");

-- CreateIndex
CREATE INDEX "AttendancePunch_zkPin_punchTime_idx" ON "AttendancePunch"("zkPin", "punchTime");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_zkPin_punchTime_deviceSn_key" ON "AttendancePunch"("zkPin", "punchTime", "deviceSn");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheatIntake" ADD CONSTRAINT "WheatIntake_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnloadingLabor" ADD CONSTRAINT "UnloadingLabor_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "WheatIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice" ADD CONSTRAINT "APInvoice_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "WheatIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APPayment" ADD CONSTRAINT "APPayment_apInvoiceId_fkey" FOREIGN KEY ("apInvoiceId") REFERENCES "APInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankFill" ADD CONSTRAINT "TankFill_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "WheatIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashingLog" ADD CONSTRAINT "WashingLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchIntakeSource" ADD CONSTRAINT "BatchIntakeSource_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchIntakeSource" ADD CONSTRAINT "BatchIntakeSource_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "WheatIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOutput" ADD CONSTRAINT "ShiftOutput_shiftRunId_fkey" FOREIGN KEY ("shiftRunId") REFERENCES "ShiftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOutput" ADD CONSTRAINT "ShiftOutput_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabCheck" ADD CONSTRAINT "LabCheck_shiftRunId_fkey" FOREIGN KEY ("shiftRunId") REFERENCES "ShiftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabCheck" ADD CONSTRAINT "LabCheck_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CAPA" ADD CONSTRAINT "CAPA_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingRun" ADD CONSTRAINT "PackagingRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingRun" ADD CONSTRAINT "PackagingRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsStock" ADD CONSTRAINT "FinishedGoodsStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceipt" ADD CONSTRAINT "CashReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceipt" ADD CONSTRAINT "CashReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
