# E2 — Constructor de condiciones en español (spec)

Tarjeta 963 · rama `mejora/963-config-e2` (sobre `mejora/962-config-e1`) · 2026-11-03

## Objetivo
Nadie vuelve a teclear `contact.leadSource`. Toda condición se arma eligiendo un dato de una
lista en español, un operador que le corresponde y un valor de un selector. El mismo
constructor lo usan reglas de flujo, cadencias (condiciones de salida), reglas de reparto,
reglas de entrada de territorio, SLA y el inspector del Journey. Cada condición se lee como
frase ("fuente es Meta Ads y presupuesto máx. ≥ 250,000").

## Lo que NO cambia
- El DSL guardado (`{ all|any: [...] }`, hojas `{ field, op, value }`, ops de
  `conditionDslOps`) y el evaluador `evaluate-conditions.ts`. E2 solo cambia cómo se arma.
- Las rutas API.

## Pieza 1 — `src/lib/workflows/condition-catalog.ts` (puro, con tests)
Catálogo de campos que el evaluador resuelve sobre `{ contact, adAttribution, deal, event }`:

```ts
type TipoDeCampo = "enum" | "number" | "text" | "boolean" | "date";
interface CampoDeCondicion {
  key: string;              // "contact.leadSource"
  label: string;            // "Fuente del lead"
  grupo: "Contacto" | "Perfil de inversión" | "Calificación" | "Anuncio (Meta)" | "Negocio" | "Evento";
  tipo: TipoDeCampo;
  opciones?: Record<string, string>;   // para enum: diccionario de @/lib/labels o constants
  contextos: Array<"contact" | "deal" | "event">; // en qué editores tiene sentido
  ayuda?: string;
}
```
- Contacto: leadSource, contactType, targetPlaza, preferredZone (text), preferredLanguage,
  residenceCountry (text), residenceCity (text), nationality (text).
- Perfil de inversión: budgetMin, budgetMax (number), propertyType, purchaseTimeline,
  paymentMethod, investmentProfile, purchaseModality, rentalStrategy (enum; etiquetas de
  constants/labels si existen, si no `etiqueta()`).
- Calificación: score (number), temperature, contactStatus, lifecycleStage, urgency,
  doNotContact (boolean), whatsappOptOut (boolean), tags (text, op contains).
- Anuncio (Meta): adAttribution.campaignName, adsetName, adName (text), network (enum si
  hay valores conocidos, si no text).
- Negocio: deal.stage, deal.dealType, deal.estimatedValue (number), deal.currency,
  deal.probability (number), deal.lostReason.
- Evento: event.type (enum con los eventos que emite `emitEvent`; tomar la lista de
  `src/lib/workflows/events.ts` o constantes).
- Campo libre: `contact.custom.<clave>` sigue permitido en modo Avanzado.

Operadores por tipo (etiquetas en español):
- enum: eq "es", neq "no es", in "es alguno de", nin "no es ninguno de", exists "tiene valor",
  changed_to "cambió a".
- number: eq, neq, gt "mayor que", gte "al menos", lt "menor que", lte "como máximo", exists.
- text: eq, neq, contains "contiene", exists.
- boolean: eq "es" (Sí/No).
- date: gt/lt/exists (si no hay campos date en el catálogo, omitir el tipo).

Funciones:
- `CAMPOS_DE_CONDICION: CampoDeCondicion[]`, `camposPara(contexto)`, `campoPorKey(key)`.
- `operadoresPara(tipo)` → `{ value, label }[]`.
- `valorParaGuardar(campo, op, raw: string | string[] | boolean | number)` → unknown del DSL
  (arrays para in/nin, number para number, boolean, string).
- `valorDesdeDsl(campo, op, value)` → forma editable.
- `describeConditions(conditions, opts?)` en español con etiquetas de campo y de valor
  (reemplaza y unifica la de `lib/teams/rules-model.ts`, que pasa a delegar aquí).
- `validarCondiciones(conditions)` → lista de problemas ("campo desconocido", "valor vacío",
  "operador no aplica al tipo") para avisar antes de guardar.

## Pieza 2 — `src/components/config/condition-tree.tsx` (UI)
Misma API externa (`tree`, `onChange`, `label`, `emptyText`) más `contexto?: "contact" |
"deal" | "event"` (default "contact"). `fieldSuggestions`/`listId` se mantienen solo para el
modo Avanzado.
- Fila guiada: selector de campo agrupado (optgroup por `grupo`) → selector de operador
  filtrado por tipo → valor: enum con `in/nin` = chips multi-selección; enum con `eq/neq` =
  select; number = input numérico; text = input; boolean = Sí/No; exists = sin valor.
- Vista previa en frase debajo del árbol (`describeConditions`).
- Enlace "Avanzado" que cambia la fila a los inputs libres actuales (campo/op/valor), para
  `contact.custom.*` o campos fuera del catálogo; una fila cuyo campo no está en el catálogo
  se abre en Avanzado automáticamente.
- Mantener `all/any`, subgrupos, agregar/quitar.
- Consumidores: pasar `contexto` donde aplique (cadencias y reglas de flujo: según
  `entityType`/trigger; reparto y territorio: "contact"); quitar los `datalist` propios si ya
  no hacen falta; la validación `hasIncompleteCondition` de rules-model pasa a usar
  `validarCondiciones`.

## Pruebas
- Catálogo: todos los enums con `opciones` tienen etiqueta para cada valor del enum de
  Prisma; `valorParaGuardar`/`valorDesdeDsl` son inversas; `describeConditions` cubre
  all/any anidados, in con etiquetas, number, boolean, campo desconocido.
- Editor: lógica pura separada (`condition-tree-model.ts`) con tests: qué operadores y qué
  tipo de input salen para cada campo, y detección de "fila necesita Avanzado".
- Verificación en navegador: crear una condición guiada en reglas de reparto y en una regla
  de flujo, ver la frase, guardar, reabrir.
