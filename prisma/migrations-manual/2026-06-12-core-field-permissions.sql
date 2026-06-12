-- Migración ADITIVA — Permisos de campo CORE por rol (Fase B detalle de contacto)
-- Objetivo: panel admin para ocultar/leer/editar columnas core por rol.
-- Segura: solo crea una tabla nueva. No altera ni borra nada existente.
-- Default sin fila = EDIT (no restrictivo) → no rompe el comportamiento actual.

CREATE TABLE IF NOT EXISTS "propyte_crm"."core_field_permissions" (
    "id"       TEXT NOT NULL,
    "object"   TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "role"     "propyte_crm"."UserRole" NOT NULL,
    "access"   "propyte_crm"."FieldAccess" NOT NULL DEFAULT 'EDIT',

    CONSTRAINT "core_field_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "core_field_permissions_object_fieldKey_role_key"
    ON "propyte_crm"."core_field_permissions" ("object", "fieldKey", "role");
