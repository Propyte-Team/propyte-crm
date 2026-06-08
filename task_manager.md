# Task Manager — propyte-crm-base

> Proyecto nuevo creado 2026-05-12. Speckit canónico en `specs/propyte-own-crm.md`.

## Estado actual

**Fase:** Pre-implementación (speckit recién escrito, esperando review de Luis).

**Última actualización:** 2026-05-12

## Próxima acción

Luis revisa `specs/propyte-own-crm.md` y responde Q1-Q11 (apartado 9 del spec). Sin esas respuestas no se puede arrancar Bloque 0.

## Bloques del plan

| Bloque | Descripción | Estado |
|--------|-------------|--------|
| 0 — Pre-código | Decisiones, fork, accesos | ⏸ Esperando Q1-Q5 |
| A — Setup local | Clone + env + first run | Pendiente |
| B — Schema vertical | Modelos Prisma + DDL | Pendiente |
| C — UI vertical básica | Developments, Units, Map, Champions | Pendiente |
| D — Sync Zoho F1 | Import desde Zoho | Pendiente |
| E — Hardening seguridad | REQ-S-01..09 (heredado spec Zoho v1.4) | Pendiente |
| F — Hosting + deploy | crm-base.propyte.com en Hostinger | Pendiente |
| G — F2 integración | Coexistencia operativa con Zoho | Pendiente |
| H — F3 cutover | Migración completa | Pendiente |

## Open questions críticas para arrancar (del spec §9)

- Q1 — Fork público o privado en `Propyte-Team/propyte-crm-base`
- Q2 — Misma instancia Supabase `oaijxdpevakashxshhvm` o nueva
- Q3 — Hostname (`crm-base.propyte.com` propuesto)
- Q4 — Login method (email+password, magic link, Google OAuth Workspace)
- Q5 — Champions acceden al CRM o solo equipo interno

## Referencias

- Speckit: `specs/propyte-own-crm.md`
- Spec relacionado: `Next_Propyte_web/specs/web-forms-zoho-integration.md` v1.4 (forma como llegan los leads)
- Audit Twenty descartado: `~/Desktop/cyber-neo-report-twenty-crm-2026-05-12.md`
- Memoria proyecto: `project_propyte_own_crm.md` (a crear post-aprobación de Luis)
