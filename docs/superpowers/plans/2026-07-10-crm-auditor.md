# `crm-auditor` — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un skill on-demand `crm-auditor` que recorra `crm.propyte.com` como cada rol (usuarios de prueba), detecte faltantes/bugs/gaps y produzca un `AUDIT.md` fechado con tickets.

**Architecture:** Skill de Claude Code compuesto por `SKILL.md` (orquestación) + playbooks por rol + contrato de seguridad + provisioning + plantilla de tickets. Ejecuta con Playwright MCP (navegador, recorrido **secuencial** por rol) y `propyte-crm-mcp` (alta/baja de usuarios). Los flujos/valores reales se extraen del código en una fase de reconocimiento antes de escribir los playbooks (el spec prohíbe asumir).

**Tech Stack:** Markdown (skill files), Playwright MCP, `propyte-crm-mcp` (admin), `gh` CLI (prior-art), bash (validación estructural). App bajo prueba: Next.js 14 + Prisma.

**Spec:** `docs/superpowers/specs/2026-07-10-crm-auditor-design.md`

---

## Estructura de archivos

Todo bajo `.claude/skills/crm-auditor/`:

| Archivo | Responsabilidad |
|---|---|
| `SKILL.md` | Orquestación end-to-end + frontmatter (`name`, `description`). |
| `safety-contract.md` | Reglas duras de datos QA en prod (fuente única). |
| `provisioning.md` | Alta/baja usuarios efímeros + reuso ADMIN temporal. |
| `ticket-template.md` | Esquema de ticket + plantilla `AUDIT.md`. |
| `playbooks/asesor.md` | Guión del asesor (prioridad) + dimensión tipo de contacto. |
| `playbooks/sistemas-qa.md` | Transversal: permisos, journey, automatizaciones, mejoras. |
| `playbooks/gerente.md` | Gerente / Team Leader. |
| `playbooks/director.md` | Director. |
| `playbooks/marketing-admin.md` | Marketing / Admin. |
| `references/recon-notes.md` | Hechos reales extraídos del código (rutas, roles, tipos, tags, provisioning, automatizaciones). Fuente de verdad que los playbooks citan. |

Reportes (generados en runtime, no en el build): `docs/audit-YYYY-MM-DD/AUDIT.md` + `screenshots/`.

---

## Task 0: Worktree aislado + rama

**Files:** (ninguno; setup de git)

- [ ] **Step 1: Crear worktree aislado desde origin/main**

El checkout de `propyte-crm` es compartido con sesiones paralelas (hoy en `feat/whatsapp-multicuenta`). NO trabajar en el checkout principal. Usar `superpowers:using-git-worktrees` o, como fallback nativo:

```bash
cd /c/Users/Luis/Projects/Propyte/propyte-crm
git fetch origin
git worktree add -b feat/crm-auditor ../propyte-crm-auditor origin/main
cd ../propyte-crm-auditor
git rev-parse --abbrev-ref HEAD   # -> feat/crm-auditor
```

- [ ] **Step 2: Copiar spec y plan al worktree (si no vienen de origin/main)**

