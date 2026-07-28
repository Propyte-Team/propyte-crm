-- Agenda personal del asesor — Fase 1
-- Spec: docs/superpowers/specs/2026-07-27-agenda-personal-asesor-design.md §5
--
-- Permite Activity sin contacto, para tareas y notas personales del asesor.
-- Aditivo e idempotente. Reversible mientras no existan filas con contactId NULL
-- (la UI que las crea llega hasta la Fase 2).
--
-- Rollback:
--   ALTER TABLE propyte_crm.activities ALTER COLUMN "contactId" SET NOT NULL;

ALTER TABLE propyte_crm.activities ALTER COLUMN "contactId" DROP NOT NULL;
