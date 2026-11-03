# 03 — Auditoría de `/journey` (lienzo del customer journey)

**Fecha:** 2026-11-03 · **Alcance:** solo lectura de código; no se levantó servidor ni se tocó BD.
**Tests:** `npx vitest run src/lib/journey src/components/journey src/app/api/admin/journey` → 7 archivos, 104 tests, todos en verde (solo cubren la capa pura `src/lib/journey/*` y helpers de API; **no hay tests del componente `journey-map-view.tsx`**). `tsc --noEmit` sin errores en journey/config.

---

## 1. Qué hace hoy `/journey` según el código

- **Acceso:** `src/app/(dashboard)/journey/page.tsx` — solo `ADMIN`/`DIRECTOR`; otros roles → `/hoy`. No está en el sidebar (`nav-config.ts` no lo lista): se llega por Configuración → tarjeta "Journey" (`config-center.tsx:78`), por el icono de rama de cada regla (`automation-section.tsx:220`) o por "Abrir en Journey" del builder (`workflow-builder.tsx:133`).
- **Datos:** un solo `GET /api/admin/automation` (reglas `AutomationRule`, cadencias `ActionPlan`, políticas SLA). Las reglas son la fuente de verdad; el lienzo **deriva** nodos a partir de ellas (`src/lib/journey/journey-map.ts` → `flow-adapter.ts`).
- **Modo General (solo lectura):** carriles por etapa de *lifecycle*; cada regla cae en un carril por heurística (`ruleStage`: trigger `LIFECYCLE_CHANGE` o acción `SET_LIFECYCLE`; si no, carril "General / Sin etapa"). Las cadencias se cuelgan de la regla que las enrola. Click en cadencia → deep-link a Configuración.
- **Modo Dirigida (lectura + edición):**
  - Lectura: filtra reglas cuya condición use `adAttribution.campaignName == <campaña elegida>` y dibuja trigger → condición → acciones → etapa.
  - Edición: "editar regla" / "+ Crear regla" carga un **draft** (`use-rule-draft.ts`) con la misma forma que `AutomationRule`; el lienzo se recalcula de ese draft (`draftToFlow`, auto-layout) y el **inspector lateral** (`rule-inspector-panel.tsx`, `decision-inspector.tsx`) edita trigger, condiciones, acciones, nodos de decisión (rombo) y ramas. Paleta `⊕` entre nodos (`insert-edge.tsx`, `node-palette.tsx`).
  - Guardar → `POST/PUT /api/admin/automation/rules` (misma API que el builder de Configuración).
  - Overlay **Métricas** (solo con regla guardada en edición): `GET /api/admin/journey/metrics?ruleId&window` agrega `action_queue` por `split_part(dedupeKey,':',4)` y pinta volumen por nodo y % por rama.
- **Qué guarda y dónde:**
  - Posiciones de nodos (solo lectura, al soltar un nodo, debounce 600 ms) → `PUT /api/admin/journey/layout` → tabla `propyte_crm.journey_layouts` (`id` = `"general"` | `"targeted:<campaña>"`, `positions` JSON).
  - Reglas → `automation_rules` vía la API de rules (con `auditLog`).
  - **No guarda** nada de cadencias ni SLA (solo deep-links a Configuración).

---

## 2. Diagnóstico — causas probables de "no funciona" (ordenadas)