El spec y este plan se escribieron sobre el checkout compartido sin commitear. Copiarlos al worktree para que viajen con la rama:

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp /c/Users/Luis/Projects/Propyte/propyte-crm/docs/superpowers/specs/2026-07-10-crm-auditor-design.md docs/superpowers/specs/
cp /c/Users/Luis/Projects/Propyte/propyte-crm/docs/superpowers/plans/2026-07-10-crm-auditor.md docs/superpowers/plans/
```

- [ ] **Step 3: Commit inicial**

```bash
git add docs/superpowers/specs/2026-07-10-crm-auditor-design.md docs/superpowers/plans/2026-07-10-crm-auditor.md
git commit -m "docs(crm-auditor): spec + plan de implementacion"
```

---

## Task 1: Reconocimiento del CRM → `references/recon-notes.md`

Extraer del código los hechos reales que el spec prohíbe asumir. **Sin este paso los playbooks quedan inventados.**

**Files:**
- Create: `.claude/skills/crm-auditor/references/recon-notes.md`

- [ ] **Step 1: Rutas y navegación**

```bash
# Rutas del App Router
find src/app -type d -name '(*)' -o -name 'page.tsx' | head -50
ls -R src/app | head -80
```
Anotar en recon-notes: rutas reales (dashboard, inbox, kanban/deals, contactos, cotizador, meta-leads, settings, admin, reportes).

- [ ] **Step 2: Roles y gating**

```bash
grep -rn "role" src/components/*sidebar* src/components/**/sidebar* 2>/dev/null | head
grep -rn "ASESOR\|GERENTE\|DIRECTOR\|TEAM_LEADER\|MARKETING\|ADMIN" src/lib src/components src/app | head -40
```
Anotar: enum real de `role`, y qué rutas/menús ve cada rol (para el negative testing de permisos).

- [ ] **Step 3: Tipo de contacto + orígenes/Lead Source**

```bash
grep -rn "tipo_contacto\|tipoContacto\|contactType" src prisma | head
grep -rn "Lead_Source\|leadSource\|origen\|source" src/lib src/server prisma/schema.prisma | head -30
```
Anotar: valores reales de tipo de contacto y catálogo de orígenes (Meta/TikTok/web/orgánico).

- [ ] **Step 4: Feature de tags/etiquetas (para el marcador QA)**

```bash
grep -rni "tag\|etiqueta\|label" prisma/schema.prisma src/server src/components | grep -vi "labelledby\|aria-label" | head -30
```
Anotar: SI existe modelo/campo de tags → usar tag `QA_AUDIT`. SI NO → registrar como hallazgo y usar el fallback (prefijo nombre `QA-` + fuente dedicada). Documentar el mecanismo elegido.

- [ ] **Step 5: Provisioning de usuarios + ADMIN temporal**

```bash
ls scripts | grep -i "seed\|user"
grep -rn "propyte_crm.users\|prisma.user\|createUser" src/server scripts | head
# Estado del ADMIN temporal:
grep -rn "audit-temp\|qa-\|@propyte.local" scripts prisma | head
```
Anotar: mecanismo real de alta/baja (¿`propyte-crm-mcp` config tools? ¿seed script?), columnas NOT NULL requeridas al insertar user (`id,email,name,role,plaza,passwordHash,updatedAt`), y el usuario ADMIN temporal existente a reusar.

- [ ] **Step 6: Automatizaciones observables**

```bash
grep -rn "AutomationRule\|ActionQueue\|cadencia\|SlaTimer\|routing" src/lib/workflows prisma/schema.prisma | head -30
ls src/app/api/cron 2>/dev/null
```
Anotar: cómo se dispara/observa un workflow/cadencia/SLA en vivo (qué tabla o UI muestra que se ejecutó).

- [ ] **Step 7: Prior-art scan**

```bash
gh issue list --repo Propyte-Team/propyte-crm --limit 100 --state all 2>/dev/null || echo "verificar nombre real del repo con: gh repo list"
ls docs/audit-* 2>/dev/null && echo "--- auditorias previas ---" && cat docs/audit-*/AUDIT.md 2>/dev/null | grep -i "^###\|title\|bug" | head -40
```
Anotar en recon-notes: lista de issues abiertos + hallazgos de auditorías previas, para dedupe.

- [ ] **Step 8: Escribir `recon-notes.md` consolidado y commit**

Estructura obligatoria del archivo (secciones con los valores reales, NO placeholders):
```markdown
# recon-notes — hechos reales del CRM (fecha)
## 1. Rutas por sección
## 2. Roles (enum) y gating por rol
## 3. Tipos de contacto y catálogo de orígenes
## 4. Mecanismo de tags (o fallback elegido)
## 5. Provisioning de usuarios (+ ADMIN temporal)
## 6. Automatizaciones observables
## 7. Prior-art (issues + auditorías previas)
```

```bash
git add .claude/skills/crm-auditor/references/recon-notes.md
git commit -m "docs(crm-auditor): recon-notes con hechos reales del CRM"
```

---

## Task 2: `safety-contract.md`

**Files:**
- Create: `.claude/skills/crm-auditor/safety-contract.md`

- [ ] **Step 1: Escribir el contrato (contenido concreto)**

Debe contener exactamente estas reglas, pobladas con el mecanismo real de recon-notes §4 y las convenciones QA:

```markdown
# Contrato de seguridad de datos QA — PRODUCCIÓN

