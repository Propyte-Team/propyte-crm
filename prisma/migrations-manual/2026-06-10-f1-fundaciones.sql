-- CreateEnum
CREATE TYPE "propyte_crm"."ContactStatus" AS ENUM ('NUEVO', 'SIN_RESPUESTA', 'CONTACTADO', 'EN_SEGUIMIENTO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "propyte_crm"."Urgency" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "propyte_crm"."DocumentType" AS ENUM ('INE', 'PASAPORTE', 'FM2', 'FM3', 'OTRO');

-- CreateEnum
CREATE TYPE "propyte_crm"."MaritalStatus" AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE');

-- CreateEnum
CREATE TYPE "propyte_crm"."TaxRegime" AS ENUM ('PFAE', 'PM', 'PF');

-- CreateEnum
CREATE TYPE "propyte_crm"."TriggerType" AS ENUM ('EVENT', 'TIME', 'BEHAVIORAL', 'INACTIVITY', 'STAGE_CHANGE', 'SLA_BREACH', 'SCORE_THRESHOLD');

-- CreateEnum
CREATE TYPE "propyte_crm"."WorkflowActionType" AS ENUM ('CREATE_TASK', 'SEND_WHATSAPP', 'SEND_EMAIL', 'MAKE_CALL', 'ASSIGN', 'REASSIGN', 'NOTIFY', 'UPDATE_FIELD', 'ADD_TAG', 'CHANGE_STAGE', 'ENROLL_PLAN', 'ESCALATE', 'AI_DRAFT', 'AI_REPLY', 'AI_CALL_SUMMARY', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "propyte_crm"."AutonomyLevel" AS ENUM ('L0', 'L1', 'L2');

-- CreateEnum
CREATE TYPE "propyte_crm"."EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'EXITED');

-- CreateEnum
CREATE TYPE "propyte_crm"."SlaTimerType" AS ENUM ('FIRST_TOUCH', 'RETRY', 'ORPHAN');

-- CreateEnum
CREATE TYPE "propyte_crm"."SlaTimerStatus" AS ENUM ('RUNNING', 'MET', 'BREACHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "propyte_crm"."ActionQueueStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConnectorProvider" AS ENUM ('META', 'TIKTOK', 'WEBSITE', 'ZAPIER', 'MANUAL');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConnectorStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConnectorLeadStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'ERROR');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConversationChannel" AS ENUM ('WHATSAPP', 'SMS', 'WEB');

-- CreateEnum
CREATE TYPE "propyte_crm"."ConversationStatus" AS ENUM ('BOT', 'HUMAN', 'SNOOZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "propyte_crm"."MessageSender" AS ENUM ('CONTACT', 'ADVISOR', 'BOT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "propyte_crm"."TemplateChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- AlterEnum
ALTER TYPE "propyte_crm"."LeadSource" ADD VALUE 'TIKTOK_ADS';

-- AlterTable
ALTER TABLE "propyte_crm"."contacts" ADD COLUMN     "contactStatus" "propyte_crm"."ContactStatus" NOT NULL DEFAULT 'NUEVO',
ADD COLUMN     "doNotContact" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hubContactId" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "originalCreatedAt" TIMESTAMP(3),
ADD COLUMN     "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "urgency" "propyte_crm"."Urgency",
ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zohoId" TEXT;

-- AlterTable
ALTER TABLE "propyte_crm"."deals" ADD COLUMN     "contractSignedAt" TIMESTAMP(3),
ADD COLUMN     "deedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "holdId" TEXT,
ADD COLUMN     "hubDevelopmentId" TEXT,
ADD COLUMN     "hubUnitId" TEXT,
ADD COLUMN     "reservedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "propyte_crm"."messages" ADD COLUMN     "aiAutonomy" "propyte_crm"."AutonomyLevel",
ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "internalNote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sender" "propyte_crm"."MessageSender" NOT NULL DEFAULT 'SYSTEM';

-- CreateTable
CREATE TABLE "propyte_crm"."contact_dossiers" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "documentType" "propyte_crm"."DocumentType",
    "documentNumber" TEXT,
    "birthDate" TIMESTAMP(3),
    "birthPlace" TEXT,
    "maritalStatus" "propyte_crm"."MaritalStatus",
    "occupation" TEXT,
    "taxId" TEXT,
    "taxRegime" "propyte_crm"."TaxRegime",
    "corrStreet" TEXT,
    "corrColonia" TEXT,
    "corrCity" TEXT,
    "corrState" TEXT,
    "corrZip" TEXT,
    "corrCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_dossiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."ad_attributions" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "gclid" TEXT,
    "fbclid" TEXT,
    "socialLeadId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "campaignName" TEXT,
    "adName" TEXT,
    "adsetName" TEXT,
    "network" TEXT,
    "device" TEXT,
    "keyword" TEXT,
    "costPerClick" DECIMAL(10,2),
    "costPerConversion" DECIMAL(10,2),
    "conversionExportStatus" TEXT,
    "conversionExportedAt" TIMESTAMP(3),
    "landingPage" TEXT,
    "referrer" TEXT,
    "firstTouch" TIMESTAMP(3),
    "lastTouch" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."web_behavior" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "visitorScore" INTEGER,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "daysVisited" INTEGER,
    "avgTimeOnSiteMin" DECIMAL(6,2),
    "chatCount" INTEGER,
    "firstPageUrl" TEXT,
    "pagesViewed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_behavior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."workflow_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."automation_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "triggerType" "propyte_crm"."TriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "cooldownMinutes" INTEGER,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."action_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "entryTrigger" JSONB NOT NULL DEFAULT '{}',
    "exitConditions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."action_plan_steps" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "actionType" "propyte_crm"."WorkflowActionType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB,
    "autonomyLevel" "propyte_crm"."AutonomyLevel" NOT NULL DEFAULT 'L0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."action_plan_enrollments" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" "propyte_crm"."EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "action_plan_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."action_queue" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "planStepId" TEXT,
    "actionType" "propyte_crm"."WorkflowActionType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "status" "propyte_crm"."ActionQueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."routing_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "strategy" "propyte_crm"."LeadAssignmentMode" NOT NULL,
    "targets" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."sla_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstTouchMinutes" INTEGER NOT NULL DEFAULT 5,
    "retryMinutes" INTEGER NOT NULL DEFAULT 30,
    "orphanHours" INTEGER NOT NULL DEFAULT 24,
    "escalationChain" JSONB NOT NULL DEFAULT '[]',
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "channelFallback" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."sla_timers" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "policyId" TEXT,
    "type" "propyte_crm"."SlaTimerType" NOT NULL,
    "status" "propyte_crm"."SlaTimerStatus" NOT NULL DEFAULT 'RUNNING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "metAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."lead_connectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "propyte_crm"."ConnectorProvider" NOT NULL,
    "status" "propyte_crm"."ConnectorStatus" NOT NULL DEFAULT 'PAUSED',
    "credentials" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "fieldMap" JSONB NOT NULL DEFAULT '{}',
    "lastLeadAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."connector_lead_logs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "externalLeadId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "contactId" TEXT,
    "status" "propyte_crm"."ConnectorLeadStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorDetail" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "connector_lead_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."conversations" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "propyte_crm"."ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "propyte_crm"."ConversationStatus" NOT NULL DEFAULT 'BOT',
    "controlledById" TEXT,
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "takeoverAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobTitle" TEXT,
    "bioEs" TEXT,
    "bioEn" TEXT,
    "photoUrl" TEXT,
    "phoneDirect" TEXT,
    "whatsappNumber" TEXT,
    "languages" TEXT[] DEFAULT ARRAY['ES']::TEXT[],
    "emailFromAlias" TEXT,
    "emailSignatureHtml" TEXT,
    "cardSlug" TEXT,
    "cardTheme" JSONB NOT NULL DEFAULT '{}',
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "calendarUrl" TEXT,
    "defaultCadenceId" TEXT,
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."user_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "propyte_crm"."TemplateChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "shortcut" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "language" "propyte_crm"."PreferredLanguage" NOT NULL DEFAULT 'ES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_dossiers_contactId_key" ON "propyte_crm"."contact_dossiers"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_attributions_contactId_key" ON "propyte_crm"."ad_attributions"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "web_behavior_contactId_key" ON "propyte_crm"."web_behavior"("contactId");

-- CreateIndex
CREATE INDEX "workflow_events_processedAt_idx" ON "propyte_crm"."workflow_events"("processedAt");

-- CreateIndex
CREATE INDEX "workflow_events_entityType_entityId_idx" ON "propyte_crm"."workflow_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "workflow_events_type_occurredAt_idx" ON "propyte_crm"."workflow_events"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_name_key" ON "propyte_crm"."automation_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "action_plans_name_key" ON "propyte_crm"."action_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "action_plan_steps_planId_order_key" ON "propyte_crm"."action_plan_steps"("planId", "order");

-- CreateIndex
CREATE INDEX "action_plan_enrollments_status_nextRunAt_idx" ON "propyte_crm"."action_plan_enrollments"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "action_plan_enrollments_planId_entityType_entityId_key" ON "propyte_crm"."action_plan_enrollments"("planId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "action_queue_dedupeKey_key" ON "propyte_crm"."action_queue"("dedupeKey");

-- CreateIndex
CREATE INDEX "action_queue_status_runAfter_idx" ON "propyte_crm"."action_queue"("status", "runAfter");

-- CreateIndex
CREATE UNIQUE INDEX "routing_rules_name_key" ON "propyte_crm"."routing_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_name_key" ON "propyte_crm"."sla_policies"("name");

-- CreateIndex
CREATE INDEX "sla_timers_status_dueAt_idx" ON "propyte_crm"."sla_timers"("status", "dueAt");

-- CreateIndex
CREATE INDEX "connector_lead_logs_status_receivedAt_idx" ON "propyte_crm"."connector_lead_logs"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "connector_lead_logs_connectorId_externalLeadId_key" ON "propyte_crm"."connector_lead_logs"("connectorId", "externalLeadId");

-- CreateIndex
CREATE INDEX "conversations_status_lastMessageAt_idx" ON "propyte_crm"."conversations"("status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contactId_channel_key" ON "propyte_crm"."conversations"("contactId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "propyte_crm"."user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_cardSlug_key" ON "propyte_crm"."user_profiles"("cardSlug");

-- CreateIndex
CREATE UNIQUE INDEX "user_templates_userId_shortcut_key" ON "propyte_crm"."user_templates"("userId", "shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_zohoId_key" ON "propyte_crm"."contacts"("zohoId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "propyte_crm"."messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "propyte_crm"."contacts" ADD CONSTRAINT "contacts_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "propyte_crm"."conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."contact_dossiers" ADD CONSTRAINT "contact_dossiers_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."ad_attributions" ADD CONSTRAINT "ad_attributions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."web_behavior" ADD CONSTRAINT "web_behavior_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."action_plans" ADD CONSTRAINT "action_plans_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."action_plan_steps" ADD CONSTRAINT "action_plan_steps_planId_fkey" FOREIGN KEY ("planId") REFERENCES "propyte_crm"."action_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."action_plan_enrollments" ADD CONSTRAINT "action_plan_enrollments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "propyte_crm"."action_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."sla_timers" ADD CONSTRAINT "sla_timers_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."sla_timers" ADD CONSTRAINT "sla_timers_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "propyte_crm"."deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."sla_timers" ADD CONSTRAINT "sla_timers_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "propyte_crm"."sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."connector_lead_logs" ADD CONSTRAINT "connector_lead_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."connector_lead_logs" ADD CONSTRAINT "connector_lead_logs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."conversations" ADD CONSTRAINT "conversations_controlledById_fkey" FOREIGN KEY ("controlledById") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."user_profiles" ADD CONSTRAINT "user_profiles_defaultCadenceId_fkey" FOREIGN KEY ("defaultCadenceId") REFERENCES "propyte_crm"."action_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."user_templates" ADD CONSTRAINT "user_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: mensajes históricos (inbound eran del contacto, outbound del asesor)
UPDATE "propyte_crm"."messages"
SET "sender" = CASE WHEN "direction" = 'INBOUND' THEN 'CONTACT'::"propyte_crm"."MessageSender"
                    ELSE 'ADVISOR'::"propyte_crm"."MessageSender" END
WHERE "sender" = 'SYSTEM';
