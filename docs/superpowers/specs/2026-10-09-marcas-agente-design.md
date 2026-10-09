# Marcas del agente — separación por marca en las respuestas del bot

**Fecha:** 2026-10-09
**Estado:** borrador para revisión
**Motivo inmediato:** dar de alta Yaxnáh Caucel (Mérida, AVICA) en el CRM sin que el agente le conteste a sus prospectos como "Propyte, Riviera Maya".
**Reemplaza:** la "Fase C — Bot por cuenta" que quedó sin construir en `2026-06-22-whatsapp-multicuenta-design.md` (§58-60, §158).

Esta es la **entrega 1 de 3**:

1. **Esta spec:** la marca como dato, las respuestas del agente por marca y la atribución.
2. Visibilidad por usuario con interruptores por marca, más "siempre ves lo que tienes asignado".
3. Filtros y reportes por marca.

Las entregas 2 y 3 tendrán su propia spec. Esta deja listos los datos que van a necesitar.

---

## 1. Objetivo y criterios de éxito

Yaxnáh y Propyte son segmentos distintos, con esfuerzos de marketing separados. Cuando una conversación entra por una cuenta de una marca, el agente debe:

- presentarse como esa marca, con su propia información oficial;
- ofrecer solo los desarrollos de esa marca;
- no usar nada que se haya hablado con el mismo cliente desde otra marca.

El esquema debe admitir **N marcas** sin cambiar código: una marca nueva se da de alta desde el panel.

**Criterios de éxito (verificables):**

1. Un mensaje a una cuenta asignada a una marca no predeterminada se responde con la presentación, el conocimiento y el catálogo de esa marca. El prompt no contiene "Propyte", "Riviera Maya" ni los ejemplos de Tulum.
2. Un mensaje a una cuenta sin marca, o con la marca predeterminada, produce **exactamente el mismo prompt que hoy**. Lo garantiza una prueba con el prompt actual congelado.
3. Una marca con el agente apagado no contesta. Su conversación pasa una sola vez a la bandeja de humanos con un motivo visible.
4. Prender Instagram para una marca no prende Instagram para las demás.
5. Un número de WhatsApp que llega al webhook sin cuenta registrada nunca recibe respuesta automática desde el número global.
6. Una cuenta de WhatsApp se puede dar de alta y probar desde Conexiones.
7. Las fotos y audios entrantes de un número con cuenta propia se descargan con el token de esa cuenta.
8. Un lead entrante por una cuenta con marca queda atribuido a esa marca (contacto ↔ marca) y toma la plaza predeterminada de la marca.
9. La suite completa (`npm test`), `npm run typecheck` y `npm run lint` pasan.

**Fuera de alcance** (entregas 2 y 3, o después):

- Filtrar qué ve cada usuario en contactos, bandeja, pipeline, etc. Hasta la entrega 2, **los leads de una marca nueva son visibles para todo el equipo**. Ver §9.
- Selectores de marca en pantallas y reportes.
- Separar Nativa en su propia marca. Sus cuentas siguen en la marca predeterminada; se podrá hacer después asignándolas a una marca "Nativa" desde el panel, sin código.
- Agent Studio (`src/lib/agents/runner.ts`): opera entre contactos, no en una conversación, y sigue siendo global.
- Los contactos siguen siendo **compartidos** entre marcas. El dedup por teléfono, correo e IG no cambia (decisión del 2026-10-09: Propyte también manejará productos de Yaxnáh).

---

## 2. Modelo de datos

Hay una migración manual nueva, `prisma/migrations-manual/2026-10-09-brands.sql`. Es **aditiva e idempotente**: `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`. Sigue el patrón de `2026-09-30-contact-whatsapp-bsuid.sql`.

No toca columnas de `propyte_crm.users`, porque el Hub comparte esa tabla (`.claude/AI_TASKS.md`).