## Marcador de datos QA
- Tag `QA_AUDIT` (mecanismo real: ver recon-notes §4). Si no hay tags → fallback:
  prefijo de nombre `QA-<rol>-<YYYYMMDD-HHMM>` + Lead Source dedicada.
- TODO registro QA debe ser identificable por al menos 2 señales.

## Datos de contacto QA
- Email: `qa+<rol>@propyte.com` (u otro del equipo interno).
- Teléfono: <teléfono de prueba interno del equipo>.
- Cualquier WhatsApp/email real cae en el equipo, NUNCA en clientes reales.

## Reglas duras
1. Datos reales = SOLO LECTURA. Jamás modificar/borrar leads/deals/contactos reales.
2. Solo se mutan registros marcados QA.
3. Sin acciones irreversibles de negocio (no campañas, no tocar conectores con creds reales salvo lectura).
4. Teardown obligatorio: borrar todo lo QA. Si algo no se pudo borrar → reportarlo explícito en AUDIT.md (nunca silenciar el fallo de cleanup).
5. En Windows: nunca matar node.exe masivo (regla conocida).

## Checklist de teardown
- [ ] Leads QA borrados
- [ ] Deals/cotizaciones QA borradas
- [ ] Mensajes QA borrados
- [ ] Usuarios efímeros borrados / ADMIN temporal restaurado
- [ ] Residuo reportado si lo hay
```

- [ ] **Step 2: Verificar y commit**

```bash
test -f .claude/skills/crm-auditor/safety-contract.md && grep -q "SOLO LECTURA" .claude/skills/crm-auditor/safety-contract.md && echo OK
git add .claude/skills/crm-auditor/safety-contract.md
git commit -m "feat(crm-auditor): contrato de seguridad de datos QA"
```

---

## Task 3: `provisioning.md`

**Files:**
- Create: `.claude/skills/crm-auditor/provisioning.md`

- [ ] **Step 1: Escribir el procedimiento (usando recon-notes §5)**

Contenido concreto:
```markdown
# Provisioning de usuarios de prueba

## Alta (por rol)
- Usuario: `qa-<rol>@propyte.local`, rol correspondiente, plaza TULUM (o la que exija NOT NULL).
- Mecanismo: <MCP admin propyte-crm | seed script> (ver recon-notes §5).
- Columnas NOT NULL al insertar: id, email, name, role, plaza, passwordHash, updatedAt.
- Clave de sesión efímera (no se commitea, no va al AUDIT.md).

## ADMIN
- Reusar el usuario temporal existente <email real de recon-notes §5>.
- Cambiar su clave a valor de sesión; restaurar/inhabilitar al cerrar.
- No crear ADMIN nuevo (bloqueado por el clasificador de seguridad).

## Baja (teardown)
- Borrar todos los `qa-*@propyte.local` creados en esta corrida.
- Restaurar estado del ADMIN temporal.
- Verificar en BD que no quedó residuo; si quedó, listarlo.
```

- [ ] **Step 2: Verificar y commit**

```bash
test -f .claude/skills/crm-auditor/provisioning.md && echo OK
git add .claude/skills/crm-auditor/provisioning.md
git commit -m "feat(crm-auditor): procedimiento de provisioning de usuarios"
```

---

## Task 4: `ticket-template.md`

**Files:**
- Create: `.claude/skills/crm-auditor/ticket-template.md`

- [ ] **Step 1: Escribir plantilla (esquema del spec §8.1)**

```markdown
# Plantilla de ticket y AUDIT.md

