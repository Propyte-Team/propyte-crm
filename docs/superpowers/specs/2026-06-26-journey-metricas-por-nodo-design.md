# Métricas por nodo en el canvas de Journey (Fase 3 sub-F) — Diseño

**Fecha:** 2026-06-26
**Sub-proyecto:** Fase 3 — F (métricas por nodo)
**Rama:** `feat/crm-journey-metrics` (worktree `.claude/worktrees/crm-journey-metrics`, desde `origin/main` `3555bf5`)
**Estado:** aprobado por Luis (brainstorming con visual companion)

## Problema

Tras construir el canvas de journey (i1-i3) y las ramas (sub-proyecto ramas), no hay forma de ver **cuántos contactos pasan por cada nodo** ni **cómo se reparten entre las ramas de una decisión**. Luis quiere leer, sobre el mismo canvas, el volumen por nodo y el % de reparto por rama, para evaluar qué caminos usa la gente.

## Alcance (confirmado)

- **Métricas:** A · **volumen por nodo** + B · **% de reparto por rama**. (NO conversión/resultado, NO heatmap — fuera de alcance.)
- **Ventana:** selector **7 / 30 / 90 / todo**, default 30 días.
- **Vista:** solo **Dirigida** (el árbol de UNA regla). General (lifecycle) queda fuera.
- **Datos:** derivados de `ActionQueue` (cada acción encolada = un contacto que tocó ese nodo). **Sin instrumentación nueva, sin migración, sin tocar el motor.**

## Fuente de datos

Cada acción que el motor encola deja una fila en `propyte_crm.action_queue` con `ruleId`, `entityId`, `createdAt` y `dedupeKey` con formato:

```
{ruleId}:{entityId}:{actionType}:{path}:{dayBucket}
```

`path` es la ruta del nodo del scheme de `walkNodes` (raíz numérica `"0"`,`"1"`; rama `"1.b0.0"`; else `"1.else.0"`). Como `ruleId`/`entityId` (UUID), `actionType` (enum) y `path` no contienen `:`, `split_part(dedupeKey, ':', 4)` recupera la ruta de forma fiable. `createdAt` da la ventana de tiempo.

**Limitación inherente (documentada):** los nodos **trigger**, **condition** y **decisión** y las **ramas sin acción** no encolan filas propias → su volumen se **infiere** de las acciones descendientes (ver helper). Una rama sin ninguna acción no es medible (volumen 0).

## Componentes

### 1. Endpoint de agregación

`GET /api/admin/journey/metrics?ruleId=<id>&window=<7|30|90|all>`
- RBAC **ADMIN/DIRECTOR** (mismo patrón que `/api/admin/journey/layout`).
- `window` → fecha de corte en JS: `all` ⇒ `null`; si no, `new Date(Date.now() - N*86400000)`.
- SQL (un solo agregado):
  ```sql
  select split_part("dedupeKey", ':', 4) as path, count(distinct "entityId")::int as n
  from propyte_crm.action_queue
  where "ruleId" = $1 and ($2::timestamptz is null or "createdAt" >= $2)
  group by 1
  ```
- Respuesta: `{ counts: { "0": 142, "1.b0.0": 96, "1.b1.0": 36, "1.else.0": 10 }, total: 142, window }`.
  `total` = `count(distinct entityId)` de todas las filas de la regla en la ventana (para el subtítulo "N contactos · ventana" y el volumen de trigger/condition).
- Valida `ruleId` (string) y `window` (enum) con zod; 400 si inválido, 403 sin rol.

### 2. Helper puro de cómputo

`src/lib/journey/node-metrics.ts` (PURO, sin React/BD, testeable):

```ts
interface RawMetrics { counts: Record<string, number>; total: number }
interface NodeMetrics {
  nodeVolumes: Record<string, number>;          // por nodeId del canvas (a0, a1, a1.b0.0, trigger, condition)
  branchSplits: Record<string, { count: number; pct: number }>; // por branchId
}
function computeNodeMetrics(draft: RuleDraft, raw: RawMetrics): NodeMetrics
```

