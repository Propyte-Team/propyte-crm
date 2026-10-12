# Marcas — filtro, badge, leads huérfanos y reportes (entrega 3)

**Fecha:** 2026-10-12
**Estado:** implementado en `feat/marcas-entrega-3`, pendiente de revisión
**Continúa:** `2026-10-09-marcas-agente-design.md` (entrega 1) y `2026-10-12-marcas-visibilidad-design.md` (entrega 2).

Esta es la **entrega 3 de 3**:

1. Marca como dato, respuestas del agente por marca y atribución (en `main`).
2. Interruptores por marca para cada usuario, más "siempre ves lo que tienes asignado" (en `main`).
3. **Esta spec:** selector «Marca» en las listas, badge de marca, panel de leads huérfanos y reportes por marca.

---

## 1. Objetivo y criterios de éxito

Que cada quien pueda trabajar una marca a la vez, distinga de qué marca es cada registro y vea en un solo lugar los prospectos que se están perdiendo. Las cifras de reportes y dashboard respetan las mismas marcas que las listas.

**Criterios de éxito (verificables):**

1. Contactos, Bandeja y Negocios tienen un selector **«Marca»** con «Todas mis marcas» (por omisión) y cada marca que el usuario ve. ADMIN ve todas las vivas. La selección vive en la URL (`?marca=<brandId>`).
2. Elegir una marca **nunca** muestra algo que no aparecía con «Todas mis marcas». El filtro se suma con AND a la visibilidad de la entrega 2 y al alcance por rol.
3. Una marca inexistente, borrada o que el usuario no ve responde **400 «Marca no válida»** en las APIs de lista, con el mismo cuerpo en los tres casos. Las páginas la ignoran y muestran «Todas mis marcas».
4. Cada contacto muestra su(s) marca(s) en Contactos, en la ficha, en las tarjetas y la tabla de Negocios, y cada hilo de la Bandeja muestra la marca de su cuenta. Quien ve una sola marca no ve badges de la predeterminada.
5. **Conexiones → Leads huérfanos** (`/conexiones/huerfanos`) lista, recortado por marca: contactos sin dueño, contactos con dueño técnico y conversaciones que llegaron a una cuenta sin registrar. Solo para ADMIN, DIRECTOR, GERENTE y MARKETING.
6. Para quien no es ADMIN, los reportes y el dashboard solo cuentan sus marcas. ADMIN ve todo, como hoy.
7. **Sin migración.**
8. La suite completa (`npx vitest run`), `npm run typecheck` y `eslint` sobre los archivos cambiados pasan.

---

## 2. Decisiones del dueño (2026-10-12)

1. **Filtro** «Marca» en Contactos (lista), Bandeja (lista de conversaciones) y Negocios. Solo acota dentro de lo que el usuario ya ve; nunca amplía. Una marca que no tiene se ignora o da 400, sin delatar nada. Se guarda en la URL.
2. **Badge** discreto con la(s) marca(s) en Contactos, Bandeja (filas y encabezado), Negocios (por el contacto) y la ficha. Sin badge cuando la única marca es la predeterminada, salvo que el usuario vea más de una. En la Bandeja manda la marca de la cuenta del hilo.
3. **Leads huérfanos** para mandos (los roles de Conexiones), recortado por marca: (a) sin dueño, (b) dueño técnico, (c) mensajes a cuentas o números sin registrar. Asignación rápida si sale barata.
4. **Reportes** sin selector de marca, pero quien no es ADMIN solo ve cifras de sus marcas, con la misma regla. ADMIN ve todo.

---

## 3. Filtro «Marca»

### 3.1 Regla pura: `src/lib/brands/filter.ts`

- `parseBrandFilterParam(raw)`: vacío → sin filtro; algo que no parece un id (`[A-Za-z0-9-]{1,64}`) → inválido sin ir a la base.
- `resolveBrandFilter(requested, brand, visible)`: `brand` es la fila **viva** leída para ese id (o null).
  - Sin marca pedida → `none`.
  - Inexistente o borrada → `invalid`.
  - ADMIN (`"ALL"`) → vale cualquier marca viva.
  - Si no, vale solo si está en `visible.brandIds` o es la predeterminada con `includesDefault`. Si no, `invalid`: **el mismo resultado que una inexistente**, para no confirmar que existe.