## Ticket
### [SEVERIDAD] Título corto
- ID:        AUD-YYYYMMDD-NN
- Rol:       Asesor | Gerente | Director | Marketing/Admin | Sistemas
- Flujo:     ej. Contacto → Enviar WhatsApp
- Tipo cto:  (si aplica) Lead Meta | Prospecto | Broker | ...
- Categoría: bug | missing-feature | ux | permiso-gap | automation-gap | mejora
- Severidad: crítica | alta | media | baja
- Pasos:     1... 2... 3...
- Esperado:  ...
- Actual:    ...
- Evidencia: screenshots/AUD-YYYYMMDD-NN.png
- Prior-art: issue GitHub #NN | AUDIT previo | nuevo
- Estado:    abierto

## Encabezado del AUDIT.md
# Auditoría CRM — YYYY-MM-DD
- Entorno: crm.propyte.com (prod)
- Roles corridos: ...
- Resumen: N tickets (críticas X / altas Y / medias Z / bajas W)
- Residuo QA: ninguno | <detalle>

## Tabla resumen (tickets por rol y severidad), luego los tickets en detalle.
```

- [ ] **Step 2: Verificar y commit**

```bash
test -f .claude/skills/crm-auditor/ticket-template.md && echo OK
git add .claude/skills/crm-auditor/ticket-template.md
git commit -m "feat(crm-auditor): plantilla de tickets y AUDIT.md"
```

---

## Task 5: `SKILL.md` (orquestación)

**Files:**
- Create: `.claude/skills/crm-auditor/SKILL.md`

- [ ] **Step 1: Escribir SKILL.md con frontmatter y flujo (spec §9)**

```markdown
---
name: crm-auditor
description: Use when Luis wants to audit the real Propyte CRM (crm.propyte.com) as different roles, exercising flows end-to-end to find missing features, bugs, permission gaps and automation gaps, and produce a dated AUDIT.md with tickets. Invoke on demand.
---

# crm-auditor

Auditor on-demand de la app real. Recorre crm.propyte.com como cada rol y reporta hallazgos.

## Antes de correr (OBLIGATORIO)
1. Confirmar perfil PROPYTE y que el entorno objetivo es crm.propyte.com (prod).
2. Leer `safety-contract.md` COMPLETO. Es producción con leads reales.
3. Leer `references/recon-notes.md` (rutas/roles/tipos/automatizaciones reales).
4. Preguntar a Luis qué roles correr (default: Asesor + Sistemas/QA).

## Flujo
0. Prep: prior-art scan (recon-notes §7 + `gh issue list`) + provisionar usuarios (`provisioning.md`).
1. Por cada rol (SECUENCIAL — un login/logout por rol, nunca en paralelo sobre el mismo navegador Playwright):
   - Login con el usuario del rol.
   - Ejecutar `playbooks/<rol>.md` con Playwright, incluyendo la dimensión tipo de contacto.
   - Usar SOLO datos QA (safety-contract). Capturar screenshots en docs/audit-<fecha>/screenshots/.
   - Recolectar hallazgos estructurados (formato `ticket-template.md`).
   - Logout.
2. Síntesis: dedupe intra/inter-rol y vs prior-art → escribir docs/audit-<fecha>/AUDIT.md.
3. Teardown (safety-contract checklist): borrar datos QA + usuarios; verificar; reportar residuo.
4. Resumen a Luis: conteo por severidad/rol + ruta del doc.

## Reglas de robustez
- Login/gating inesperado → registrar como hallazgo, marcar rol "parcial", NO abortar la corrida.
- Playwright colgado/lock de perfil → documentar punto de fallo, cerrar navegador limpio, continuar. Nunca matar node.exe masivo.
- El agente REPORTA, no arregla bugs.