| # | Causa | Evidencia | Cómo confirmar (1 paso) | Arreglo / tamaño |
|---|---|---|---|---|
| 1 | **El deep-link desde Configuración aterriza en "General" sin abrir nada.** `resolveRuleJourneyLink` solo devuelve `targeted` si la regla tiene una condición `adAttribution.campaignName`; cualquier otra regla (asignación por origen, tipo de contacto, SLA…) "degrada" a General y no se carga el draft. Peor: las reglas **con ramas** ya no se pueden editar en el form (`shouldGuardRule` → "Abrir en Journey"), así que el único editor posible las manda a una vista donde no pasa nada. | `journey-map-view.tsx:170-185`, `journey-map.ts:202-211`, `workflow-builder.tsx:125-137`, `automation-section.tsx:220` | Configuración → Automatización → icono de rama de una regla sin campaña → se ve General, nada seleccionado, sin mensaje. | **Quick win:** si hay `ruleId` válido, siempre `setMode("targeted")` + `load(r)` (la edición no necesita campaña; `campaign` solo afecta la lectura). Mostrar aviso si no existe la regla. |
| 2 | **Dirigida en lectura queda vacía.** Necesita una campaña y `extractCampaigns` solo recoge valores de `adAttribution.campaignName`. Si ninguna regla usa ese campo, el `<select>` solo tiene "— elige campaña —" y el lienzo no dibuja nada; no hay estado vacío. | `journey-map-view.tsx:195, 310-313`, `journey-map.ts:133-141` | Pestaña Dirigida → desplegar campaña: sin opciones; lienzo en blanco. | **Quick win:** empty state ("ninguna regla segmenta por campaña; elige una regla para editarla"). **Medio:** que Dirigida sea "por regla" (lista de reglas), con campaña/tipo de contacto como filtros opcionales. |
| 3 | **General parece una lista, no un journey.** Solo reglas con `LIFECYCLE_CHANGE`/`SET_LIFECYCLE` caen en un carril de etapa; el resto se apila en una sola columna "General / Sin etapa" sin aristas (las únicas aristas son entre cabeceras de etapa). Nodos tipo `rule` no tienen conexiones. | `journey-map.ts:58-69, 82-112`, `flow-adapter.ts:15-41` | General → todas las reglas bajo "General / Sin etapa". | **Medio:** extender la heurística a `STAGE_CHANGE`/`CHANGE_STAGE` (pipeline) y al `eventType` del trigger; dibujar regla → cadencia/etapa destino. **Rediseño** si se quiere un embudo real (ver §3). |
| 4 | **Inspector sin estilos.** Usa las clases `journey-inspector`, `label`, `inspector-actions`, `decision-branch`, que **no existen** en `globals.css` (solo `form-input` y `btn-secondary`). Resultado: títulos y campos pegados, botones ↑ ↓ Borrar sin separación, panel ilegible → "inusable". | `rule-inspector-panel.tsx:181,183,327,338`, `decision-inspector.tsx:19,28,43`; `grep "\.label" src/app/globals.css` → 0 resultados | DevTools sobre `aside.journey-inspector`: sin reglas CSS. | **Quick win:** definir esas 4 clases en `globals.css` (o sustituir por utilidades Tailwind `space-y-3 text-xs font-medium`). |
| 5 | **Altura mal calculada → scroll y controles cortados.** El lienzo usa `h-[calc(100vh-3.5rem)]`, pero el layout real es topbar `h-12` (3 rem) + `main` con `p-6` (48 px): sobran ~40 px. Los Controls (zoom), el MiniMap y el pie de ayuda quedan bajo el borde hasta hacer scroll. | `journey-map-view.tsx:290`, `src/app/(dashboard)/layout.tsx:16`, `topbar.tsx:275` | Abrir `/journey`: aparece scroll vertical en `main`. | **Quick win:** `h-[calc(100vh-6rem)]` o `-m-6 h-[calc(100vh-3rem)]`. |
| 6 | **"Crear regla" → "Datos inválidos" sin explicar.** `newRuleDraft()` nace con `name: ""` (API exige ≥ 3), trigger `EVENT` sin `eventType` y `CHANGE_STAGE` con `config: {}`. La API devuelve `{error:"Datos inválidos", details}` y el cliente solo muestra `error`. | `rule-draft.ts:379-392`, `rules/route.ts:11-21,28-31`, `use-rule-draft.ts:71-75` | Dirigida → "+ Crear regla" → "Guardar". | **Quick win:** mostrar `details.fieldErrors`, validar nombre en cliente, nacer con nombre "Nueva regla" y `isDirty`. **Medio:** un mini-asistente "nombre + disparador" antes de dibujar. |
| 7 | **El acomodo no se guarda (silencioso) si falta la tabla.** `journey_layouts` solo existe por migración **manual** (`prisma/migrations-manual/2026-06-24-journey-layout.sql`, "aplicar vía MCP Supabase con autorización"). Si no se aplicó: `GET` devuelve `{}` (hay `catch`), pero `PUT` da 500 y el cliente lo traga (`.catch(() => {})`). Síntoma: mueves nodos y al recargar vuelven. | `layout/route.ts:16,28`, `journey-map-view.tsx:230-233` | Mover un nodo → Network: `PUT /api/admin/journey/layout` 500; o `select 1 from propyte_crm.journey_layouts`. | Aplicar migración (verificar en prod). **Quick win:** toast "No se pudo guardar el acomodo". |
| 8 | **Carrera lectura ↔ edición.** El efecto de solo lectura (`fetch` del layout) no tiene flag de cancelación; si entras a editar antes de que resuelva, `setNodes` pisa el lienzo del draft: inspector en edición pero nodos de lectura. | `journey-map-view.tsx:191-204` (vs. el de métricas `135-148` que sí cancela) | Dirigida: elegir campaña e inmediatamente "editar regla" con red lenta. | **Quick win:** `let cancel=false; return () => { cancel = true }`. |
| 9 | **Métricas en 0 o invisibles.** Solo aparecen editando una regla **guardada**; dependen de filas en `action_queue` con `ruleId` (reglas inactivas o motor sin correr → todo 0). El `path` sale de `dedupeKey` (`engine.ts:179`), consistente. | `journey-map-view.tsx:135-148, 342-369`, `metrics/route.ts:17-27` | Dirigida → editar regla → "● Métricas". | **Medio:** métricas también en lectura (sin entrar a edición) y leyenda "sin datos en la ventana". |
| 10 | **Rombo de decisión con "caja" blanca.** `nodeStyle` no tiene rama para `decision`; aplica el estilo por defecto (borde, padding, fondo blanco) alrededor del rombo. | `journey-map-view.tsx:72-86` | Añadir una decisión: rombo dentro de un cuadro con borde. | **Quick win:** `if (type === "decision") return { opacity: dim, ...sel }`. |
| 11 | **Posiciones de Dirigida se desordenan.** IDs de lectura son `f<índiceRegla>:<kind>:<i>`; al crear/borrar/reordenar reglas, el layout guardado se aplica a nodos distintos. | `flow-adapter.ts:49` | Guardar acomodo, crear una regla con la misma campaña, recargar. | **Quick win:** usar `rule.id` en el ID (`f:<ruleId>:<kind>:<i>`). |
| 12 | **En edición los nodos "se mueven solos".** Cualquier cambio del draft recalcula el auto-layout; arrastrar en edición no persiste. Combinado con `fitView` solo al montar (no re-encuadra al cambiar de modo o cargar un draft), el usuario puede quedar mirando un área vacía. | `journey-map-view.tsx:207-225, 236-240, 381` | Editar un nodo tras arrastrarlo: vuelve a su sitio. | **Medio:** `useReactFlow().fitView()` tras cada rebuild; conservar posiciones por `nodeId` durante la sesión de edición. |
| 13 | **Tipos de nodo no registrados.** `rule`, `cadence`, `stage`, `trigger`, `condition`, `action` no están en `nodeTypes` (solo `decision`); React Flow usa el nodo default y avisa en consola. Funciona, pero con handles y tipografía genéricos. | `journey-map-view.tsx:70, 383` | Consola: "Node type … not found". | **Medio:** un `nodeTypes` propio por tipo (base de cualquier rediseño visual). |

