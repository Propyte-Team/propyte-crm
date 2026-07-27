# Agenda Personal del Asesor — Diseño

**Fecha:** 2026-07-27
**Autor:** Luis Flores (con Claude Code)
**Estado:** Diseño aprobado, pendiente plan de implementación

---

## 1. Objetivo

Dar a cada asesor un espacio personal dentro del CRM para notas, tareas y pendientes propios — los que hoy no tienen dónde vivir porque toda `Activity` obliga a colgar de un contacto. Sumado a una vista de grafo que muestre cómo se conectan las cosas, y un asistente Claude que opere sobre la agenda del propio asesor.

**Criterio de éxito:** un asesor puede capturar "preparar propuesta para la junta del jueves" sin inventar un contacto, verla junto a sus actividades de CRM, y preguntarle al asistente "¿qué traigo pendiente esta semana?" y recibir su agenda real.

**Origen:** este diseño empezó como una app standalone (`Kai-note`) con Supabase propio. Al revisar el CRM se encontró que la mayor parte ya existía, así que se replanteó como feature del CRM. El repo standalone se descartó.

---

## 2. Qué ya existe (y no se vuelve a construir)

Auditoría de `prisma/schema.prisma` (2,648 líneas, ~90 modelos):

| Necesidad | Ya resuelto por |
|---|---|
| Tareas y notas | `Activity` — tipos `TASK`, `NOTE`, `FOLLOW_UP`, `MEETING_*`; `dueDate`, `completedAt`, `status`, `userId` |
| Estados de tarea | `ActivityStatus` — `PENDIENTE` / `COMPLETADA` / `VENCIDA` / `CANCELADA` |
| Aristas del grafo | `RecordLink` (`fromObject/fromId → toObject/toId`, indexado ambos sentidos) + `RelationshipDef` + `RelationshipLabel` |
| OAuth Google por asesor | `GoogleOAuthToken` — access/refresh cifrados AES-256-GCM, `scope`, `isValid` |
| Preferencias por usuario | `UserProfile` — `workingHours`, `notificationPrefs`, `calendarUrl` |
| Permisos por perfil | `UserRole` + rolesets |
| Notificaciones | `Notification` |
| Superficie MCP | `/api/mcp` |
| **Calendario Google** | **`specs/SPECKIT-GOOGLE-WORKSPACE.md` §3 (GW-2)** — especificado, no implementado |

El diseño original proponía un modelo `nodes` + `edges` propio. Es innecesario: `Activity` es el nodo y `RecordLink` es la arista. Construirlo habría duplicado dos subsistemas en producción.

---

## 3. Alcance

### 3.1 Dentro

1. **Agenda personal** — `Activity.contactId` nullable + UI de captura y listado (§5, §6)
2. **Vista de grafo** — render sobre `RecordLink`, sin modelo nuevo (§7)
3. **Asistente personal** — chat con tool calling sobre la agenda del asesor (§8)

### 3.2 Fuera, con razón

- **Calendario Google.** Ya está diseñado en GW-2. Este spec **depende** de él pero no lo rediseña ni lo implementa. Ver §9.
- **El bot de leads.** `BotConfig` / `BotPlaybook` / `BotAgentProfile` / `Conversation` son el bot que atiende prospectos. El asistente de §8 es otra cosa: habla con el asesor, no con el lead. No se tocan.
- **Automatización.** `ActionPlan`, `ActionQueue`, `AutomationRule`, `SlaTimer` ya cubren secuencias y SLAs. No se construye un motor de sugerencias que compita con ellos. Si más adelante se quiere un organizador automático, se monta sobre `ActionQueue`, no al lado.
- **Objetos custom.** `CustomObjectDef` / `CustomRecord` existen. La agenda personal no los usa: `Activity` alcanza.

---

## 4. Restricciones

1. **Producción.** `crm.propyte.com` está en uso. Toda migración es aditiva y reversible; ningún cambio destructivo sin autorización explícita.
2. **Rama nueva desde `main`.** Al momento de escribir esto, `feat/crm-config-linking` tiene 27 archivos modificados sin commitear (bot agents, journey, config center) que no son de este trabajo. No se tocan.
3. **PG3 — el CRM es source of truth.** Principio ya establecido en el speckit de Google Workspace. Google Calendar es espejo de salida; los datos maestros no se sobrescriben desde Google salvo en el sync inverso explícito de GW-2.
4. **Por asesor.** Todo query filtra por `userId` de la sesión. `canSeeAll` solo para roles que ya lo tienen.

---

## 5. Cambio de modelo: `Activity.contactId` nullable

### 5.1 La decisión

```prisma
model Activity {
  contactId String?                                          // era String
  contact   Contact? @relation(fields: [contactId], references: [id])
  ...
}
```

Migración aditiva: `ALTER TABLE propyte_crm.activities ALTER COLUMN "contactId" DROP NOT NULL;`. Reversible mientras no existan filas con null.

### 5.2 Por qué, y no las alternativas