## Subagentes
Opcional: un subagente Sonnet por rol (dirigido por Opus), pero SERIALIZADOS sobre el navegador Playwright (instancia única).
```

- [ ] **Step 2: Verificar frontmatter y commit**

```bash
head -5 .claude/skills/crm-auditor/SKILL.md | grep -q "name: crm-auditor" && echo OK
git add .claude/skills/crm-auditor/SKILL.md
git commit -m "feat(crm-auditor): SKILL.md orquestacion"
```

---

## Task 6: `playbooks/asesor.md` (prioridad)

**Files:**
- Create: `.claude/skills/crm-auditor/playbooks/asesor.md`

- [ ] **Step 1: Escribir el playbook del asesor**

Estructura obligatoria; las rutas/valores en `<...>` se toman de `recon-notes.md` (§1, §3) — no inventar:

```markdown
# Playbook — Asesor inmobiliario

## Persona
Asesor de ventas. Ve solo sus leads/deals. Objetivo: atender el lead con la mejor info según su origen y tipo.

## Precondición
Login como `qa-asesor@propyte.local`. Datos QA por safety-contract.

## Dimensión tipo de contacto (repetir el journey por cada tipo de recon-notes §3)
- Lead nuevo por origen: Meta Lead Ads / TikTok / formulario web / orgánico-manual.
- Prospecto (lead trabajado/convertido).
- Contacto existente.
- Broker / Inmobiliaria.

## Journey (por cada tipo aplicable)
1. Dashboard: ¿aparece el lead nuevo? Ruta: <ruta>. Éxito: el lead QA es visible y filtrable.
2. Identificar origen: abrir el lead. Éxito: el sistema muestra claramente de dónde proviene
   (campaña/fuente) y adapta la info mostrada al origen. Hallazgo si el origen no es evidente.
3. Dossier del contacto: Éxito: historial/atributos suficientes para atender. Hallazgo si falta contexto.
4. Registrar actividad (nota/tarea): Éxito: se guarda y aparece en el historial.
5. Enviar mensaje/WhatsApp (inbox, takeover): Ruta: <ruta inbox>. Éxito: se puede componer y (según
   política) enviar a los datos QA del equipo. Hallazgo si el takeover/compose falla.
6. Mover deal en el kanban: Éxito: el cambio de etapa persiste tras recarga.
7. Cotizar: Ruta: <ruta cotizador>. Éxito: genera cotización asociada al deal QA.
8. Agendar reunión/tarea: Éxito: queda agendada y visible.
9. Automatizaciones: verificar (recon-notes §6) que cadencia/SLA del lead QA se dispara.

## Criterio de hallazgo
Cualquier paso que: no exista, falle, dé info incorrecta según origen/tipo, o carezca de un paso
esperado del proceso de venta. Clasificar (bug/missing-feature/ux/permiso-gap/automation-gap/mejora).
```

- [ ] **Step 2: Verificar referencias y commit**

```bash
test -f .claude/skills/crm-auditor/playbooks/asesor.md && echo OK
git add .claude/skills/crm-auditor/playbooks/asesor.md
git commit -m "feat(crm-auditor): playbook asesor (prioridad + tipo de contacto)"
```

---

## Task 7: `playbooks/sistemas-qa.md` (transversal)

**Files:**
- Create: `.claude/skills/crm-auditor/playbooks/sistemas-qa.md`

- [ ] **Step 1: Escribir el playbook transversal**

```markdown
# Playbook — Sistemas / QA (transversal)

## Persona
Auditor de sistema. Revisa permisos, journey global, automatizaciones y mejoras.

## 1. Matriz de permisos (negative testing)
Por cada rol de recon-notes §2, intentar acceder a rutas que NO le corresponden.
Éxito: la app bloquea (redirect/403/menu oculto). Hallazgo (permiso-gap) si un rol ve/hace de más o de menos.
Ejemplos: Asesor intentando /admin, /settings de sistema, datos de otros asesores.

## 2. Journey completo lead→cierre
Seguir un lead QA desde intake hasta deal cerrado, cruzando roles. Éxito: cada handoff (asignación,
seguimiento, cotización, cierre) tiene su paso en la UI. Hallazgo si hay hueco en la cadena.

## 3. Automatizaciones (recon-notes §6)
Por cada workflow/cadencia/SLA/routing: disparar la condición con datos QA y verificar el efecto.
Éxito: la acción se ejecuta y es observable. Hallazgo (automation-gap) si no dispara o dispara mal.
Anotar además MEJORAS posibles (categoría `mejora`).

