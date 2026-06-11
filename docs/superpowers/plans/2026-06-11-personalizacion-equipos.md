# Personalización & Equipos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Ejecuta P1→P3 en orden.

**Goal:** Implementar el Speckit Personalización & Equipos: equipos/territorios integrados al ruteo,
registro de metadata + custom fields JSONB sobre Contact/Deal con gobernanza, y registro de relaciones.

**Architecture:** Una sola migración additiva con TODAS las tablas (P1+P2+P3) para requerir una sola
autorización de DDL. Núcleo tipado intacto (PC1); lo custom vive en `Contact.custom`/`Deal.custom`
JSONB validado desde el registro. Puente N:N **genérico** (`record_links`) en vez de tabla por relación
— evita DDL en runtime (fiel a PC1; desviación documentada del §4.2).

**Tech Stack:** Prisma · JSONB · zod generado desde registro · UI admin B/N.

**Aprobación:** Luis 2026-06-11 ("realices el siguiente Speckit", aprobación general previa).

## Decisiones (cierran §8 Open Questions)

| OQ | Decisión |
|---|---|
| 1 Editor v1 | Solo custom fields sobre objetos núcleo (Contact/Deal). Objetos custom desde cero = P4 (tabla `custom_records` queda lista). |
| 2 Territorios | Nivel zona dentro de plaza desde v1 (`Territory.zones String[]` + `plaza?`). |
| 3 Storage | JSONB + registro. Promoción a columna generada/index = SQL artifact que se genera bajo demanda (`isSearchable` lo marca; la promoción es migración asistida, no runtime). Umbral de graduación a columna tipada: campo estable >90 días Y usado en reportes/ruteo. |
| 4 Sharing | Jerárquico: membresía en territorio padre da VIEW sobre hijos; EDIT no se hereda. |
| 5 Hub | `custom_objects.isExternal=true` para Unit/Development del Hub: visibles en registro/relaciones, NO editables. |
| 6 Layout conditions | v1 = mostrar/ocultar/obligatorio (DSL de condiciones reutilizado §D.4). Picklists dependientes = P4. |
| 7 Forecast manager | Opcional v1; la UI muestra warning si falta (best practice SF sin bloquear). |

## Fases

### P1 — Equipos & Territorios
- Modelos: Team, TeamMember (historial joined/left), Territory (self-jerarquía), TerritoryMember,
  TerritoryRule (conditions DSL §D.4, evaluación hijo-antes-que-padre).
- Ruteo: `autoRouteLead` resuelve PRIMERO territorio (TerritoryRule por prioridad, hoja→raíz),
  y restringe candidatos a miembros del territorio; luego aplica RoutingRule/estrategia existente.
- API `/api/admin/teams` + `/api/admin/territories` (CRUD + members + rules) — DIRECTOR/ADMIN.
- UI: tab "Equipos" en /admin (lista equipos con líder/miembros + territorios con reglas).

### P2 — Registro de metadata + custom fields
- Modelos: CustomObjectDef, CustomFieldDef (apiName/type inmutables), FieldOption, Layout/Section/Field,
  FieldPermission. Columnas `custom Json` en contacts/deals.
- Gobernanza: validador apiName `/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/` + prefijo objeto; detector de
  duplicados por label similar; solo ADMIN; AuditLog en todo cambio.
- Validador runtime: `buildZodFromRegistry(objectApiName)` → valida `custom` en PATCH.
- API `/api/admin/metadata/*` (objects/fields/options/permissions) + `/api/records/[object]/[id]/custom`
  (PATCH valores custom con validación + field-level security).
- UI: tab "Campos" en /admin (catálogo navegable anti-sprawl + alta de campo + picklist editor) +
  `CustomFieldsSection` (render dinámico) montado en detalle de Contacto y Deal.
- Seeds: registrar objetos núcleo (contact, deal, activity, quote + hub_unit/hub_development externos).

### P3 — Relaciones
- Modelos: RelationshipDef, RelationshipLabel, LookupProjection (máx 5), RollupFieldDef, RecordLink
  (puente genérico con label/role).
- API `/api/admin/relationships` (CRUD) + `/api/links` (crear/quitar vínculo + listar por record) +
  `/api/records/search?object=&q=` (picker typeahead por recordNameField + searchables).
- Seeds: describir relaciones núcleo existentes (Contact↔Deal, Deal↔Hub, User↔Contact/Deal).
- UI: componente `RelatedRecords` (lista relacionada + picker) montado en detalle de Deal.

### Transversal
- Tests (vitest): gobernanza de apiName, zod-from-registry, resolución de territorio (puro).
- Migración: `prisma/migrations-manual/2026-06-11-p123-personalizacion.sql` — additiva, una sola.
- Cache de metadata: módulo con cache en memoria TTL 60s e invalidación al editar.
