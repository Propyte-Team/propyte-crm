# Marcas del agente: correcciones de seguimiento (PR #121)

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:subagent-driven-development. Pasos con casillas (`- [ ]`).

**Objetivo:** corregir los 5 hallazgos de la revisión de código del PR #121 (ya mergeado) que bloquean conectar las cuentas de Yaxnáh.

**Spec:** `docs/superpowers/specs/2026-10-09-marcas-agente-design.md` (autoridad). Plan original: `docs/superpowers/plans/2026-10-09-marcas-agente.md`.

## Restricciones globales

- Rama `fix/marcas-agente-seguimiento`, creada desde `origin/main` (ad7d4dbe). **Nunca agregues `pnpm-lock.yaml` a un commit**: está modificado en el árbol y no es parte de esto. Agrega los archivos por ruta.
- Windows. Usa Bash con `cd /c/Users/ptoral/Projects/propyte-crm && ...`. Los archivos son UTF-8 aunque la terminal muestre los acentos mal; edita con la herramienta Edit.
- **Sin marca, o con la predeterminada, el comportamiento debe quedar igual.** El prompt sin marca está congelado en `src/lib/bot/__snapshots__/claude.brand.test.ts.snap`: nunca corras vitest con `-u`.
- TDD: escribe la prueba, mírala fallar, implementa y mírala pasar. Las pruebas mockean `@/lib/db`. Los `console.warn` y `console.error` intencionales se silencian con `vi.spyOn(...).mockImplementation(() => {})` y se verifican.
- Comentarios en español con el porqué y la fecha `2026-10-09`, siguiendo el estilo del archivo.
- Mensaje de commit en español (`fix(marcas): …`), seguido de una línea en blanco y `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No toques la base de datos real. No lances subagentes.

---

### Tarea 1: Atribución de marca para contactos que ya existen (ruta de mensajería)

**Problema:**
- `attachBrand` solo corre dentro de `captureLead` (`src/lib/intake/capture-lead.ts`).
- `handleInboundMessage` (`src/lib/messaging/core.ts`, cerca de `:261`, `if (!contact) {`) solo llama a `captureLead` cuando no encuentra el contacto.
- Por eso, cuando un contacto existente escribe por WhatsApp, IG o Messenger a una cuenta con marca, nunca se registra su fila en `contact_brands`. La spec §4.1 exige registrarla para nuevos **y** existentes.

**Corrección:**
1. En `handleInboundMessage`, cuando el contacto **ya existía** (no se creó en esta llamada vía `captureLead`), el mensaje trae `msg.connectorId` y no es un eco:
   - lee `brandId` de la cuenta con `prisma.leadConnector.findUnique({ where: { id }, select: { brandId: true } })`;
   - `brandId = cuenta.brandId ?? await getDefaultBrandId()`;
   - si hay `brandId`, llama `attachBrand({ contactId, brandId, connectorId: msg.connectorId, contactIsNew: false })`;
   - todo es best-effort: envuélvelo en try/catch con `console.error`. Nunca debe romper la entrada del mensaje.
2. Haz que `attachBrand` (`src/lib/brands/attach.ts`) sea barato cuando ya existe la fila: al inicio, `prisma.contactBrand.findUnique({ where: { contactId_brandId: { contactId, brandId } }, select: { id: true } })`; si existe, termina sin más consultas. Esto evita contar y hacer upserts en cada mensaje entrante.
3. Si en el mismo flujo ya se llamó a `captureLead` para un contacto nuevo, no lo atribuyas dos veces: `captureLead` ya lo hizo.

**Pruebas:**
- `src/lib/messaging/core.*.test.ts`: busca el archivo existente de `handleInboundMessage` y su andamiaje.
  - Un contacto existente con mensaje por una cuenta con marca → `attachBrand` se llama con `contactIsNew: false` y el `brandId` de la cuenta.
  - Una cuenta sin marca → se usa la predeterminada.
  - Sin `connectorId` → no se llama.
  - Un eco → no se llama.
  - Un contacto nuevo vía `captureLead` → no se llama una segunda vez.
  - Si falla la lectura de la cuenta → el mensaje se ingiere igual.
- `attach.test.ts`: con la fila existente, solo una consulta (`findUnique`), sin `count` ni `upsert`.

---

### Tarea 2: El catálogo de una marca no debe recortarse a 25 unidades

**Problema:**
- `findMatchingDevelopments` (`src/lib/bot/hub-catalog.ts:75`) pide `limit: 25`.
- `searchCatalog` (`src/lib/hub/catalog.ts`) recorta con `clampLimit(filters.limit, 5, 25)` y ordena por precio ascendente.
- Con el inventario completo de Yaxnáh (unas 51 unidades), las 22 Kannah, que son las más caras, quedan fuera. El resumen diría "$1,433,000 a $1,800,000 · 2 rec" y el agente negaría que hay casas de 3 recámaras.

**Corrección:**
1. En `searchCatalog`, cuando `filters.developmentIds` es un arreglo no vacío, el tope sube a 500: `clampLimit(filters.limit, 5, filters.developmentIds?.length ? 500 : 25)`. Sin `developmentIds` el tope sigue en 25, sin cambios.
2. En `findMatchingDevelopments`, cuando viene `developmentIds`, pide `limit: 500` a `searchCatalog`. Sin él, `limit: 25` como hoy.

**Pruebas:**
- `catalog.test.ts`: con `developmentIds`, el SQL lleva `LIMIT 500`; sin él, `LIMIT 25`.
- `hub-catalog.test.ts`: con 30 unidades de un mismo desarrollo y precios de 1.4M a 2.09M, el resumen debe tener `precio_max` 2090000 y `recamaras_max` 3, y `searchCatalog` debe recibir `limit: 500`. Sin `developmentIds` se sigue pidiendo `limit: 25`.

---

### Tarea 3: Una referencia vieja no debe bloquear la edición de una marca

**Problema:**
- El formulario reenvía siempre `playbookId` y `marketingOwnerUserId` (`src/components/admin/brands/brand-helpers.ts:177-178`).
- `brandRefsError` (`src/lib/brands/admin.ts`) rechaza un playbook borrado o un usuario inactivo.
- Si el responsable de marketing se da de baja, o se borra el playbook, ya no se puede guardar ningún cambio de la marca, ni siquiera apagar su agente.

**Corrección (en el servidor; vale para cualquier cliente):**
1. `brandRefsError(input, current?)` recibe opcionalmente los valores actuales `{ playbookId, marketingOwnerUserId }`. Si el valor enviado es **igual** al actual, no se valida.
2. El `PATCH` (`src/app/api/admin/brands/[id]/route.ts`) lee también `playbookId` y `marketingOwnerUserId` en el `findFirst` y los pasa como `current`.
3. El POST no cambia.
4. En `bot-respond` y `ai-actions` ya existen caídas seguras: un playbook inactivo da "sin playbook" y un responsable inactivo cae al global. Verifícalo; no hay que cambiarlo.

**Pruebas:**
- `brands/[id]/route.test.ts`:
  - `PATCH { botEnabled: false, marketingOwnerUserId: <id inactivo igual al actual>, playbookId: <id borrado igual al actual> }` → 200 y se guarda.
  - Un `marketingOwnerUserId` **distinto** e inactivo → sigue en 400.
- `admin.test.ts`, si existe, o en la misma prueba de la ruta: `brandRefsError` con `current` igual no consulta la base.

---

### Tarea 4: Instagram/Messenger sin cuenta activa no disparan al agente

**Problema:**
- En `src/app/api/webhooks/meta-dm/route.ts` (cerca de `:110-121`), un DM a una cuenta sin conector activo se ingiere sin conector y entra a `botTargets` con `connectorId: null`.
- `botRespond` lo trata como la marca predeterminada.
- WhatsApp sí tiene ese candado (`unknownNumber`); meta-dm no. Ejemplo: si la cuenta de Yaxnáh está en pausa y se prenden Instagram o Messenger en los canales globales, contestaría Propyte.

**Corrección:** si `msg.accountId` venía y no se resolvió ninguna cuenta activa, el mensaje se ingiere igual (no se pierde), pero **no** entra a `botTargets`. El `console.warn` existente se queda. Los mensajes sin `accountId` y los que sí resuelven cuenta se comportan como hoy.

**Pruebas:** junto a la ruta (`src/app/api/webhooks/meta-dm/*.test.ts`, existente o nuevo, reusando su andamiaje):
- `accountId` sin cuenta → `handleInboundMessage` se llama y `botRespond` no.
- `accountId` con cuenta → `botRespond` se llama con ese `connectorId`.
- Sin `accountId` → igual que hoy.

---

### Tarea 5: Un lead de Lead Ads de una página sin cuenta no se pierde sin rastro

**Problema:**
- Con 2 o más cuentas META, un lead cuyo `page_id` no tiene cuenta se descarta con solo un `console.warn` (`src/app/api/connectors/meta/webhook/route.ts:111-116`).
- No queda fila en `ConnectorLeadLog`. Eso contradice el criterio de #713: un lead pagado siempre deja rastro visible.

**Corrección:**
- En lugar de descartarlo en silencio, reserva el lead con `reservarLeadEntrante(matched.connector.id, leadgenId, { webhook: change.value, motivo: "pagina_sin_cuenta" })` bajo la cuenta cuya firma validó.
- Márcalo en **ERROR**, con el detalle `Página ${pageId} sin cuenta registrada en Conexiones; lead ${leadgenId} no asignado a ninguna marca`. Busca en el mismo archivo cómo se marca hoy un log en ERROR y reusa ese helper.
- Llama a `markConnectorLead(matched.connector.id, <mismo detalle>)` para que aparezca en `lastError` de Conexiones.
- **No** pidas el lead a Graph ni lo asignes a ninguna marca.
- Si la reserva dice `yaProcesado`, no hagas nada más.
- La respuesta sigue siendo 200 y el estado en `results` sigue siendo `"pagina_sin_cuenta"`.
- Si la reserva falla, cuenta el fallo igual que hoy (variable `fallos`) para que Meta reintente.

**Pruebas:** en `src/app/api/connectors/meta/webhook/route.test.ts`:
- 2 cuentas y una página sin cuenta → se reserva bajo la cuenta firmante, el log queda en ERROR con el detalle, `markConnectorLead` recibe el detalle, no hay `fetch` a Graph y la respuesta es 200.
- Una lead repetida (`yaProcesado`) → no se re-marca.
- Los casos existentes (una cuenta y una página que sí empata) siguen igual.