## 4. Consistencia de estados
Verificar que los estados de lead/deal sean coherentes entre listados, kanban y detalle.

## Criterio de hallazgo
Igual que los demás playbooks; enfatizar permiso-gap, automation-gap y mejora.
```

- [ ] **Step 2: Verificar y commit**

```bash
test -f .claude/skills/crm-auditor/playbooks/sistemas-qa.md && echo OK
git add .claude/skills/crm-auditor/playbooks/sistemas-qa.md
git commit -m "feat(crm-auditor): playbook sistemas/QA transversal"
```

---

## Task 8: `playbooks/{gerente,director,marketing-admin}.md`

**Files:**
- Create: `.claude/skills/crm-auditor/playbooks/gerente.md`
- Create: `.claude/skills/crm-auditor/playbooks/director.md`
- Create: `.claude/skills/crm-auditor/playbooks/marketing-admin.md`

- [ ] **Step 1: gerente.md**

```markdown
# Playbook — Gerente / Team Leader
## Persona: supervisa asesores y distribución de leads.
## Precondición: login `qa-gerente@propyte.local`.
## Journey
1. Ruteo/asignación de leads (routing rules, territorios) — recon-notes §6. Éxito: puede asignar/reasignar un lead QA.
2. Reasignación entre asesores. Éxito: el lead QA cambia de dueño y persiste.
3. Vistas de desempeño de asesores. Éxito: métricas por asesor visibles y coherentes.
## Criterio de hallazgo: igual que asesor; enfatizar ruteo y visibilidad de equipo.
```

- [ ] **Step 2: director.md**

```markdown
# Playbook — Director
## Persona: acceso total, decisiones de negocio.
## Precondición: login ADMIN temporal (provisioning.md) o `qa-director@propyte.local`.
## Journey
1. Reportes/KPIs y embudos. Éxito: cargan con datos coherentes.
2. Acceso total: verificar que ve todas las secciones sin bloqueo.
3. Config de negocio. Éxito: puede ver/editar configuración global.
## Criterio de hallazgo: igual; enfatizar reportes y acceso.
```

- [ ] **Step 3: marketing-admin.md**

```markdown
# Playbook — Marketing / Admin
## Persona: conectores, meta-leads, config de sistema.
## Precondición: login `qa-marketing@propyte.local` o ADMIN temporal según recon-notes §2.
## Journey
1. Conectores Meta/TikTok (SOLO LECTURA de credenciales — safety-contract). Éxito: UI de conectores funciona.
2. Meta-leads: matching/discrepancias. Éxito: la vista carga y clasifica.
3. Campos custom/gobernanza + plantillas. Éxito: se pueden ver/crear (con datos QA).
4. Integraciones/API keys. Éxito: flujo de generación de key funciona (revocar la QA al final).
## Criterio de hallazgo: igual; enfatizar integraciones y gobernanza de datos.
```

- [ ] **Step 4: Verificar y commit**

```bash
ls .claude/skills/crm-auditor/playbooks/ | grep -E "gerente|director|marketing-admin" | wc -l   # -> 3 (+2 previos)
git add .claude/skills/crm-auditor/playbooks/gerente.md .claude/skills/crm-auditor/playbooks/director.md .claude/skills/crm-auditor/playbooks/marketing-admin.md
git commit -m "feat(crm-auditor): playbooks gerente, director, marketing-admin"
```

---

## Task 9: Validación estructural

**Files:**
- Create: `.claude/skills/crm-auditor/validate.sh`

- [ ] **Step 1: Escribir validador (referencias resuelven + frontmatter)**

```bash
cat > .claude/skills/crm-auditor/validate.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
fail=0
# frontmatter
head -5 SKILL.md | grep -q "name: crm-auditor" || { echo "FALTA name en SKILL.md"; fail=1; }
# archivos referenciados por SKILL.md existen
for f in safety-contract.md provisioning.md ticket-template.md references/recon-notes.md \
         playbooks/asesor.md playbooks/sistemas-qa.md playbooks/gerente.md \
         playbooks/director.md playbooks/marketing-admin.md; do
  test -f "$f" || { echo "FALTA $f"; fail=1; }