### 2.1 `Brand` (tabla `propyte_crm.brands`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `name` | text, único | Nombre visible ("Yaxnáh Caucel") |
| `slug` | text, único | Identificador estable ("yaxnah") |
| `isDefault` | bool | **Exactamente una** con `true`, garantizado con un índice único parcial `WHERE "isDefault"`. La migración la siembra con el nombre "Propyte". |
| `persona` | text, null | Línea de presentación del agente. `null` en la predeterminada significa "usa el texto actual" (ver §3.2). |
| `knowledge` | text, null | Información oficial citable: precios y promociones vigentes, crédito, horario, contacto oficial, **qué no se puede decir** |
| `developmentIds` | text[] | IDs de desarrollos del Hub (`real_estate_hub.v_developments.id`) que el agente puede citar. Vacío = sin catálogo. |
| `defaultPlaza` | `Plaza`, null | Plaza que toman los leads nuevos que entran por cuentas de la marca |
| `enabledChannels` | jsonb, null | Canales en que contesta el agente. `null` = hereda `BotConfig.enabledChannels`. |
| `tonePreset` | `BotTonePreset`, null | `null` = hereda el global |
| `playbookId` | uuid, null → `bot_playbooks` | Playbook propio de la marca (opcional) |
| `marketingOwnerUserId` | uuid, null → `users` | Responsable de "vengo a ofrecer servicios". `null` = el global de hoy (`getMarketingOwnerId`). |
| `botEnabled` | bool, default **false** | Interruptor del agente para esa marca. La predeterminada se siembra en `true`. |
| `createdAt` / `updatedAt` / `deletedAt` | | Borrado lógico, como el resto del esquema |

Una marca no predeterminada nace con el agente **apagado**, a propósito: nadie la prende hasta revisarla.

La relación inversa en `User` y en `BotPlaybook` es solo de Prisma y no agrega columnas a `users`.

### 2.2 `LeadConnector.brandId`

Es una columna `uuid NULL` → `brands`, con índice. `null` = marca predeterminada. **No se rellena nada**: las cuentas actuales quedan en `null` y se comportan igual que hoy.

`config.brand`, el texto que hoy se muestra en la bandeja ("WhatsApp · Marca"), sigue funcionando. Si la cuenta tiene `brandId`, la bandeja muestra `brand.name` y, si no, `config.brand`.

### 2.3 `ContactBrand` (tabla `propyte_crm.contact_brands`)

Registra las marcas por las que llegó cada contacto. Lo necesitan las entregas 2 y 3, y aquí solo se escribe.

| Campo | Notas |
|---|---|
| `contactId`, `brandId` | Únicos juntos |
| `firstConnectorId` | uuid, null: la cuenta por la que llegó la primera vez con esa marca |
| `createdAt` | |

**Regla de pertenencia** (la usará la entrega 2): un contacto pertenece a las marcas de sus filas, y **un contacto sin filas pertenece a la predeterminada**. Por eso no hace falta rellenar los contactos existentes.

La función `attachBrand(contactId, brandId, connectorId?)` mantiene esa regla. Si el contacto ya existía, no tenía filas y la marca nueva no es la predeterminada, primero inserta la fila de la predeterminada, porque hasta ese momento era un contacto de Propyte. Así un cliente de Nativa que luego escribe a Yaxnáh queda en **ambas** marcas y no "desaparece" de Propyte.

---

## 3. Respuesta del agente

### 3.1 Resolución de la marca

`src/lib/brands/resolve.ts`:

- `resolveBrandForConnector(connectorId)` devuelve:
  - la predeterminada, si no hay cuenta o la cuenta no tiene `brandId`;
  - la `Brand` de la cuenta, si existe y no está borrada;
  - un resultado de **"marca no disponible"**, si la cuenta tiene `brandId` pero la marca está borrada o no se puede leer. El agente no contesta (§7).
- `isBrandScoped(brand)` = `!brand.isDefault`. Todo el comportamiento nuevo depende de esta bandera. **Si es falsa, el código va exactamente por el camino de hoy.**

La marca de una conversación es la de su cuenta (`Conversation.connectorId`). No se duplica en la tabla `conversations`.

### 3.2 `bot-respond.ts`: camino con marca

Si la marca resuelta **no** es la predeterminada:

1. **Canales:** `shouldBotRespondForChannel` usa `brand.enabledChannels ?? config.enabledChannels`. El interruptor global `BotConfig.botEnabled` sigue mandando sobre todas las marcas.
2. **Interruptor de marca:** con `brand.botEnabled = false` no se genera respuesta. Si la conversación está en `BOT`, se llama una vez a `escalateToHuman(conv.id, "Agente de la marca «{name}» apagado")`. Esa llamada la pasa a `HUMAN`, así que no se repite.
3. **Historial:** solo los mensajes de **esta conversación** (`conversationId = conv.id`), no los de todo el contacto. La guarda anti-ráfaga sigue mirando todo el contacto, que es lo conservador.
4. **Sin agentes por segmento, sin clasificador y sin playbook global.** Sus textos mencionan a Propyte y la Riviera Maya. Si `brand.playbookId` existe y está activo, se usa ese playbook con `runPlaybookStep`, igual que hoy. Como el clasificador no corre, los contactos de la marca no reciben `contactType` automático.
5. **Catálogo:** `findMatchingDevelopments({ developmentIds: brand.developmentIds, limit: 10 })`, **sin** filtro de presupuesto ni zona: el agente ve todo el inventario publicado de su marca. Con `developmentIds` vacío no hay bloque de catálogo. Si el Hub falla, se omite el bloque, como hoy.
6. **Tono:** `brand.tonePreset ?? config.tonePreset`.
7. **Escalamiento a marketing:** `routeToUserId = brand.marketingOwnerUserId` si apunta a un usuario activo y, si no, `getMarketingOwnerId()`.
8. **Envío:** sin cambios. Sale por `conv.connectorId`.

