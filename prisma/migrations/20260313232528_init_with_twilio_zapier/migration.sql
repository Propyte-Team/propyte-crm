-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DIRECTOR', 'GERENTE', 'TEAM_LEADER', 'ASESOR_SR', 'ASESOR_JR', 'HOSTESS', 'MARKETING', 'DEVELOPER_EXT');

-- CreateEnum
CREATE TYPE "CareerLevel" AS ENUM ('JR', 'SR', 'TOP_PRODUCER', 'TEAM_LEADER', 'GERENTE');

-- CreateEnum
CREATE TYPE "Plaza" AS ENUM ('PDC', 'TULUM', 'MERIDA');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('LEAD', 'PROSPECTO', 'CLIENTE', 'INVERSIONISTA', 'BROKER_EXTERNO', 'REFERIDO');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'FACEBOOK_ADS', 'GOOGLE_ADS', 'INSTAGRAM', 'PORTAL_INMOBILIARIO', 'REFERIDO_CLIENTE', 'REFERIDO_BROKER', 'LLAMADA_FRIA', 'EVENTO', 'WEBSITE', 'WHATSAPP', 'OTRO');

-- CreateEnum
CREATE TYPE "PreferredLanguage" AS ENUM ('ES', 'EN');

-- CreateEnum
CREATE TYPE "InvestmentProfile" AS ENUM ('END_USER', 'INVESTOR_RENTAL', 'INVESTOR_FLIP', 'INVESTOR_LAND', 'MIXED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('DEPARTAMENTO', 'CASA', 'TERRENO', 'MACROLOTE', 'LOCAL_COMERCIAL', 'OTRO');

-- CreateEnum
CREATE TYPE "PurchaseTimeline" AS ENUM ('IMMEDIATE', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_PLUS_MONTHS');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CONTADO', 'CREDITO_HIPOTECARIO', 'FINANCIAMIENTO_DIRECTO', 'MIXTO');

-- CreateEnum
CREATE TYPE "PurchaseModality" AS ENUM ('PREVENTA', 'ENTREGA_INMEDIATA', 'REVENTA', 'ABIERTO');

-- CreateEnum
CREATE TYPE "RentalStrategy" AS ENUM ('LONG_TERM', 'AIRBNB', 'BOTH', 'NA');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD', 'DEAD');

-- CreateEnum
CREATE TYPE "DevelopmentType" AS ENUM ('PROPIO', 'MASTERBROKER', 'CORRETAJE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('MXN', 'USD');

-- CreateEnum
CREATE TYPE "DevelopmentStatus" AS ENUM ('PREVENTA', 'CONSTRUCCION', 'ENTREGA_INMEDIATA', 'VENDIDO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('DEPTO_1REC', 'DEPTO_2REC', 'DEPTO_3REC', 'PENTHOUSE', 'CASA', 'TERRENO', 'MACROLOTE', 'LOCAL');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('DISPONIBLE', 'APARTADA', 'VENDIDA', 'NO_DISPONIBLE');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('NEW_LEAD', 'CONTACTED', 'DISCOVERY_DONE', 'MEETING_SCHEDULED', 'MEETING_COMPLETED', 'PROPOSAL_SENT', 'NEGOTIATION', 'RESERVED', 'CONTRACT_SIGNED', 'CLOSING', 'WON', 'LOST', 'FROZEN');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('NATIVA_CONTADO', 'NATIVA_FINANCIAMIENTO', 'MACROLOTE', 'CORRETAJE', 'MASTERBROKER');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRECIO', 'COMPETENCIA', 'FINANCIAMIENTO_RECHAZADO', 'NO_INTERESADO', 'NO_CONTACTABLE', 'COMPRO_DIRECTO', 'DESARROLLO_CANCELADO', 'OTRO');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDIENTE', 'FACTURADA', 'PAGADA');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL_OUTBOUND', 'CALL_INBOUND', 'WHATSAPP_OUT', 'WHATSAPP_IN', 'SMS_OUT', 'SMS_IN', 'EMAIL_SENT', 'EMAIL_RECEIVED', 'MEETING_VIRTUAL', 'MEETING_PRESENTIAL', 'MEETING_SHOWROOM', 'DISCOVERY_CALL', 'PROPOSAL_DELIVERY', 'FOLLOW_UP', 'WALK_IN', 'NOTE', 'TASK', 'CONTRACT_REVIEW', 'CLOSING_ACTIVITY');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDIENTE', 'COMPLETADA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "VisitPurpose" AS ENUM ('INVERSION', 'USO_PROPIO', 'INFORMACION', 'OTRO');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT');

-- CreateEnum
CREATE TYPE "LeadSourceCategory" AS ENUM ('PROPYTE_LEAD', 'BROKER_LEAD', 'ASESOR_LEAD');

-- CreateEnum
CREATE TYPE "LeadAssignmentMode" AS ENUM ('ROUND_ROBIN', 'PERFORMANCE', 'MANUAL', 'GUARDIA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "careerLevel" "CareerLevel" NOT NULL DEFAULT 'JR',
    "plaza" "Plaza" NOT NULL,
    "teamLeaderId" TEXT,
    "sedetusNumber" TEXT,
    "sedetusExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "secondaryPhone" TEXT,
    "contactType" "ContactType" NOT NULL DEFAULT 'LEAD',
    "leadSource" "LeadSource" NOT NULL,
    "leadSourceDetail" TEXT,
    "residenceCity" TEXT,
    "residenceCountry" TEXT,
    "nationality" TEXT,
    "preferredLanguage" "PreferredLanguage" NOT NULL DEFAULT 'ES',
    "investmentProfile" "InvestmentProfile",
    "propertyType" "PropertyType",
    "purchaseTimeline" "PurchaseTimeline",
    "budgetMin" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "paymentMethod" "PaymentMethod",
    "preferredZone" TEXT,
    "purchaseModality" "PurchaseModality",
    "rentalStrategy" "RentalStrategy",
    "assignedToId" TEXT,
    "temperature" "LeadTemperature" NOT NULL DEFAULT 'COLD',
    "score" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developerName" TEXT NOT NULL,
    "developmentType" "DevelopmentType" NOT NULL,
    "location" TEXT NOT NULL,
    "plaza" "Plaza" NOT NULL,
    "totalUnits" INTEGER NOT NULL,
    "availableUnits" INTEGER NOT NULL,
    "soldUnits" INTEGER NOT NULL DEFAULT 0,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "priceMin" DECIMAL(14,2) NOT NULL,
    "priceMax" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "totalDevelopmentValue" DECIMAL(16,2),
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "status" "DevelopmentStatus" NOT NULL DEFAULT 'PREVENTA',
    "constructionProgress" INTEGER NOT NULL DEFAULT 0,
    "deliveryDate" TIMESTAMP(3),
    "contractStartDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "brochureUrl" TEXT,
    "virtualTourUrl" TEXT,
    "amenities" TEXT[],
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "developments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "developmentId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "unitType" "UnitType" NOT NULL,
    "area_m2" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "floor" INTEGER,
    "status" "UnitStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "reservedByContactId" TEXT,
    "reservedByUserId" TEXT,
    "reservationDate" TIMESTAMP(3),
    "saleDate" TIMESTAMP(3),
    "salePrice" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "developmentId" TEXT,
    "unitId" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'NEW_LEAD',
    "dealType" "DealType" NOT NULL,
    "estimatedValue" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "probability" INTEGER NOT NULL DEFAULT 5,
    "expectedCloseDate" TIMESTAMP(3) NOT NULL,
    "actualCloseDate" TIMESTAMP(3),
    "lostReason" "LostReason",
    "lostReasonDetail" TEXT,
    "commissionTotal" DECIMAL(14,2),
    "commissionAdvisor" DECIMAL(14,2),
    "commissionTL" DECIMAL(14,2),
    "commissionGerente" DECIMAL(14,2),
    "commissionDirector" DECIMAL(14,2),
    "commissionBrokerExt" DECIMAL(14,2),
    "commissionStatus" "CommissionStatus" NOT NULL DEFAULT 'PENDIENTE',
    "leadSourceAtDeal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "userId" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDIENTE',
    "outcome" TEXT,
    "duration_minutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "dealType" "DealType" NOT NULL,
    "leadSourceCategory" "LeadSourceCategory" NOT NULL,
    "role" "UserRole" NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "walk_ins" (
    "id" TEXT NOT NULL,
    "hostessId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "arrivalTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departureTime" TIMESTAMP(3),
    "visitPurpose" "VisitPurpose" NOT NULL,
    "assignedAdvisorId" TEXT,
    "convertedToDeal" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "walk_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "twilioSid" TEXT,
    "templateName" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "externalPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_configs" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE UNIQUE INDEX "messages_twilioSid_key" ON "messages"("twilioSid");

-- CreateIndex
CREATE INDEX "messages_contactId_createdAt_idx" ON "messages"("contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hashedKey_key" ON "api_keys"("hashedKey");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamLeaderId_fkey" FOREIGN KEY ("teamLeaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "developments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_reservedByContactId_fkey" FOREIGN KEY ("reservedByContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_reservedByUserId_fkey" FOREIGN KEY ("reservedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "developments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_hostessId_fkey" FOREIGN KEY ("hostessId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_assignedAdvisorId_fkey" FOREIGN KEY ("assignedAdvisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