done
# recon-notes no debe tener secciones vacías (placeholder scan)
grep -q "asumir\|TBD\|TODO\|<ruta>\|<...>" references/recon-notes.md && { echo "recon-notes tiene placeholders sin poblar"; fail=1; } || true
[ $fail -eq 0 ] && echo "VALIDATE OK" || { echo "VALIDATE FAIL"; exit 1; }
EOF
chmod +x .claude/skills/crm-auditor/validate.sh
```

- [ ] **Step 2: Correr el validador**

Run: `bash .claude/skills/crm-auditor/validate.sh`
Expected: `VALIDATE OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/crm-auditor/validate.sh
git commit -m "test(crm-auditor): validador estructural del skill"
```

---

## Task 10: Smoke run REAL contra prod (solo Asesor) — GATED

> ⚠️ Esta tarea ejecuta acciones en producción (crea/borra datos y usuarios QA). **Requiere confirmación explícita de Luis antes de correr.** No ejecutar autónomamente.

**Files:** genera `docs/audit-<fecha>/` (runtime)

- [ ] **Step 1: Confirmar con Luis**

Preguntar: "¿Corro el smoke del skill contra crm.propyte.com como Asesor? Creará un usuario efímero y ~1 lead QA por tipo, y los borrará al final." Esperar sí explícito.

- [ ] **Step 2: Provisionar 1 usuario Asesor QA**

Seguir `provisioning.md`. Verificar login manual en el navegador Playwright antes de seguir.

- [ ] **Step 3: Ejecutar playbook Asesor con 1 tipo de contacto**

Correr el journey de `playbooks/asesor.md` para UN tipo (lead Meta) con datos QA. Capturar 2-3 screenshots.
Expected: recorrido completo o hallazgos registrados en formato ticket.

- [ ] **Step 4: Escribir AUDIT.md de prueba + teardown**

Generar `docs/audit-<fecha>/AUDIT.md` con los hallazgos del smoke. Ejecutar el checklist de teardown de `safety-contract.md`. Verificar 0 residuo (o reportarlo).
Expected: AUDIT.md existe; teardown confirmado.

- [ ] **Step 5: Ajustar skill según lo aprendido y commit**

Corregir rutas/pasos que fallaron en el smoke (en recon-notes/playbooks). 

```bash
git add -A .claude/skills/crm-auditor
git commit -m "fix(crm-auditor): ajustes tras smoke run del asesor"
```

---

## Task 11: Finalizar

- [ ] **Step 1: Correr validador final**

Run: `bash .claude/skills/crm-auditor/validate.sh`
Expected: `VALIDATE OK`

- [ ] **Step 2: Push de la rama (Luis decide merge)**

```bash
git push -u origin feat/crm-auditor
```
No mergear a main sin OK de Luis. Merge sugerido (FF, sin checkout main): `git push origin feat/crm-auditor:main` tras su aprobación.

- [ ] **Step 3: Ofrecer la 1ª corrida completa**

Preguntar a Luis si quiere la auditoría completa (los 5 roles) ahora o después.

---

## Self-Review (cobertura del spec)

- Spec §2 roles → Tasks 6,7,8. ✅
- Spec §5.1 tipo de contacto → Task 6 (dimensión explícita). ✅
- Spec §6 contrato de seguridad → Task 2 + gate en Task 10. ✅
- Spec §7 provisioning + ADMIN temporal → Task 3. ✅
- Spec §8 tickets + prior-art → Task 4 + Task 1 Step 7. ✅
- Spec §9 flujo de ejecución → Task 5. ✅
- Spec §12 hechos a verificar → Task 1 (recon). ✅
- Restricción secuencial Playwright → Task 5 + Task 10. ✅
- Marcador QA = tag + fallback → Task 1 Step 4 + Task 2. ✅