Una tarea personal genuinamente no tiene contacto. Las otras dos opciones consideradas:

- **Contacto sentinel "Personal" por asesor** — cero riesgo, pero mete registros falsos en la tabla de contactos y obliga a excluirlos en cada reporte, para siempre.
- **Modelo separado** — aislado, pero parte el sistema en dos y el grafo dejaría de ver todo junto, que es justamente el objetivo.

Se eligió nullable a sabiendas de que es la de mayor radio de impacto, porque es la única que deja el modelo correcto.

### 5.3 Radio de impacto medido

65 archivos mencionan `Activity`. El compilador atrapa la mayoría de los accesos rotos: los queries de servidor usan `include: { contact: { select: {...} } }`, así que al volver nullable el FK, Prisma regenera el tipo como `| null` y `tsc --noEmit` enumera cada dereferencia sin guardia.

**Pero el compilador NO los encuentra todos.** Los componentes cliente que consumen una API route (`fetch("/api/activities")`) tipan la respuesta JSON **a mano**. Ese tipo escrito a mano no está conectado a Prisma, así que puede declarar `contact` como no-nullable y `tsc` pasa en verde mientras el runtime devuelve `null`. Es un punto ciego estructural del enfoque, no un descuido puntual.

El audit necesita por lo tanto **dos modalidades**:

1. `npx tsc --noEmit` — atrapa el código de servidor tipado por Prisma
2. Búsqueda de tipos escritos a mano en consumidores de API:
   ```bash
   grep -rn "^\s*contact: {" --include="*.tsx" src/components/ | grep -v "| null"
   ```
   Y verificar, para cada resultado, si el contacto viene de una `Activity` o de otra entidad.

Caso real encontrado por este audit: `src/components/activities/overdue-tasks.tsx` declaraba `contact` no-nullable sobre la respuesta de `/api/activities` y renderizaba `task.contact.firstName` sin guardia — invisible a `tsc`, crash garantizado en cuanto exista una tarea personal. Los otros dos tipos escritos a mano con `contact` (`inbox-view.tsx`, `quotes-global-view.tsx`) resultaron ser de `Conversation` y `Deal`, no afectados.

Puntos identificados en el audit:

| Archivo | Estado |
|---|---|
| `app/(dashboard)/activities/page.tsx` | **Ya es null-safe** — tanto el nombre (`{a.contact ? … : "—"}`) como el `<Link>` están dentro de guardias |
| `server/activities.ts:171-191` | **Rompe por construcción** — `CreateActivityInput.contactId: string` y `where: { id: data.contactId }`. Al volverse opcional, el `findUnique` deja de tipar sin guardia |
| `app/api/activities/route.ts` (115, 225) | Revisar consumidores del include |
| `server/activities.ts` (145, 223, 281, 391) | Revisar consumidores del include |
| `server/today.ts:99` | Revisar consumidores del include |

**Gate obligatorio:** `tsc --noEmit` + `next build` en verde antes de mergear.

**Esta lista es el punto de partida del audit, no su resultado.** No se precomputó la lista completa de errores porque exigiría instalar dependencias en el worktree o regenerar el cliente Prisma bajo el árbol de trabajo activo. El ejecutor corre `tsc --noEmit` tras el cambio y obtiene la lista real y completa — que es la autoridad. Una lista adivinada aquí daría falsa confianza.

### 5.4 Semántica

`contactId = null` significa "actividad personal del asesor". No se agrega un discriminador aparte: la ausencia de contacto *es* la señal, y un flag redundante se desincronizaría.

Los listados de CRM existentes (timeline de contacto, timeline de deal) filtran por `contactId`/`dealId`, así que las actividades personales no aparecen ahí automáticamente — sin cambios en esos queries.

---

## 6. Agenda personal — UX

Ruta nueva `/agenda`, visible para todo usuario autenticado.

- **Captura rápida** — un input que crea `Activity` con `contactId: null`, `userId` de sesión. Tipo `TASK` o `NOTE` según toggle. Fecha opcional.
- **Listado** — pendientes del asesor, agrupados por vencimiento (vencidas / hoy / esta semana / después / sin fecha). Incluye **tanto** las personales como las de CRM, porque el asesor quiere ver una sola lista de pendientes.
- **Completar** — marca `status: COMPLETADA` + `completedAt`.
- **Vincular** — asociar una actividad personal a un contacto, deal o desarrollo crea un `RecordLink`. Es lo que la hace aparecer en el grafo con contexto.

Reutiliza los componentes de actividad existentes donde sea posible; no se crea un sistema de UI paralelo.

---

## 7. Vista de grafo

Render sobre `RecordLink`. **Sin modelo nuevo, sin migración, solo lectura.**

