---
name: crm-auditor
description: Use when Luis wants to audit the real Propyte CRM (crm.propyte.com) as different roles (asesor, gerente, director, marketing, admin/sistemas), exercising flows end-to-end with QA-tagged test data to find missing features, bugs, permission gaps and automation gaps, and produce a dated AUDIT.md with tickets. Invoke on demand.
---

# crm-auditor

Auditor on-demand de la app real. Entra a `crm.propyte.com` como cada rol (usuarios de prueba), recorre los flujos de punta a punta y reporta hallazgos en un `AUDIT.md` fechado. **El agente REPORTA, no arregla.**

## Antes de correr (OBLIGATORIO)

1. Confirmar perfil PROPYTE y que el entorno es `crm.propyte.com` (prod).
2. Leer `safety-contract.md` COMPLETO. Es producción con leads reales.
3. Leer `references/recon-notes.md` (rutas, roles, tipos de contacto, orígenes, tags, provisioning y automatizaciones reales — con citas al código). **Es la fuente de verdad; si el código cambió, re-correr el recon primero.**
4. Preguntar a Luis qué roles correr. Default sugerido: **Asesor + Sistemas/QA** (valida el harness y da el mayor rendimiento).

## Contexto real del CRM (resumen; detalle en recon-notes)

- Next.js 14, App Router con grupo `(dashboard)` → URLs sin `/dashboard/` prefijo: `/dashboard`, `/contacts` (+`/[id]`), `/pipeline` (+`/[id]`), `/inbox`, `/cotizaciones`, `/reports`, `/settings`, `/configuracion`, `/admin`, `/conexiones`, `/journey`, `/duplicados`, `/walk-ins`, `/commissions`, `/cobranza`.
- **`/meta-leads` NO existe aquí** (se retiró al Hub). El equivalente de intake es `/conexiones` (conectores `LeadConnector`: META, TIKTOK, etc.).
- Roles (`UserRole`): canónicos `ADMIN, ASESOR, BROKER, MANTENIMIENTO` + legacy en uso `DIRECTOR, GERENTE, TEAM_LEADER, ASESOR_SR, ASESOR_JR, HOSTESS, MARKETING, DEVELOPER_EXT`.
- Marcador de datos QA = tag `QA_AUDIT` + prefijo de nombre (safety-contract).

## Flujo

0. **Prep:** prior-art scan (`gh issue list --repo Propyte-Team/propyte-crm` + recon-notes §7) → provisionar usuarios (`provisioning.md`: bootstrap ADMIN temporal, luego altas de rol vía UI Admin).
1. **Recorrido por rol (SECUENCIAL — un login/logout por rol; nunca en paralelo sobre el mismo navegador Playwright, es instancia única y da lock de perfil):**
   - Login con el usuario del rol.
   - Ejecutar `playbooks/{rol}.md` con Playwright, incluyendo la dimensión tipo de contacto donde aplique.
   - Usar SOLO datos QA (safety-contract). Capturar screenshots en `docs/audit-{fecha}/screenshots/`.
   - Recolectar hallazgos en el formato de `ticket-template.md`.
   - Logout.
2. **Síntesis:** deduplicar intra/inter-rol y contra prior-art (recon-notes §7 + `task_manager.md`) → escribir `docs/audit-{fecha}/AUDIT.md`.
3. **Teardown:** ejecutar el checklist de `safety-contract.md` (borrar datos QA + usuarios; devolver `audit-temp` a `isActive=false`); verificar; reportar residuo.
4. **Resumen a Luis:** conteo por severidad/rol + ruta del doc.

## Playbooks disponibles

- `playbooks/asesor.md` — prioridad; journey de venta + dimensión tipo de contacto + identificar origen.
- `playbooks/sistemas-qa.md` — transversal: matriz de permisos (negative testing), journey completo, automatizaciones, mejoras.
- `playbooks/gerente.md` — ruteo/asignación, desempeño de equipo.
- `playbooks/director.md` — reportes/KPIs, acceso total, config de negocio.
- `playbooks/marketing-admin.md` — conectores, integraciones/API keys, gobernanza (Marketing vs Admin usan logins distintos — ver el archivo).

## Reglas de robustez

- Login/gating inesperado → registrar como hallazgo (posible permiso-gap), marcar el rol "parcial", NO abortar la corrida.
- Playwright colgado / lock de perfil → documentar el punto de fallo, cerrar SOLO su navegador, continuar. Nunca matar `node.exe` masivo.
- Ante cualquier acción que escriba en prod, verificar contra `safety-contract.md` que sea dato QA.

## Subagentes (opcional)

Un subagente Sonnet por rol (dirigido por Opus), pero **serializados** sobre el navegador Playwright (instancia única). No lanzar dos recorridos de navegador en paralelo.
