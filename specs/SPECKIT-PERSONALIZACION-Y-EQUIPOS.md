# SPECKIT — Personalización & Equipos (Propyte CRM)
### Sistema de Asesores/Equipos · Editor de Módulos y Campos · Relaciones (lookups) entre módulos

> **Companion #3.** Complementa `SPECKIT-PROPYTE-CRM-CONSOLIDADO.md` v1.1 y `SPEC-TECNICO-DETALLADO-PROPYTE-CRM.md`.
> **Base:** stack `propyte-crm` (Next.js + Prisma + Supabase `propyte_crm`).
> **Investigación:** mejores prácticas de Salesforce, Zoho CRM y HubSpot (2025–2026).
> **Versión:** 1.0 — 2026-06-10

---

## 0. SÍNTESIS DE LA INVESTIGACIÓN (qué hacen SF / Zoho / HubSpot)

### 0.1 Relaciones entre módulos

| Concepto | Salesforce | Zoho | HubSpot | Equivalente Postgres/Prisma |
|---|---|---|---|---|
| Relación débil N:1 | Lookup (máx 25 std / 40 custom) | Lookup (padre-hijo) | Association (sin label) | FK opcional |
| Relación fuerte (cascade + rollup) | Master-Detail (máx 2/obj, hereda seguridad, cascade delete) | — (vía layout/validación) | — | FK `ON DELETE CASCADE` + rollup |
| Muchos-a-muchos | Junction object (2 master-detail) | Multi-select lookup | Associations | Tabla puente |
| Rol en la relación | Record type/contexto | — | **Association label** | Columna `role/label` en puente |
| Denormalizar campos del relacionado | Cross-object formula | **Field of lookup** (hasta 5 campos) | Propiedades calculadas | Proyección de lookup |
| Agregados del hijo en el padre | Rollup summary (Count/Sum/Max/Min) | Formula | Calculated property | Rollup field |

**Lecciones:** usar relación fuerte solo cuando el hijo no debe existir sin el padre (Salesforce avisa: master-detail no siempre se puede revertir a lookup); para N:N siempre tabla puente; los labels de relación (HubSpot) son la forma limpia de modelar "qué rol juega este contacto en este negocio".

### 0.2 Editor de módulos y campos
- **Zoho:** módulos custom nacen con 4 campos estándar; **layouts** permiten condicionalmente mostrar/ocultar secciones y **volver campos obligatorios** según reglas; amplia variedad de tipos de campo (texto, número, moneda, fecha, picklist, auto-number, fórmula, file upload, user).
- **HubSpot:** objetos custom funcionan como estándar (propiedades, asociaciones, workflows, reportes). Tipos: single-line, multi-line, date, dropdown, number, etc.
- **Gobernanza (crítico, lección HubSpot):** los **nombres internos (API names) son permanentes**; el *property sprawl* (200+ campos cuando bastan 40) rompe reportes y confunde usuarios; sin gobernanza, marketing/ventas/ops crean 3 campos para el mismo dato. → **toda creación de campo pasa por convención de nombres + aprobación + catálogo.**

### 0.3 Equipos, roles y territorios
- **Dos jerarquías distintas:**
  - **Jerarquía de roles** = reporte tipo RH (una persona → un jefe), usada para *rollups* y visibilidad ascendente. *(ya existe en propyte-crm: `User.teamLeaderId` self-relation + `CareerLevel` + `UserRole`.)*
  - **Jerarquía de territorios** = matriz (alguien puede pertenecer a varios), usada para **asignación** y **sharing/visibilidad** por región. *(base: `Plaza` PDC/TULUM/MERIDA; ampliable a zona.)*
- **Zoho** tiene objeto de territorio nativo con jerarquía y asignación incorporada; **HubSpot** aproxima territorios con equipos + vistas filtradas (no tiene territorios nativos).
- **Best practices de territorio:** balancear carga/potencial entre territorios; un solo jefe por nodo; evitar micro-territorios; automatizar asignación con reglas; asignar "forecast manager" a cada territorio aunque sea placeholder (para no romper rollups).

---

## 1. PRINCIPIOS

