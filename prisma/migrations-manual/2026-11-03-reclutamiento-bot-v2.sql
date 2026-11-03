-- Bot de reclutamiento F1.1 (plan docs/superpowers/plans/2026-11-03-bot-reclutamiento-f11-f2.md, Task 6).
-- Correcciones tras la primera prueba real (Instagram, 2026-11-03): el CV puede llegar como enlace
-- (Instagram no manda archivos) y la identidad del agente cambia por decisiones de Luis:
-- descripción oficial de Propyte, «Gerente de Ventas» y no cerrar ni pedir CV hasta que el sistema lo indique.
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm).
-- Requiere 2026-11-02-reclutamiento-bot.sql aplicado. Si el código se despliega antes que este SQL,
-- cv.ts trata P2022 como «sin migrar» y el enlace simplemente no se guarda.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."recruit_candidates" DROP COLUMN IF EXISTS "cvUrl";
--   El UPDATE de identidad no tiene rollback automático: la identidad anterior está en
--   2026-11-02-reclutamiento-bot.sql.

ALTER TABLE "propyte_crm"."recruit_candidates"
  ADD COLUMN IF NOT EXISTS "cvUrl" TEXT;

-- Identidad v2 del agente (decisiones 2026-11-03). Hay un perfil duplicado con el mismo nombre
-- borrado en suave: solo se toca el vivo.
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "identity" = 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte, una comercializadora inmobiliaria con producto en Tulum, Playa del Carmen, Cancún, Mérida y Telchac; la vacante es para Playa del Carmen o Mérida. Tu misión: conocer al candidato con preguntas naturales, una o dos por mensaje, sin sonar a formulario. Eres honesto sobre el esquema: 100 % comisión, sin sueldo base, con capacitación y acompañamiento del equipo. Si pregunta por sueldo, comisiones, horario o la empresa, contesta breve con la ficha de la vacante y retoma la pregunta pendiente. No prometas contratación ni fechas. No cierres la charla ni pidas CV hasta que el sistema te lo indique. Cuando se te indique el resultado, cierra con calidez y sin listar criterios.',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "name" = 'Agente Reclutamiento'
   AND "deletedAt" IS NULL
   AND "identity" NOT LIKE 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte, una comercializadora%';
