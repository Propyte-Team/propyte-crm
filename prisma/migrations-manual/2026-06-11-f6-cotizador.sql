-- CreateEnum
CREATE TYPE "propyte_crm"."QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'OPENED', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "propyte_crm"."PaymentScheme" AS ENUM ('CONTADO', 'FINANCIAMIENTO_DIRECTO', 'CREDITO_BANCARIO', 'MIXTO');

-- CreateEnum
CREATE TYPE "propyte_crm"."InstallmentStatus" AS ENUM ('PENDIENTE', 'PAGADA', 'VENCIDA', 'CONDONADA');

-- CreateEnum
CREATE TYPE "propyte_crm"."DealDocumentType" AS ENUM ('KYC', 'CONTRATO_ENVIADO', 'CONTRATO_FIRMADO', 'COMPROBANTE_ENGANCHE', 'RECIBO', 'COMPROBANTE_DOMICILIO', 'OTRO');

-- AlterTable
ALTER TABLE "propyte_crm"."deals" ADD COLUMN     "externalBrokerId" TEXT;

-- CreateTable
CREATE TABLE "propyte_crm"."quotes" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "hubUnitId" TEXT,
    "unitSnapshot" JSONB NOT NULL DEFAULT '{}',
    "currency" "propyte_crm"."Currency" NOT NULL DEFAULT 'MXN',
    "listPrice" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "finalPrice" DECIMAL(14,2) NOT NULL,
    "fxRate" DECIMAL(10,4),
    "scheme" "propyte_crm"."PaymentScheme" NOT NULL,
    "status" "propyte_crm"."QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."payment_plans" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "downPaymentPct" DECIMAL(5,2) NOT NULL,
    "downPaymentAmount" DECIMAL(14,2) NOT NULL,
    "monthsCount" INTEGER NOT NULL DEFAULT 0,
    "monthlyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryPaymentPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "deliveryAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."payment_schedules" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "propyte_crm"."InstallmentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."deal_documents" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" "propyte_crm"."DealDocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."external_brokers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agency" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "splitPct" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "external_brokers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_dealId_idx" ON "propyte_crm"."quotes"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_plans_quoteId_key" ON "propyte_crm"."payment_plans"("quoteId");

-- CreateIndex
CREATE INDEX "payment_schedules_status_dueDate_idx" ON "propyte_crm"."payment_schedules"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "payment_schedules_planId_number_key" ON "propyte_crm"."payment_schedules"("planId", "number");

-- CreateIndex
CREATE INDEX "deal_documents_dealId_idx" ON "propyte_crm"."deal_documents"("dealId");

-- AddForeignKey
ALTER TABLE "propyte_crm"."deals" ADD CONSTRAINT "deals_externalBrokerId_fkey" FOREIGN KEY ("externalBrokerId") REFERENCES "propyte_crm"."external_brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."quotes" ADD CONSTRAINT "quotes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "propyte_crm"."deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."payment_plans" ADD CONSTRAINT "payment_plans_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "propyte_crm"."quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."payment_schedules" ADD CONSTRAINT "payment_schedules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "propyte_crm"."payment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."deal_documents" ADD CONSTRAINT "deal_documents_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "propyte_crm"."deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."deal_documents" ADD CONSTRAINT "deal_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