- **PC1 — Núcleo tipado, custom metadata-driven.** Los campos de dominio (los del schema Prisma actual) permanecen tipados y migrados. Lo que el usuario agregue en runtime vive en una **capa de metadata + JSONB**, nunca alterando el schema en caliente.
- **PC2 — Gobernanza desde el día 1.** Nombre interno inmutable + convención (`snake_case`, prefijo por módulo), aprobación por admin, y catálogo navegable. Evita el property sprawl.
- **PC3 — Dos jerarquías separadas.** Roles (RH, rollup) ≠ Territorios (matriz, asignación/visibilidad). No mezclarlas en una sola estructura.
- **PC4 — Relaciones explícitas y tipadas.** Toda relación entre módulos declara: cardinalidad (1:N / N:1 / N:N), fuerza (lookup débil vs master-detail fuerte), on-delete, y label/rol opcional.
- **PC5 — Seguridad por defecto restrictiva.** Un campo/relación nuevo no es visible para todos: hereda field-level security configurable por rol.
- **PC6 — Reversibilidad y auditoría.** Cambios de metadata versionados y auditados; borrar un campo archiva (soft) sus valores, no los destruye.
- **PC7 — Consistencia con el resto.** El editor escribe metadata; el motor de workflows (§D del detallado), el matching y los dashboards leen esa metadata. Una sola fuente de definición.

---

## 2. SUBSISTEMA A — ASESORES & EQUIPOS

### 2.1 Modelo de datos

**`Team`** (NUEVO): `id, name, plaza (Plaza), leaderId (FK→User), parentTeamId? (self, jerarquía), forecastManagerId? (FK→User), isActive`.
**`TeamMember`** (NUEVO, N:N User↔Team con rol): `id, teamId, userId, roleInTeam (LEADER/SENIOR/JUNIOR/HOSTESS), joinedAt, leftAt?`.
**`Territory`** (NUEVO): `id, name, type (GEO/SEGMENT), parentTerritoryId? (self), plaza?, zones String[], forecastManagerId?, isActive`.
**`TerritoryMember`** (NUEVO): `territoryId, userId, accessLevel (VIEW/EDIT)`.
**`TerritoryRule`** (NUEVO): `territoryId, priority, conditions jsonb (plaza/zone/source/language/budget), isActive` — asigna leads/deals al territorio automáticamente (evaluación hijo-antes-que-padre).

> Reutiliza lo existente: `User.teamLeaderId` (jerarquía de roles RH), `User.careerLevel`, `User.role`, `User.plaza`, `User.sedetusNumber`. **No** se duplica la jerarquía de roles; el `Team`/`Territory` es la capa matricial encima.

### 2.2 Reglas de visibilidad (RLS) derivadas
- Asesor: ve sus contactos/deals (`assignedToId = self`) + los de su territorio si tiene `accessLevel ≥ VIEW`.
- Team Leader: ve todo su equipo (descendientes en jerarquía de roles) — habilita cubrir la **posición de TL vacante** asignando interino.
- Dirección/Gerente: ve todo (rollup completo).
- Cobranza/Marketing: vistas acotadas a su función.

### 2.3 Funciones
- **createTeam / assignLeader / addMember / moveMember** (con historial `joinedAt/leftAt`).
- **createTerritory / nestTerritory / addTerritoryMember**.
- **defineTerritoryRule** → alimenta el ruteo (`RoutingRule` del §D del detallado): territorio + skill + idioma + performance.
- **rebalanceTerritories** — reporte de carga/potencial por territorio para detectar desbalance (best practice SF).
- **assignForecastManager** — por territorio/equipo, para no romper rollups de forecast.

### 2.4 Integración con el ruteo de leads
El `LeadAssignmentMode` existente (ROUND_ROBIN/PERFORMANCE/MANUAL/GUARDIA) opera **dentro** del territorio resuelto por `TerritoryRule`: primero territorio (matriz, por plaza/zona/idioma), luego asesor (round-robin ponderado o por performance). Speed-to-lead intacto (P2).

---

## 3. SUBSISTEMA B — EDITOR DE MÓDULOS Y CAMPOS

### 3.1 Concepto
Un panel de admin (no-code) para: crear **objetos custom**, agregar/editar/archivar **campos**, marcar **obligatorios**, definir **picklists**, ordenar **layouts**, y configurar **visibilidad por rol** — sin tocar código ni correr migraciones manuales. Bajo el capó es **metadata-driven** (como SF/Zoho/HubSpot).

### 3.2 Modelo de metadata (registro)

**`custom_objects`**: `id, apiName (inmutable, único), label, pluralLabel, icon, isSystem (bool: true para Contact/Deal/etc.), recordNameField, isActive`.
**`custom_fields`**: `id, objectApiName, apiName (inmutable), label, fieldType (FieldType), isRequired, isUnique, isSearchable, defaultValue?, helpText?, validation jsonb, order, sectionId?, isSystem (true = campo núcleo tipado), isActive, archivedAt?`.
**`field_options`** (picklists): `id, fieldId, value, label, color?, order, isActive`.
**`layouts`** + **`layout_sections`** + **`layout_fields`**: orden, columnas, secciones colapsables, y **reglas condicionales** (`conditions jsonb` → mostrar/ocultar/forzar-obligatorio según valores de otro campo, estilo Zoho).
**`field_permissions`**: `fieldId, role (UserRole), access (HIDDEN/READ/EDIT)` — field-level security (PC5).

