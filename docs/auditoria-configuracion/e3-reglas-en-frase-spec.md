# E3 — Reglas de flujo en frase "Cuando · Si · Entonces" (spec)

Tarjeta 964 · rama `mejora/964-config-e3` (sobre `mejora/963-config-e2`) · 2026-11-03

## Objetivo
El modal de reglas de flujo deja de ser un formulario técnico. Una regla se lee y se arma
como una frase con tres partes y una tira de tarjetas:

> **Cuando** entra un lead · **si** fuente es alguno de Meta Ads, Instagram · **entonces**
> asignar asesor → el bot saluda y califica → avisar al asesor

Disparadores y acciones se eligen por nombre de listas (eventos con nombre, etapas,
plantillas de WhatsApp/correo, cadencias, destinatarios), nunca por clave. Las cadencias
usan las mismas tarjetas de acción. La lista de reglas muestra la frase.

## Lo que NO cambia
- Lo guardado: `AutomationRule.triggerType/triggerConfig/conditions/actions` y
  `ActionPlan.steps`. El motor (`engine.ts`, `actions.ts`, `scheduler.ts`) y la API de
  reglas no cambian. E3 solo cambia cómo se arma y cómo se lee.
- El lienzo de `/journey` (E4).

## Pieza 1 — catálogos puros (con tests)

### `src/lib/workflows/trigger-catalog.ts`
```ts
interface Disparador {
  key: string;                 // "lead.captured" | "stage_change" | "inactivity" | ...
  frase: string;               // "entra un lead", "cambia de etapa a {valor}", "lleva {valor} h sin actividad"
  label: string;               // nombre corto para el selector
  grupo: "Leads" | "Contacto" | "Negocio" | "Tiempo" | "Otros";
  triggerType: TriggerType;    // el que se guarda
  campo?: { kind: "select" | "number"; label: string; opciones?: Record<string,string>; unidad?: string };
  contexto: "contact" | "deal" | "event";   // para el constructor de condiciones (E2)
  estado: "activo" | "proximamente";        // TIME y BEHAVIORAL: el motor no los ejecuta
}
```
- Un disparador por evento real de `emitEvent` (usar `EVENTOS_DE_CONDICION` del catálogo
  de E2 como fuente de verdad y frases en español: "entra un lead", "se asigna un lead",
  "se reasigna un lead", "se crea un contacto", "cambia el score", "un contacto pide no ser
  contactado", "vence un tiempo de respuesta", "se atrasa un pago", "cambia de etapa"…).
  Verificar contra `engine.ts` (`matchesTrigger`) y `scheduler.ts` cuáles corren de verdad:
  EVENT, STAGE_CHANGE, LIFECYCLE_CHANGE, SCORE_THRESHOLD, SLA_BREACH, BEHAVIORAL por
  evento; INACTIVITY por cron; TIME → `proximamente`.
- "Cambia de etapa a …" (STAGE_CHANGE, select con `STAGE_LABELS`), "Cambia de ciclo de vida
  a …" (LIFECYCLE_CHANGE, `LIFECYCLE_LABELS`), "El score llega a …" (SCORE_THRESHOLD,
  number), "Lleva … horas sin actividad" (INACTIVITY, number, unidad h), "Vence un tiempo de
  respuesta" (SLA_BREACH).
- Funciones: `DISPARADORES`, `disparadorDesde(triggerType, triggerConfig)` →
  `{ key, valor }` (compatible con `parseTriggerValue` de builder-model: lee `eventType`,
  `toStage`, `stage`, `threshold`, `hours`), `triggerConfigDesde(key, valor)` (debe
  producir lo mismo que `buildTriggerConfig`), `describeTrigger(triggerType, triggerConfig)`.

### `src/lib/workflows/action-catalog.ts`
Para cada `workflowActionTypes` (ver `node-catalog.ts` y las claves que lee `actions.ts`):
```ts
interface AccionDeCatalogo {
  type: string; label: string; icono: string; grupo: string;
  frase: (config, fuentes) => string;      // "enviar WhatsApp «Bienvenida»", "asignar asesor"
  campos: CampoDeAccion[];                 // { key, label, kind: "text"|"textarea"|"number"|"select"|"fuente", fuente?: "plantillas_whatsapp"|"plantillas_email"|"cadencias"|"usuarios"|"roles"|"etapas"|"ciclo"|"campos_contacto"|"tipos_aviso", ayuda?, requerido? }
  estado: "activo" | "proximamente";       // AI_DRAFT / AI_CALL_SUMMARY / WEBHOOK si el motor no los ejecuta
}
```
- Claves que el motor lee (de `actions.ts`): SEND_WHATSAPP template/body; SEND_EMAIL
  template/subject/body; NOTIFY type/title/message/template; CREATE_TASK subject/description/
  dueInMinutes; MAKE_CALL subject/description/dueInMinutes/reason; ENROLL_PLAN planId;
  CHANGE_STAGE toStage; SET_LIFECYCLE toStage/allowBackward; ADD_TAG tag; UPDATE_FIELD
  field/value; ESCALATE to/reason; REASSIGN reason; ASSIGN reason; AI_REPLY goal (verificar en
  src/lib/bot cómo se usa `goal`); WEBHOOK url. Verificar cada una leyendo `actions.ts`; lo que
  el motor no lea no se muestra.
