# Espejo del catálogo publicado en el CRM (F1) + catálogo enriquecido del agente IA (F3)

Fecha: 2026-07-27
Estado: aprobado por Luis
Repo: `propyte-crm`

## Problema

`/developments` del CRM lee `propyte_crm.developments` (Prisma local), que tiene **0 filas**:
la pantalla está vacía. El inventario real vive en el Hub (`real_estate_hub`) y es lo que
publica propyte.com.

Peor: hay **dos definiciones de "publicado"** conviviendo, y ninguna coincide con el sitio.

| Fuente | Gate | Registros |
|---|---|---|
| propyte.com (`Next_Propyte_web/src/lib/supabase/queries.ts`) | `v_developments` + `approved_at IS NOT NULL` + `deleted_at IS NULL` | **21 devs / 56 unidades** |
| `src/lib/hub/client.ts:38` (cotizador, inventario) | `Propyte_desarrollos.pipeline_status = 'Publicado'` | 16 |
| `src/lib/bot/hub-catalog.ts:35` (agente IA) | idem | 16 |

El agente IA recomienda desarrollos que no están en el sitio y omite 5 que sí lo están.

Verificado por SQL contra Supabase prod `oaijxdpevakashxshhvm` el 2026-07-27.

## Alcance

**Dentro:**
- F1 — `/developments` como espejo de lo publicado en propyte.com (desarrollos + unidades).
- F3 — catálogo del agente IA enriquecido y con el gate correcto.

**Fuera (specs propios):**
- F2 — acciones comerciales en la ficha: vincular a Deal, agregar a shortlist, cotizar,
  hold/release. Los modelos ya existen (`Deal.hubDevelopmentId`, `ShortlistItem.hubUnitId`,
  `Quote.hubUnitId`, `requestUnitHold`) — falta la UI.
- F4 — entidad `Company` (desarrolladoras, master brokers, agencias); migrar `ExternalBroker`.
- F5 — originación: "quién trae el desarrollo" (desarrollo ↔ empresa/contacto, rol, split).
  El Hub ya trae semillas: `developer_name`, `crm_relationship`, `commission_rate`,
  `contact_name`, `contact_phone`.

## Decisiones tomadas

| # | Decisión | Razón |
|---|---|---|
| D1 | Gate único = el del sitio: `approved_at IS NOT NULL AND deleted_at IS NULL` sobre `v_developments` / `v_units` | Es la definición operativa de "está en propyte.com". Las views ya aplican el media-gate (migración 032) que el sitio respeta. |
| D2 | El gate se escribe **una sola vez**, en una constante compartida | La divergencia 21 vs 16 nació de repetir el criterio. Ver `feedback_tope_duplicado_cliente_servidor`. |
| D3 | Espejo **estricto**: solo unidades publicadas (56) | Fiel al pedido ("espejo del sitio"). Mostrar vendidas/apartadas es quitar el gate en una query — fast-follow si Luis lo pide. |
| D4 | `/developments` es **read-only**; edición vive en el Hub | El CRM no posee inventario (P1 del speckit maestro). |
| D5 | El CRUD local queda en desuso, sin borrar | Reversible. Modelo Prisma y tablas vacías intactos. |
| D6 | El agente IA consulta **SQL en vivo**, no una tabla materializada | Cero desfase, cero job de sync que mantener. |

## Arquitectura

### Módulo nuevo: `src/lib/hub/catalog.ts`

Capa de lectura del catálogo publicado. SQL directo por Prisma al schema `real_estate_hub`,
mismo patrón y misma conexión que `src/lib/hub/client.ts` (decisión de Luis 2026-06-12).

```
const PUBLIC_GATE = `approved_at IS NOT NULL AND deleted_at IS NULL`
```

Exporta:

| Función | Uso | Devuelve |
|---|---|---|
| `listPublishedDevelopments(filters)` | lista de `/developments` | devs + conteos de unidades |
| `getPublishedDevelopment(id)` | ficha | dev completo |
| `listPublishedUnits({developmentId, ...})` | tabla de unidades de la ficha | unidades publicadas |
| `getPublishedUnit(id)` | detalle de unidad | unidad |
| `searchCatalog({budgetMin, budgetMax, zone, bedrooms})` | agente IA | unidades + su dev |

Todas devuelven `{ data, error }` — nunca `[]` silencioso ante fallo (ver "Errores").

`filters` de desarrollos: `search`, `city`, `zone`, `stage`, `priceMin`, `priceMax`,
`onlyWithAvailable`, `limit`.

**Columnas explícitas, nunca `SELECT *`.** `meta_title`, `meta_description`,
`detection_source`, `source_url`, `keywords` no salen de la capa: son internos y no deben
llegar al prompt del agente ni a la UI.

### Delegación de los consumidores existentes

`src/lib/hub/client.ts` (`listHubDevelopments`, `getHubDevelopment`, `listHubUnits`,
`getHubUnit`) pasa a delegar en `catalog.ts` **conservando sus firmas actuales**
(devuelven arrays / `T | null`): desenvuelven `{ data, error }` y hacen `data ?? []`,
logueando el error. Así el cotizador y demás callers no se tocan en esta fase.

`src/lib/bot/hub-catalog.ts` **sí** adopta `{ data, error }`, porque el bot necesita
distinguir "no hay inventario" de "no pude consultar" (ver "Manejo de errores"). Es el único
módulo cuya firma cambia, y arrastra **5 call sites + 3 mocks** que hay que actualizar en el
mismo commit:

- `src/lib/bot/bot-respond.ts`, `src/lib/bot/ai-actions.ts`, `src/lib/bot/claude.ts`
  (`catalogBrief`), `src/lib/agents/tools.ts`, `src/app/api/records/search/route.ts`
