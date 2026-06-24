# Canvas de Journey con React Flow + Layout Persistente — Diseño (Fase 3 · sub-C.2 · incremento i1)

**Fecha:** 2026-06-24
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (brainstorming 2026-06-24). C.2 incremento 1 de 3.
**Rama:** `feat/crm-journey-canvas` (worktree aislado desde `origin/main` `c0c82cf`).

## 1. Visión

Convertir el mapa de journey (C.1, render custom read-only) en un **lienzo de nodos real** con
**React Flow**: nodos movibles, zoom/pan, y **posiciones persistentes** (se recuerda el acomodo entre
sesiones). Sigue **read-only en lógica** (no edita reglas todavía — eso es i2). Este incremento valida
el stack (React Flow + shape {nodes,edges} + tabla de layout) con bajo riesgo, antes de la edición.

## 2. Decisiones (cerradas en brainstorming)

1. **Arquitectura híbrida:** el motor (`AutomationRule`+`ActionPlan`) es la **fuente de verdad**; se agrega
   una tabla **ligera** solo para el layout del canvas (posiciones). Sin modelo paralelo ni compilador.
2. **React Flow** (`@xyflow/react`) para el lienzo (nueva dependencia, estándar de la industria).
3. **Incremental:** i1 = lienzo + layout persistente (read-only); i2 = edición/write-back; i3 = paleta+ramas.

## 3. Estado actual (lo que se reutiliza)

- C.1 ya tiene la capa de derivación pura `src/lib/journey/journey-map.ts`
  (`buildGeneralView`/`buildTargetedView`/`extractCampaigns` + tipos `RuleLite`/`PlanLite`/`GeneralView`/
  `TargetedView`/`FlowNode`) y la página `/journey` + `journey-map-view.tsx` (render custom con switcher
  General/Dirigida + filtro). i1 **reemplaza el render** por React Flow; la derivación se mantiene.
- GET `/api/admin/automation` provee `rules`+`plans` (ya incluye `conditions` tras el fix de C.1).

## 4. Arquitectura — 3 piezas

### 4.1 Adaptador derivación → React Flow (puro, testeable)
`src/lib/journey/flow-adapter.ts` — convierte las vistas derivadas a `{ nodes, edges }` de React Flow:
- `generalToFlow(view: GeneralView): { nodes: FlowRFNode[]; edges: FlowRFEdge[] }` — un nodo por
  regla/cadencia agrupado visualmente por carril; nodos de "etapa" como cabecera de cada carril, con
  aristas de avance entre etapas consecutivas.
- `targetedToFlow(view: TargetedView): { nodes, edges }` — por cada flujo, una cadena de nodos
  trigger→condición→acción…→stage con aristas secuenciales.
- **IDs estables** (clave para casar el layout guardado): `stage:<STAGE>`, `rule:<id>`, `plan:<id>` para
  General; `<ruleIndex>:<kind>:<i>` para Dirigida. Tipos `FlowRFNode = { id, type, position, data }`,
  `FlowRFEdge = { id, source, target }`.
- **Auto-layout por defecto:** posiciones calculadas determinísticamente (x por carril/orden, y por índice)
  cuando no hay layout guardado. Puro, sin librerías de auto-layout.

### 4.2 Persistencia de layout (tabla ligera + API)
- **Modelo Prisma nuevo `JourneyLayout`** (tabla `journey_layouts`, schema `propyte_crm`):
  ```prisma
  model JourneyLayout {
    id        String   @id            // scope key: "general" | "targeted:<CAMPAIGN>"
    positions Json     @default("{}") // { [nodeId]: { x: number, y: number } }
    updatedAt DateTime @updatedAt
    @@map("journey_layouts")
    @@schema("propyte_crm")
  }
  ```
  Solo guarda **posiciones por nodo** (no duplica nodos/aristas; esos se derivan). Una fila por "scope".
- **API `src/app/api/admin/journey/layout/route.ts`:** `GET ?scope=` → `{ positions }`;
  `PUT { scope, positions }` → upsert. RBAC ADMIN/DIRECTOR (igual que la página). Validación zod
  (`positions` = record de `{x:number,y:number}`).
