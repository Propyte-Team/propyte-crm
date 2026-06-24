# Mapa de Journey (read-only) — Diseño (Fase 3 · sub-C.1)

**Fecha:** 2026-06-24
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (brainstorming con visual companion, 2026-06-24). Sub-proyecto C, fase 1 (read-only).
**Rama:** `feat/crm-journey-map` (worktree aislado desde `origin/main` `86e2444`).

## 1. Visión

Un **mapa visual read-only** del ciclo de vida automatizado: dibuja lo que YA existe (reglas
`AutomationRule` + cadencias `ActionPlan` + etapas de lifecycle) como un diagrama navegable, para que
Luis vea de un vistazo "qué pasa en cada etapa" y "qué le pasa a un grupo concreto". Es la fase 1 de C;
la edición en el lienzo es C.2 (sesión futura). Hoy la automatización solo se ve como listas en
/configuracion; falta la vista de journey.

## 2. Decisiones (cerradas en brainstorming)

1. **Dos vistas con switcher** (decisión de Luis: combinar A y B):
   - **General (A):** carriles por etapa de lifecycle (Suscriptor→…→Embajador) con las reglas/cadencias
     *generales* colocadas en su etapa. El panorama del embudo.
   - **Dirigida (B):** flujo (disparador→condición→acciones→efecto de etapa) de un **grupo/campaña**
     elegido. Responde "¿qué le pasa a un broker / a un lead de Empleo / a esta campaña?".
2. **Drill:** clic en una campaña (filtro) o en una etapa de la vista General → salta a la Dirigida de
   ese grupo. Toggle manual también.
3. **Read-only** en ambas (C.1). La edición sigue en el rule builder y el editor de cadencias (sub-B).
4. **Sin lib de grafo nueva** ni `@dnd-kit` (no hay drag en read-only).

## 3. Arquitectura — 3 piezas

### 3.1 Capa de derivación (núcleo, función pura)
`src/lib/journey/journey-map.ts` — funciones puras (sin React, sin BD) que reciben
`rules: RuleLite[]` + `plans: PlanLite[]` (+ `LIFECYCLE_ORDER` de constants) y devuelven un **modelo de
grafo** para render. Tipos de entrada mínimos (lo que el GET ya trae):
- `RuleLite = { id, name, isActive, triggerType, triggerConfig, conditions, actions }`
- `PlanLite = { id, name, isActive, steps: { actionType, delayMinutes }[] }`

#### 3.1.1 Vista General — `buildGeneralView(rules, plans)`
Asigna cada regla a una etapa de lifecycle por **heurística de etapa** (`ruleStage(rule)`):
1. Si `triggerType === "LIFECYCLE_CHANGE"` y `triggerConfig.toStage` ∈ LIFECYCLE_ORDER → esa etapa.
2. Si alguna acción es `SET_LIFECYCLE` con `config.toStage` ∈ LIFECYCLE_ORDER → esa etapa (la última gana
   si hay varias).
3. Si no → carril especial `"GENERAL"` (sin etapa).
Devuelve `{ lanes: { stage: LifecycleStage|"GENERAL", rules: RuleNode[], cadences: CadenceNode[] }[] }`.
Las cadencias se ubican en la etapa de la(s) regla(s) que las enrolan (`ENROLL_PLAN` con
`config.planId` === plan.id); una cadencia sin regla que la enrole va al carril `"GENERAL"`. El orden de
los carriles sigue `LIFECYCLE_ORDER` + `GENERAL` al final.

#### 3.1.2 Vista Dirigida — `buildTargetedView(rules, plans, filter)`
`filter = { campaign?: string; contactType?: string }`. Selecciona las reglas cuyas **condiciones**
referencian el filtro: recorre el árbol de condiciones (`conditions`, DSL `all/any/leaf`) buscando hojas
con `field === "adAttribution.campaignName"` (match `contains`/`eq` contra `filter.campaign`) o
`field === "contact.contactType"` (match `filter.contactType`). Para cada regla seleccionada arma un
**flujo lineal**: `triggerNode → conditionSummaryNode → actionNodes[] → stageEffectNode?`
(stageEffect = la etapa destino si hay `SET_LIFECYCLE`/`LIFECYCLE_CHANGE`). Acciones `ENROLL_PLAN`
expanden la cadencia (sus pasos) inline. Devuelve `{ flows: FlowNode[][] }` (una secuencia por regla).

