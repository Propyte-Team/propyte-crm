# Marcas por usuario — qué contactos ve cada quien

**Fecha:** 2026-10-12
**Estado:** implementado en `feat/marcas-visibilidad-usuario`, pendiente de revisión
**Motivo inmediato:** que los leads de Yaxnáh Caucel y Avica no aparezcan a todo el equipo de Propyte en contactos, bandeja y pipeline.
**Continúa:** `2026-10-09-marcas-agente-design.md` (entrega 1), que dejó los datos listos y avisó en §9 que hasta esta entrega los leads de una marca nueva eran visibles para todos.

Esta es la **entrega 2 de 3**:

1. Marca como dato, respuestas del agente por marca y atribución (ya en `main`).
2. **Esta spec:** interruptores por marca para cada usuario, más "siempre ves lo que tienes asignado".
3. Filtros y reportes por marca.

---

## 1. Objetivo y criterios de éxito

Cada usuario ve solo los contactos de las marcas que tiene prendidas, encima de lo que ya le permite su rol.

**Criterios de éxito (verificables):**

1. Un usuario sin Yaxnáh no ve un contacto de Yaxnáh en la lista de contactos, en los buscadores, en la bandeja (incluida la cola sin asignar) ni en el pipeline.
2. Abrir por URL directa la ficha, el hilo o el negocio de ese contacto responde **404**, igual que un id que no existe.
3. Si ese contacto está asignado al usuario, lo ve, sea de la marca que sea.
4. Un ADMIN ve todo, como hoy.
5. Los usuarios que ya existen amanecen viendo **solo Propyte**, sin rellenar datos.
6. El filtro de marca nunca amplía lo que un rol puede ver. Un asesor con Yaxnáh sigue sin ver los contactos de Yaxnáh de otro asesor.
7. La suite completa (`npx vitest run`), `npm run typecheck` y `eslint` sobre los archivos cambiados pasan.

---

## 2. Decisiones del dueño (2026-10-12)

1. Los interruptores por usuario deciden de qué marcas ve contactos. Además, **un usuario siempre ve los contactos con `assignedToId` = él**, sean de la marca que sean.
2. Los interruptores aplican a **todos los roles menos ADMIN**. DIRECTOR y GERENTE también se filtran. ADMIN ve todas las marcas.
3. Los usuarios existentes empiezan con **solo la marca predeterminada** (Propyte). Yaxnáh y Avica quedan apagadas hasta que un admin las prenda por usuario.
4. Pantallas de esta entrega: **Contactos** (lista, búsqueda, ficha y lo que cuelga de ella), **Bandeja** (listas, incluida la cola sin asignar, y abrir un hilo) y **Pipeline** (negocios, por su contacto). Agenda, actividades, tableros y reportes quedan fuera. Los reportes son la entrega 3.
5. El filtro de marca se **suma** al alcance actual (OWN/TEAM/PLAZA, alcance de la bandeja, acceso a negocios). Nunca lo amplía, solo lo recorta.

---

## 3. La regla

**Usuario:**

- ADMIN → ve todas las marcas.
- Usuario **sin filas** en `user_brand_access` → ve solo la predeterminada. Es la misma regla que `contact_brands` y por eso no se rellena nada (decisión 3).
- Usuario con filas → ve exactamente esas marcas, menos las que estén borradas. Si todas sus marcas se borraron, el conjunto queda vacío y solo ve lo suyo. Tener filas significa que alguien ya decidió, y borrar una marca no debe devolverle Propyte en silencio.

**Contacto** (regla de la entrega 1, §2.3): pertenece a las marcas de sus filas en `contact_brands`. Un contacto **sin filas** es de la predeterminada.

**Visibilidad:** un usuario ve un contacto si se cumple cualquiera de estas:

- el contacto está asignado a él;
- el contacto tiene una fila de una marca que él ve;
- el contacto no tiene filas y él ve la predeterminada.

Eso se combina con **AND** con el alcance por rol de cada pantalla.

**Negocio:** no tiene marca propia y la hereda de su contacto. Un usuario lo ve si el negocio está asignado a él o si ve al contacto por marca.

---

## 4. Modelo de datos

Hay una migración manual nueva, `prisma/migrations-manual/2026-10-12-user-brand-access.sql`. Es **aditiva e idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, FKs dentro de `DO $$ … EXCEPTION WHEN duplicate_object`) y sigue el patrón de `2026-10-09-brands.sql`.

