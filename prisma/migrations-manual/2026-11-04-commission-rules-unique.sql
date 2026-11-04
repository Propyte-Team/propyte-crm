-- E8 — Una sola regla de comisión por (tipo de deal, origen del lead, rol).
-- El servidor ya lo valida (src/server/admin.ts); este índice es la red de seguridad.
--
-- PASO 1 (obligatorio ANTES de aplicar): detectar duplicados existentes.
--   SELECT "dealType", "leadSourceCategory", "role", count(*)
--   FROM propyte_crm.commission_rules
--   GROUP BY "dealType", "leadSourceCategory", "role"
--   HAVING count(*) > 1;
-- Si devuelve filas, resuélvelas a mano (borra o desactiva la que sobre, conservando
-- la que de verdad se usa) y repite la consulta hasta que salga vacía. Con duplicados el
-- CREATE UNIQUE INDEX falla y, con CONCURRENTLY, deja un índice INVALID que hay que
-- borrar (DROP INDEX propyte_crm.commission_rules_dealType_leadSourceCategory_role_key).
--
-- PASO 2: aplicar. CONCURRENTLY no puede correr dentro de una transacción: ejecútalo solo,
-- no dentro de BEGIN/COMMIT. El nombre es el que Prisma espera para @@unique.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "commission_rules_dealType_leadSourceCategory_role_key"
  ON propyte_crm.commission_rules ("dealType", "leadSourceCategory", "role");
