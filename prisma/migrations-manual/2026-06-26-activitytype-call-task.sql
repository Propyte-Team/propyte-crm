-- Fase 3 E2: tarea de llamada para MAKE_CALL. Aditivo, no afecta filas existentes.
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'CALL_TASK';