#### 3.1.3 Catálogo de filtros — `extractCampaigns(rules)`
Recorre las condiciones de todas las reglas y junta los valores distintos de
`adAttribution.campaignName` (para poblar el dropdown de campañas) + los `contactType` referenciados.

### 3.2 Render (sin lib de grafo)
`src/components/journey/journey-map-view.tsx` (cliente):
- **Switcher** General↔Dirigida + **dropdown de filtro** (campañas de `extractCampaigns` + segmentos).
- **General:** columnas flex (una por carril), cada una con sus tarjetas de regla/cadencia; flechas de
  avance entre etapas con CSS (borde/›). Color de etapa = `LIFECYCLE_COLORS`.
- **Dirigida:** por cada flujo, una fila horizontal de nodos con conectores (CSS/SVG `→`); tipos de nodo
  con estilo distinto (disparador, condición, acción, cadencia, efecto de etapa).
- Clic en una etapa (General) o en una campaña → setea filtro + cambia a Dirigida.
- Estados: vacío ("sin reglas configuradas"), reglas inactivas atenuadas (badge "pausada").
- Composición con oficio, coherente con el rediseño B/N y el rule builder. Ver
  `feedback_ui_craft_no_admin_template`.

### 3.3 Página + datos
- Nueva ruta `src/app/(dashboard)/journey/page.tsx` (server component: RBAC ADMIN/DIRECTOR, monta la vista
  cliente). Link en sidebar (solo esos roles).
- **Reusa el GET `/api/admin/automation`** (ya devuelve `rules` + `plans`). La página/cliente hace fetch
  de ese endpoint y deriva el mapa con la función pura. **No se crea API nueva.**

## 4. Modelo de datos

**Sin cambios de schema. Sin migración. Sin gate de infra.** Todo se deriva de `AutomationRule` +
`ActionPlan` existentes.

## 5. Testing (TDD)

- **`journey-map.test.ts`** (foco): fixtures de rules/plans →
  - `ruleStage`: LIFECYCLE_CHANGE→etapa; SET_LIFECYCLE→etapa; sin nada→GENERAL.
  - `buildGeneralView`: carriles en orden de LIFECYCLE_ORDER+GENERAL; cadencia enrolada cae en la etapa
    de su regla; cadencia huérfana → GENERAL.
  - `buildTargetedView`: selecciona solo reglas cuyas condiciones referencian la campaña/contactType;
    expande ENROLL_PLAN con los pasos; arma el flujo trigger→…→stageEffect.
  - `extractCampaigns`: junta valores distintos de adAttribution.campaignName de un árbol de condiciones
    anidado (all/any).
- **NO** E2E Playwright salvo que Luis lo pida.

## 6. Alcance v1 (YAGNI)

- **SÍ:** capa de derivación pura + vista General + vista Dirigida + switcher + filtro + drill + página
  /journey + link sidebar.
- **NO:** edición en el lienzo (C.2), métricas/conteos por nodo (sub-F), lib de grafo, drag&drop, export.

## 7. Riesgos / lecciones aplicadas

- **Heurística de etapa es aproximada:** una regla sin SET_LIFECYCLE/LIFECYCLE_CHANGE cae en "GENERAL"
  aunque conceptualmente actúe en una etapa. Es aceptable en v1 (read-only, orientativo); documentado.
  Si Luis quiere más precisión luego, se puede permitir etiquetar la etapa de una regla (C.2).
- **Reuso del DSL de condiciones:** el recorrido del árbol de condiciones (para Dirigida y
  extractCampaigns) reusa la forma del `ConditionNode` (`all`/`any`/leaf) ya definida; no re-parsear a mano
  divergente. Ver `feedback_db_enum_vs_zod_enum` (consistencia de formas).
- **Worktree compartido / autoría / merge:** worktree aislado, autoría `Propyte-Luis`, ff-merge a main solo
  con OK de Luis. Ver `feedback_propyte_hub_shared_worktree`.
