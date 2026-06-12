-- Seguridad — Habilitar Row Level Security en las 45 tablas de propyte_crm que la tenían apagada.
-- CONTEXTO: el CRM accede por rol `postgres` (Prisma, bypassrls=true) y `service_role`
-- (cliente JS, bypassrls=true). anon/authenticated NO saltan RLS. Verificado que no hay
-- uso de anon key ni Realtime contra propyte_crm → habilitar RLS SIN políticas cierra la
-- exposición vía anon key sin afectar al CRM. Reversible con ... DISABLE ROW LEVEL SECURITY.
-- Sin políticas = anon/authenticated quedan denegados (deny-all), que es justo lo deseado.

ALTER TABLE "propyte_crm"."action_plan_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."action_plan_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."action_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."action_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."ad_attributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."auth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."connector_lead_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."contact_dossiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."conversion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."core_field_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."custom_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."custom_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."custom_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."deal_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."external_brokers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."field_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."field_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."layout_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."layout_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."layouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."lead_connectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."lookup_projections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."payment_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."payment_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."record_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."relationship_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."rollup_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."routing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."sla_timers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."territories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."territory_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."territory_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."user_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."web_behavior" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."workflow_events" ENABLE ROW LEVEL SECURITY;