### 3.3 Prompt (`claude.ts`)

`buildSystemPrompt` recibe un parámetro opcional `brand?: BrandPromptInput`, con `name`, `persona` y `knowledge`.

- **Sin `brand`**: el resultado es **idéntico byte a byte** al de hoy. Una prueba compara el prompt completo contra uno congelado antes del cambio.
- **Con `brand`**:
  - Reemplaza la línea "Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya." por `brand.persona`.
  - Si `persona` está vacía, usa "Eres el asistente comercial de {name}.".
  - Agrega, justo después: "Representas únicamente a {name}. No menciones ni ofrezcas otras marcas, desarrollos o ciudades; si preguntan por algo fuera de {name}, ofrece que un asesor lo contacte."
  - Conserva **todas** las demás reglas de `buildBrandRules`: data-gate, disparadores y token `[ESCALAR]`, regla #790, token de marketing, idioma del último mensaje, largo y formato WhatsApp, honestidad sobre ser IA.
  - **Quita los ejemplos de tono** (`fewShot`, todos de Tulum) y conserva `voiceGuidance`.
  - Agrega el bloque de conocimiento: "Información oficial de {name} (puedes citarla; lo que no esté aquí ni en el catálogo, no lo inventes):\n{knowledge}".
  - El encabezado del catálogo pasa de "Catálogo publicado en propyte.com" a "Catálogo oficial de {name}". `catalogBrief` recibe el encabezado como parámetro, y el valor por defecto es el de hoy.

El linter de marca (`lintBrandVoice`) se aplica igual a todas las marcas.

### 3.4 Catálogo (`hub-catalog.ts`, `src/lib/hub/catalog.ts`)

`findMatchingDevelopments` y `searchCatalog` aceptan `developmentIds?: string[]`. Si viene, la consulta a `v_units` agrega `development_id = ANY($ids)`.

El gate público no cambia (`approved_at IS NOT NULL AND deleted_at IS NULL`): una marca solo puede citar lo que está publicado.

### 3.5 Borradores AI_DRAFT (`ai-actions.ts`)

La marca se toma de la **conversación más reciente** del contacto (`lastMessageAt desc`) y se resuelve por su cuenta. Si la marca no es la predeterminada, se aplican las mismas reglas de §3.2: sin agentes por segmento, catálogo y prompt de la marca, e historial de esa conversación.

La rama BOT_REPLY ya pasa por `botRespond`, así que hereda el comportamiento.

---

## 4. Entrada de leads y atribución

### 4.1 `capture-lead.ts`

- Si `opts.connectorId` resuelve a una marca **no predeterminada**: `targetPlaza = brand.defaultPlaza ?? resolveTargetPlaza(señales)`.
- Si no, se mantiene la lógica actual por señales.
- `attachBrand` se ejecuta tanto para contactos nuevos como para existentes, siempre que haya `connectorId`. Corre **después** de la transacción del candado de alta (`withIntakeLock`), no dentro: un error dentro de una transacción de Postgres la aborta, y la atribución nunca debe tumbar la entrada de un lead. Es idempotente (upsert sobre `contactId + brandId`) y nunca lanza.
- **Un contacto existente no cambia de plaza ni de asesor** por escribirle a otra marca. Eso es reparto, y lo decide la entrega 2 o una regla de ruteo.

`resolveTargetPlaza` y sus listas de palabras quedan solo como respaldo para leads sin cuenta (campañas de Lead Ads de la marca predeterminada, WhatsApp directo). Se actualiza el comentario de `MERIDA_SIGNALS`: ya no está "reservado para Yaxnah"; esa plaza la da la marca.

### 4.2 Lead Ads (`api/connectors/meta/webhook/route.ts`)