- **Migración aditiva** `prisma/migrations-manual/2026-06-24-journey-layout.sql` (CREATE TABLE) →
  **gate de infra** (frase de Luis). Es 100% aditiva (tabla nueva, nada toca datos existentes).

### 4.3 UI con React Flow
- `npm i @xyflow/react` (dep nueva). `journey-map-view.tsx` se reescribe para usar `<ReactFlow>`:
  - Importa el CSS de React Flow (`@xyflow/react/dist/style.css`).
  - Nodos custom por tipo (stage / rule / cadence / trigger / condition / action) con estilo coherente al
    rediseño B/N y colores de etapa (`LIFECYCLE_COLORS`). `nodesDraggable`, `fitView`, Controls + minimapa.
  - **Read-only lógico:** `nodesConnectable={false}`, sin paleta de agregar; solo mover.
  - Switcher General/Dirigida + filtro de campaña se mantienen (toolbar arriba del lienzo).
  - **Persistencia:** al montar, fetch del layout del scope actual y aplicar posiciones (merge con
    auto-layout para nodos sin posición guardada). `onNodeDragStop` → guardar posiciones (debounce ~600ms,
    PUT). Cambiar de vista/scope → cargar el layout de ese scope.
  - Estados: cargando, vacío (sin reglas), reglas/cadencias inactivas atenuadas (igual que C.1).

## 5. Modelo de datos

**Una tabla nueva** (`journey_layouts`), aditiva, solo posiciones de UI. El motor no cambia. Sin tocar
columnas existentes. Migración preparada; **no se aplica sin la frase de Luis** (BD compartida con prod),
ver `feedback_autorizacion_explicita_infra`. Como es solo additive + tabla nueva, no rompe el código
desplegado actual.

## 6. Testing (TDD)

- **`flow-adapter.test.ts`** (foco): `generalToFlow` produce un nodo por regla/cadencia + nodos de etapa
  con IDs estables y aristas de avance; `targetedToFlow` produce la cadena por flujo; auto-layout asigna
  posiciones determinísticas; aplicar posiciones guardadas sobrescribe el auto-layout por nodo y deja el
  resto en auto.
- **API layout:** zod rechaza positions malformado; `PUT` hace upsert; `GET` devuelve `{}` si no existe;
  RBAC 403 no-admin.
- **NO** E2E Playwright salvo que Luis lo pida (React Flow es difícil de testear headless; la verificación
  visual la hace Luis tras deploy).

## 7. Alcance v1 (i1, YAGNI)

- **SÍ:** dep React Flow + adaptador derivación→flow + tabla/API de layout + lienzo movible con
  persistencia + switcher/filtro reusados. Read-only en lógica.
- **NO:** edición de nodos / write-back al motor (i2), paleta de agregar nodos (i3), ramas nuevas (i3),
  auto-layout avanzado (dagre/elk), métricas por nodo (sub-F).

## 8. Riesgos / lecciones aplicadas

- **React Flow + SSR:** es client-only → el componente del lienzo va `"use client"`; la página server
  solo hace RBAC y monta. El CSS se importa en el componente cliente.
- **IDs estables:** el casado layout↔nodo depende de IDs determinísticos de la derivación; si cambian, las
  posiciones guardadas quedan huérfanas (degradan a auto-layout, sin romper). Documentado.
- **Gate de infra:** tabla nueva en BD compartida → frase explícita de Luis antes de aplicar; SQL aditivo
  listo y verificado. Ver `feedback_autorizacion_explicita_infra` y `feedback_prisma_manual_sql_naming`
  (tabla snake plural `journey_layouts`, columnas camelCase, verificar nombres reales antes de aplicar).
- **Dep nueva:** `@xyflow/react` se instala en el worktree; verificar que el build de Hostinger la tome
  (queda en package.json + lock).
- **Worktree compartido / autoría / merge:** worktree aislado, autoría `Propyte-Luis`, ff-merge a main solo
  con OK de Luis. Ver `feedback_propyte_hub_shared_worktree`.