- Librería: `react-force-graph-2d`, con `dynamic(..., { ssr: false })` — no hay canvas en el servidor.
- Nodos: contactos, deals, desarrollos, unidades, actividades. Color por `fromObject`/`toObject`.
- Aristas: `RecordLink`, etiquetadas con `RelationshipLabel` cuando exista.
- Alcance por defecto: subgrafo a 2 saltos desde el registro enfocado. El grafo completo de un CRM en producción no se renderiza de forma útil ni rápida.
- Scoping: solo registros que el asesor puede ver según su roleset. **El grafo no puede convertirse en un bypass de permisos** — se consulta a través de las mismas funciones autorizadas que el resto del CRM, nunca con un query directo a `record_links`.

---

## 8. Asistente personal con Claude

### 8.1 Qué es y qué no es

Es un chat para el **asesor**, sobre su propia agenda. No es el bot de leads (`bot-respond`), no comparte configuración con él, y no habla con prospectos.

### 8.2 Arquitectura

Tools como funciones `(args, scope) => Promise<Result>` en `src/lib/agenda/tools/`, sin dependencias de framework. El `scope` viene de la sesión NextAuth, nunca de los argumentos del modelo — un `userId` en el input del modelo se ignora por construcción, porque no existe en el esquema de entrada.

Se montan en dos superficies:
- `POST /api/agenda/chat` — Anthropic SDK con tool runner
- El `/api/mcp` existente — mismas funciones, para operar desde Claude Code

Tools: `crear_tarea`, `crear_nota`, `buscar_actividades`, `mi_agenda`, `completar_tarea`, `reagendar`, `vincular_registro`.

**Sin DELETE.** El `/api/mcp` del CRM ya sigue esa regla; el asistente la respeta. Cancelar es `status: CANCELADA`, no borrar.

### 8.3 Modelo y costo

`claude-haiku-4-5` — $1/MTok entrada, $5/MTok salida. Elegido explícitamente por costo.

Estimación por asesor: ~4K tokens de entrada (system + tools + conversación) y ~400 de salida por mensaje ≈ $0.006. A 20 mensajes/día por asesor son ~$3.60/mes por asesor.

**Este costo escala con el número de asesores** — a diferencia del diseño standalone, donde era un solo usuario. Con 10 asesores activos son ~$36/mes. Conviene un límite de mensajes por usuario/día antes de abrirlo a todo el equipo.

El mínimo cacheable de Haiku 4.5 es 4096 tokens; si el system prompt más las definiciones de tools no lo superan, el caching no aplica. Se mide con `usage.cache_read_input_tokens` en producción antes de asumir el ahorro.

---

## 9. Dependencia: GW-2 Calendario

El calendario **no se diseña aquí**. `specs/SPECKIT-GOOGLE-WORKSPACE.md` §3 ya lo especifica completo: push notifications vía `/api/google/calendar/webhook`, tabla `google_calendar_watches`, `calendar_sync_token` para delta sync, sync inverso por attendee, y cron de renovación de watches (expiran ~7 días).

`Activity.googleEventId` ya existe en el schema, marcado "reservado GW-2".

**Interacción con este spec:** cuando GW-2 se implemente, una actividad personal con fecha podrá reflejarse en el calendario del asesor. Hasta entonces la agenda personal funciona sin calendario — las tareas tienen `dueDate` y se listan por vencimiento. No hay bloqueo mutuo, y este spec no adelanta trabajo de GW-2.

---

## 10. Fases

1. **`contactId` nullable** — migración + audit dirigido por `tsc --noEmit` + tests. Sin UI nueva. Desplegable y sin efecto visible.
2. **Agenda personal** — ruta `/agenda`, captura, listado, completar.
3. **Vincular** — crear `RecordLink` desde una actividad personal.
4. **Grafo** — vista de solo lectura sobre `RecordLink`.
5. **Asistente** — capa de tools + `/api/agenda/chat` + montaje en `/api/mcp`.

Cada fase es desplegable por sí sola. La 1 no cambia nada visible para los asesores, que es justo lo que se quiere de una migración a un modelo central.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| `contactId` nullable rompe código de servidor que asume contacto | `tsc --noEmit` + `next build` como gate; Prisma convierte el riesgo en error de compilación (§5.3) |
| `contactId` nullable rompe componentes cliente que tipan JSON a mano | **`tsc` es ciego a esto.** Segunda modalidad de audit por grep sobre tipos escritos a mano (§5.3). Encontró un caso real que el compilador no vio |
| El grafo se vuelve un bypass de permisos | Consultar por las funciones autorizadas del CRM, nunca `record_links` directo (§7) |
| Costo del asistente escala por asesor | Límite de mensajes/día por usuario antes de abrirlo al equipo (§8.3) |
| Rendimiento del grafo en un CRM real | Subgrafo a 2 saltos por defecto (§7) |
| Duplicar el motor de automatización existente | El organizador automático queda fuera de alcance; si se hace, sobre `ActionQueue` (§3.2) |
| Colisión con los 27 archivos sin commitear en `feat/crm-config-linking` | Rama nueva desde `main`; verificar HEAD antes de cada commit (§4) |
| Contradecir GW-2 | El calendario no se diseña aquí; PG3 (CRM es SOT) se respeta (§9) |