**Nota de contexto:** gran parte de esta pantalla llegó en el commit `fcae8780` ("respaldo del WIP del 14-jul sin commitear… esta rama NO está lista para mergear"). Las causas 1, 4 y 5 son coherentes con ese origen: se integró sin pasar por QA visual.

**Lectura conjunta:** si Luis entra por el icono de rama (lo más natural), ve General con todo apilado (#1 + #3), sin controles visibles (#5); si va a Dirigida, el lienzo está vacío (#2); si logra editar, el panel está ilegible (#4) y guardar una regla nueva falla sin explicación (#6). Cualquiera de esas rutas se describe como "no funciona".

---

## 3. Auditoría UX

### 3.1 Jerga técnica expuesta (para gerencia es ruido)
- Enums crudos en selects: disparadores `EVENT · TIME · BEHAVIORAL · SLA_BREACH · SCORE_THRESHOLD…` (`rule-inspector-panel.tsx:193`) y acciones `SEND_WHATSAPP · AI_CALL_SUMMARY…` (`:288`), **cuando ya existen** `TRIGGER_CATALOG`/`NODE_CATALOG` con etiquetas amables (el builder de Configuración sí las usa).
- Etiquetas de desarrollador: "triggerConfig", "config", "Ver JSON", textareas JSON con "JSON inválido", "ID del plan" (hay que teclear un UUID para enrolar una cadencia), "Prioridad 1-1000", "Retraso (min)", `⚡ Nombre (lead.captured)`, campos de condición tipo `adAttribution.campaignName`.
- Panel SLA: "1er toque 15min · reintento 30min · huérfano 24h · prioridad 10 · default".
- Nombres de modo: "General" / "Dirigida" no explican nada; "Dirigida" ni siquiera dice que ahí se edita.
- Pie de ayuda con "escribe al motor", "⊕", "scope".

### 3.2 Fricción
- Para editar: Dirigida → desplegable "— editar regla —" (lista todas las reglas, aunque el filtro de campaña esté activo) → nodo → inspector. Tres pasos invisibles; el botón de la toolbar cambia de contenido según el estado.
- Sin estados vacíos ni mensajes de error contextuales; `window.confirm` nativo para guardar una regla activa; sin deshacer; sin "cerrar y volver a Configuración".
- No hay leyenda de colores/formas (azul = disparador, rombo = decisión, línea punteada = condición/cadencia).
- Las ramas se nombran y condicionan en el inspector, pero sus acciones "se editan seleccionando sus nodos en el lienzo": navegación cruzada que nadie descubre.
- Métricas escondidas tras el modo edición; ventana en "7d/30d/90d".
- Dos editores para el mismo objeto (`WorkflowBuilder` plano y el lienzo) con reglas distintas de qué puede editar cada uno; el guard de ramas obliga a saltar de uno a otro.

### 3.3 Qué le falta para que gerencia lo entienda
1. Un **título y propósito** claros ("Qué pasa con un lead cuando entra") y una leyenda.
2. Un **resumen en lenguaje natural** de la regla seleccionada ("Cuando entra un lead de Meta, si la campaña es X: asigna a Karla y manda WhatsApp de bienvenida").
3. Nombres amables en todos los selects (reusar `TRIGGER_CATALOG`/`NODE_CATALOG`), selector de cadencia por nombre, selector de campaña/origen por catálogo.
4. Estados vacíos accionables y errores legibles (qué campo falta).
5. Métricas en lectura (volumen por nodo y % por rama) sin entrar a editar; esa es la parte que de verdad aporta a dirección.

### 3.4 Relación con el editor de reglas de Configuración — recomendación

**Recomendación: un solo editor (el de Configuración) y `/journey` como vista de solo lectura con métricas; el lienzo editable queda como "vista avanzada" embebida en Configuración solo para ramas.**

- **Por qué no dos editores:** ambos escriben a la misma `AutomationRule` vía la misma API; ya hubo que poner un guard anti-pérdida de datos (`shouldGuardRule`) porque el form aplana las ramas. Mantener dos superficies con capacidades distintas garantiza divergencia y confusión ("¿dónde edito esto?").
- **Por qué no "único editor = lienzo":** el 80 % de las reglas son lineales (disparador → condiciones → 1-3 acciones); un formulario es más rápido y menos frágil que un canvas, y el canvas hoy tiene las fallas de §2.
- **Cómo quedaría:**
  1. `/configuracion` → Automatización: el `WorkflowBuilder` es **el** editor. Cuando una regla tiene (o va a tener) ramas, un botón "Ramas / vista avanzada" abre el lienzo **dentro de Configuración** (modal o panel ancho) reutilizando `RuleInspectorPanel`/`DecisionInspector`/`draftToFlow` con el draft ya cargado. Sin deep-link a otra página, sin modo "Dirigida", sin campaña obligatoria.
  2. `/journey` pasa a **solo lectura**: mapa General rediseñado (regla → cadencia → etapa, heurística ampliada) + métricas por nodo en lectura + panel SLA. Clic en una regla → "Editar en Configuración". Es la pantalla que se le enseña a gerencia.
  3. Retirar de `/journey` el `+ Crear regla`, el desplegable "editar regla" y el guard que manda al usuario desde el form al journey.
- **Orden sugerido:** (a) quick wins 1, 4, 5, 6, 8, 10 para que deje de "no funcionar" esta semana; (b) embeber el lienzo como vista avanzada en Configuración; (c) rediseño de la vista General + métricas en lectura.

---

## 4. Archivos involucrados

- Página y componentes: `src/app/(dashboard)/journey/page.tsx`; `src/components/journey/journey-map-view.tsx`, `rule-inspector-panel.tsx`, `decision-inspector.tsx`, `node-palette.tsx`, `insert-edge.tsx`, `use-rule-draft.ts`.
- Capa pura: `src/lib/journey/journey-map.ts`, `flow-adapter.ts`, `rule-draft.ts`, `node-metrics.ts`, `node-catalog.ts` (+ sus `*.test.ts`).
- APIs: `src/app/api/admin/automation/route.ts` (GET datos), `src/app/api/admin/automation/rules/route.ts` (POST/PUT regla), `src/app/api/admin/journey/layout/route.ts` (GET/PUT posiciones), `src/app/api/admin/journey/metrics/route.ts` + `route-helpers.ts`.
- Validación/modelo: `src/lib/validations/rebuild-f1.ts` (`TRIGGER_TYPES`, `workflowActionTypes`, `workflowActionsSchema`), `src/lib/workflows/builder-model.ts`, `src/lib/workflows/engine.ts:179` (formato `dedupeKey` que leen las métricas), `prisma/schema.prisma` (`JourneyLayout`, `ActionQueue.ruleId`), `prisma/migrations-manual/2026-06-24-journey-layout.sql`.
- Integración con Configuración: `src/components/config/config-center.tsx:78`, `automation-section.tsx:220`, `workflow-builder.tsx:35-45, 125-137`, `condition-tree.tsx`.
- Layout global que afecta la altura: `src/app/(dashboard)/layout.tsx`, `src/components/layout/topbar.tsx`, `nav-config.ts` (sin entrada para `/journey`); estilos faltantes en `src/app/globals.css`.
- Specs de referencia: `docs/superpowers/specs/2026-06-24-journey-map-design.md`, `2026-06-24-journey-canvas-i1-design.md`, `2026-06-25-journey-canvas-i2-design.md`, `2026-06-25-journey-canvas-i3-design.md`, `2026-06-25-journey-ramas-nodo-decision-design.md`, `2026-06-26-journey-metricas-por-nodo-design.md`.