### 3.3 Tipos de campo (`FieldType`)
`TEXT, TEXTAREA, NUMBER, CURRENCY, PERCENT, DATE, DATETIME, BOOLEAN, EMAIL, PHONE, URL, PICKLIST, MULTI_PICKLIST, AUTO_NUMBER, FORMULA, FILE, USER, LOOKUP, MASTER_DETAIL, ROLLUP, GEO`.

### 3.4 Almacenamiento de valores (decisión de arquitectura)
- **Campos núcleo** (`isSystem=true`): columnas tipadas reales en Prisma (lo actual). No cambian.
- **Campos custom**: columna **`custom jsonb`** en cada tabla núcleo (y en la tabla de records de objetos custom). Validación y tipos los impone el **registro** `custom_fields`, no la DB.
- **Búsqueda/índices:** los campos marcados `isSearchable=true` se promueven a **columnas generadas + índice** (`GENERATED ALWAYS AS ((custom->>'apiName')) STORED` + GIN/btree) para filtrar y enlazar con rendimiento. (Postgres JSONB con índices selectivos = pragmático; evita el EAV puro y su pena de performance.)

> **Por qué JSONB y no columnas reales por campo:** agregar columnas en caliente sobre tablas con datos requiere migraciones y locks; JSONB + registro permite runtime seguro, y promovemos a columna indexada solo lo que de verdad se busca/enlaza. (Si más adelante un custom field se vuelve crítico/estable, se "gradúa" a columna tipada vía migración.)

### 3.5 Funciones
- **createCustomObject / archiveCustomObject** (system objects no se borran).
- **addField** (valida apiName único + convención + reserva el tipo) · **editFieldMeta** (label/help/validation; **apiName y type inmutables** tras crear, lección HubSpot) · **setRequired** · **archiveField** (soft; conserva valores).
- **definePicklist / reorderOptions / deactivateOption** (nunca borrar opción en uso → desactivar).
- **configureLayout** (drag-drop secciones/campos + reglas condicionales).
- **setFieldPermission** (por rol).
- **catalogSearch** — catálogo navegable de todos los campos/objetos (anti-sprawl, PC2).

### 3.6 Gobernanza (anti property-sprawl)
- Convención obligatoria de `apiName` (`<obj>_<snake>`); validación al crear.
- Solo rol `ADMIN` crea campos; cambios quedan en `AuditLog`.
- Detector de duplicados semánticos al crear (avisa "ya existe `lead_source`/`campaign_source`").
- Revisión periódica: reporte de campos sin uso (0 valores en N días) → candidatos a archivar.

---

## 4. SUBSISTEMA C — RELACIONES (LOOKUPS) ENTRE MÓDULOS

> "Agregar campos de búsqueda entre módulos para enlazar" = relaciones tipadas + buscador de records + listas relacionadas.

### 4.1 Modelo de metadata de relación

**`relationships`** (NUEVO): `id, name, fromObject, toObject, kind (LOOKUP | MASTER_DETAIL | MANY_TO_MANY), onDelete (SET_NULL | CASCADE | RESTRICT), relatedListLabel, isRequired, allowMultiple, isActive`.
**`relationship_labels`** (NUEVO, estilo HubSpot association labels): `id, relationshipId, label, fromRole?, toRole?` — define el **rol** que juega el record en la relación (p.ej. Deal↔Contact: "titular", "co-inversionista", "broker").
**`lookup_projections`** (NUEVO, estilo Zoho field-of-lookup): `id, relationshipId, sourceFieldApiName, displayLabel` — trae campos del módulo relacionado al layout (máx 5, como Zoho).
**`rollup_fields`** (NUEVO, estilo Salesforce): `id, parentObject, childRelationshipId, aggregate (COUNT/SUM/MIN/MAX/AVG), childFieldApiName?, filter jsonb?` — solo válido en relaciones MASTER_DETAIL o con FK fuerte.

### 4.2 Cómo se materializa cada `kind`
- **LOOKUP** (N:1 débil): columna FK opcional (en `custom` o columna real si searchable). Borrado padre → `SET_NULL`. Sin herencia de seguridad.
- **MASTER_DETAIL** (N:1 fuerte): FK requerida + `ON DELETE CASCADE` + el hijo hereda RLS del padre + habilita rollups. (Usar con cuidado: difícil de revertir, lección SF.)
- **MANY_TO_MANY**: tabla puente `rel_<from>_<to>` (`fromId, toId, label, role, createdAt`) — soporta labels/roles.

