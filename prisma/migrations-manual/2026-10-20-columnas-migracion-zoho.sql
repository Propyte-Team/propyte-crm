-- #914 — Columnas para la migración de Zoho (leads de Felipe) + anuncio de origen en ad_attributions.
--
-- UNA sola parte, y va ANTES de desplegar el código (lección de la #907: ahí se mezcló el PR
-- antes de aplicar la migración y la lista de contactos se quedó en «0 en total»).
-- Solo agrega columnas NULLABLE, sin default: es compatible con el código que hoy está en
-- producción, cuyo cliente de Prisma no las conoce (no las selecciona ni las escribe).
--
-- Origen de cada columna: los 36 campos de Zoho (de 118) que tienen algún dato en los 356 Leads
-- de Felipe, medido el 2026-10-19 con COQL de solo lectura. Los que ya tenían una columna en el
-- CRM no se duplican (Tipo → contactType, Estado → contactStatus, Plataforma → leadSourceDetail,
-- Adquisición → paymentMethod, Urgencia → purchaseTimeline/urgency, ID_Lead_Meta → socialLeadId…).
-- Detalle y decisiones en el doc «migracion-zoho-leads-felipe-2026-10-19» del proyecto Sistemas.
--
-- Aplicar vía execute_sql/apply_migration a oaijxdpevakashxshhvm (schema propyte_crm).
-- Idempotente: re-ejecutarla no hace nada.

-- ───────────────────────────── contacts ─────────────────────────────
ALTER TABLE "propyte_crm"."contacts"
  ADD COLUMN IF NOT EXISTS "company"         TEXT,     -- Zoho Company / Inmobiliaria (empresa o inmobiliaria del broker)
  ADD COLUMN IF NOT EXISTS "secondaryEmail"  TEXT,     -- Zoho Secondary_Email
  ADD COLUMN IF NOT EXISTS "facebook"        TEXT,     -- Zoho Facebook
  ADD COLUMN IF NOT EXISTS "instagramHandle" TEXT,     -- Zoho Instagram (usuario; instagramId es el id de Meta, otra cosa)
  ADD COLUMN IF NOT EXISTS "budgetText"      TEXT,     -- Zoho Presupuesto: texto libre / rango del formulario
  ADD COLUMN IF NOT EXISTS "brokerInterest"  TEXT,     -- Zoho Inter_s «Interés de Broker»
  ADD COLUMN IF NOT EXISTS "initialMessage"  TEXT,     -- Zoho Mensaje
  ADD COLUMN IF NOT EXISTS "internalStage"   TEXT,     -- Zoho Etapa_interna_de_contacto
  ADD COLUMN IF NOT EXISTS "discardReason"   TEXT,     -- Zoho Raz_n_de_descarte
  ADD COLUMN IF NOT EXISTS "appliedPosition" TEXT,     -- Zoho Puesto_solicitado (contactos de Empleo)
  ADD COLUMN IF NOT EXISTS "inSequence"      BOOLEAN;  -- Zoho En_secuencia (histórico de su automatización)

-- ───────────────────────────── ad_attributions ─────────────────────────────
ALTER TABLE "propyte_crm"."ad_attributions"
  ADD COLUMN IF NOT EXISTS "metaCampaignId" TEXT,  -- Zoho ID_Campa_a_Meta
  ADD COLUMN IF NOT EXISTS "metaAdsetId"    TEXT,  -- Zoho ID_Conjunto_Meta
  ADD COLUMN IF NOT EXISTS "metaAdId"       TEXT,  -- Zoho ID_Anuncio_Meta
  ADD COLUMN IF NOT EXISTS "metaFormId"     TEXT,  -- Zoho ID_Formulario_Meta
  ADD COLUMN IF NOT EXISTS "formName"       TEXT;  -- Zoho Nombre_del_formulario

-- Comprobación (debe dar 11 y 5 filas):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'propyte_crm' AND table_name = 'contacts'
--      AND column_name IN ('company','secondaryEmail','facebook','instagramHandle','budgetText',
--        'brokerInterest','initialMessage','internalStage','discardReason','appliedPosition','inSequence');
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'propyte_crm' AND table_name = 'ad_attributions'
--      AND column_name IN ('metaCampaignId','metaAdsetId','metaAdId','metaFormId','formName');
--
-- Reversa (solo si hiciera falta, y ANTES de cargar datos de Zoho en ellas):
--   ALTER TABLE "propyte_crm"."contacts" DROP COLUMN IF EXISTS "company", … ;
--   ALTER TABLE "propyte_crm"."ad_attributions" DROP COLUMN IF EXISTS "metaCampaignId", … ;
