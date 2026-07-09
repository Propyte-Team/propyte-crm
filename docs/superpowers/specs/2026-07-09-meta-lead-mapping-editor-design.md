# Editor de mapeo Meta→Contact por conector — Diseño

**Fecha:** 2026-07-09
**Rama:** `feat/crm-meta-lead-mapping` (worktree off `origin/main` `6064201`)
**Estado:** diseño aprobado por Luis ("hazlo y en revisiones volvemos a checar", 2026-07-09)

## Contexto / premisa corregida

El `project_crm_port_meta_leads_mapping.md` (2026-07-07) asumía mapeo Meta→**Zoho**. Falso hoy: en la migración CRM→Hub (jun-2026) el CRM perdió TODO Zoho. El pipeline Meta actual del CRM es: webhook directo de Meta (`/api/connectors/meta/webhook`) → `mapExternalFields(fieldMap, external)` → `processIncomingLead` → `captureLead` **crea un Contact** (dedup + AdAttribution + ruteo/SLA). Nunca toca Zoho.

El `fieldMap` (por conector, `LeadConnector.fieldMap` Json) hoy es `Record<string,string>` (metaField→campo), **configurable solo por API/DB, sin UI**, sin fuentes constant/metadata ni traducciones. Este proyecto trae la UX del editor del Hub adaptada a **Contact + AdAttribution**.

## Decisiones (brainstorming)

1. Editor **por conector en /conexiones** ("Editar mapeo" por tarjeta Meta/IG).
2. Reglas con 3 fuentes: `question` | `metadata` | `constant`, destino = campos Contact + `custom.*`, **con traducciones (value-map)** para destinos enum + fallback.
3. **Dry-run** ("Probar"): último lead recibido del conector (de `ConnectorLeadLog.rawPayload`) o ejemplo manual.

## Arquitectura

### Almacenamiento (sin migración)

Reusar `LeadConnector.fieldMap` (Json). Nuevo shape:
```ts
type MappingRule = {
  source: "question" | "metadata" | "constant";
  metaField?: string;   // question: clave de field_data · metadata: nombre del metadato
  target: string;       // campo Contact (whitelist) o "custom.<clave>"
  value?: string;       // constant
  valueMap?: Record<string, string>; // traducción valor-origen → valor destino (enums)
  fallback?: "omit" | "passthrough" | "fixed";
  fallbackValue?: string;
};
// fieldMap = { rules: MappingRule[] }  (shape nuevo)
```
**Retrocompat:** si `fieldMap` es el shape viejo `Record<string,string>` (o `{}`), se interpreta como `rules` de `source:"question"` (`metaField=key, target=value`). El mapper detecta el shape → conectores existentes NO rompen, sin migración.

### Metadatos disponibles (source: metadata)

`campaign_name`, `campaign_id`, `adset_name`, `adset_id`, `ad_name`, `ad_id`, `form_id`, `leadgen_id`. (`platform`, `form_name` **fuera de v1** — no se obtienen hoy de Graph.) El webhook hoy solo parsea name-s; se extenderá para extraer también los `_id` (ya se piden en el `fields=` de Graph) y pasarlos al mapper vía `rawPayload.meta`.

### Destinos (target) — whitelist

Campos que `captureLead`/`incomingLeadSchema` acepta: `firstName`, `lastName`, `fullName` (se parte), `phone`, `email`, `source`(→leadSource), `sourceDetail`(→leadSourceDetail), `language`, `investmentProfile`, `propertyType`, `purchaseTimeline`, `paymentMethod`, `purchaseModality`, `rentalStrategy`, `budgetMin`, `budgetMax`, `preferredZone` + `custom.*`.
**Extensión (decisión):** agregar `contactType` + `temperature` opcionales a `incomingLeadSchema` y `captureLead` (hoy `contactType` está hardcodeado a COMPRADOR y `temperature` no existe en el schema de intake) → así el editor puede mapearlos (útiles para ruteo/segmentación). Fallback: COMPRADOR / COLD.