Hoy, si el `page_id` no coincide con ninguna cuenta, el lead se asigna a la cuenta cuya firma validó, y puede ser de otra marca. El cambio:

- **Con 2 o más cuentas META activas:** sin coincidencia de `page_id`, el lead **no** se asigna. Se registra un `console.warn` con el `page_id` y se responde 200, para que Meta no reintente para siempre. La entrega 3 podrá mostrarlos en un panel de "leads huérfanos".
- **Con una sola cuenta META activa:** se mantiene el respaldo actual, por compatibilidad con la instalación de una sola cuenta.

### 4.3 WhatsApp: número sin cuenta (`api/webhooks/whatsapp/meta/route.ts`)

Si `metadata.phone_number_id` **no** coincide con ninguna cuenta activa **y** es distinto de `META_WA_PHONE_NUMBER_ID`:

- el mensaje se ingiere igual, con `connectorId` null, para que no se pierda;
- **no** se agrega a `botTargets`, así que el agente no contesta;
- se registra un `console.warn` con el `phone_number_id`.

Esto evita que el cliente de una marca reciba una respuesta automática desde el WhatsApp de otra.

---

## 5. WhatsApp en Conexiones

- **Prueba de conexión real.** Se agrega `testKind: "whatsapp"` en `src/lib/connectors/registry.ts` y su caso en `test-connection.ts`. La prueba hace `GET graph.facebook.com/v24.0/{phoneNumberId}?fields=display_phone_number,verified_name` con el `accessToken`. Si responde bien, muestra "{verified_name} · {display_phone_number}" y el asistente habilita "Guardar y activar".
- **`accessToken` obligatorio** en el formulario de WhatsApp. En la práctica ya lo es: `resolveWhatsAppSender` lanza un error si falta.
- **Media por cuenta.** `resolveWaMediaToStorage(mediaId, token?)` usa el `accessToken` de la cuenta resuelta y, si no hay cuenta, `META_WA_ACCESS_TOKEN` como hoy. El webhook le pasa el token cuando resolvió la cuenta.

---

## 6. Panel

- **Configuración → Bot conversacional:** una tarjeta nueva, **"Marcas del agente"**, que abre `/admin?tab=botBrands` y se agrega en `config-center.tsx`. Sus puntos son "Presentación y conocimiento por marca", "Catálogo por marca", "Canales y encendido por marca" y "Cuentas asignadas".
- **Pestaña "Marcas del agente"** (`admin-content.tsx`, un componente nuevo en `src/components/admin/brands/`):
  - Lista de marcas con la predeterminada marcada; esta no se puede borrar ni dejar de ser predeterminada desde aquí.
  - Alta y edición de todos los campos de §2.1.
  - `developmentIds` se eligen con un buscador de desarrollos del Hub publicados.
  - El playbook se elige de la lista existente y el responsable de marketing de la lista de usuarios activos.
  - Interruptor "Agente encendido".
  - Lista de solo lectura de las cuentas asignadas a la marca.
- **Conexiones:** un selector "Marca" en el alta (`connect-wizard.tsx`) y en la edición de una cuenta. `POST /api/admin/connectors` y `PATCH /api/admin/connectors/[id]` aceptan `brandId`, que se valida contra marcas no borradas.
- **Permisos:** los mismos que la configuración del bot hoy: ADMIN, DIRECTOR y GERENTE (`ADMIN_ROLES` en `src/server/bot-config.ts`). La lectura de marcas para el selector de Conexiones usa los roles de `/conexiones`.
- **API:**
  - `GET /api/admin/brands` y `POST /api/admin/brands`;
  - `PATCH /api/admin/brands/[id]` y `DELETE /api/admin/brands/[id]` (lógico; rechaza la predeterminada y las marcas con cuentas activas);
  - `GET /api/admin/brands/developments?q=` (buscador del Hub).
  - Validación con zod en `src/lib/validations/`, como el resto de rutas admin.

---

## 7. Manejo de errores

- Si la cuenta **no** tiene `brandId`, la marca se resuelve sin consultar la base. Si no se puede leer la marca predeterminada, se usa el camino actual, sin marca, y se registra el error. Nunca impide que el agente funcione para Propyte.
- **Excepción:** si la cuenta tiene `brandId` pero la marca no se puede leer, el agente **no** contesta y se registra un `console.error`. Contestar como Propyte a un cliente de otra marca es justo el error que esta spec existe para evitar. Mismo criterio que `resolveWhatsAppSender`.
- Un playbook de marca inexistente o inactivo hace que la marca funcione sin playbook, con el objetivo por defecto.
- Un `marketingOwnerUserId` inactivo hace que se use el responsable global.

