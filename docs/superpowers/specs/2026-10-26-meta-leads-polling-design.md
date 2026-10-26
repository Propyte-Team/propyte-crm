# Leads de Meta: webhook + polling + bitácora — diseño

**Fecha:** 2026-10-26 · **Estado:** propuesta, sin implementar · **Base:** `origin/main` @ `9b041ef0`
**Referencia externa:** patrón de `server/services/ads-leads.ts` de GoHyperLevel (AGPL-3.0 — se toma la
idea, no el código).

## 1. Problema

Un lead de Meta ya está pagado. Hoy el CRM solo se entera de él si **Meta nos avisa por webhook**. Si
ese aviso nunca llega, no queda ninguna fila en ningún lado: el lead es invisible y nadie puede
reclamarlo.

Casos reales en los que el aviso no llega (no son hipotéticos en esta casa):

- La app se desuscribe de la página (`subscribed_apps`) o pierde el campo `leadgen` — por eso existe
  `scripts/probe-meta-subscriptions.ts`.
- Deploy sin reinicio de PM2: la ruta nueva o arreglada no responde aunque el código esté en `main`.
- Caída del CRM más larga que la ventana de reintentos de Meta (el 11–14 sep estuvimos 3 días en 500).
- Token de página caducado: el webhook llega, pero el lead queda en `ERROR` **sin campos mapeados** y
  el replay no lo puede rehacer solo (ver §2).

## 2. Qué tenemos ya vs. qué hace GoHyperLevel

