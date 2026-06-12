-- CreateEnum
CREATE TYPE "propyte_crm"."ConnectorDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BOTH');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConversionEventName" AS ENUM ('LEAD', 'QUALIFIED', 'MEETING_SCHEDULED', 'RESERVED', 'WON');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConversionStatus" AS ENUM ('PENDING', 'SENT', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "propyte_crm"."AgentType" AS ENUM ('PREBUILT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "propyte_crm"."AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ESCALATED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'GOOGLE';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'LINKEDIN';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'INMUEBLES24';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'LAMUDI_PROPPIT';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'PROPIEDADES';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'VIVANUNCIOS';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'EASYBROKER';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "propyte_crm"."ad_attributions" ADD COLUMN     "liFatId" TEXT,
ADD COLUMN     "portalLeadId" TEXT,
ADD COLUMN     "ttclid" TEXT;

-- AlterTable
ALTER TABLE "propyte_crm"."lead_connectors" ADD COLUMN     "direction" "propyte_crm"."ConnectorDirection" NOT NULL DEFAULT 'INBOUND';

-- CreateTable
CREATE TABLE "propyte_crm"."conversion_events" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "eventName" "propyte_crm"."ConversionEventName" NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DECIMAL(14,2),
    "currency" "propyte_crm"."Currency" NOT NULL DEFAULT 'MXN',
    "leadQualityTier" TEXT,
    "clickIds" JSONB NOT NULL DEFAULT '{}',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "propyte_crm"."ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "propyte_crm"."AgentType" NOT NULL DEFAULT 'PREBUILT',
    "systemUserId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "autonomyLevel" "propyte_crm"."AutonomyLevel" NOT NULL DEFAULT 'L2',
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "schedule" TEXT,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."agent_runs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "output" TEXT,
    "status" "propyte_crm"."AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "escalatedToUserId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_eventId_key" ON "propyte_crm"."conversion_events"("eventId");

-- CreateIndex
CREATE INDEX "conversion_events_status_createdAt_idx" ON "propyte_crm"."conversion_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "conversion_events_contactId_idx" ON "propyte_crm"."conversion_events"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_key" ON "propyte_crm"."agents"("name");

-- CreateIndex
CREATE INDEX "agent_runs_agentId_startedAt_idx" ON "propyte_crm"."agent_runs"("agentId", "startedAt");

-- AddForeignKey
ALTER TABLE "propyte_crm"."conversion_events" ADD CONSTRAINT "conversion_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."conversion_events" ADD CONSTRAINT "conversion_events_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "propyte_crm"."deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."agents" ADD CONSTRAINT "agents_systemUserId_fkey" FOREIGN KEY ("systemUserId") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "propyte_crm"."agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