**No toca `propyte_crm.users`**, porque el Hub comparte esa tabla (`.claude/AI_TASKS.md`). La FK hacia `users` vive en la tabla nueva, igual que `brands."marketingOwnerUserId"`.

### `UserBrandAccess` (tabla `propyte_crm.user_brand_access`)

| Campo | Tipo | Notas |
|---|---|---|
| `userId` | text → `users(id)` | `ON DELETE CASCADE` |
| `brandId` | text → `brands(id)` | `ON DELETE CASCADE` |
| `createdAt` | timestamp(3) | |
| PK | `(userId, brandId)` | más un índice por `brandId` |

- Cuando un admin edita los interruptores de un usuario, se guarda el **conjunto completo**, incluida la predeterminada si queda prendida.
- No se puede guardar un conjunto vacío, porque "sin filas" se leería como "solo Propyte". Lo asignado se ve siempre, así que no hace falta un "no ve ninguna marca".
- En Prisma, `User.brandAccess` y `Brand.userAccess` son relaciones solo de Prisma y no agregan columnas.

---

## 5. Implementación

### 5.1 Regla pura: `src/lib/brands/visibility.ts`

- `resolveVisibleBrandIds(user, rows, defaultBrandId)` devuelve `"ALL"` o `{ brandIds, includesDefault }`.
  - `includesDefault` va aparte de `brandIds`: si no se pudo leer el id de la predeterminada, un usuario sin filas sigue viendo los contactos sin filas (casi todo Propyte) en vez de quedarse en blanco.
- `contactBrandVisibilityWhere(user, visible)` devuelve `undefined` con `"ALL"` o, si no, `{ OR: [{ assignedToId: user.id }, { brands: { some: { brandId: { in } } } }, { brands: { none: {} } }] }`. El último término solo va si `includesDefault`, y el `in` se omite si no hay marcas.
- `dealBrandVisibilityWhere(user, visible)` = `{ OR: [{ assignedToId: user.id }, { contact: <lo anterior> }] }`.
- `canSeeContactBrand` y `canSeeDealBrand` aplican la misma regla sobre un registro ya leído. Si el llamador no trajo `brands`, **fallan cerrado**: solo pasa lo asignado al propio usuario.
- `CONTACT_BRAND_SELECT` es el select único de las marcas del contacto, para que ninguna lectura de un registro se olvide de traerlas.
- `countVisibleUsersByBrand` calcula cuántos usuarios ven cada marca, para la tarjeta del panel.

`visibility.test.ts` cruza la consulta y el chequeo en memoria en una **tabla de paridad**, con un evaluador manual del `where`, como `src/lib/inbox/scope.test.ts`.

### 5.2 Lectura: `src/lib/brands/user-access.ts`

`getVisibleBrands(user)`:

- con ADMIN devuelve `"ALL"` sin consultar;
- si no, lee las filas del usuario con `brand.isDefault` y `brand.deletedAt`;
- con la tabla inexistente (`P2021`), trata al usuario como "sin filas": ve solo la predeterminada, que es el estado inicial que decidió el dueño;
- **cualquier otro error se propaga.** No se puede "fallar cerrado" a la predeterminada, porque a quien le apagaron Propyte eso le mostraría Propyte. Un 500 es mejor que ver lo que no toca.

### 5.3 Dónde se aplica