- `UPDATE_FIELD.field` se elige de los campos enum/boolean del catálogo de E2 y `value` con
  su selector; `NOTIFY.type` con opciones fijas en español; `ESCALATE.to` con roles de mando.
- `describeAction(action, fuentes)`, `describeActions(actions, fuentes)` ("asignar asesor →
  el bot saluda → avisar"), `describeRule(rule, fuentes)` ("Cuando … · si … · entonces …"),
  `describeStep(step, fuentes)` para cadencias ("Día 2: enviar WhatsApp «Seguimiento»").
  `fuentes` = `{ plantillas: Record<id|clave,nombre>, cadencias: Record<id,nombre>, usuarios:
  Record<id,nombre> }`; sin fuentes se muestra la clave humanizada.
- `validarAccion(action)` → problemas (campo requerido vacío, cadencia inexistente si hay
  fuentes).

### `GET /api/admin/automation/fuentes` (nuevo, con test de ruta)
Devuelve `{ plantillas: [{ id, clave?, nombre, canal }], cadencias: [{ id, nombre }],
usuarios: [{ id, nombre, rol }] }` para alimentar los selectores. Plantillas =
`UserTemplate` (verificar el modelo y si hay plantillas globales vs por usuario; incluir las
que el motor puede resolver por `template`), cadencias = `ActionPlan` activos, usuarios =
ruteables + mando. Permisos: los mismos que `GET /api/admin/automation`.

## Pieza 2 — UI

### `workflow-builder.tsx` (reescritura)
- Encabezado: nombre + frase viva (`describeRule`) que se actualiza al editar.
- **Cuando**: selector de disparador agrupado (solo `activo`; si la regla ya usa uno
  `proximamente` se muestra con aviso) + su campo (select/number).
- **Si**: `ConditionTreeEditor` de E2 con `contexto` del disparador.
- **Entonces**: tira de tarjetas de acción (icono + label + frase corta + retraso); botones
  subir/bajar/quitar; "Agregar acción" abre un selector agrupado; la tarjeta seleccionada
  muestra sus campos con selectores (plantillas, cadencias, usuarios, etapas…) y el retraso
  con presets (Inmediata, 15 min, 1 h, 1 día) + unidad (`DelayInput` de E1).
- **Avanzado** (plegado): prioridad, descripción, "no repetir durante" (cooldown con presets),
  y vista JSON de solo lectura de `actions`/`conditions`.
- Guardar: valida con `validarCondiciones` y `validarAccion`; errores por campo con
  `erroresPorCampo`; mantiene "Guardar pausada" / "Guardar y activar".
- Mantener el guard de ramas (`hasDecisionNode` → mandar a Journey) y las plantillas de
  reglas (`builder-templates.ts`), mostrando su frase.

### `cadence-editor.tsx`
Pasos como tarjetas de acción (mismo componente de tarjeta/campos que el builder), con el
retraso en unidades y la frase `describeStep`; condiciones de salida con E2.

### `automation-section.tsx`
Cada regla muestra `describeRule`; cada cadencia la lista de `describeStep`. Nada más.

### Componente compartido
`src/components/config/action-card.tsx` (tarjeta + formulario de campos de una acción,
alimentado por `action-catalog` y `fuentes`), usado por builder y cadencias.

## Fuera de E3 (anotar, no hacer)
- "Probar con un contacto" (dry-run): tarjeta aparte.
- Reordenar con drag & drop (basta subir/bajar).
- Embeber el lienzo de Journey (E4).

## Pruebas
- Catálogos: cada `TriggerType` y cada `workflowActionTypes` está en su catálogo; ida y vuelta
  `disparadorDesde`/`triggerConfigDesde` con las 8 reglas canónicas de `seed-rebuild-f1.ts`
  (léelas: deben describirse en español sin claves crudas); `describeRule` de WF1 produce
  "Cuando entra un lead · si fuente es alguno de … · entonces asignar asesor → …".
- Ruta `fuentes`: permisos y forma.
- UI: modelo puro del builder (`workflow-builder-model.ts`) con tests: armar/parsear una regla
  completa sin perder claves que el motor lee.
- Navegador: abrir WF1–WF8 y ver la frase; crear una regla de prueba hasta la vista previa
  (sin guardar si el entorno lo bloquea); cadencia con dos pasos en tarjetas.