### 4.3 UI / experiencia
- **Picker de búsqueda** (typeahead) que busca records del módulo objetivo por su `recordNameField` + campos `isSearchable`.
- **Listas relacionadas**: en el record padre, sección con los hijos (con `relatedListLabel`), filtrable y ordenable.
- **Búsqueda global** entre módulos (omni-search) que respeta field-level security.
- **Proyección de lookup**: al seleccionar un record relacionado, se muestran los `lookup_projections` (p.ej. al elegir una Unidad del Hub en un Deal, mostrar precio/m²/estatus sin abrir la unidad).

### 4.4 Relaciones núcleo ya existentes (a representar en el registro, no recrear)
Contact↔Deal (1:N), Deal↔Unit/Development (lookup al Hub por ID), User↔Contact/Deal (asignación), Deal↔Activity (1:N). El registro de relaciones las **describe** para que el editor y los reportes las conozcan; la implementación física ya existe en Prisma.

---

## 5. ARQUITECTURA DE LA CAPA DE PERSONALIZACIÓN

```
┌───────────────────────────────────────────────────────────┐
│  REGISTRO DE METADATA  (propyte_crm)                        │
│  custom_objects · custom_fields · field_options · layouts · │
│  field_permissions · relationships · relationship_labels ·  │
│  lookup_projections · rollup_fields · Team/Territory/Rules  │
└───────────────┬───────────────────────────────────────────┘
                │  (una sola fuente de definición)
   ┌────────────┼─────────────┬───────────────┬──────────────┐
   ▼            ▼             ▼               ▼              ▼
Form/UID    Validación    Motor Workflows   Dashboards    RLS/perm` +
dinámico    (registro)    (§D detallado)    /reportes     sharing por
(render)                                                   territorio
```
- **Render dinámico:** las pantallas de records se construyen leyendo `layouts` + `custom_fields` (campos núcleo tipados + custom JSONB).
- **Validación:** un validador único (Zod generado desde el registro) aplica required/unique/tipo/validation.
- **Cache de metadata:** el registro cambia poco; cachear en memoria/edge e invalidar al editar (evita leer metadata en cada request).

---

## 6. PERMISOS & GOBERNANZA (resumen)

| Capacidad | Quién |
|---|---|
| Crear/editar objetos y campos custom | ADMIN |
| Configurar layouts y field-level security | ADMIN |
| Definir relaciones y labels | ADMIN |
| Crear/editar equipos y territorios | ADMIN / DIRECTOR |
| Asignar miembros a equipo/territorio | DIRECTOR / GERENTE |
| Ver catálogo de campos | todos (read) |

Todo cambio de metadata → `AuditLog` (quién, qué, antes/después). Nombres internos inmutables. Borrado = archivado (soft).

---

## 7. ROADMAP

- **Fase P1 — Equipos & Territorios.** `Team`/`TeamMember`/`Territory`/`TerritoryMember`/`TerritoryRule` + RLS por territorio + integración con ruteo. *(desbloquea cubrir el TL vacante y el speed-to-lead por plaza).*
- **Fase P2 — Registro de metadata + editor de campos (solo lectura→edición).** `custom_objects`/`custom_fields`/`layouts`/`field_permissions` + render dinámico + validación + JSONB storage. Empezar permitiendo custom fields sobre objetos núcleo (Contact/Deal).
- **Fase P3 — Relaciones entre módulos.** `relationships` + picker de búsqueda + listas relacionadas + labels + proyección de lookup.
- **Fase P4 — Rollups, fórmulas y objetos custom completos.** `rollup_fields`, campos fórmula, creación de objetos custom de cero, búsqueda global.
- **Gobernanza (transversal):** convención de nombres, detector de duplicados y reporte de campos sin uso desde P2.

---

## 8. OPEN QUESTIONS

1. **Profundidad del editor v1:** ¿solo custom fields sobre objetos núcleo (Contact/Deal), o también crear objetos custom desde cero? (P2 vs P4 — recomendado empezar acotado).
2. **Territorios vs plazas:** ¿basta `Plaza` (PDC/TULUM/MERIDA) o se necesita un nivel zona dentro de plaza? (afecta `TerritoryRule`).
3. **Storage:** confirmar JSONB + columnas generadas para searchable (vs columnas reales con migración asistida). ¿Umbral para "graduar" un campo a columna tipada?
4. **Sharing model:** ¿visibilidad por territorio es VIEW/EDIT plano, o jerárquico (un TL ve territorios hijos)?
5. **Relación con el Hub:** los lookups a catálogo (Unit/Development) son read-only por ID al Hub — confirmar que el editor de relaciones los trate como "objetos externos" no editables.
6. **Reglas condicionales de layout:** ¿alcance v1 (mostrar/ocultar/obligatorio) o también valores dependientes entre picklists?
7. **Forecast managers:** ¿se exige asignar uno por territorio/equipo desde el inicio (best practice SF) o es opcional?

*Fin — Speckit Personalización & Equipos v1.0.*
