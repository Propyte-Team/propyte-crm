# E4 — Journey: que funcione y tenga un rol claro (spec)

Tarjeta 965 · rama `mejora/965-config-e4` (sobre `mejora/964-config-e3`) · 2026-11-03
Diagnóstico completo: `03-journey.md` §2 (causas 1–13) y §3.

## Decisión de rol
- **Un solo editor de reglas**: el de Configuración (E3, "Cuando · Si · Entonces").
- **El lienzo es la vista avanzada** de ese editor, para reglas con ramas (decisiones). Se abre
  desde el builder ("Vista avanzada (ramas)") y edita la misma regla; al guardar vuelve al
  builder/lista.
- **`/journey` es de solo lectura** para gerencia: mapa general por etapas, métricas por nodo
  sin entrar a editar, panel de SLA, y enlace "Editar en Configuración" por regla.

## Ola 1 (en paralelo, archivos exclusivos)

### A — Arreglos del lienzo (`journey-map-view.tsx`, `lib/journey/*`, `use-rule-draft.ts`,
`api/admin/journey/*`)
Causas del §2 a resolver, todas quick wins salvo que se diga:
1. Deep-link `?mode=targeted&ruleId=` abre SIEMPRE la regla (no solo las de campaña); si no
   existe, aviso y vuelta a General.
2. Dirigida sin campañas: estado vacío explícito ("ninguna regla segmenta por campaña…") y
   lista de reglas para elegir cuál ver.
5. Altura: el lienzo cabe sin scroll en el layout real (topbar 3rem + `p-6`).
6. Crear regla: nace con nombre "Nueva regla", disparador válido (usa `trigger-catalog`:
   `lead.captured`) y acción con config válida; la API devuelve `details.fieldErrors` → se
   muestran con `erroresPorCampo` (E1).
7. Guardar acomodo: si el `PUT /layout` falla, toast "No se pudo guardar el acomodo" (no
   silencio). Si la tabla no existe, el GET sigue devolviendo `{}`.
8. Cancelar el fetch de lectura al entrar a edición (flag `cancel`).
10. Nodo de decisión sin caja blanca.
11. IDs de Dirigida por `rule.id`, no por índice.
12. `fitView()` tras cada rebuild y al cambiar de modo; conservar posiciones arrastradas
    durante la sesión de edición (mapa `nodeId → position` en memoria).
13. (Si cabe) `nodeTypes` propios para `rule`, `cadence`, `stage`, `trigger`, `condition`,
    `action` para quitar el aviso de consola; sin rediseño visual.
Además: General reconoce `STAGE_CHANGE`/`CHANGE_STAGE` y el `eventType` del disparador para
ubicar reglas en un carril (causa 3, versión mínima): etapa del pipeline o "Entrada de
leads" / "Seguimiento" / "Postventa" según el disparador; aristas regla → cadencia
(ENROLL_PLAN) y regla → etapa destino (CHANGE_STAGE/SET_LIFECYCLE).

### B — Inspector en lenguaje de negocio (`rule-inspector-panel.tsx`,
`decision-inspector.tsx`, `node-palette.tsx`, `globals.css`)
4. Clases CSS que no existen → utilidades Tailwind o clases definidas en `globals.css`.
- Disparador: selector del `trigger-catalog` (DISPARADORES activos + el actual si es
  "próximamente") con su campo; nada de `EVENT` + texto libre.
- Nodo acción: campos de `action-catalog` (`camposVisibles`, `opcionesDeCampo`, `kind:
  "fuente"` con `useFuentes`) con la misma lógica de `action-card-model.ts` (reutiliza
  `rawDesdeConfig`/`accionDesdeRaw`/`configParaGuardar`); título con `describeAction`.
  El JSON crudo queda bajo "Avanzado".
- Nodo condición / rama de decisión: `ConditionTreeEditor` de E2 con `contexto` del
  disparador y la frase `describeConditions` como título de la rama.
- Paleta: solo acciones `activo` del catálogo, agrupadas, con etiqueta sin emoji.
- Resumen de la regla arriba del inspector: `describeRule`.

## Ola 2 (después de A y B) — C: rol del lienzo
- Extraer `RuleCanvasEditor` (lienzo editable de UNA regla: nodos de `draftToFlow`,
  `RuleInspectorPanel`, `NodePalette`, guardar/cancelar) desde `journey-map-view.tsx`.
- `workflow-builder.tsx`: para reglas con ramas, en vez del banner "Abrir en Journey",
  botón "Vista avanzada (ramas)" que abre `RuleCanvasEditor` a pantalla completa dentro del
  modal; al guardar vuelve a la lista. Para reglas sin ramas, enlace discreto "Convertir en
  flujo con ramas" que abre lo mismo.
- `/journey`: modo General de solo lectura con métricas por nodo (sin entrar a edición) y
  leyenda "sin datos en la ventana"; panel SLA; Dirigida pasa a "por regla" (ver una regla con
  sus métricas) con botón "Editar en Configuración" (`/configuracion?section=automation&
  ruleId=`). Se quitan de `/journey` los botones de crear/editar.
- `automation-section.tsx`: el icono "Editar en Journey" pasa a "Ver en el mapa" (solo
  lectura); editar siempre abre el builder.
- `config-center.tsx`: la tarjeta "Etapas del recorrido del cliente" describe el mapa de solo
  lectura.

## Lo que NO cambia
Forma guardada de reglas, API de reglas, motor. `journey_layouts` sigue siendo opcional.

## Pruebas
- `lib/journey` tests existentes + nuevos para: deep-link siempre abre; ubicación en carril
  por disparador; IDs estables por `rule.id`; draft nuevo válido para la API.
- Inspector: modelo puro (`rule-inspector-model.ts`) con tests de mapeo nodo ↔ campos del
  catálogo.
- Navegador: abrir WF1 en vista avanzada desde el builder, ver inspector legible; `/journey`
  con carriles y métricas sin editar.