- Los where del recorte **no** llevan el término «asignado a mí» de la visibilidad. Elegir Yaxnáh es "los de Yaxnáh", no "los de Yaxnáh más todos los míos". Lo mío ya entra por la visibilidad, que va en el mismo AND:
  - `contactBrandFilterWhere`: con fila de esa marca. Para la predeterminada, también **sin filas** (regla de pertenencia de la entrega 1, §2.3).
  - `dealBrandFilterWhere`: por la marca de su contacto.
  - `conversationBrandFilterWhere`: por la marca de la **cuenta** del hilo (`lead_connectors.brandId`). Para la predeterminada: sin cuenta, cuenta sin marca o cuenta de la predeterminada.

**Por qué la Bandeja filtra por la cuenta y no por el contacto.** Un contacto de Propyte que también le escribió a Yaxnáh tiene dos hilos. Filtrar por Yaxnáh debe dejar el hilo de Yaxnáh, no los dos. Es la misma marca con la que contesta el agente (`resolveBrandForConnector`) y la que pinta el badge del hilo. La visibilidad sigue siendo por contacto (entrega 2, §9), así que el filtro no amplía nada.

### 3.2 Lectura: `src/lib/brands/view-context.ts`

- `loadBrandFilter(requested, visible)`: sin `?marca=` no consulta nada. Con marca, lee la fila viva y llama a `resolveBrandFilter`. Un error de base se propaga.
- Va aparte de `user-access.ts` a propósito: las pruebas de la entrega 2 simulan ese módulo con solo `getVisibleBrands`, y una lista sin filtro no debe hacer ninguna consulta de más.

### 3.3 Dónde se aplica

| Pantalla | Archivo | Marca inválida |
|---|---|---|
| Contactos, primera página | `getContacts({ brandId })` (`src/server/contacts.ts`), desde `contacts/page.tsx` | se ignora |
| Contactos, recargas y vistas guardadas | `GET /api/contacts?marca=` | 400 |
| Bandeja, lista | `GET /api/conversations?marca=` (`where.AND`, el alcance del contacto no se toca) | 400 |
| Negocios, tablero inicial | `getDealsByStage({ brandId })` (`src/server/deals.ts`), desde `pipeline/page.tsx` | se ignora |
| Negocios, recargas (Kanban y tabla) | `GET /api/deals?marca=` | 400 |

Las páginas ignoran la marca inválida porque la leen de la URL: mostrar lo que el usuario ya ve no revela nada. Las APIs responden 400 para que la pantalla no crea que filtró.

### 3.4 Pantalla

- `src/components/brands/brand-view.tsx`:
  - `BrandViewProvider` / `useBrandView`: el contexto lo arma la página en el servidor (`getBrandViewContext`) y no se pasa prop por prop hasta la tarjeta del tablero.
  - `BrandFilterSelect`: solo aparece si el usuario ve **más de una** marca. Con una sola no hay nada que acotar.
  - `useBrandFilterParam`: lee `?marca=` y cambia la URL con `history.replaceState`, que Next sincroniza con `useSearchParams`, sin volver a pedir la página. Un valor que no está entre las opciones se lee como «Todas mis marcas».
- Contactos: el selector junto a los demás filtros. «Limpiar» lo quita y las vistas guardadas lo recuerdan; una vista con una marca que el usuario no ve se abre en «Todas mis marcas».
- Negocios: el selector junto a «Filtros». Lo filtra el servidor, así que aplica al Kanban y a la tabla. Los filtros de etapa y tipo siguen siendo en memoria y solo de la tabla, como hoy.
- Bandeja: el selector debajo del de canal. Convive con `?c=`.

---

## 4. Badge de marca

`src/lib/brands/badges.ts` (puro):

- `buildBrandViewContext(liveBrands, visible)` → `{ brands, options, multiBrand }`.
  - `brands`: todas las vivas, para **nombrar** cualquier registro visible. A quien solo ve Propyte se le asigna un contacto de Yaxnáh y el badge debe decir «Yaxnáh Caucel».
  - `options`: las que ve, para el selector.
  - `multiBrand`: ve más de una.
- `brandBadges(recordBrandIds, ctx, { alreadyShown })`:
  - `[]` (sin filas) = la predeterminada. `null` = el registro se leyó sin marcas: no se adivina.
  - Sale en el orden de la base, sin duplicados y sin marcas borradas.
  - Si el usuario no es multimarca y todo es de la predeterminada → nada. Una marca no predeterminada se pinta siempre.
  - `alreadyShown` evita repetir la marca que la etiqueta de la cuenta ya dice en la Bandeja («WhatsApp · Yaxnáh Caucel»).
