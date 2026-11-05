-- #988 — Copilot fase 1: «Mi día» con la cadencia de nuevos (15 días) del PDF de Luis.
--
-- Qué hace:
--   1. copilot_plantillas: los textos de la cadencia, ES/EN, por toque y variante. Se siembran con
--      el PDF «Cadencia Multicanal — Resumen Operativo» (secciones 3, 4 y 5) y con los primeros
--      mensajes por fuente de Luis (ronda 4, §6). Se editan en Copilot → Plantillas. Volver a
--      correr esta migración NO pisa lo que ya se editó (ON CONFLICT DO NOTHING).
--   2. copilot_cadencias: una por contacto mientras está activa (índice único parcial).
--   3. copilot_toques: los toques de cada día. Los crea el cron (etapa «cadencias») el día que
--      tocan; el asesor marca el resultado.
--   4. Disparador trg_contacts_zz_copilot_cadencia (AFTER) en contacts:
--      - INSCRIBE al contacto que se da de alta en Nuevo o Sin respuesta, o que llega a uno de
--        esos dos estados desde otro. Los 399 que ya están hoy en Nuevo o Sin respuesta NO entran.
--      - TERMINA la cadencia (y quita los toques pendientes) cuando el contacto sale de Nuevo o
--        Sin respuesta, se marca No contactar, se borra o se fusiona, o deja de ser de compra.
--      A quién aplica: tipo distinto de Broker, Empleo, Proveedor, Lead vendedor y Otro; flujo
--      vacío, F2, F4 o F5; y que no sea un provisional de comentario (lib/leads/real-leads.ts).
--      Un alta con «fecha de origen» de hace más de 30 días es una importación de historial y no entra.
--
-- No mueve ningún contacto ni crea toques por sí sola. Idempotente. Va en una transacción.
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm). Puede ir antes o después del código:
-- sin las tablas, la etapa del cron y la página avisan y no hacen nada.
--
-- Comprobación:
--   SELECT codigo, idioma, variante FROM propyte_crm.copilot_plantillas ORDER BY orden, idioma, variante;  -- 55 filas
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_contacts_zz_copilot_cadencia';                      -- 1 fila
--   SELECT count(*) FROM propyte_crm.copilot_cadencias;                                                   -- 0 (hasta que entre un lead)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_contacts_zz_copilot_cadencia ON propyte_crm.contacts;
--   DROP FUNCTION IF EXISTS propyte_crm.copilot_cadencia_de_contacto();
--   DROP FUNCTION IF EXISTS propyte_crm.copilot_aplica_cadencia(propyte_crm.contacts);
--   DROP TABLE IF EXISTS propyte_crm.copilot_toques, propyte_crm.copilot_cadencias, propyte_crm.copilot_plantillas;

BEGIN;

-- ───────────────────────────── 1. tablas ─────────────────────────────

CREATE TABLE IF NOT EXISTS propyte_crm.copilot_plantillas (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "codigo"      TEXT NOT NULL,
  "idioma"      TEXT NOT NULL CHECK ("idioma" IN ('ES', 'EN')),
  "variante"    TEXT NOT NULL DEFAULT '',
  "canal"       TEXT NOT NULL CHECK ("canal" IN ('WHATSAPP', 'SMS', 'CORREO', 'BUZON', 'DATO')),
  "nombre"      TEXT NOT NULL,
  "asunto"      TEXT,
  "cuerpo"      TEXT NOT NULL,
  "orden"       INTEGER NOT NULL DEFAULT 0,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedById" TEXT,
  CONSTRAINT copilot_plantillas_codigo_idioma_variante_key UNIQUE ("codigo", "idioma", "variante")
);