Reglas de cómputo:
- **Mapeo ruta→nodeId:** la ruta del dedupeKey usa raíz numérica; el canvas usa raíz con prefijo `a`. Transformar prefijando `a` al primer segmento: `"1.b0.0"` → `"a1.b0.0"`, `"0"` → `"a0"`.
- **Nodo acción:** volumen = `counts[rutaExacta]` (0 si ausente).
- **Nodo decisión** (nodeId `aN`): volumen = `count(distinct entity)` de sus rutas descendientes. Como el endpoint ya devuelve distinct-por-ruta (no por-entidad-cross-ruta), se **aproxima** sumando los volúmenes de los primeros pasos de cada rama+else (documentado: un mismo contacto que tomó 2 ramas en distintos días cuenta en ambas). Implementación: recorrer el árbol del draft; para una decisión, sumar el volumen del **primer nodo** de cada rama y del else.
- **Trigger / condition:** volumen = `raw.total`.
- **% reparto por rama:** `branchSplits[branchId] = { count: volPrimerPasoDeLaRama, pct: round(count / sumaDeRamas * 100) }`. Si la rama no tiene pasos → `{count:0, pct:0}`. Denominador = suma de los `count` de todas las ramas+else de esa decisión (0 ⇒ pct 0, sin división por cero).

> Reusa la forma de `RuleDraft`/`NodeDraft`/`isDecisionDraft` de `rule-draft.ts`. No duplica la estructura del árbol.

### 3. Overlay en el canvas (vista Dirigida)

En `src/components/journey/journey-map-view.tsx`:
- Estado `metricsOn: boolean` (toggle "● Métricas") y `metricsWindow: '7'|'30'|'90'|'all'` (selector; default `'30'`).
- El toggle/selector solo aplican en **Dirigida** y cuando hay una **regla guardada** cargada (con `ruleId`; una regla nueva sin guardar no tiene métricas → toggle deshabilitado o sin efecto).
- Cuando `metricsOn` + regla guardada: `fetch('/api/admin/journey/metrics?ruleId&window')` → `computeNodeMetrics(draft, raw)`. Cambiar `metricsWindow` refetch.
- **Render:**
  - Badge de volumen por nodo: pasar `data.metricVolume` a cada RF node; el `DecisionNode` (y un pequeño wrapper para los nodos por defecto) lo muestra como píldora.
  - Aristas de rama: cuando `metricsOn`, el `label` combina nombre de rama + `pct% · count` con tinte suave (verde/ámbar/gris por índice de rama).
  - Subtítulo "N contactos · ventana" usando `raw.total`.
- `metricsOn` OFF → canvas idéntico a hoy (sin badges ni labels de métrica), para editar sin ruido.

## Pruebas

- **Unit `computeNodeMetrics`:** acción (conteo exacto), decisión (suma de primeros pasos de ramas+else), % por rama (incl. denominador 0 → pct 0), trigger/condition = total, mapeo ruta→nodeId (prefijo `a`), rama sin pasos = `{0,0}`.
- **Endpoint:** cálculo de corte por `window` (7/30/90 → fecha; all → null) + shape de respuesta + RBAC 403 + zod 400.
- **Sin migración** → sin gate de infra. Build + suite verdes. Smoke en vivo Playwright (toggle + selector + badges en una regla con historia, o verificación del endpoint si no hay datos). ff-push a main → auto-deploy.

## Fuera de alcance (futuro)

Métricas en General (contadores por etapa de lifecycle), conversión/resultado al cierre (métrica D), mapa de calor (C), export CSV, drill-down a la lista de contactos de un nodo.

## Notas de consistencia

- El mapeo ruta↔nodeId depende de que el scheme de `walkNodes` (raíz numérica) y el de `ruleToDraft`/`rebuildBranchIds` (raíz `aN`, hijos iguales) sigan alineados salvo el prefijo de raíz. Si cambia el scheme de rutas, actualizar el transform en `node-metrics.ts`. (Mismo "4 lugares de la verdad" del sub-proyecto ramas.)
