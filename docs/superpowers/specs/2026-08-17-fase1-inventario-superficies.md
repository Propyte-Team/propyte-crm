# Fase 1 — inventario de superficies a migrar

**Fecha:** 2026-08-17
**Estado:** inventario verificado contra el código en `main` = `b65937f4`. **No es un plan** — la fase 1 tiene tres decisiones abiertas (§4) que cambian su diseño.
**Spec padre:** [`2026-08-17-moderador-permisos-design.md`](2026-08-17-moderador-permisos-design.md)

## Por qué existe este documento

Al planear la fase 0 escribí de memoria qué roles gobernaban cada superficie y me equivoqué dos veces: agrupé conectores con API keys ignorando que MARKETING ya tiene los primeros, e inventé una carpeta de migraciones cuando el repo ya tenía la suya. Las dos habrían explotado más adelante.

Este inventario sale de leer el código, no de recordarlo. Cada fila se verificó con `grep` sobre `main` el 2026-08-17.

## 1. Server actions — 28 en 4 archivos

Todas usan hoy el mismo guardia genérico `requireAdminRole()` → `["ADMIN","DIRECTOR","GERENTE"]`, salvo `resetUserPassword`, que usa el estrecho `requirePasswordResetRole()` → `["ADMIN","DIRECTOR"]`.

### `src/server/admin.ts` — 18 acciones

| Acción | Permiso destino |
|---|---|
| `getUsers` | `usuarios.ver` |
| `createUser` · `updateUser` · `deactivateUser` | `usuarios.editar` |
| `resetUserPassword` | `usuarios.password` 🔒 |
| `getCommissionRules` · `createCommissionRule` · `updateCommissionRule` · `deleteCommissionRule` | `comisiones.reglas` |
| `getSystemConfig` · `updateSystemConfig` | `config.actividad` ⚠️ ver §4.3 |
| `getWebhookConfigs` · `createWebhookConfig` · `updateWebhookConfig` · `deleteWebhookConfig` | `integraciones.apikeys` |
| `getApiKeys` · `generateNewApiKey` · `revokeApiKey` | `integraciones.apikeys` |

### `src/server/bot-config.ts` · `bot-playbook.ts` · `bot-agents.ts` — 10 acciones

`getBotConfigForAdmin` · `updateBotConfig` · `listPlaybooks` · `getPlaybook` · `upsertPlaybook` · `setActivePlaybook` · `deletePlaybook` · `listAgentProfiles` · `upsertAgentProfile` · `deleteAgentProfile` → todas a **`bot.configurar`**.

Cada uno de esos tres archivos tiene **su propia copia** de `const ADMIN_ROLES` y su propio `requireAdminRole()`. Son 4 copias contando la de `admin.ts`: el mismo patrón que ya se consolidó en `comment-rules` durante el PR #12.

## 2. Páginas

| Página | Guardia hoy | Nota |
|---|---|---|
| `src/app/(dashboard)/admin/page.tsx:21` | `["ADMIN","DIRECTOR","GERENTE"]` | Carga **todos** los datos de todas las pestañas antes de renderizar. Migrarla por permiso obliga a cargar condicionalmente, o seguirá filtrando al payload lo que el permiso niega. |
| `src/app/(dashboard)/configuracion/page.tsx:9` | `["ADMIN","DIRECTOR","GERENTE"]` | **Es el verdadero punto de entrada.** `src/components/config/config-center.tsx` dibuja las tarjetas con su propia lógica de roles. No estaba en el alcance original de la fase 1 y debe estarlo. |
| `src/app/(dashboard)/admin/comentarios/page.tsx` | `canManageCommentRules()` | Ya usa un módulo de permiso; es la migración más barata de todas. |

## 3. Ya consolidado (referencia del patrón)

`src/lib/comments/roles.ts` — `COMMENT_RULES_ROLES` + `canManageCommentRules()`, consumido por las 5 rutas de `comment-rules` y por `nav-config`. Es el modelo a seguir y el único legacy anclado hoy al test de paridad.

## 4. Las tres decisiones abiertas

Ninguna se puede resolver leyendo código. Bloquean el diseño de la fase 1.

### 4.1 `can()` confía en el rol del token y nunca mira `isActive`

`PermissionUser` es `{id, role}`, y ese `role` sale del JWT de NextAuth, fijado al iniciar sesión y vivo hasta que expire. Consecuencia asimétrica:

- Mover un override de una persona → surte efecto en 30 s ✅
- Cambiarle el **rol** a alguien → no surte hasta que cierre sesión ❌
- **Desactivar una cuenta** (`isActive:false`, solo se comprueba en `authorize()`) → `can()` le sigue resolviendo permisos ❌

El spec §5.1 justifica leer de la base *precisamente* para que los cambios se propaguen. Leer `role` e `isActive` del propio usuario cabría en las consultas que `explain()` ya hace. **Decidirlo antes de que el patrón se replique en 28 acciones.**

### 4.2 `usuarios.password` es sensible → los DIRECTOR lo pierden

Los permisos sensibles no se siembran a ningún rol. Hoy `PASSWORD_RESET_ROLES` incluye `DIRECTOR`; al migrar `resetUserPassword`, cada director necesita un override por persona **antes** del deploy o pierde el botón.

Anclado con test en `PERDIDAS_POR_SENSIBILIDAD` (`src/lib/permissions/seed-data.ts`). Alternativa si se prefiere: dejar de marcarlo sensible y sembrarlo a DIRECTOR como cualquier otro permiso.

### 4.3 `config.actividad` promete menos de lo que concede

La etiqueta dice "Configurar el acuerdo de actividad", pero la superficie real es `updateSystemConfig(key, value)` — **genérica**. La tabla `system_config` guarda además el puntero de round-robin (`src/lib/workflows/routing.ts`) y el umbral de CAPI (`src/lib/capi/events.ts`). Hoy la UI solo escribe `activity_agreement`, pero el server action acepta cualquier clave.

Dos salidas: renombrar el permiso a `config.sistema`, o estrechar el server action a una lista blanca de claves.

## 5. Prerrequisitos menores, ya diagnosticados

- **`connectors/health/route.ts:8`** es la única de las 5 superficies de conectores sin `MARKETING`. Al migrar, MARKETING lo ganará. Alinearlo o declararlo como divergencia.
- **`comment-rules-tab.tsx:27`** hace `fetch("/api/admin/connectors")`. Quien reciba `comentarios.gestionar` por override sin tener `integraciones.conectores` verá la pantalla a medias. Hoy no muerde porque MARKETING lleva ambos.
- **`can()` hace una consulta por permiso.** Renderizar `/admin` con 8 pestañas haría 8 `findMany` idénticos sobre `role_permissions`. Cachear `rol → permisos` antes de que aparezcan consumidores.
- **`LEGACY_ROLE_LISTS` sigue siendo transcripción a mano** en 7 de sus 8 filas. Solo `comentarios.gestionar` está anclada a su fuente. Las demás son constantes privadas dentro de `"use server"` o `route.ts`; anclarlas exigiría leerlas con `fs` desde el test.

## 6. Lo que la fase 1 NO debe tocar

`/api/admin/{agents,automation,journey,teams,territories,metadata}` y `/api/webhooks/meta-dm/debug` (marcada `[TEMPORAL]`) son fase 4 o posterior. El eje de **alcance de datos** (`src/lib/rbac/query-scope.ts`) no se toca nunca en este proyecto: gobierna qué filas ves, no a qué pantallas entras.
