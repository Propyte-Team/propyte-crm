# Spec — `crm-auditor`: agente auditor de la app real (Propyte CRM)

- **Fecha:** 2026-07-10
- **Autor:** Luis + Claude (brainstorming)
- **Estado:** propuesto (pendiente de aprobación de Luis)
- **Repo:** `propyte-crm` · rama de trabajo a definir (hoy el checkout está en `feat/whatsapp-multicuenta`)

---

## 1. Objetivo

Crear un **agente auditor on-demand** que entre a la app **real en producción** (`crm.propyte.com`), la use como lo haría cada **rol** (usuarios de prueba), recorra los flujos de punta a punta, detecte **faltantes de funcionalidad, bugs, gaps de permisos, huecos de automatización y mejoras**, y produzca un **doc markdown de auditoría fechado** con tickets accionables.

Finalidad de negocio: tener "usuarios prueba" que revisen cada paso del sistema de forma repetible, empezando por el **asesor inmobiliario** (procesos de contacto, mensajería, identificación del origen del lead, cotización).

## 2. Alcance

**Dentro:**
- Skill reutilizable `crm-auditor` que yo (Claude) invoco cuando Luis lo pida.
- Recorrido por rol: **Asesor, Gerente/Team Leader, Director, Marketing/Admin** + rol transversal **Sistemas/QA**.
- Dimensión adicional: pruebas **por tipo de contacto** (lead por origen, prospecto, contacto existente, broker/inmobiliaria).
- Reporte `AUDIT.md` fechado con tickets + evidencia (screenshots).
- Prior-art scan (GitHub Issues + auditorías previas) para no duplicar.
- Provisioning y limpieza de usuarios y datos de prueba.

**Fuera (YAGNI / futuro):**
- Scripts Playwright deterministas para regresión CI (Enfoque B) — extensión futura.
- Cron nocturno autónomo (Enfoque C) — extensión trivial una vez que exista el skill.
- Creación automática de Issues en GitHub (hoy el destino es el doc markdown; el GitHub sólo se **lee** para prior-art).
- Corrección de los bugs encontrados (el agente **reporta**, no arregla).

## 3. Enfoque elegido

**A — Skill + Playwright MCP, recorrido secuencial por rol, reporte markdown.**
Encaja con patrones ya usados en el proyecto (auditorías Playwright previas, subagentes Sonnet dirigidos por Opus, docs de auditoría, flujo superpowers).

**Restricción técnica clave:** el navegador de Playwright MCP es *stateful* y de instancia única. Los roles se recorren **secuencialmente** (un login/logout por rol) — nunca en paralelo sobre el mismo navegador. Esto además evita el *lock* de perfil de Chrome que ya rompió una sesión previa, y es **necesario** para validar de verdad el gating de permisos (cada rol necesita su propia sesión limpia).

## 4. Arquitectura

### 4.1 Ubicación
- Skill: `propyte-crm/.claude/skills/crm-auditor/` (versionado con la app; los playbooks evolucionan junto al CRM).
- Reportes: `propyte-crm/docs/audit-YYYY-MM-DD/AUDIT.md` + `screenshots/`.

### 4.2 Archivos del skill
| Archivo | Propósito |
|---|---|
| `SKILL.md` | Orquestación end-to-end: prep → recorrido por rol → síntesis → limpieza. Frontmatter con `name`, `description`. |
| `playbooks/asesor.md` | Guión del asesor inmobiliario (prioridad). |
| `playbooks/gerente.md` | Guión Gerente / Team Leader. |
| `playbooks/director.md` | Guión Director. |
| `playbooks/marketing-admin.md` | Guión Marketing / Admin. |
| `playbooks/sistemas-qa.md` | Guión transversal: permisos, journey completo, automatizaciones, mejoras. |
| `safety-contract.md` | Reglas duras de datos de prueba en prod (fuente única de verdad). |
| `provisioning.md` | Alta/baja de usuarios efímeros + reuso del ADMIN temporal. |
| `ticket-template.md` | Esquema del ticket + plantilla del `AUDIT.md`. |

