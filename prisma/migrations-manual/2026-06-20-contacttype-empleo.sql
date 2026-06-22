-- Fase 2: agrega EMPLEO a ContactType (additivo, no destructivo).
-- ADD VALUE no corre dentro de transacción en PG < 12 / algunos pools → ejecutar suelto.
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'EMPLEO';
