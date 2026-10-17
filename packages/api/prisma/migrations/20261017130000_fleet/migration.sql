-- Module 16: Fleet & Logistics Management
-- Additive, deploy-safe migration: new Vehicle columns + six new fleet tables.
-- All statements use IF NOT EXISTS guards so re-runs are harmless.

-- Vehicle extensions
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "capacityQt" DECIMAL(12,2);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "purchaseDate" DATE;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "purchaseCostBirr" DECIMAL(18,2);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Rental contracts (and owned-vehicle depreciation records)
CREATE TABLE IF NOT EXISTS "VehicleContract" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "rateBirr" DECIMAL(18,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleContract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VehicleContract_vehicleId_idx" ON "VehicleContract"("vehicleId");
CREATE INDEX IF NOT EXISTS "VehicleContract_status_idx" ON "VehicleContract"("status");

-- Driver assignments with license validity tracking
CREATE TABLE IF NOT EXISTS "DriverAssignment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "licenseNo" TEXT,
    "licenseExpiry" DATE,
    "assignedFrom" DATE NOT NULL,
    "assignedTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DriverAssignment_vehicleId_idx" ON "DriverAssignment"("vehicleId");
CREATE INDEX IF NOT EXISTS "DriverAssignment_status_idx" ON "DriverAssignment"("status");

-- Detailed trip log (flour deliveries + wheat procurement runs)
CREATE TABLE IF NOT EXISTS "FleetTrip" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverName" TEXT,
    "routeFrom" TEXT,
    "routeTo" TEXT,
    "cargoType" TEXT,
    "cargoQt" DECIMAL(12,2),
    "departureAt" TIMESTAMP(3),
    "arrivalAt" TIMESTAMP(3),
    "odometerStart" DECIMAL(12,2),
    "odometerEnd" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "dispatchId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FleetTrip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FleetTrip_vehicleId_idx" ON "FleetTrip"("vehicleId");
CREATE INDEX IF NOT EXISTS "FleetTrip_status_idx" ON "FleetTrip"("status");
CREATE INDEX IF NOT EXISTS "FleetTrip_departureAt_idx" ON "FleetTrip"("departureAt");

-- Fuel refills
CREATE TABLE IF NOT EXISTS "FuelLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liters" DECIMAL(12,2) NOT NULL,
    "costBirr" DECIMAL(18,2) NOT NULL,
    "odometer" DECIMAL(12,2),
    "station" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FuelLog_vehicleId_idx" ON "FuelLog"("vehicleId");
CREATE INDEX IF NOT EXISTS "FuelLog_loggedAt_idx" ON "FuelLog"("loggedAt");

-- Non-fuel operating expenses
CREATE TABLE IF NOT EXISTS "FleetExpense" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FleetExpense_vehicleId_idx" ON "FleetExpense"("vehicleId");
CREATE INDEX IF NOT EXISTS "FleetExpense_expenseDate_idx" ON "FleetExpense"("expenseDate");

-- Vehicle service history
CREATE TABLE IF NOT EXISTS "FleetMaintenanceRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "costBirr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "odometer" DECIMAL(12,2),
    "nextDueDate" DATE,
    "performedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FleetMaintenanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FleetMaintenanceRecord_vehicleId_idx" ON "FleetMaintenanceRecord"("vehicleId");
CREATE INDEX IF NOT EXISTS "FleetMaintenanceRecord_nextDueDate_idx" ON "FleetMaintenanceRecord"("nextDueDate");