### 4.3 Cada archivo, una responsabilidad
- Los **playbooks** describen QUÉ probar (journeys, pasos, criterio de "correcto") — sin lógica de orquestación.
- El **SKILL.md** describe CÓMO orquestar — sin detalles de flujos de negocio.
- El **safety-contract** es el único lugar donde viven las reglas de datos QA; playbooks y provisioning lo referencian, no lo repiten.

## 5. Playbooks por rol (journeys)

Cada playbook define: **persona**, **journey paso a paso**, **criterio de éxito por paso**, y **qué constituye un hallazgo** (bug / faltante / UX / permiso / automatización / mejora).

- **Asesor inmobiliario (prioridad):**
  ver lead nuevo → **identificar origen** (Meta / TikTok / web / orgánico) → abrir dossier del contacto → registrar actividad → **enviar mensaje / WhatsApp** (inbox, takeover) → mover deal en el kanban → **cotizar** → agendar reunión/tarea → confirmar que cadencias/SLA se disparan.
- **Gerente / Team Leader:** ruteo/asignación de leads (routing rules, territorios), reasignación, vistas de desempeño de asesores.
- **Director:** reportes/KPIs, embudos, acceso total, configuración de negocio.
- **Marketing / Admin:** conectores Meta/TikTok, meta-leads (matching/discrepancias), campos custom/gobernanza, plantillas, integraciones/API keys.
- **Sistemas / QA (transversal):** matriz de permisos por rol (*negative testing*: que un Asesor NO acceda a admin, etc.), journey completo lead→cierre, automatizaciones (workflows/cadencias/SLA/routing) + propuestas de mejora, consistencia de estados, gaps de funcionalidad global.

### 5.1 Dimensión: tipo de contacto
Transversal a los playbooks (sobre todo Asesor). El agente crea/usa leads QA de **cada tipo de contacto** y verifica que el flujo y la información que ofrece el sistema **se adapten** al tipo:
- Lead nuevo **por origen**: Meta Lead Ads, TikTok, formulario web, orgánico/manual.
- Prospecto (lead ya trabajado / convertido).
- Contacto existente.
- Broker / Inmobiliaria.

Objetivo explícito de Luis: comprobar que el sistema le dé al asesor **la mejor información según de dónde proviene el cliente** y su tipo.

> **Hechos a verificar en la fase de plan** (contra el código/app real, no asumir): valores reales de `tipo_contacto`, catálogo de orígenes/`Lead Source`, rutas exactas de cada flujo, y si existe una feature de *tags/etiquetas*.

## 6. Contrato de seguridad de datos QA (crítico — es producción)

Hay leads reales en el sistema. Reglas duras:

1. **Marcador de datos QA = etiqueta.** No existe hoy → el skill crea/usa un tag **`QA_AUDIT`**. Para identificación a prueba de balas se combina con:
   - Prefijo de nombre **`QA-<rol>-<timestamp>`**.
   - **Lead Source / fuente dedicada** cuando aplique.
   - Si el CRM no soporta tagging robusto, ese hallazgo se reporta como ticket y el marcador cae al prefijo de nombre + fuente dedicada (identificación garantizada de todos modos).
2. **Correos/teléfonos = del equipo interno** (p. ej. `qa+asesor@propyte.com`, teléfono de prueba interno). Cualquier WhatsApp/email real cae en el equipo, **nunca en clientes reales**.
3. **Datos reales = solo lectura.** El agente jamás modifica/borra leads, deals o contactos reales. Sólo muta registros marcados QA.
4. **Limpieza al final (teardown):** borra leads/deals/cotizaciones/mensajes QA + usuarios efímeros. Si algo no se pudo borrar, lo **reporta explícitamente** (nunca se traga el fallo del cleanup) para limpieza manual.
5. **Sin acciones irreversibles de negocio** fuera de datos QA (no enviar campañas, no tocar conectores en producción con credenciales reales salvo lectura).

## 7. Provisioning de usuarios