| Pieza | Propyte CRM (`main`) | GoHyperLevel | Veredicto |
|---|---|---|---|
| Firma `X-Hub-Signature-256` | ✅ contra el `appSecret` de cada conector activo | ✅ igual | Empate |
| Ruteo página → cuenta | ✅ por `page_id`; sin cuenta → fila `ERROR` `pagina_sin_cuenta` | ✅ por `page_id` + secreto con que se firmó | Empate |
| Datos del lead | Se piden a Graph con el `leadgen_id` | Igual: el webhook solo nombra el lead | Empate |
| Bitácora por lead | ✅ `ConnectorLeadLog`, `UNIQUE(connectorId, externalLeadId)`, reserva **antes** de Graph (#713) | `ads_leads`, `UNIQUE(location, leadgen_id)` | Empate; la nuestra reserva antes, la de ellos no |
| Estados | `RECEIVED · PROCESSED · DUPLICATE · ERROR` | `imported · skipped · failed` | Nos falta `SKIPPED` (lead sin datos de contacto); menor |
| Si algo falla | **503 → Meta reintenta** | 200 y confía en el polling | **Nosotros mejor** |
| Replay | ✅ cron cada minuto, solo `ERROR` **con** `_mapped` | El polling re-importa los `failed` | Nosotros: replay más fino, **pero no recupera los que fallaron antes del mapeo** |
| Origen del lead en la bitácora | ❌ no se guarda | ✅ `source: webhook \| poll` | **Falta** |
| **Polling de respaldo** | ❌ **no existe** | ✅ `{page}/leadgen_forms` + `{form}/leads?filtering=time_created>since` | **Falta — es el hueco principal** |
| `RECEIVED` encallado (proceso muerto a media captura, `maxDuration` 30 s) | ❌ nadie lo mira | ❌ tampoco | Falta en ambos |
| Tope de reintentos / backoff | ❌ el replay reintenta cada minuto para siempre | ❌ tampoco | Falta en ambos |

**Conclusión:** el webhook y la bitácora ya están al nivel de GoHyperLevel o por encima. Lo único que
vale la pena traer es el **polling de respaldo**, más tres cabos que tenemos sueltos (origen, encallados
y tope de reintentos).

## 3. Diseño

### 3.1 Extraer la ingesta común (refactor, sin cambio de comportamiento)

Hoy el mapeo Meta → `mapped` vive dentro de `POST` en `api/connectors/meta/webhook/route.ts`. Se extrae
a `src/lib/intake/meta-lead.ts`:

```ts
ingestarLeadMeta(conector, lead: LeadGraph, origen: "WEBHOOK" | "POLL" | "REPLAY")
  → { status: "PROCESSED" | "DUPLICATE" | "ALREADY_PROCESSED" | "ERROR"; contactId?: string }
```

Hace exactamente lo de hoy: `external` + `metadata` → `mapLead(DEFAULT_META_RULES + fieldMap)` →
atribución → `processIncomingLead`. El webhook la llama después de su `fetch` a Graph; el polling, con
el lead tal cual llega de `/{form}/leads`, que ya trae `field_data`, `ad_*`, `adset_*` y `campaign_*`
(**no hace falta un segundo fetch por lead**).

### 3.2 Polling: `GET /api/cron/connectors/meta`

Mismo patrón que `cron/connectors/tiktok` (`rechazoCron`, `maxDuration = 60`). Crontab del VPS cada
**15 min** (los crons viven en la crontab de root, no en el panel; evitar los minutos pares que ocupa el
autodeploy: `7,22,37,52 * * * *`).

Por cada `LeadConnector` `provider=META, status=ACTIVE, deletedAt=null`:

1. **Formularios:** `config.formIds` si existe (respeta el alcance actual del conector); si no,
   `GET {pageId}/leadgen_forms?fields=id,name,status&limit=100`, descartando `DELETED`.
2. **Ventana:** `since = max(config.metaPoll.cursorAt − 10 min, ahora − 7 días)`. Los 10 min de traslape
   cubren leads con `created_time` atrasado; la idempotencia absorbe los repetidos. En la primera corrida
   no hay cursor: 7 días.
3. **Leads:** `GET {formId}/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic&limit=100&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":<since>}]`,
   paginando con `paging.cursors.after`. Tope: 10 páginas por formulario y por corrida.
4. **Filtro barato:** un solo `findMany` de `ConnectorLeadLog` por conector con
   `externalLeadId IN (…ids)` y `status IN (PROCESSED, DUPLICATE)`, para saltar sin tocar nada lo que el
   webhook ya metió (el caso normal: 100 % de lo que regresa el polling).
5. Lo que queda → `ingestarLeadMeta(conector, lead, "POLL")`. Reusa la reserva, así que un lead que
   llegó por webhook y quedó en `ERROR` **sin** `_mapped` se completa aquí: el polling trae los datos
   que el webhook no pudo pedir.
6. **Cursor:** se avanza a la hora de *inicio* de la corrida **solo si todos los formularios
   respondieron**. Si uno falla, el cursor no se mueve y la siguiente corrida vuelve a cubrir la ventana
   (GoHyperLevel lo avanza siempre; aquí no, porque un formulario caído perdería su ventana).

**Señal de salud (el valor principal):** en operación normal el polling **no recupera nada**, porque el
webhook llegó primero. Cada lead con origen `POLL` es un lead que el webhook se perdió. Si una corrida
recupera ≥ 1, se escribe `lastError` en el conector ("N leads entraron por polling: el webhook no
llegó") y aparece en Conexiones. Así detectamos una suscripción rota en ≤ 15 min, no días después
comparando contra Ads Manager.

### 3.3 Bitácora: columnas nuevas en `connector_lead_logs`

Migración manual (`prisma/migrations-manual/`, como `cronologia-field-changes`):

| Columna | Tipo | Para qué |
|---|---|---|
| `origen` | `TEXT` default `'WEBHOOK'` | `WEBHOOK · POLL · REPLAY`: quién la *completó*. Es la señal de §3.2 |
| `intentos` | `INT` default `0` | Se incrementa en cada intento que termina en `ERROR` |
| `ultimoIntentoAt` | `TIMESTAMPTZ` null | Para el backoff |
| `formId` | `TEXT` null | Hoy solo está dentro de `rawPayload`; columna para filtrar en el panel |

Sin enums nuevos ni cambios a la llave única. Índice nuevo: `(status, ultimoIntentoAt)`.

### 3.4 Replay: tres ajustes a `reprocesarLeadsFallidos`

1. **Encallados:** también toma las filas `RECEIVED` con `receivedAt < ahora − 15 min` (el proceso murió
   entre la reserva y el `update` final).
2. **Re-fetch para filas META sin `_mapped`:** en vez de saltarlas, pide `GET {leadgen_id}` a Graph con
   el token del conector y llama a `ingestarLeadMeta(…, "REPLAY")`. **Excepción:** `motivo:
   "pagina_sin_cuenta"` sigue saltándose (no hay token de esa página).
3. **Backoff y tope:** se salta una fila si `ultimoIntentoAt > ahora − min(2^intentos, 360) min`; con
   `intentos ≥ 8` deja de reintentarse (sigue en `ERROR`, visible en el panel de leads fallidos). Esto
   frena el `errorCount` inflado por reintentar lo mismo cada minuto.

### 3.5 Lo que NO cambia

- El webhook sigue siendo la vía principal (SLA < 5 min). El polling es red de respaldo, no reemplazo.
- La respuesta 503 ante fallos se queda: es mejor que lo de GoHyperLevel.
- El conector Meta → Zoho del **Hub** es otro camino con otra tabla (`meta_leads`); esto no lo toca.

## 4. Riesgos y cosas por verificar antes de construir

- **Permisos del token de página:** `/{leadgen_id}` ya funciona con `leads_retrieval`. Listar
  `/{page}/leadgen_forms` y `/{form}/leads` puede pedir además `pages_manage_ads` / `pages_read_engagement`.
  **Verificar con `probe-meta-subscriptions.ts`** (o una llamada manual) por cada página antes del F1.
  Si falta el permiso y no hay `config.formIds`, el paso 1 falla: el conector queda con `lastError` y no
  se mueve el cursor (no se pierde nada, pero no hay respaldo).
- **Token caducado (~60 días):** el polling también fallará. Es la misma causa raíz que #713; la
  solución de fondo es un token de **System User** sin caducidad. Fuera de alcance, pero el polling la
  hace visible cada 15 min.
- **Leads orgánicos / de prueba** (`is_organic`, herramienta de prueba de Meta) entrarían por polling
  igual que por webhook: mismo comportamiento que hoy.
- **Volumen:** 19 formularios × 4 corridas/h ≈ 76 llamadas/h, más paginación. Muy por debajo del
  límite de Graph.

## 5. Fases

| Fase | Qué | Migración | Riesgo |
|---|---|---|---|
| **F1** | §3.1 refactor + §3.2 polling (origen y formId van en `rawPayload`, sin columnas) + crontab | No | Bajo: solo agrega |
| **F2** | §3.3 columnas + §3.4.1 encallados + §3.4.3 backoff | Sí (manual) | Medio: toca el replay que corre cada minuto |
| **F3** | §3.4.2 re-fetch desde Graph + aviso en Conexiones cuando el polling recupera leads | No | Bajo |

**Pruebas:** `route.test.ts` del webhook debe seguir verde tras el refactor sin tocar sus aserciones
(prueba de que §3.1 no cambió comportamiento). Nuevo `cron/connectors/meta/route.test.ts`: lead ya
procesado se salta sin escribir; lead nuevo entra con origen `POLL`; formulario que falla no mueve el
cursor; paginación con `after`. `reserva-y-replay.test.ts`: encallado, backoff, tope y re-fetch.

## 6. Decisiones abiertas (Luis)

1. Frecuencia del polling: **15 min** (propuesta) o 5 min como TikTok.
2. Ventana máxima hacia atrás: **7 días** (propuesta). Meta guarda los leads 90 días; se podría correr
   una vez con 90 días para auditar lo que se haya perdido desde el arranque del CRM.
3. Sin `config.formIds`: ¿el polling recorre **todos** los formularios de la página (propuesta) o solo
   los que ya se vieron llegar por webhook?
4. Tope de reintentos: **8** (propuesta, ≈ 6 h con el backoff).
