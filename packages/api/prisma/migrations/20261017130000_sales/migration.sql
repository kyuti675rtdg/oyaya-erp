-- Module 13 expansion: order lines, customer price agreements, advance
-- application tracking, truck load consolidation, delivery trips, agent stock
-- placement, sales invoice lines, cash reconciliation, gate-pass on Dispatch.
-- Deploy-safe: only new tables + additive columns with defaults.

-- ── Additive columns on existing tables ──────────────────────────

ALTER TABLE "SalesInvoice" ALTER COLUMN "dispatchId" DROP NOT NULL;
ALTER TABLE "SalesInvoice" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'DISPATCH';
ALTER TABLE "SalesInvoice" ADD COLUMN "orderIds" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "Dispatch" ADD COLUMN "gateStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Dispatch" ADD COLUMN "gateCheckedAt" TIMESTAMPTZ(3);
ALTER TABLE "Dispatch" ADD COLUMN "sealNo" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN "gateOfficer" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN "gateNotes" TEXT;

ALTER TABLE "AdvancePayment" ADD COLUMN "appliedAmountBirr" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "AdvancePayment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OPEN';

-- ── New tables ──────────────────────────────────────────────────

CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    "priceBirr" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesOrderLine_orderId_idx" ON "SalesOrderLine"("orderId");
CREATE INDEX "SalesOrderLine_productId_idx" ON "SalesOrderLine"("productId");

CREATE TABLE "SalesAgreement" (
    "id" TEXT NOT NULL,
    "agreementNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesAgreement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesAgreement_agreementNo_key" ON "SalesAgreement"("agreementNo");
CREATE INDEX "SalesAgreement_customerId_idx" ON "SalesAgreement"("customerId");
CREATE INDEX "SalesAgreement_status_idx" ON "SalesAgreement"("status");

CREATE TABLE "SalesAgreementLine" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "priceBirr" DECIMAL(18,2) NOT NULL,
    "tiers" JSONB,
    CONSTRAINT "SalesAgreementLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvanceApplication" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedById" TEXT,
    CONSTRAINT "AdvanceApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdvanceApplication_advanceId_idx" ON "AdvanceApplication"("advanceId");
CREATE INDEX "AdvanceApplication_invoiceId_idx" ON "AdvanceApplication"("invoiceId");

CREATE TABLE "TruckLoad" (
    "id" TEXT NOT NULL,
    "loadNo" TEXT NOT NULL,
    "vehicleId" TEXT,
    "route" TEXT NOT NULL,
    "capacityQuintals" DECIMAL(12,2) NOT NULL DEFAULT 300,
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TruckLoad_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TruckLoad_loadNo_key" ON "TruckLoad"("loadNo");
CREATE INDEX "TruckLoad_status_idx" ON "TruckLoad"("status");
CREATE INDEX "TruckLoad_vehicleId_idx" ON "TruckLoad"("vehicleId");

CREATE TABLE "TruckLoadItem" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "TruckLoadItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TruckLoadItem_loadId_orderId_key" ON "TruckLoadItem"("loadId", "orderId");
CREATE INDEX "TruckLoadItem_loadId_idx" ON "TruckLoadItem"("loadId");

CREATE TABLE "DeliveryTrip" (
    "id" TEXT NOT NULL,
    "tripNo" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverName" TEXT,
    "area" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "departedAt" TIMESTAMPTZ(3),
    "arrivedAt" TIMESTAMPTZ(3),
    "podReceivedAt" TIMESTAMPTZ(3),
    "podSignedBy" TEXT,
    "dispatchId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryTrip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryTrip_tripNo_key" ON "DeliveryTrip"("tripNo");
CREATE INDEX "DeliveryTrip_vehicleId_idx" ON "DeliveryTrip"("vehicleId");
CREATE INDEX "DeliveryTrip_status_idx" ON "DeliveryTrip"("status");

CREATE TABLE "AgentStockPlacement" (
    "id" TEXT NOT NULL,
    "placementNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    "unitPriceBirr" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLACED',
    "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdById" TEXT,
    CONSTRAINT "AgentStockPlacement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentStockPlacement_placementNo_key" ON "AgentStockPlacement"("placementNo");
CREATE INDEX "AgentStockPlacement_customerId_idx" ON "AgentStockPlacement"("customerId");
CREATE INDEX "AgentStockPlacement_status_idx" ON "AgentStockPlacement"("status");

CREATE TABLE "AgentStockSettlement" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    "amountBirr" DECIMAL(18,2) NOT NULL,
    "settledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledById" TEXT,
    "notes" TEXT,
    CONSTRAINT "AgentStockSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderId" TEXT,
    "productId" TEXT NOT NULL,
    "packagingSizeId" TEXT,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "quintals" DECIMAL(12,2) NOT NULL,
    "unitPriceBirr" DECIMAL(18,2) NOT NULL,
    "lineTotalBirr" DECIMAL(18,2) NOT NULL,
    CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesInvoiceLine_invoiceId_idx" ON "SalesInvoiceLine"("invoiceId");

CREATE TABLE "CashReconciliation" (
    "id" TEXT NOT NULL,
    "reconDate" DATE NOT NULL,
    "expectedBirr" DECIMAL(18,2) NOT NULL,
    "collectedBirr" DECIMAL(18,2) NOT NULL,
    "varianceBirr" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BALANCED',
    "depositRef" TEXT,
    "depositedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "reconciledById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CashReconciliation_reconDate_key" ON "CashReconciliation"("reconDate");

-- ── Foreign keys ────────────────────────────────────────────────

ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_packagingSizeId_fkey" FOREIGN KEY ("packagingSizeId") REFERENCES "PackagingSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesAgreement" ADD CONSTRAINT "SalesAgreement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesAgreementLine" ADD CONSTRAINT "SalesAgreementLine_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "SalesAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesAgreementLine" ADD CONSTRAINT "SalesAgreementLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesAgreementLine" ADD CONSTRAINT "SalesAgreementLine_packagingSizeId_fkey" FOREIGN KEY ("packagingSizeId") REFERENCES "PackagingSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "AdvancePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TruckLoad" ADD CONSTRAINT "TruckLoad_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TruckLoadItem" ADD CONSTRAINT "TruckLoadItem_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "TruckLoad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TruckLoadItem" ADD CONSTRAINT "TruckLoadItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentStockPlacement" ADD CONSTRAINT "AgentStockPlacement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentStockPlacement" ADD CONSTRAINT "AgentStockPlacement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentStockPlacement" ADD CONSTRAINT "AgentStockPlacement_packagingSizeId_fkey" FOREIGN KEY ("packagingSizeId") REFERENCES "PackagingSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentStockSettlement" ADD CONSTRAINT "AgentStockSettlement_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "AgentStockPlacement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_packagingSizeId_fkey" FOREIGN KEY ("packagingSizeId") REFERENCES "PackagingSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;
