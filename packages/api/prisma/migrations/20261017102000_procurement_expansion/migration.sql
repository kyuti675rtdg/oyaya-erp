-- AlterTable: extend Supplier with full registration fields
ALTER TABLE "Supplier" ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "tin" TEXT,
ADD COLUMN     "licenseNo" TEXT,
ADD COLUMN     "wheatTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: WheatIntake weighbridge, PO link, return note
ALTER TABLE "WheatIntake" ADD COLUMN     "grossKg" DECIMAL(12,2),
ADD COLUMN     "tareKg" DECIMAL(12,2),
ADD COLUMN     "netKg" DECIMAL(12,2),
ADD COLUMN     "moistureQuick" DECIMAL(5,2),
ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "returnNote" TEXT;

-- AlterTable: APInvoice due date for aging
ALTER TABLE "APInvoice" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "wheatCategory" "WheatCategory" NOT NULL,
    "quantityQ" DECIMAL(12,2) NOT NULL,
    "pricePerQBirr" DECIMAL(12,2) NOT NULL,
    "totalBirr" DECIMAL(18,2) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "terms" TEXT,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedQ" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheatIntake" ADD CONSTRAINT "WheatIntake_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
