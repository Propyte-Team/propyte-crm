# Matriz de paridad Zoho: CRM (sync-engine) vs Hub — T2.1

> Generada 2026-06-10 (análisis de código por agente; CRM en main `d85a0d4c`, Hub en main `32d0a74`).
> Pregunta: ¿se puede apagar el cron de 15 min del CRM (`/api/zoho/sync/cron`) sin perder cobertura?
> **VEREDICTO: NO TODAVÍA.** El outbound está cubierto por el Hub; el inbound NO (escribe a tablas distintas).

## Resumen por capacidad

| Capacidad | CRM | Hub | ¿Cubierto? |
|---|---|---|---|
| Push saliente devs/units (creates + updates, drip-feed) | `sync-engine.ts:133-382` (batch 100, upsert) | `zoho-hub-push/route.ts:175-330` (per-row vía trigger Postgres + insert con anti-dup) | ✅ Sí (Hub incluso superior: tiempo real) |
| Creates nuevos (zoho_record_id NULL) + write-back del ID | `sync-engine.ts:141-150` | `zoho-hub-push/route.ts:267-330` | ✅ Sí |
| Reglas SOT (Publicado/Rechazado/Terminado = Hub manda) | `sync-engine.ts:118,295` | `field-rules.ts:21` + `zoho-hub-push:92-101` | ✅ Sí |
| Last-write-wins | `sync-engine.ts:713-716` | `zoho-hub-push:113-125` (tolerancia 30s) | ✅ Sí |
| Status pipeline saliente | `field-maps.ts:220-221` | `outbound-whitelist.ts:201` | ✅ Sí |
| Webhook entrante + staging + anti-replay | (limitado) | `zoho-webhook/route.ts:297-467` + staging | ✅ Hub superior |
| **Inbound Leads/Contacts/Deals/Accounts** | **Fase 2 → `real_estate_hub.Propyte_zoho_{leads,contacts,deals,accounts}`** (`sync-engine.ts:617-679`) | **Escribe a OTRO schema/tablas: `reports.zoho_{contactos,negocios,empresas}`** | ❌ **GAP CRÍTICO** |
| `Propyte_zoho_id_map` (mapeo IDs + consecutive_misses) | `sync-engine.ts:155-163,341-349` | No existe en Hub (usa `zoho_record_id` en tablas + `detect-deletes.ts` directo de Zoho API) | ⚠️ Decidir si se retira |
| Deal stage → estado de unidad | `sync-engine.ts:758-793` — **solo loguea sugerencia, NO aplica** | No existe | ⚠️ Menor (nunca aplicó) |
| Cobertura de campos saliente | ~148 mapeos (`field-maps.ts`) | ~35 en whitelist (`outbound-whitelist.ts`) | ⚠️ Faltan: `ext_precio_min/max_mxn`, 3 campos ROI. (Amenidades y content NO se sincronizan por diseño: Hub-owned editorial, `field-rules.ts:76`) |
| Log por registro | `Propyte_zoho_sync_log` detallado | `sync_log` solo resumen por módulo | ⚠️ Menor (debugging) |

## El gap que bloquea: inbound de leads

- El CRM llena `Propyte_zoho_leads` cada 15 min; **la reconciliación Meta Leads la lee** (`server/meta-leads.ts`).
- El Hub sincroniza el módulo Contactos de Zoho pero a `reports.zoho_contactos` (columnas distintas: `zoho_id` vs `zoho_record_id`).
- Si se apaga el cron del CRM hoy → `Propyte_zoho_leads` se congela → matching de Meta Leads queda ciego.

## Decisión de arquitectura pendiente (Luis) — define el orden F2/F3

- **Opción B (recomendada):** al portar Meta Leads al Hub (T3.1), hacer que el matching lea `reports.zoho_contactos` (un solo pipeline inbound, el del Hub). Verificar que tenga email/phone/mobile. Después las tablas `Propyte_zoho_*` se congelan/retiran junto con el cron del CRM.
- **Opción A (fallback):** portar la Fase 2 del CRM al Hub para seguir llenando `Propyte_zoho_*` tal cual.

## Checklist previo a apagar el cron del CRM (T2.1 final)

1. [ ] Resolver el inbound de leads (Opción A o B) y verlo funcionando en Hub
2. [ ] Agregar `ext_precio_min_mxn`/`ext_precio_max_mxn` (+ROI si se usa en Zoho) al whitelist saliente del Hub
3. [ ] Decidir destino de `Propyte_zoho_id_map` (retirar si detect-deletes del Hub basta)
4. [ ] Confirmar con datos: N días de corridas del Hub sin que el CRM aporte cambios (comparar conteos)
5. [ ] Luis borra el cron de 15 min en el panel de Hostinger
6. [ ] Solo entonces: T2.2 borrar código Zoho del CRM