- Datos que viajan para pintarlo: `brands` del contacto en `getContacts`, `GET /api/contacts`, `getDealsByStage` y `GET /api/deals`, que ya venía en `getContact`. También `connector.brandId` en `GET /api/conversations` y `/api/conversations/[id]`.
- Pantallas: nombre en la lista de Contactos, encabezado de la ficha, tarjeta del Kanban y tabla de Negocios, fila y encabezado del hilo.
- `getBrandViewContext` es **best-effort**: si falla, la pantalla sale sin badges ni selector en vez de caerse. La visibilidad no depende de él.

---

## 5. Leads huérfanos

**Dónde:** `/conexiones/huerfanos`, con un aviso con el total en el encabezado de Conexiones y una tarjeta en Configuración → Canales & Integraciones. Va junto a Conexiones porque el caso (c) se arregla dando de alta la cuenta ahí. Usa los mismos roles: ADMIN, DIRECTOR, GERENTE y MARKETING (`ORPHAN_LEADS_ROLES`). Una prueba los cruza con el menú.

**Qué lista** (`src/lib/leads/orphans.ts`, puro; `src/server/orphan-leads.ts`, consultas):

| | Qué | Recorte |
|---|---|---|
| a | Contactos vivos (`deletedAt` y `mergedIntoId` null) **sin dueño**, del más nuevo al más viejo | marca de quien mira |
| b | Contactos vivos cuyo dueño tiene correo del **dominio técnico** (`DOMINIO_TECNICO`, `ruteables.ts`) | marca de quien mira |
| c | Conversaciones **abiertas** cuya **última nota interna** dice que el mensaje llegó a un número o una cuenta sin registrar | alcance de la Bandeja (`inboxScopeWhere`): rol + marca |

- (a) y (b) pasan por `realLeadWhere`: los provisionales de comentarios que nunca contestaron nacen sin dueño a propósito y llenarían la lista.
- (c) usa el alcance de la Bandeja porque su enlace abre el hilo ahí; un renglón que luego da 404 sería un enlace roto. Para ADMIN, DIRECTOR y GERENTE (vista completa) solo cuenta la marca; MARKETING ve los suyos y los sin asignar.
- (c) en dos pasos, porque Prisma no filtra por "la fila más reciente de una relación":
  1. la nota más reciente de este tipo por hilo (`distinct: conversationId`, hasta 200 hilos);
  2. la última nota interna de esos hilos.

  Se queda solo donde coinciden (`latestNotesOnly`). Si alguien dejó otra nota o cerró el hilo, sale de la lista.
- Cada renglón lleva nombre (enlace a la ficha, o al hilo en (c)), fuente, marca(s), fecha de alta y último mensaje real (sin notas internas). En (b) va además el correo del dueño técnico y en (c) la cuenta o el número.
- **Asignación rápida:** el mismo `AdvisorSelect` y la misma ruta que la ficha (`PUT /api/contacts`). El selector se carga solo al abrirlo, porque cada uno pide la lista de asesores. La seguridad por campo del PUT sigue mandando: si un rol no puede editar el asesor, se muestra el mensaje del servidor.
- **Un solo texto para la nota.** Lo arman y lo leen las mismas funciones de `src/lib/messaging/unregistered-account.ts` (`unknownWhatsAppNumberReason`, `unknownMetaAccountReason`, `parseUnregisteredAccountNote`). Los dos webhooks las usan con el texto exacto de antes (sus pruebas lo fijan). Así, cambiar una coma en el webhook no deja al panel sin encontrar las notas sin que nada truene.
  - Los prefijos de las notas del bot pasan a `src/lib/messaging/bot-note-prefix.ts`, sin dependencias, y `send-failure.ts` los sigue exportando.
- El conteo de Conexiones (`countOrphanLeads`) es best-effort: si falla, el aviso sale sin número.

Datos de producción al 2026-10-12 (solo lectura): (a) 24 para ADMIN y 23 para quien solo ve Propyte; (b) 90; (c) 0 notas todavía.

---

## 6. Reportes y dashboard