CREATE TABLE IF NOT EXISTS propyte_crm.copilot_cadencias (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contactId"        TEXT NOT NULL REFERENCES propyte_crm.contacts("id") ON DELETE CASCADE,
  "tipo"             TEXT NOT NULL CHECK ("tipo" IN ('NUEVOS', 'BASE_DE_DATOS')),
  "estado"           TEXT NOT NULL DEFAULT 'ACTIVA' CHECK ("estado" IN ('ACTIVA', 'TERMINADA')),
  "motivoFin"        TEXT CHECK ("motivoFin" IS NULL OR "motivoFin" IN ('RESPONDIO', 'SALIO_DEL_ESTADO', 'YA_NO_APLICA', 'SIN_RESPUESTA')),
  "inicio"           TIMESTAMP(3) NOT NULL,
  "diaInicio"        DATE NOT NULL,
  "horaEntrada"      INTEGER NOT NULL CHECK ("horaEntrada" BETWEEN 0 AND 23),
  "modoSms"          TEXT CHECK ("modoSms" IS NULL OR "modoSms" IN ('COMPLEMENTARIO', 'ROBUSTO')),
  "diaMaterializado" INTEGER NOT NULL DEFAULT 0,
  "primerIntentoAt"  TIMESTAMP(3),
  "respuestaAt"      TIMESTAMP(3),
  "finAt"            TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE UNIQUE INDEX IF NOT EXISTS copilot_cadencias_una_activa ON propyte_crm.copilot_cadencias ("contactId") WHERE "estado" = 'ACTIVA';
CREATE INDEX IF NOT EXISTS copilot_cadencias_contact_idx ON propyte_crm.copilot_cadencias ("contactId");
CREATE INDEX IF NOT EXISTS copilot_cadencias_estado_idx ON propyte_crm.copilot_cadencias ("estado");

CREATE TABLE IF NOT EXISTS propyte_crm.copilot_toques (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cadenciaId"     TEXT NOT NULL REFERENCES propyte_crm.copilot_cadencias("id") ON DELETE CASCADE,
  "contactId"      TEXT NOT NULL,
  "dia"            INTEGER NOT NULL,
  "fecha"          DATE NOT NULL,
  "codigo"         TEXT NOT NULL,
  "canal"          TEXT NOT NULL CHECK ("canal" IN ('LLAMADA', 'WHATSAPP', 'SMS', 'CORREO', 'BUZON')),
  "orden"          INTEGER NOT NULL,
  "plantilla"      TEXT,
  "cuando"         TEXT NOT NULL,
  "variante"       TEXT,
  "resultado"      TEXT CHECK ("resultado" IS NULL OR "resultado" IN ('CONTESTO', 'NO_CONTESTO', 'DEJADO', 'ENVIADO', 'RESPONDIO', 'NO_SE_PUDO', 'NO_HECHO')),
  "resultadoAt"    TIMESTAMP(3),
  "resultadoPorId" TEXT,
  "avisoVencidaAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT copilot_toques_cadencia_codigo_key UNIQUE ("cadenciaId", "codigo")
);
CREATE INDEX IF NOT EXISTS copilot_toques_contact_idx ON propyte_crm.copilot_toques ("contactId");
CREATE INDEX IF NOT EXISTS copilot_toques_pendientes_idx ON propyte_crm.copilot_toques ("cadenciaId", "fecha") WHERE "resultado" IS NULL;

-- Sin políticas: solo las lee y escribe el CRM con su rol de servidor (igual que contact_temperaturas).
ALTER TABLE propyte_crm.copilot_plantillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE propyte_crm.copilot_cadencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE propyte_crm.copilot_toques ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────── 2. a quién aplica ─────────────────────────────
-- Paridad con TIPOS_SIN_CADENCIA y FLUJOS_SIN_CADENCIA de src/lib/copilot/cadencia-nuevos.ts
-- (lo comprueba cadencia-nuevos.test.ts).
CREATE OR REPLACE FUNCTION propyte_crm.copilot_aplica_cadencia(c propyte_crm.contacts)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT c."deletedAt" IS NULL
     AND c."mergedIntoId" IS NULL
     AND NOT coalesce(c."doNotContact", false)
     AND c.estado::text IN ('NUEVO', 'SIN_RESPUESTA')
     AND coalesce(c."contactType"::text, '') NOT IN ('BROKER_EXTERNO', 'EMPLEO', 'PROVEEDOR', 'LEAD_VENDEDOR', 'OTRO')
     AND coalesce(c.flujo::text, '') NOT IN ('F1_CORRETAJE_VENDEDOR', 'F3_CAPTACION_MB', 'F6_BROKER', 'F7_INMOBILIARIA', 'F8_EMPLEO')
     AND coalesce(c."leadSourceDetail", '') NOT LIKE 'comentario:%';
$$;

-- ───────────────────────────── 3. disparador ─────────────────────────────
CREATE OR REPLACE FUNCTION propyte_crm.copilot_cadencia_de_contacto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  activa text;
  aplica boolean := propyte_crm.copilot_aplica_cadencia(NEW);
  ahora  timestamp := now() AT TIME ZONE 'UTC';
  local  timestamp := now() AT TIME ZONE 'America/Cancun';
BEGIN
  SELECT k."id" INTO activa
    FROM propyte_crm.copilot_cadencias k
   WHERE k."contactId" = NEW."id" AND k."estado" = 'ACTIVA';

  IF activa IS NOT NULL THEN
    IF NOT aplica THEN
      DELETE FROM propyte_crm.copilot_toques WHERE "cadenciaId" = activa AND "resultado" IS NULL;
      UPDATE propyte_crm.copilot_cadencias
         SET "estado" = 'TERMINADA',
             "finAt" = ahora,
             "motivoFin" = CASE WHEN NEW.estado::text IN ('NUEVO', 'SIN_RESPUESTA') THEN 'YA_NO_APLICA' ELSE 'SALIO_DEL_ESTADO' END
       WHERE "id" = activa;
    END IF;
    RETURN NULL;
  END IF;

  IF NOT aplica THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Un alta con fecha de origen vieja es una importación de historial, no un lead que entra.
    IF NEW."originalCreatedAt" IS NOT NULL AND NEW."originalCreatedAt" < ahora - interval '30 days' THEN
      RETURN NULL;
    END IF;
  ELSIF NEW.estado IS NOT DISTINCT FROM OLD.estado
        OR coalesce(OLD.estado::text, '') IN ('NUEVO', 'SIN_RESPUESTA') THEN
    -- Solo al LLEGAR a Nuevo o Sin respuesta desde otro estado (Nuevo → Sin respuesta no reinicia).
    RETURN NULL;
  END IF;

  INSERT INTO propyte_crm.copilot_cadencias ("contactId", "tipo", "inicio", "diaInicio", "horaEntrada")
  VALUES (
    NEW."id",
    CASE WHEN NEW."leadSource"::text = 'BASE_DE_DATOS' THEN 'BASE_DE_DATOS' ELSE 'NUEVOS' END,
    ahora,
    local::date,
    extract(hour FROM local)::int
  )
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

-- «zz»: después de los AFTER de cronología y reclutamiento. Lleva contactStatus porque el código
-- viejo escribe el estado por ahí y el disparador #953 (BEFORE) lo traduce a `estado`.
DROP TRIGGER IF EXISTS trg_contacts_zz_copilot_cadencia ON propyte_crm.contacts;
CREATE TRIGGER trg_contacts_zz_copilot_cadencia
  AFTER INSERT OR UPDATE OF estado, "contactStatus", "contactType", flujo, "doNotContact", "deletedAt", "mergedIntoId"
  ON propyte_crm.contacts
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.copilot_cadencia_de_contacto();

-- ───────────────────────────── 4. plantillas del PDF ─────────────────────────────
-- Transcritas del PDF (páginas 2 a 5). Cambios de forma, para que el CRM llene las variables:
--   - «[LÍNEA DE VALOR — elige del menú abajo]» y «[VALUE LINE — …]» quedan como [LÍNEA DE VALOR];
--     el CRM pone la opción A–D según la zona (menú de la página 4).
--   - En los SMS, la cifra «+13.5%» queda como [CIFRA]: el CRM pone la de la zona del lead
--     (regla zona–cifra del PDF: «misma pareja zona–cifra en todos los canales»).
--   - «continuamos por aca» → «por acá».
-- Los SMS solo vienen en inglés (son para +1). Los primeros mensajes por fuente (Self-Gen, Walk-in,
-- Evento, Base de datos) son de Luis y solo vienen en español.
INSERT INTO propyte_crm.copilot_plantillas ("codigo", "idioma", "variante", "canal", "nombre", "asunto", "cuerpo", "orden") VALUES
-- WhatsApp 1 · plusvalía (día 1)
('WA1', 'ES', '', 'WHATSAPP', 'WA1 · Plusvalía (gancho)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte. Vi que pediste info de [PROYECTO]. Te soy directo: [ZONA] fue de las zonas que más subieron de precio en México este trimestre, te paso fuente y número si te sirve. Pero no todo lo que se vende aquí lo aprovecha; yo solo te llevo lo que sí. ¿Lo vemos en una llamada de 10 min?$p$, 10),
('WA1', 'EN', '', 'WHATSAPP', 'WA1 · Plusvalía (gancho)', NULL,
$p$Hi [NOMBRE], this is [ASESOR] with Propyte. Saw you asked about [PROYECTO]. Straight up: [ZONA] posted some of the strongest price growth in Mexico this quarter (happy to share the source and the exact number). But not every property here captures it, and I only bring you the ones that do. Want to hop on a quick 10-min call?$p$, 10),
-- Primer WhatsApp por fuente (Luis, ronda 4)
('WA1_SELF_GEN', 'ES', '', 'WHATSAPP', 'WA1 · Self-Gen (Luis)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte. [Cómo se conocieron]. Trabajo con desarrollos en [ZONA] y solo recomiendo los que pasan mi filtro de números, ubicación y desarrollador. ¿Te cuento en una llamada de 10 minutos?$p$, 11),
('WA1_WALK_IN', 'ES', '', 'WHATSAPP', 'WA1 · Walk-in (Luis)', NULL,
$p$Hola [NOMBRE], soy [ASESOR]. Gracias por visitarnos hoy. Te dejo mi número directo y lo que vimos de [PROYECTO]. ¿Agendamos [SIGUIENTE PASO]?$p$, 12),
('WA1_EVENTO', 'ES', '', 'WHATSAPP', 'WA1 · Evento (Luis)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte. Platicamos en [EVENTO]. Como quedamos, te comparto [MATERIAL]. ¿Lo vemos en una llamada de 10 minutos esta semana?$p$, 13),
('WA1_BASE_DE_DATOS', 'ES', '', 'WHATSAPP', 'WA1 · Base de datos (Luis)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte. Hace tiempo te interesó [ZONA]. ¿Sigue en tus planes o prefieres que no te vuelva a escribir? Cualquiera de las dos me sirve.$p$, 14),
-- Correo 1 · plusvalía (día 2; EE. UU. día 1)
('CORREO1', 'ES', '', 'CORREO', 'Correo 1 · Plusvalía', $p$[NOMBRE], sobre [ZONA]$p$,
$p$Hola [NOMBRE]:

Vi que pediste información de [PROYECTO], en [ZONA].

[LÍNEA DE VALOR]

Lo más ágil es seguirlo por WhatsApp; te escribo también por ahí para que tengas mi número directo: [wa.me/NÚMERO]

¿Te parece si lo vemos ahí? Si prefieres el correo, continuamos por acá.

[ASESOR] · [ROL] · Propyte · [WhatsApp]$p$, 20),
('CORREO1', 'EN', '', 'CORREO', 'Correo 1 · Plusvalía', NULL,
$p$Hi [NOMBRE],

Saw your inquiry about [PROYECTO] in [ZONA].

[LÍNEA DE VALOR]

The quickest way to dig in is WhatsApp: one tap below and you're through to me directly. Or if you'd rather, we can keep it right here: [wa.me/NÚMERO]

Worth a closer look?

[ASESOR] · [ROL] · Propyte · [WhatsApp]$p$, 20),
-- Menú de línea de valor del Correo 1 (página 4)
('LINEA_VALOR', 'ES', 'A', 'DATO', 'Línea de valor A · Playa del Carmen', NULL,
$p$Según la Sociedad Hipotecaria Federal (agencia federal de vivienda), Playa del Carmen fue el municipio con mayor apreciación de vivienda del país en el 1T 2026: +13.5% anual, contra 8.7% del promedio nacional.$p$, 21),
('LINEA_VALOR', 'EN', 'A', 'DATO', 'Línea de valor A · Playa del Carmen', NULL,
$p$Per Mexico’s federal housing agency (SHF), Playa del Carmen posted the highest home-price appreciation of any municipality in the country in Q1 2026 — up 13.5% year over year, against a national average of 8.7%.$p$, 21),
('LINEA_VALOR', 'ES', 'B', 'DATO', 'Línea de valor B · Cancún', NULL,
$p$Según la Sociedad Hipotecaria Federal, Cancún tuvo la segunda mayor apreciación de vivienda del país en el 1T 2026: +13.3% anual, frente al 8.7% nacional.$p$, 22),
('LINEA_VALOR', 'EN', 'B', 'DATO', 'Línea de valor B · Cancún', NULL,
$p$Per Mexico’s federal housing agency (SHF), Cancún saw the country’s second-highest home-price appreciation in Q1 2026 — up 13.3% year over year, vs. a national average of 8.7%.$p$, 22),
('LINEA_VALOR', 'ES', 'C', 'DATO', 'Línea de valor C · Quintana Roo', NULL,
$p$Según la Sociedad Hipotecaria Federal, Quintana Roo lideró la apreciación de vivienda en México en el 1T 2026: +13.4% anual (promedio nacional: 8.7%).$p$, 23),
('LINEA_VALOR', 'EN', 'C', 'DATO', 'Línea de valor C · Quintana Roo', NULL,
$p$Per Mexico’s federal housing agency (SHF), Quintana Roo led the country in home-price appreciation in Q1 2026, up 13.4% year over year (national average: 8.7%).$p$, 23),
('LINEA_VALOR', 'ES', 'D', 'DATO', 'Línea de valor D · Honesta (Tulum / escéptico)', NULL,
$p$Te soy directo: no todo lo que se vende en [ZONA] tiene sentido como inversión hoy. Por eso trabajo con datos: para mostrarte lo que sí y lo que no.$p$, 24),
('LINEA_VALOR', 'EN', 'D', 'DATO', 'Línea de valor D · Honesta (Tulum / escéptico)', NULL,
$p$I’ll be straight with you: not everything on the market in [ZONA] makes sense as an investment right now. That’s exactly why I work from data — so you can see what does.$p$, 24),
-- Cifras por zona (SHF, Índice de Precios de la Vivienda 1T 2026; página 6). Las usan los SMS.
('CIFRA', 'ES', 'PDC', 'DATO', 'Cifra · Playa del Carmen (SHF 1T 2026)', NULL, '+13.5%', 25),
('CIFRA', 'ES', 'CANCUN', 'DATO', 'Cifra · Cancún (SHF 1T 2026)', NULL, '+13.3%', 26),
('CIFRA', 'ES', 'QROO', 'DATO', 'Cifra · Quintana Roo (SHF 1T 2026)', NULL, '+13.4%', 27),
-- WhatsApp 2 · curaduría (día 4)
('WA2', 'ES', '', 'WHATSAPP', 'WA2 · Curaduría (pregunta)', NULL,
$p$[NOMBRE], algo rápido que te ahorra tiempo: yo digo que no más seguido que sí. ¿Para qué llenarte de opciones si la mayoría no te conviene? Mejor te mando solo lo que pasa mi filtro, ¿va?$p$, 30),
('WA2', 'EN', '', 'WHATSAPP', 'WA2 · Curaduría (pregunta)', NULL,
$p$[NOMBRE], quick thought that'll save you time: I turn down far more projects than I take on. Why flood you with listings when most of them don't hold up? Want me to send you only what clears my filter?$p$, 30),
-- Correo 2 · curaduría (día 5)
('CORREO2', 'ES', '', 'CORREO', 'Correo 2 · Curaduría', NULL,
$p$Hola [NOMBRE]:

Algo que nos hace distintos y que a ti te ahorra tiempo: en Propyte decimos que no más veces de las que decimos que sí. No te voy a recomendar la mayoría de lo que se promueve en [ZONA]; solo te llevo lo que pasa el filtro: números, ubicación y desarrollador. Así no revisas catálogos, revisas lo que sí tiene sentido.

¿Te muestro lo que sí pasa el filtro? Por WhatsApp, o responde este correo: [wa.me/NÚMERO]

[firma]$p$, 40),
('CORREO2', 'EN', '', 'CORREO', 'Correo 2 · Curaduría', NULL,
$p$Hi [NOMBRE],

One thing that sets us apart — and saves you real time: at Propyte, we say no more often than we say yes. Most of what's being marketed in [ZONA] won't get my recommendation. I only bring you what clears the filter: numbers, location, and developer. So instead of scrolling listings, you're looking at the short list that actually holds up.

Want to see what clears the filter? WhatsApp me, or just hit reply: [wa.me/NÚMERO]

[signature]$p$, 40),
-- WhatsApp 3 · credibilidad (día 7, elige variante)
('WA3', 'ES', 'TRACCION', 'WHATSAPP', 'WA3 · Credibilidad · Tracción (solo dato real y favorable)', NULL,
$p$[NOMBRE], para que veas que no es discurso: [PROYECTO] ya va en [N] de [M]. No es para apurarte, es que el mercado ya está votando con dinero. ¿Te enseño qué queda?$p$, 50),
('WA3', 'EN', 'TRACCION', 'WHATSAPP', 'WA3 · Credibilidad · Tracción (solo dato real y favorable)', NULL,
$p$[NOMBRE], so you know this isn't just talk: [PROYECTO] is already at [N] of [M] units. Not trying to rush you — the market's just voting with its wallet. Want to see what's still available?$p$, 50),
('WA3', 'ES', 'METODO', 'WHATSAPP', 'WA3 · Credibilidad · Método (cualquier proyecto)', NULL,
$p$[NOMBRE], en corto: no soy agente suelto, soy el brazo comercial de desarrollos reales en [ZONA], y los he caminado en persona. Si algo no te conviene, te lo digo. ¿Vemos cuáles sí van contigo?$p$, 51),
('WA3', 'EN', 'METODO', 'WHATSAPP', 'WA3 · Credibilidad · Método (cualquier proyecto)', NULL,
$p$[NOMBRE], short version: I'm not an agent recycling listings. I'm the direct sales arm for real developments in [ZONA], and I've walked every one of them. If something's not right for you, I'll say so. Want to see which ones actually fit?$p$, 51),
-- Correo 3 · credibilidad (día 8, elige variante)
('CORREO3', 'ES', 'TRACCION', 'CORREO', 'Correo 3 · Credibilidad · Tracción', NULL,
$p$Hola [NOMBRE]:

Para darte una referencia real: [PROYECTO] va en [N] unidades vendidas de [M] al [FECHA]. No te lo comparto para apurarte; esa táctica no va conmigo. Te lo comparto porque el mercado ya está validando el proyecto con dinero, no con promesas.

¿Te paso qué unidades quedan y a qué precio? Por WhatsApp: [wa.me/NÚMERO]$p$, 60),
('CORREO3', 'EN', 'TRACCION', 'CORREO', 'Correo 3 · Credibilidad · Tracción', NULL,
$p$Hello [NOMBRE],

To give you a real-life reference, [PROYECTO] is currently at [N] units sold out of [M] as of [FECHA]. I'm not sharing this to pressure you; that tactic is not my style. I'm sharing it because the market is already validating the project with money, not promises.

Shall I send you the remaining units and their prices? It's faster on WhatsApp: [wa.me/NÚMERO]$p$, 60),
('CORREO3', 'ES', 'METODO', 'CORREO', 'Correo 3 · Credibilidad · Método', NULL,
$p$Hola [NOMBRE]:

Una razón para tomarme en serio, sin venderte nada: no soy un agente suelto. Soy el brazo comercial de desarrollos reales en [ZONA], los he caminado en persona, y trabajo con datos verificables, no con adjetivos. Si un proyecto no te conviene, te lo digo.

¿Vemos cuáles sí encajan contigo? Por WhatsApp: [wa.me/NÚMERO]$p$, 61),
('CORREO3', 'EN', 'METODO', 'CORREO', 'Correo 3 · Credibilidad · Método', NULL,
$p$Hello [NOMBRE],

One reason to take me seriously, without me selling you anything: I'm not a freelance agent. I'm the commercial arm for actual developments in [ZONA]. I've walked them in person and work with verifiable data, not just adjectives. If a project isn't a good fit, I'll tell you.

Shall we see which ones actually suit you? WhatsApp me, or hit reply: [wa.me/NÚMERO]$p$, 61),
-- WhatsApp 4 · objeción (día 10, elige variante)
('WA4', 'ES', 'FIDEICOMISO', 'WHATSAPP', 'WA4 · Objeción · Fideicomiso (extranjero)', NULL,
$p$[NOMBRE], la pregunta que más me hacen los compradores de fuera: "¿puedo ser dueño siendo extranjero?" Sí, por fideicomiso: 50 años, renovable, todos los derechos. Y es lo normal, la SRE autorizó miles solo en el primer semestre de 2025 (te paso el número exacto). ¿Te explico el proceso?$p$, 70),
('WA4', 'EN', 'FIDEICOMISO', 'WHATSAPP', 'WA4 · Objeción · Fideicomiso (extranjero)', NULL,
$p$[NOMBRE], the question I get most from foreign buyers: "can I actually own property as a foreigner?" You can — through a bank trust: 50 years, renewable, full ownership rights. And it's the norm: Mexico's foreign ministry approved thousands of these in H1 2025 alone (happy to send the exact figure). Want me to walk you through it, no fine print?$p$, 70),
('WA4', 'ES', 'SEGURIDAD', 'WHATSAPP', 'WA4 · Objeción · Seguridad jurídica (universal)', NULL,
$p$[NOMBRE], lo que más preocupa al comprar a distancia es un problema legal escondido. Te soy claro: la validación legal no la hacemos nosotros, seríamos juez y parte. La hace un experto y nosotros la coordinamos. ¿Te explico cómo te cubre eso?$p$, 71),
('WA4', 'EN', 'SEGURIDAD', 'WHATSAPP', 'WA4 · Objeción · Seguridad jurídica (universal)', NULL,
$p$[NOMBRE], the biggest worry when buying from afar is a hidden legal problem. Straight with you: we don't run the legal validation ourselves — we'd be grading our own homework. An independent expert does it, and we coordinate the whole thing. Want me to show you how that protects you?$p$, 71),
-- Correo 4 · objeción (día 11, elige variante)
('CORREO4', 'ES', 'FIDEICOMISO', 'CORREO', 'Correo 4 · Objeción · Fideicomiso', NULL,
$p$Hola [NOMBRE]:

Si te frena la duda de si un extranjero puede ser dueño aquí: sí puede. La vía es un fideicomiso bancario, con derecho a usar, rentar, vender o heredar. Y no es la excepción: solo en el primer semestre de 2025, la Secretaría de Relaciones Exteriores autorizó más de 3,400 fideicomisos de este tipo para extranjeros. Es la regla, no el truco.

¿Te explico el proceso, sin letra chica? Por WhatsApp: [wa.me/NÚMERO]$p$, 80),
('CORREO4', 'EN', 'FIDEICOMISO', 'CORREO', 'Correo 4 · Objeción · Fideicomiso', NULL,
$p$Hi [NOMBRE],

If the question holding you back is whether a foreigner can truly own property here: you can. The vehicle is a bank trust (fideicomiso) — full rights to use, rent, sell, or pass the property on. And it's far from rare: in H1 2025 alone, Mexico's Ministry of Foreign Affairs authorized more than 3,400 of these trusts for foreign buyers. It's the standard route, not a workaround.

Want me to walk you through the process, no fine print? [wa.me/NÚMERO]$p$, 80),
('CORREO4', 'ES', 'SEGURIDAD', 'CORREO', 'Correo 4 · Objeción · Seguridad jurídica', NULL,
$p$Hola [NOMBRE]:

Una preocupación válida al comprar a distancia: que la propiedad traiga un problema legal escondido. De entrada, nosotros revisamos la documentación y la trayectoria del desarrollador, y te damos una opinión honesta. La validación a fondo, registro público y títulos, la hace un experto legal; nosotros la coordinamos con alguna de las firmas especializadas de la zona y le damos seguimiento. No la hacemos nosotros directamente: seríamos juez y parte.

¿Te explico cómo funciona? Por WhatsApp: [wa.me/NÚMERO]$p$, 81),
('CORREO4', 'EN', 'SEGURIDAD', 'CORREO', 'Correo 4 · Objeción · Seguridad jurídica', NULL,
$p$Hi [NOMBRE],

A fair concern when buying from afar: that a property comes with a hidden legal problem. Up front, we review the developer's documentation and track record and give you an honest read. The deep validation — public registry, title — is done by an independent legal expert; we coordinate it with one of the area's specialized firms and follow through. We don't run it directly ourselves: we'd be grading our own homework.

Want me to show you how that protects you? [wa.me/NÚMERO]$p$, 81),
-- WhatsApp 5 · cierre (día 13)
('WA5', 'ES', '', 'WHATSAPP', 'WA5 · Cierre (pregunta paradójica)', NULL,
$p$[NOMBRE], no quiero saturarte, así que cierro por aquí por ahora. Pregunta honesta: ¿[ZONA] dejó de interesarte, o solo no es el momento? Cualquier respuesta me sirve.$p$, 90),
('WA5', 'EN', '', 'WHATSAPP', 'WA5 · Cierre (pregunta paradójica)', NULL,
$p$[NOMBRE], I don't want to keep piling on, so I'll leave it here for now. Honest question: is [ZONA] off the table for you, or is it just bad timing? Either answer works.$p$, 90),
-- Correo 5 · cierre (día 15)
('CORREO5', 'ES', '', 'CORREO', 'Correo 5 · Cierre («permiso para cerrar»)', NULL,
$p$Hola [NOMBRE]:

No quiero llenarte la bandeja, así que este es mi último correo por ahora. Lo entiendo perfecto: una compra de este tamaño no se decide con prisa, y si no es tu momento, está bien. Cierro tu expediente por mi lado y dejo de escribirte. Cuando quieras retomarlo, aquí sigo, y no empiezas de cero.

¿Lo dejamos para más adelante, o le damos un último vistazo por WhatsApp? [wa.me/NÚMERO]

[firma]$p$, 100),
('CORREO5', 'EN', '', 'CORREO', 'Correo 5 · Cierre («permiso para cerrar»)', NULL,
$p$Hi [NOMBRE],

I don't want to clutter your inbox, so this is my last email for now. I get it — buying in another country isn't a decision you rush, and if the timing isn't right, that's fine. I'll close your file on my end and stop writing. Whenever you want to pick this back up, I'm here, and we'll start right where we left off.

Park it for now, or take one last look over WhatsApp? [wa.me/NÚMERO]

[signature]$p$, 100),
-- SMS, solo +1 (página 5). Complementario: SMS1 día 1, SMS2 día 6, SMS3 día 12. Robusto: días 1, 4, 8 y 13.
('SMS_C1_CON_WA', 'EN', '', 'SMS', 'SMS1 · Complementario (con WhatsApp)', NULL,
$p$[NOMBRE], this is [ASESOR] from Propyte re: your [ZONA] inquiry. I just messaged you on WhatsApp — easiest place to talk. Or reply here.$p$, 110),
('SMS_C1_SIN_WA', 'EN', '', 'SMS', 'SMS1 · Complementario (sin WhatsApp)', NULL,
$p$[NOMBRE], this is [ASESOR] from Propyte re: your [ZONA] inquiry. Reply here, or let me know what time works best for a call.$p$, 111),
('SMS_C2', 'EN', '', 'SMS', 'SMS2 · Complementario (día 6)', NULL,
$p$[NOMBRE], quick one from Propyte: [ZONA] led Mexico in home-price growth in Q1 2026 (SHF, [CIFRA]). Details on WhatsApp/Email when you’re ready.$p$, 112),
('SMS_C3', 'EN', '', 'SMS', 'SMS3 · Complementario (día 12)', NULL,
$p$[NOMBRE], closing your file for now — no rush. If [ZONA] is still on your mind, reply here or ping me on WhatsApp.$p$, 113),
('SMS_R1', 'EN', '', 'SMS', 'SMS1 · Robusto (día 1)', NULL,
$p$[NOMBRE], [ASESOR] from Propyte re: your [ZONA] inquiry. Per Mexico’s federal housing agency, [ZONA] led the country in price growth in Q1 2026 ([CIFRA]). Reply to talk.$p$, 114),
('SMS_R2', 'EN', '', 'SMS', 'SMS2 · Robusto (día 4)', NULL,
$p$[NOMBRE], how we work at Propyte: we turn down more than we take on. I only send what clears the filter — numbers, location, developer. Want to see what fits?$p$, 115),
('SMS_R3', 'EN', '', 'SMS', 'SMS3 · Robusto (día 8)', NULL,
$p$[NOMBRE], wondering if a foreigner can own here? You can — via a bank trust. Mexico’s SRE approved 3,400+ for foreigners in H1 2025 alone. Want the process? Reply.$p$, 116),
('SMS_R4', 'EN', '', 'SMS', 'SMS4 · Robusto (día 13)', NULL,
$p$[NOMBRE], last note for now — no pressure. Is [ZONA] off the table, or just bad timing? Either’s fine, one line works.$p$, 117),
-- Buzón de voz, solo +1, máximo 2 (página 5). Nunca da cifras.
('BUZON1', 'ES', '', 'BUZON', 'Buzón 1 · día 1 (tras L2, menos de 20 s)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte. Consultaste [PROYECTO] en [ZONA] y te acabo de marcar. No hace falta que me regreses la llamada: ahora mismo te mando un mensaje con lo primero. Saludos.$p$, 120),
('BUZON1', 'EN', '', 'BUZON', 'Buzón 1 · día 1 (tras L2, menos de 20 s)', NULL,
$p$Hi [NOMBRE], this is [ASESOR] with Propyte. You inquired about [PROYECTO] in [ZONA] — I just tried to reach you. No need to call back: I’m sending you a text right now with the first piece of information. Talk soon.$p$, 120),
('BUZON2', 'ES', '', 'BUZON', 'Buzón 2 · día 10 (tras L6)', NULL,
$p$Hola [NOMBRE], soy [ASESOR], de Propyte otra vez. Te he mandado un par de cosas sobre [PROYECTO]. Si no es el momento, no pasa nada — dímelo por mensaje y cierro tu expediente. Y si sigue en tu radar, mi siguiente mensaje trae una sola pregunta. Cualquiera de las dos me sirve.$p$, 121),
('BUZON2', 'EN', '', 'BUZON', 'Buzón 2 · día 10 (tras L6)', NULL,
$p$Hi [NOMBRE], [ASESOR] with Propyte again. I’ve sent you a few things about [PROYECTO]. If the timing isn’t right, that’s completely fine — just say so by text and I’ll close your file, no hard feelings. If it’s still on your radar, my next message has one simple question. Either answer works.$p$, 121)
ON CONFLICT ("codigo", "idioma", "variante") DO NOTHING;

COMMIT;