- El agente **crea usuarios efímeros** por rol: `qa-<rol>@propyte.local` con el rol correspondiente, vía `propyte-crm-mcp` (admin) o seed script del repo. Se borran en el teardown.
- **ADMIN:** reusa el **usuario temporal existente**; le cambia la clave a un valor de sesión y la restaura/inhabilita al cerrar.
- Nota conocida: crear ADMIN desde cero puede quedar bloqueado por el clasificador de seguridad — por eso se reusa el temporal.
- Credenciales de sesión: se pasan de forma efímera (no se commitean, no se guardan en el doc de auditoría).

## 8. Tickets + prior-art

### 8.1 Esquema del ticket (en `AUDIT.md`)
```
### [SEVERIDAD] Título corto
- ID:        AUD-YYYYMMDD-NN
- Rol:       Asesor | Gerente | Director | Marketing/Admin | Sistemas
- Flujo:     Contacto → Enviar WhatsApp
- Tipo cto:  (si aplica) Lead Meta | Prospecto | Broker | ...
- Categoría: bug | missing-feature | ux | permiso-gap | automation-gap | mejora
- Severidad: crítica | alta | media | baja
- Pasos:     1... 2... 3...
- Esperado:  ...
- Actual:    ...
- Evidencia: screenshots/AUD-YYYYMMDD-NN.png
- Prior-art: issue GitHub #NN | AUDIT previo | nuevo
- Estado:    abierto
```

### 8.2 Prior-art scan (antes de escribir)
- Revisa **Issues de GitHub** del repo `propyte-crm` (`gh issue list`).
- Revisa **auditorías previas** (`docs/audit-*`) y pendientes conocidos.
- Deduplica y cruza referencia para no repetir hallazgos ya registrados. (Esto cubre el requisito de Luis: "busca si ya hay algo creado en GitHub para irlo checando").

## 9. Flujo de ejecución del skill

0. **Prep:** confirmar perfil PROPYTE + entorno (prod) → leer `safety-contract.md` + playbooks seleccionados → **prior-art scan** → **provisionar** usuarios efímeros (+ reuso ADMIN temporal).
1. **Recorrido por rol (secuencial):** por cada rol seleccionado → login → ejecutar su playbook con Playwright (incluyendo la dimensión tipo de contacto) usando datos QA → capturar evidencia (screenshots) + hallazgos estructurados → logout.
2. **Síntesis:** deduplicar intra/inter-rol y vs prior-art → asignar IDs/severidad → escribir `docs/audit-YYYY-MM-DD/AUDIT.md`.
3. **Teardown:** borrar datos QA + usuarios efímeros → verificar limpieza → reportar residuo si lo hay.
4. **Resumen** a Luis: conteo de tickets por severidad/rol + ruta del doc.

## 10. Manejo de errores

- **Login falla / gating inesperado:** se registra como hallazgo (posible permiso-gap) y el rol se marca "parcial", no aborta toda la corrida.
- **Playwright se cuelga / lock de perfil:** el skill documenta el punto de fallo, cierra el navegador limpio y continúa; nunca mata `node.exe` masivo (regla conocida de Windows).
- **Cleanup parcial:** cualquier residuo QA se lista explícito en el `AUDIT.md` con instrucciones de borrado manual.

## 11. Criterios de éxito

- Corrida completa produce un `AUDIT.md` con tickets reproducibles y evidencia.
- Cero datos QA residuales en prod tras el teardown (o residuo reportado explícito).
- Cero modificaciones a datos reales.
- El playbook del Asesor cubre el journey completo incl. identificación de origen y tipo de contacto.
- Los hallazgos no duplican prior-art ya registrado.

## 12. Hechos a verificar en la fase de plan (no asumir)

1. Rutas reales de cada flujo del CRM (dashboard, inbox, kanban, cotizador, admin, meta-leads, settings).
2. Valores reales de `role` y el gating por rol en el sidebar/rutas.
3. Valores reales de `tipo_contacto` y catálogo de orígenes/`Lead Source`.
4. Si existe feature de **tags/etiquetas** (para el marcador `QA_AUDIT`) o hay que caer al fallback.
5. Mecanismo real de alta/baja de usuarios (MCP admin vs seed script) y estado del ADMIN temporal.
6. Cómo se dispara/observa una automatización (workflow/cadencia/SLA) para verificarla en vivo.