- mocks en `bot/ai-actions.test.ts`, `bot/bot-respond.agents.test.ts`,
  `bot/bot-respond.channel.test.ts`

`client.ts` conserva intacta su mitad de mutación (`requestUnitHold`, `releaseUnitHold`,
`confirmUnitHold` por REST al Hub con `x-hub-api-key`).

Efecto colateral esperado y deseado: el bot y el cotizador pasan de ver 16 desarrollos a
ver los 21 que están en el sitio.

### Pantalla `/developments`

`page.tsx` (server component): reemplaza `getDevelopments()` de `@/server/developments` por
`listPublishedDevelopments()`.

**Lista** — tarjeta por desarrollo:
- imagen de portada (`images[0]`), nombre (`publication_title ?? name`), desarrollador
  (`developer_name`), ciudad/zona
- rango de precio (`price_min_mxn`–`price_max_mxn`)
- `available_units` / `total_units`
- badge de etapa (`stage`), badge "Descuentos" si `discounted_units_count > 0`
- filtros: búsqueda, ciudad/zona, precio, etapa, sólo con disponibles

**Ficha `/developments/[id]`**:
- header: nombre, desarrollador, ubicación, botón **"Ver en propyte.com"** →
  `https://propyte.com/es/desarrollos/{slug}`
- galería (`images`), descripción (`description_es`), amenidades (`amenities`)
- entrega y avance (`estimated_delivery`, `delivery_text`, `construction_progress`)
- financiamiento del desarrollo (`financing_down_payment`, `financing_months`,
  `financing_interest`), ROI (`roi_projected`, `roi_rental_monthly`, `roi_appreciation`)
- **tabla de unidades publicadas**: `unit_number`, `typology`, `bedrooms`/`bathrooms`,
  `built_area_m2`, `price_mxn`/`price_usd`, descuento si `is_discount_active`, `status`,
  link a la unidad en el sitio (`/es/propiedades/{slug}`)
- link "Editar en el Hub" solo para roles admin

**RBAC:** lectura para cualquier usuario autenticado — es catálogo de venta. Ningún control
de escritura en la pantalla.

### Retiro del CRUD local

`src/server/developments.ts` queda sin llamadores desde `/developments`. Se marca deprecated
con comentario apuntando a `hub/catalog.ts`. Modelos Prisma `Development`/`Unit` y sus tablas
(0 filas) quedan intactos.

**Antes de desconectar:** grep de importadores de `@/server/developments` para no matar algo
vivo (`feedback_dead_component_check`). Lo que siga usándolo se documenta, no se borra.

### Agente IA (F3)

`bot/hub-catalog.ts` delega en `catalog.ts` y expone al bot lo que hoy no puede responder:

- por desarrollo: precio min/max, unidades disponibles, etapa, entrega estimada, amenidades,
  ROI, zona/ciudad, desarrollador
- por unidad: recámaras, baños, m², precio MXN/USD, descuento activo, y **esquemas de pago**
  (`fin_directo`, `fin_hipotecario`, `fin_enganche_pct`, `fin_meses_opciones`, `fin_tasa`,
  `fin_esquemas_pago`, `fin_preventa`)
- búsqueda por presupuesto, zona y recámaras vía `searchCatalog`

Read-only. Sin campos internos en el prompt (ver "Columnas explícitas").

## Manejo de errores

Hoy `client.ts` captura la excepción y devuelve `[]`: una BD caída se ve **idéntica** a
"no hay desarrollos publicados". La capa nueva devuelve `{ data, error }` y:

- la UI distingue **vacío legítimo** ("No hay desarrollos publicados en el sitio") de
  **fallo** ("No se pudo cargar el catálogo del Hub") y en el segundo caso ofrece reintentar
- el bot, ante `error`, no afirma que no hay inventario: escala o pide reintentar
- se loguea con la clave `err` (`feedback_pino_err_key_serializer`)

## Verificación

1. **Test del gate** — los IDs de `listPublishedDevelopments()` == los de
   `v_developments WHERE approved_at IS NOT NULL AND deleted_at IS NULL` (hoy 21).
   Igual para unidades (hoy 56).
2. **Test de no-divergencia** — `listHubDevelopments()` (client.ts) y el catálogo del bot
   devuelven el mismo conjunto de IDs que la capa nueva. Este test es el que impide que
   vuelvan a separarse.
3. **Test de columnas** — la salida de la capa no contiene `meta_title`, `meta_description`,
   `detection_source`, `source_url`.
4. **Paridad contra el sitio** — conteo y slugs del CRM vs `propyte.com/es/desarrollos`.
5. **Estados de la UI** — vacío, error y carga verificados por render, no solo por HTTP 200
   (`feedback_verify_prod_code_path`).
6. **Gates** — `tsc --noEmit` 0, `next build` verde, vitest verde.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El bot cambia de comportamiento (16→21 devs) sin que nadie lo note | Está en la verificación y en el changelog; es el fix pedido, no un efecto secundario |
| `v_developments` cambia de columnas y rompe el SQL crudo | Columnas explícitas + test de forma sobre el resultado |
| Alguien vuelve a escribir el gate a mano en una query nueva | Constante compartida + test de no-divergencia (#2) |
| Un caller vivo de `@/server/developments` se rompe | Grep de importadores antes de desconectar; el módulo no se borra |

## Fast-follows anotados

- Mostrar unidades vendidas/apartadas en la ficha (quitar el gate en esa query).
- F2: acciones comerciales sobre la ficha.
- F4/F5: Empresas y originación del desarrollo.