| Pantalla | Archivo | Cómo |
|---|---|---|
| Contactos, lista inicial | `src/server/contacts.ts` → `getContacts` | AND en `where.AND` junto a la búsqueda, que antes se asignaba directo y la habría pisado |
| Contactos, ficha | `getContact` | `canSeeContactBrand`; fuera de marca lanza "Contacto no encontrado" y la página da 404 |
| Ficha: cronología, periodos de estado, vínculos, campos custom, llamar | `getContactAccessInfo` (lo usan `timeline`, `status-periods`, `puedeTocarRecord` → `/api/links`, `/api/records/[object]/[id]/custom`, `/api/twilio/call`) | fuera de marca responde **`not_found`**, no `forbidden`: ahora la existencia de un lead de otra marca es el dato que se esconde |
| Ficha: panel de mensajes | `GET /api/messages?contactId=` | antes no tenía **ningún** control. Ahora pasa por `getContactAccessInfo` con el mismo mapeo que la cronología |
| Contactos, lista y buscadores (agenda, actividades, alta de negocio) | `GET /api/contacts` | AND al final, para que `assignedTo` y los demás filtros sueltos no lo pisen |
| Paleta de comandos y picker de relaciones | `GET /api/records/search` (contact, deal) | esa ruta no tiene alcance por rol, pero sí recorta por marca |
| Bandeja, lista (todas las pestañas, incluida "sin asignar") | `GET /api/conversations` | `inboxScopeWhere(user, visible)` = rol AND marca |
| Bandeja, contador del menú | `GET /api/inbox/unread-count` | igual |
| Bandeja, abrir hilo | `GET /api/conversations/[id]` | `canViewInboxContact(contact, user, visible)` y 404 |
| Bandeja, acciones y asignar | `POST /api/conversations/[id]/actions` (assign y genéricas) | igual y 404 |
| Bandeja, escribir | `POST /api/conversations/[id]/messages` | marca antes de la nota interna (404); el gate por rol sigue donde estaba |
| Pipeline, tablero y listas | `src/server/deals.ts` → `buildRBACFilter` (getDeals, getDealsByStage, getStagnantDeals, agregados por etapa) y `GET /api/deals` | `dealBrandVisibilityWhere` en `AND` |
| Pipeline, detalle | `getDeal` (página) y `GET`/`PATCH /api/deals/[id]` | `canSeeDealBrand`, null/404 |
| Todo lo que cuelga de un negocio | `verificarAccesoANegocio` (`src/lib/rbac/deal-access.ts`): cotizaciones, documentos, shortlists, vínculos, campos custom | rol primero y después marca; fuera → `forbidden`, que todos los llamadores ya responden 404 |

`inboxScopeWhere` y `canViewInboxContact` reciben `visible` como parámetro **obligatorio**. Si fuera opcional, una ruta nueva que lo olvide mostraría todas las marcas sin que nada truene. Así, TypeScript obliga a decidir.

---

## 6. Panel

- **Configuración → Usuarios & Roles** (`/admin?tab=users`), en el formulario de edición: sección **«Marcas que ve»**, con un interruptor por marca viva que muestra el conjunto efectivo (sin filas = solo la predeterminada marcada).
  - Un usuario ADMIN muestra «Ve todas las marcas (administrador)», sin interruptores. Esto sigue al rol elegido en el formulario.
  - Siempre muestra la nota «Siempre ve los contactos que tiene asignados».
  - DIRECTOR y GERENTE entran a `/admin`, pero ven los interruptores **de solo lectura**: ellos mismos están sujetos a sus interruptores y no deben poder prenderse marcas.
  - Al crear un usuario no hay interruptores. Nace sin filas, o sea, viendo solo Propyte, y se edita después.
  - Solo se guarda si el conjunto cambió. Un usuario que nadie toca sigue sin filas.
- **Guardado:** `PUT /api/admin/users/[id]/brands { brandIds }`.
  - Solo ADMIN, validado con zod (`src/lib/validations/user-brand-access.ts`: `min(1)`, sin duplicados, `.strict()`).
  - Rechaza marcas borradas o inexistentes con 400 y un usuario inexistente o eliminado con 404.
  - Reemplaza el conjunto en una transacción (`deleteMany` + `createMany`) y deja rastro en `AuditLog` (`field: "brandAccess"`, `from` = filas previas o `null`, `to`).
  - Con la tabla inexistente responde 503 con un mensaje que lo dice.
- **Marcas del agente:** cada tarjeta muestra cuántos usuarios activos la ven, con la misma regla. Es best-effort: si no se puede contar, no se muestra el número.

---

## 7. Manejo de errores

- Si falta la tabla `user_brand_access`, todos los no-ADMIN ven solo Propyte y lo suyo. El panel dice "falta aplicar la migración" y el guardado responde 503. Nada se abre de más.
- Un error de base al leer las marcas de un usuario tumba la petición (500). No se adivina un conjunto.
- Si no se puede leer el id de la predeterminada (caché de 60 s de `getDefaultBrandId`), un usuario sin filas sigue viendo los contactos sin filas. Los pocos contactos con una fila **explícita** de Propyte (los que `attachBrand` registró al llegar por otra marca) quedan ocultos mientras dure el error. Se falla cerrado, no abierto.
- Un registro leído sin `brands` falla cerrado (solo pasa lo asignado).

---

## 8. Pruebas

Con Vitest y los mocks de `@/lib/db` del repo:

- `visibility.test.ts`:
  - ADMIN ve todo;
  - sin filas → solo la predeterminada;
  - conjunto explícito con y sin Propyte;
  - marcas borradas ignoradas;
  - lo asignado siempre visible;
  - contacto sin filas = predeterminada;
  - forma exacta de los `where`;
  - tabla de paridad `where` ↔ chequeo en memoria;
  - conteo por marca.