Valores de enums para el value-map (de Prisma): `ContactType`(COMPRADOR/INVERSIONISTA/BROKER_EXTERNO/EMPLEO/REFERIDOR/…), `LeadSource`(subset de intake), `LeadTemperature`(HOT/WARM/COLD/DEAD), `InvestmentProfile`, `PaymentMethod`, `PurchaseTimeline`, `PropertyType`, `PurchaseModality`, `RentalStrategy`.

### Mapper puro (nuevo)

`src/lib/intake/map-lead.ts`:
```
mapLead(rules: MappingRule[], input: { fieldData: Record<string,unknown>; metadata: Record<string,unknown> }): Record<string, unknown>
```
- `question` → valor de `fieldData[metaField]`; `metadata` → `metadata[metaField]`; `constant` → `value`.
- Trim; vacío → omitir (salvo constant).
- `fullName` → parte en firstName/lastName.
- `valueMap`: **si `Object.keys(valueMap).length > 0`** aplica traducción; si el valor no está en el mapa → fallback (`omit`/`passthrough`/`fixed` con `fallbackValue`). **GOTCHA del Hub:** `valueMap = {}` es truthy → NO activar la guarda; mapa vacío = passthrough. Test de regresión obligatorio.
- Campos no cubiertos por reglas: los field_data crudos siguen yendo a `Contact.custom` (como hoy, vía `rawPayload.external`) — nada se pierde.
- Helper `parseRules(fieldMap)`: normaliza shape viejo/nuevo → `MappingRule[]`.

### Integración

`processIncomingLead` / webhook usan `mapLead(parseRules(connector.fieldMap), { fieldData: external, metadata })`. **Fix del clobber:** `deriveInvestmentProfile` (heurístico) se aplica DESPUÉS pero **solo para campos que el mapeo explícito NO fijó** (explicit-wins) — hoy `Object.assign(fields, profileFields)` pisa; se cambia a rellenar solo faltantes.

### API

- `PUT /api/admin/connectors/[id]` — extender `patchSchema.fieldMap`: unión `z.record(z.string())` (legacy) | `{ rules: mappingRuleSchema[] }`. `mappingRuleSchema` valida `source`, `target` contra la whitelist (+ `custom.*`), y `valueMap`/`fallback`. RBAC ya = ADMIN/DIRECTOR/GERENTE/MARKETING.
- `POST /api/admin/connectors/[id]/test-mapping` (dry-run, NO persiste): body = `{ rules, sample? }`. Si `sample` ausente → usa `ConnectorLeadLog` más reciente del conector (`rawPayload.external` + `rawPayload.meta`). Devuelve `{ mapped, usedLastLead: boolean }`. RBAC igual.

### UI

`connections-view.tsx`: 3er botón "Editar mapeo" por conector Meta/IG (junto a Pausar/Eliminar) → drawer/modal `mapping-editor.tsx`:
- Lista de reglas: selector fuente → (question: input metaField | metadata: select de metadatos | constant: input value) → **selector de campo destino** con filtro insensible a acentos + orden alfabético (= ZohoFieldSelect del Hub) → si destino enum: editor value-map (pares valor→opción del enum) + fallback. "+ Agregar regla", ✕ quitar.
- Botón **"Probar"**: llama `test-mapping` (último lead o ejemplo escrito) → muestra el Contact resultante.
- Guardar → PUT. Errores 400/403 mostrados.

## Testing (TDD)

- `map-lead.test.ts`: 3 fuentes; fullName split; valueMap con match / sin match+fallback (omit/passthrough/fixed); **regresión `valueMap {}` = passthrough**; `parseRules` retrocompat (Record viejo + {} + rules nuevo); vacío omitido; constant siempre.
- `map-lead` integración: explicit-wins sobre deriveInvestmentProfile.
- zod `mappingRuleSchema` (target inválido rechazado, custom.* aceptado, valueMap ok).
- `test-mapping` route (RBAC, no persiste, usa último lead vs sample).
- `incomingLeadSchema`+`captureLead`: acepta contactType/temperature opcionales, fallback correcto.

## Fuera de v1

Import de formularios Meta; `platform`/`form_name` como metadatos; condiciones por regla; multi-regla al mismo target (last-wins); autopush a Zoho (N/A en el CRM).