Mismo recorte que las listas, siempre en `AND` para que ningún filtro suelto (plaza, asesor, fechas) lo pise. Con ADMIN no se agrega nada. Una actividad no tiene marca: cuenta si se ve su contacto, si no tiene contacto, si se ve su negocio, y las que no cuelgan de nada se quedan (`activityBrandVisibilityWhere`, nuevo en `visibility.ts`).

| Función | Recorte |
|---|---|
| `getPipelineReport` | negocios |
| `getCommissionsReport` | negocios |
| `getActivitiesReport` | actividades |
| `getLeadSourcesReport` | contactos (agrupación por fuente) **y** negocios (conversión y valor), para no mezclar contactos propios con negocios de todas |
| `getForecastReport` | negocios |
| `getLostDealsReport` | negocios |
| `getAbsorptionReport` | **ninguno**: lee los contadores de inventario de `developments` (`soldUnits`, …), sin contactos ni negocios de por medio |
| `getDashboardStats` | todos los KPIs de negocios (`dealBaseWhere`), leads nuevos del mes y del anterior, actividades recientes, métricas por asesor (negocios y actividades de cada uno) y tareas vencidas por asesor |
| `getOverdueTasks` (`server/activities.ts`) | actividades. Su único llamador es el dashboard |

Los reportes de `reports.ts` no tenían alcance por rol: el de marca es el único recorte que se agrega. Lo que ya tenía el dashboard (asesor, equipo, plaza) sigue igual.

---

## 7. Manejo de errores

- `loadBrandFilter`: un error de base se propaga (500). No se adivina un filtro.
- `getBrandViewContext` y `countOrphanLeads`: best-effort. Sin ellos no hay badges, selector ni número en el aviso, y la página no se cae.
- `getOrphanLeads` con un rol sin acceso devuelve `null` sin consultar nada, y la página redirige al dashboard.
- Todo lo demás hereda el manejo de la entrega 2: sin la tabla `user_brand_access`, los no-ADMIN ven solo Propyte y lo suyo.

---

## 8. Pruebas

- `brands/filter.test.ts`: forma del parámetro, nunca amplía, ajena = inexistente, predeterminada por `includesDefault`, forma de los tres where.
- `brands/badges.test.ts`: contexto por visibilidad, regla del badge, marcas borradas, `alreadyShown`.
- `brands/view-context.test.ts`: sin marca no consulta, solo marcas vivas, best-effort.
- `brands/visibility.test.ts`: `activityBrandVisibilityWhere`.
- Listas con el filtro, cada una con prisma simulado:
  - `api/contacts`, `api/deals` y `api/conversations` (`route.filtro-marca.test.ts`): AND con la visibilidad, el mismo 400 para ajena e inexistente, rol intacto y ADMIN.
  - `server/listas.filtro-marca.test.ts`: `getContacts` y `getDealsByStage`, donde la marca inválida se ignora.
- `leads/orphans.test.ts`: roles permitidos y denegados (cruzados con el menú de Conexiones), forma de (a), (b) y (c) con y sin marca, alcance de la Bandeja para MARKETING y `latestNotesOnly`.
- `server/orphan-leads.test.ts`: consultas, renglones, última nota interna, ADMIN sin recorte y conteo best-effort.
- `messaging/unregistered-account.test.ts`: los textos de siempre, y el parser los lee.
- `server/reportes.marcas.test.ts`: cada reporte y el dashboard con el recorte en AND para no-ADMIN y sin él para ADMIN; absorción sin recorte.

---

## 9. Límites conocidos

- **El selector no cambia el contador de la Bandeja** (`/api/inbox/unread-count`). Sigue contando todo lo que el usuario ve.
- **Fuera de la decisión 4:** «Hoy», agenda, metas, comisiones, cobranza, carrera y visitas siguen sin recorte por marca (entrega 2, §9).
- **(c) revisa hasta 200 hilos** con la nota más reciente. Las notas se deduplican por hilo cada 24 h, así que son hilos y no mensajes.
- **(b) es grande hoy** (90 contactos de `agentes@propyte.local`, #734). El panel muestra los 50 más recientes y el total.
- **Asignar desde el panel** usa `PUT /api/contacts`, que no tiene control por registro (entrega 2, §9). El panel solo enseña contactos que quien mira ya ve.
- **El tablero de Negocios** sigue trayendo todo de una vez (`pageSize=500`). El selector reduce lo que llega, pero no pagina.