---

## 8. Pruebas

Con Vitest y el mismo estilo de mocks de `@/lib/db` que usa el repo:

- `claude.test.ts`:
  - el prompt sin marca es **igual** al prompt congelado de hoy;
  - con marca: no contiene "Propyte", "Riviera Maya" ni "Tulum"; contiene la presentación, la regla de exclusividad y el conocimiento; conserva `[ESCALAR]`, `[ESCALAR_MARKETING]` y la regla #790.
- `bot-respond.brand.test.ts`:
  - historial por conversación;
  - no consulta `botAgentProfile`;
  - catálogo por `developmentIds` sin presupuesto ni zona;
  - canales por marca;
  - marca apagada → `escalateToHuman` una vez y sin envío;
  - marca ilegible → no envía;
  - responsable de marketing por marca;
  - **una cuenta sin marca sigue el camino de siempre**.
- `brands/resolve.test.ts` y `brands/attach.test.ts`: la regla de pertenencia, incluido el caso del contacto existente sin filas.
- `capture-lead`: plaza por marca, `attachBrand` con contacto nuevo y existente, y que la plaza y el asesor de un contacto existente no cambian.
- Lead Ads: estricto con 2 o más cuentas y con respaldo con una sola.
- WhatsApp webhook: número desconocido → se ingiere sin agente; número global → sin cambios.
- `test-connection` WhatsApp: correcto, token inválido y número inexistente. `media` usa el token de la cuenta.
- Rutas `api/admin/brands`: permisos, validación, que no se pueda borrar la predeterminada y que `PATCH` de una cuenta acepte `brandId`.

La suite completa, `typecheck` y `lint` deben pasar, como en el CI (`.github/workflows/ci.yml`).

---

## 9. Puesta en marcha y riesgos

**Orden:**

1. PR → revisión.
2. **Aplicar la migración en Supabase ANTES del merge.** Es manual y requiere aprobación explícita.
   - Es obligatorio: el código nuevo lee `lead_connectors.brandId`, y Prisma incluye todas las columnas del modelo en cada consulta. Desplegar sin la columna rompería **todas** las lecturas de cuentas, no solo las de marcas.
   - La migración es inofensiva para el código actual: solo agrega una tabla, una columna que puede quedar vacía y una fila.
3. Merge → despliegue.
4. Crear la marca "Yaxnáh Caucel" desde el panel:
   - plaza MERIDA;
   - desarrollo del Hub `76dfb7d5-4755-4938-8bf2-07aed5d2df15`;
   - agente **apagado**.

   Su conocimiento se redacta a partir de `yaxnah-contexto-maestro.md` (corte 3-oct-2026) y **lo validan Luis y Rafa** antes de prenderla. Deben respetarse las reglas "nunca publicar": m² en conflicto, tasas bancarias, bono de $60,000, Real Caucel, rendimientos.
5. Hub: cargar Muyal y Kanté y reflejar las promociones vigentes del Kannah. Hoy solo hay **1 unidad** publicada (Kannah a precio de lista, $2,090,000). Mientras tanto, las promociones van en el conocimiento de la marca.
6. Conectar las cuentas de Yaxnáh en la misma app de Meta y asignarlas a la marca.
7. Probar con un número de prueba con el agente encendido. Después, prenderlo para el público.

**Riesgos y decisiones:**

- **Visibilidad.** Hasta que salga la entrega 2, los leads de Yaxnáh serán visibles para todo el equipo de Propyte en contactos, bandeja y pipeline. Conectar las cuentas en producción antes de la entrega 2 lo debe decidir explícitamente marketing/Dirección.
- **Plaza MERIDA sin equipo.** No hay asesores ni gerentes en MERIDA (`scripts/seed-sales-team.ts`), así que los leads caen al Pond y se notifica a todos los gerentes (`routing.ts:130-133`). Hay que definir el equipo con Rafa y Malaquías antes de abrir al público.
- **Auditor de QA.** `.claude/skills/crm-auditor/safety-contract.md:30` y `provisioning.md:34-36` usan MERIDA como "plaza sin inbound" para sus asesores de prueba. Se actualiza en esta entrega para usar una plaza o marca sin tráfico real.
- **Mismo contacto en dos marcas.** El historial del agente ya está separado por conversación, pero la ficha del contacto (plaza, asesor) es una sola. Lo resuelve la entrega 2.
