-- CreateEnum
CREATE TYPE "propyte_crm"."TeamRole" AS ENUM ('LEADER', 'SENIOR', 'JUNIOR', 'HOSTESS');

-- CreateEnum
CREATE TYPE "propyte_crm"."TerritoryType" AS ENUM ('GEO', 'SEGMENT');

-- CreateEnum
CREATE TYPE "propyte_crm"."TerritoryAccess" AS ENUM ('VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "propyte_crm"."FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'PERCENT', 'DATE', 'DATETIME', 'BOOLEAN', 'EMAIL', 'PHONE', 'URL', 'PICKLIST', 'MULTI_PICKLIST', 'AUTO_NUMBER', 'FORMULA', 'FILE', 'USER', 'LOOKUP', 'MASTER_DETAIL', 'ROLLUP', 'GEO');

-- CreateEnum
CREATE TYPE "propyte_crm"."FieldAccess" AS ENUM ('HIDDEN', 'READ', 'EDIT');

-- CreateEnum
CREATE TYPE "propyte_crm"."RelationshipKind" AS ENUM ('LOOKUP', 'MASTER_DETAIL', 'MANY_TO_MANY');

-- CreateEnum
CREATE TYPE "propyte_crm"."OnDeleteBehavior" AS ENUM ('SET_NULL', 'CASCADE', 'RESTRICT');

-- CreateEnum
CREATE TYPE "propyte_crm"."RollupAggregate" AS ENUM ('COUNT', 'SUM', 'MIN', 'MAX', 'AVG');

-- AlterTable
ALTER TABLE "propyte_crm"."contacts" ADD COLUMN     "custom" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "propyte_crm"."deals" ADD COLUMN     "custom" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "propyte_crm"."teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plaza" "propyte_crm"."Plaza" NOT NULL,
    "leaderId" TEXT,
    "parentTeamId" TEXT,
    "forecastManagerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInTeam" "propyte_crm"."TeamRole" NOT NULL DEFAULT 'JUNIOR',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."territories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "propyte_crm"."TerritoryType" NOT NULL DEFAULT 'GEO',
    "parentTerritoryId" TEXT,
    "plaza" "propyte_crm"."Plaza",
    "zones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forecastManagerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."territory_members" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessLevel" "propyte_crm"."TerritoryAccess" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "territory_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."territory_rules" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territory_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."custom_objects" (
    "id" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pluralLabel" TEXT NOT NULL,
    "icon" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "recordNameField" TEXT NOT NULL DEFAULT 'name',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."custom_fields" (
    "id" TEXT NOT NULL,
    "objectApiName" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "propyte_crm"."FieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isSearchable" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" JSONB,
    "helpText" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 100,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."field_options" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "field_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."layouts" (
    "id" TEXT NOT NULL,
    "objectApiName" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."layout_sections" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 100,
    "columns" INTEGER NOT NULL DEFAULT 2,
    "conditions" JSONB,

    CONSTRAINT "layout_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."layout_fields" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "fieldApiName" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB,

    CONSTRAINT "layout_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."field_permissions" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "role" "propyte_crm"."UserRole" NOT NULL,
    "access" "propyte_crm"."FieldAccess" NOT NULL DEFAULT 'READ',

    CONSTRAINT "field_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."relationships" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromObject" TEXT NOT NULL,
    "toObject" TEXT NOT NULL,
    "kind" "propyte_crm"."RelationshipKind" NOT NULL,
    "onDelete" "propyte_crm"."OnDeleteBehavior" NOT NULL DEFAULT 'SET_NULL',
    "relatedListLabel" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."relationship_labels" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromRole" TEXT,
    "toRole" TEXT,

    CONSTRAINT "relationship_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."lookup_projections" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "sourceFieldApiName" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "lookup_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."rollup_fields" (
    "id" TEXT NOT NULL,
    "parentObject" TEXT NOT NULL,
    "childRelationshipId" TEXT NOT NULL,
    "aggregate" "propyte_crm"."RollupAggregate" NOT NULL,
    "childFieldApiName" TEXT,
    "filter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rollup_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."record_links" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "fromObject" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toObject" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "labelId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propyte_crm"."custom_records" (
    "id" TEXT NOT NULL,
    "objectApiName" TEXT NOT NULL,
    "recordName" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "propyte_crm"."teams"("name");

-- CreateIndex
CREATE INDEX "team_members_teamId_leftAt_idx" ON "propyte_crm"."team_members"("teamId", "leftAt");

-- CreateIndex
CREATE INDEX "team_members_userId_leftAt_idx" ON "propyte_crm"."team_members"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "territories_name_key" ON "propyte_crm"."territories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "territory_members_territoryId_userId_key" ON "propyte_crm"."territory_members"("territoryId", "userId");

-- CreateIndex
CREATE INDEX "territory_rules_isActive_priority_idx" ON "propyte_crm"."territory_rules"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "custom_objects_apiName_key" ON "propyte_crm"."custom_objects"("apiName");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_objectApiName_apiName_key" ON "propyte_crm"."custom_fields"("objectApiName", "apiName");

-- CreateIndex
CREATE UNIQUE INDEX "field_options_fieldId_value_key" ON "propyte_crm"."field_options"("fieldId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "layouts_objectApiName_name_key" ON "propyte_crm"."layouts"("objectApiName", "name");

-- CreateIndex
CREATE UNIQUE INDEX "field_permissions_fieldId_role_key" ON "propyte_crm"."field_permissions"("fieldId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_name_key" ON "propyte_crm"."relationships"("name");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_labels_relationshipId_label_key" ON "propyte_crm"."relationship_labels"("relationshipId", "label");

-- CreateIndex
CREATE INDEX "record_links_fromObject_fromId_idx" ON "propyte_crm"."record_links"("fromObject", "fromId");

-- CreateIndex
CREATE INDEX "record_links_toObject_toId_idx" ON "propyte_crm"."record_links"("toObject", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "record_links_relationshipId_fromId_toId_key" ON "propyte_crm"."record_links"("relationshipId", "fromId", "toId");

-- CreateIndex
CREATE INDEX "custom_records_objectApiName_deletedAt_idx" ON "propyte_crm"."custom_records"("objectApiName", "deletedAt");

-- AddForeignKey
ALTER TABLE "propyte_crm"."teams" ADD CONSTRAINT "teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."teams" ADD CONSTRAINT "teams_parentTeamId_fkey" FOREIGN KEY ("parentTeamId") REFERENCES "propyte_crm"."teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."teams" ADD CONSTRAINT "teams_forecastManagerId_fkey" FOREIGN KEY ("forecastManagerId") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "propyte_crm"."teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."territories" ADD CONSTRAINT "territories_parentTerritoryId_fkey" FOREIGN KEY ("parentTerritoryId") REFERENCES "propyte_crm"."territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."territories" ADD CONSTRAINT "territories_forecastManagerId_fkey" FOREIGN KEY ("forecastManagerId") REFERENCES "propyte_crm"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."territory_members" ADD CONSTRAINT "territory_members_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "propyte_crm"."territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."territory_members" ADD CONSTRAINT "territory_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "propyte_crm"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."territory_rules" ADD CONSTRAINT "territory_rules_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "propyte_crm"."territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."custom_fields" ADD CONSTRAINT "custom_fields_objectApiName_fkey" FOREIGN KEY ("objectApiName") REFERENCES "propyte_crm"."custom_objects"("apiName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."field_options" ADD CONSTRAINT "field_options_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "propyte_crm"."custom_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."layouts" ADD CONSTRAINT "layouts_objectApiName_fkey" FOREIGN KEY ("objectApiName") REFERENCES "propyte_crm"."custom_objects"("apiName") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."layout_sections" ADD CONSTRAINT "layout_sections_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "propyte_crm"."layouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."layout_fields" ADD CONSTRAINT "layout_fields_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "propyte_crm"."layout_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."field_permissions" ADD CONSTRAINT "field_permissions_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "propyte_crm"."custom_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."relationship_labels" ADD CONSTRAINT "relationship_labels_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "propyte_crm"."relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."lookup_projections" ADD CONSTRAINT "lookup_projections_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "propyte_crm"."relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."rollup_fields" ADD CONSTRAINT "rollup_fields_childRelationshipId_fkey" FOREIGN KEY ("childRelationshipId") REFERENCES "propyte_crm"."relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."record_links" ADD CONSTRAINT "record_links_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "propyte_crm"."relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propyte_crm"."record_links" ADD CONSTRAINT "record_links_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "propyte_crm"."relationship_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