- `user-access.test.ts`: ADMIN sin consultas, `P2021` → solo la predeterminada, otro error → se propaga.
- `inbox/scope.test.ts`:
  - **cola sin asignar**: un hilo libre de Yaxnáh oculto a quien no tiene Yaxnáh y visible a quien sí, para cada rol;
  - la marca no amplía el rol;
  - forma `AND [rol, marca]`.
- Cada ruta y server action integrada, con prisma simulado, verifica que la marca va en AND con el alcance por rol (o que responde 404) y que los filtros sueltos no la pisan:
  - `conversations` (lista, detalle, acciones, mensajes) y `unread-count`;
  - `contacts` (server y API) y `records/search`;
  - `messages`;
  - `deal-access`, `server/deals`, `api/deals` y `api/deals/[id]`.
- `api/admin/users/[id]/brands`: solo ADMIN, validación, marca borrada, usuario inexistente, reemplazo completo en transacción, auditoría, 503 sin migración.
- `api/admin/brands`: conteo de usuarios por marca.
- `user-brands-helpers.test.ts`: conjunto efectivo, comparación y orden de los interruptores.

---

## 9. Puesta en marcha, riesgos y límites

**Orden:**

1. PR → revisión.
2. **Aplicar `2026-10-12-user-brand-access.sql` en Supabase ANTES del merge.** Es manual y requiere aprobación explícita. El código no se cae sin la tabla, pero nadie podría prender Yaxnáh ni Avica a ningún usuario.
3. Merge → despliegue. Desde ese momento, **todo no-ADMIN ve solo Propyte y lo suyo** (decisión 3). Eso incluye a DIRECTOR y GERENTE.
4. Un ADMIN prende Yaxnáh o Avica a quien corresponda desde Usuarios & Roles.

**Límites conocidos (fuera de esta entrega, a propósito):**

- **Agenda, actividades, "Hoy", tableros, reportes, comisiones, metas, carrera y visitas** no filtran por marca (decisión 4; los reportes son la entrega 3). Por ahí todavía se ven nombres de contactos de otras marcas.
- **Duplicados** (`/api/contacts/duplicates` y `merge`) es una herramienta de limpieza para roles de acceso total (ADMIN, DIRECTOR, DEVELOPER_EXT, MANTENIMIENTO). El dedup es entre marcas por diseño (entrega 1, §1), y filtrarlo escondería justo los duplicados entre marcas.
- **El filtro es por contacto, no por conversación.** Un contacto que está en Propyte y en Yaxnáh muestra **todos** sus hilos, incluido el de la cuenta de Yaxnáh, a quien lo ve por Propyte. Es consecuencia de la regla de la entrega 1: hay una sola ficha por persona.
- **Escrituras sin control por registro que ya existían:**
  - `PUT`/`DELETE /api/contacts?id=`;
  - las server actions `updateContact`, `deleteContact`, `updateDeal` y `transitionDealStage`;
  - `GET /api/deals/[id]/pending-meeting`.

  No tenían alcance por rol y no se les agregó marca. Exigen conocer el id, que las listas ya no enseñan.
- **Marcar spam** (`mark_spam`) sigue resolviéndose antes del gate de alcance, por rol, como se decidió en su momento.
- **Notificaciones y reparto** (avisos a gerentes del Pond, correos) no se filtran por marca.
- Agent Studio y los handlers de MCP no tienen sesión de usuario y siguen siendo globales.

---

## 10. Entrega 3 (2026-10-12)

La entrega 3 se describe completa en `2026-10-12-marcas-filtros-reportes-design.md`. En resumen, encima de la regla de esta spec, sin cambiarla y sin migración:

- **Selector «Marca»** en Contactos, Bandeja y Negocios (`?marca=`).
  - Solo acota dentro de lo visible, siempre en AND con la visibilidad y el alcance por rol.
  - Una marca ajena o inexistente da el mismo 400 en las APIs y se ignora en las páginas.
  - La Bandeja filtra por la marca de la **cuenta** del hilo.
- **Badge de marca** en listas, ficha, tablero y hilos. Quien ve una sola marca no ve el de la predeterminada.
- **Leads huérfanos** en `/conexiones/huerfanos`, con los roles de Conexiones: sin dueño, dueño técnico y mensajes a cuentas sin registrar, todo recortado por marca.
- **Reportes y dashboard** con el mismo recorte para quien no es ADMIN. Con esto, los reportes y el dashboard salen de los límites del §9; agenda, «Hoy», metas, comisiones, cobranza, carrera y visitas siguen fuera.
