# Puerta de revisión del CRM para Claude Cowork

**Fecha:** 2026-08-28
**Estado:** implementado en `feat/puerta-revision-cowork`. Ver §14 para lo que se desvió.
**Alcance de este spec:** R1 (la puerta: código + datos + fallos) y R3 (el protocolo diario).
R2 (capturas de UI) y R4 (errores de runtime) quedan fuera y se documentan en §12.

---

## 1. Problema

Claude Cowork debe poder revisar el CRM todos los días —su código, su estado, sus fallos y
sus oportunidades— y dejar los hallazgos donde ya se les da seguimiento, sin poder tocar
producción.

Cowork corre en claude.ai. Solo alcanza el exterior por **conectores personalizados**, que son
servidores MCP remotos sobre HTTPS. Y hay una restricción medida que condiciona todo el diseño:

> **El conector de claude.ai no manda cabeceras.** El secreto tiene que viajar en la ruta.
> (Reincidente ×2 en este proyecto; ya resuelto así en `/api/mcp/blog/<token>` y
> `/api/mcp/mejoras/<token>` del Hub.)

## 2. Contexto verificado

Medido el 2026-08-28, no supuesto:

| Hecho | Cómo se verificó |
|---|---|
| `propyte-crm/src/app/api/mcp/` **no es MCP**: es pasarela REST con Bearer, sin JSON-RPC | grep: cero coincidencias de `jsonrpc`, `initialize` o `tools/list` en `src/lib/mcp` |
| El patrón JSON-RPC que sí funciona vive en `origin/main` del Hub | `git ls-tree origin/main` → `src/lib/mcp/blog/{rpc,http,auth,tools,errors,types}.ts` + `src/app/api/mcp/blog/[token]/route.ts` |
| Cowork ya escribe al tablero de Mejoras | conector `Propyte_Mejoras` activo, 4 tools |
| `mejoras_create_task` dedupea en el servidor y responde 409 con el número existente | descripción de la tool |
| `mejoras_list_tasks` **excluye las descartadas por defecto** | descripción de la tool |
| `mejoras_create_task` ya acepta `origen: 'auditor'` | enum de la tool |
| Los 5 modelos de fallos existen con campos de estado y error | `prisma/schema.prisma`, §6 |

**Trampa reproducida durante el diseño:** el checkout local del Hub estaba en
`feat/campos-obligatorios-por-tipo-unidad` y **no** contenía `src/lib/mcp/blog/`; `origin/main`
sí. Un revisor que leyera "el código" desde el disco habría reportado que la puerta no existe.
Esto es lo que fija la regla de rotulado de §4.3.

## 3. Decisión de arquitectura

**Puerta de revisión propia en el CRM**, JSON-RPC real, token en la ruta, calcada del patrón
probado del Hub.

**Alternativas rechazadas:**

- *Extender la puerta de mejoras del Hub con tools `crm_*` que proxeen la pasarela REST.* Obliga
  al Hub a portar `CRM_MCP_API_TOKEN`, **que es de escritura** (abre `POST /automation/rules`,
  `/connectors`, `/config/fields`). No existe un token read-only del CRM. Además mezcla dos
  productos en una puerta.
- *Briefing estático diario publicado por un cron.* Cowork solo vería lo que el cron adivinó que
  era relevante; se pierde el análisis exploratorio, que es el objetivo. Y publicar el estado del
  CRM sin autenticación expone datos de negocio.

## 4. La puerta

### 4.1 Archivos

```
src/app/api/mcp/revision/[token]/route.ts     token en la URL (claude.ai)
src/app/api/mcp/revision/route.ts             token por cabecera Bearer
src/lib/mcp/revision/
  auth.ts        comparación timing-safe contra MCP_REVISION_TOKEN
  github.ts      lector de la API de GitHub, solo GET
  redactar.ts    tapa correos, teléfonos y UUIDs; firma de error para agrupar
  rpc.ts         initialize · notifications/initialized · tools/list · tools/call
  http.ts        el servidor
  tools.ts       catálogo (nombre, descripción, JSON Schema)
  errors.ts      códigos JSON-RPC
  types.ts
  sobre.ts       construye el sobre de rotulado de §4.3
  handlers/
    codigo.ts    GitHub API
    pulso.ts     prisma, agregados
    anomalias.ts medianas de 14 dias vs. el dia
    fallos.ts    prisma, agrupados
    practicas.ts catálogo curado
    protocolo.ts el checklist de §7
  practicas.data.ts
```

Se copia la estructura de `src/lib/mcp/blog/` del Hub (`origin/main`): transporte, manejo de
errores y forma del catálogo son idénticos. Solo cambian los handlers.

### 4.2 Solo lectura, y demostrable

Las routes exportan los demás verbos **solo para contestar 405 con el motivo** —la autorización
los rechaza antes de tocar nada— en vez de un 404 que mandaría a revisar la URL. Es el mismo
patrón que las puertas del Hub. Los handlers hacen `SELECT` por prisma y `GET` a GitHub.

**Primera línea de defensa, añadida en la implementación:** el tipo `RevisionDb` es un `Pick` de
`PrismaClient` que NO expone `create`, `update`, `upsert` ni `delete`. Un handler que intente
escribir **no compila**. El test es la segunda red; el tipo actúa antes.

Un test-guardia (§11) recorre `src/lib/mcp/revision/**` y falla si aparece
`prisma.<modelo>.(create|createMany|update|updateMany|upsert|delete|deleteMany)` o cualquier
verbo HTTP distinto de `GET` hacia GitHub. La garantía es una prueba, no una promesa.

### 4.3 Rotulado — el sobre

**Toda** respuesta de **toda** tool viene envuelta:

```json
{
  "sobre": {
    "ref": "main",
    "sha": "8516e5f0...",
    "medido_en": "2026-08-28T14:03:11Z",
    "alcance": "commits desde 2026-08-27T00:00Z"
  },
  "datos": {}
}
```

Las tools de código resuelven la ref contra GitHub en cada llamada; **nunca** leen el filesystem
del deploy. `ref` es un parámetro con default `main`, para poder revisar una rama concreta a
propósito y que quede dicho cuál fue.

### 4.4 Errores

Mismos códigos que la puerta del blog: `-32001 unauthorized` (token ausente o inválido),
`-32602` (argumentos inválidos), `-32603` (fallo interno, sin filtrar el mensaje de prisma).
Sin token → 401 antes de parsear el cuerpo.

### 4.5 Topes

| Tool | Tope |
|---|---|
| `crm_codigo_leer` | 60 KB por archivo; obligatorio pasar rango si excede |
| `crm_codigo_buscar` | 100 coincidencias, 3 líneas de contexto |
| `crm_codigo_cambios` | 50 commits, ventana máxima 30 días |
| `crm_fallos` | 30 grupos, 1 ejemplo redactado por grupo |
| cualquiera | 200 KB de respuesta; al pasarse, trunca y lo **declara** en el sobre |

Un truncado silencioso se lee como "eso es todo lo que hay". Siempre se declara.

## 5. Catálogo de tools

Cada tool lleva descripción larga: **una tool sin descripción es invisible para el cliente.**

### Código — GitHub API, PAT de solo lectura

1. **`crm_codigo_cambios(desde?, ref?)`** — commits, PRs abiertos con su estado y archivos
   tocados. Es el arranque de cada corrida: responde "qué cambió desde ayer".
2. **`crm_codigo_arbol(path?, ref?)`** — qué archivos hay, para orientarse sin adivinar rutas.
3. **`crm_codigo_leer(path, desde_linea?, hasta_linea?, ref?)`** — contenido rotulado con SHA.
4. **`crm_codigo_buscar(patron, glob?, ref?)`** — grep sobre la ref. Sin esta tool el revisor
   adivina dónde mirar y lee archivos al azar.

### Datos — prisma, agregado

5. **`crm_pulso()`** — el estado del día en conteos: leads nuevos 24 h / 7 d, deals por etapa,
   SLA vencidos y su antigüedad, cola de acciones (pendientes / ejecutadas / fallidas / agotadas),
   conectores con su última sincronización, workflows activos, usuarios activos.
6. **`crm_anomalias()`** — cada métrica del pulso contra su mediana de los 14 días previos, con
   la desviación. Es lo que convierte *"hay 14 leads"* en *"hay 14 leads y la mediana es 60"*.

### Fallos

7. **`crm_fallos(desde?)`** — los 5 modelos de §6, agrupados por tipo + mensaje, con conteo y
   **un ejemplo redactado** por grupo. Nunca payloads crudos: `GET /automation/queue` de la
   pasarela devuelve 100 filas crudas con sus payloads y por eso no se proxea, se agrega.

### Mejoras

8. **`crm_practicas(area?)`** — catálogo curado de prácticas de CRM inmobiliario, cada entrada
   con **su criterio de medición** (§8). Es lo que evita la propuesta genérica: la corrida toma
   N prácticas y las mide contra el CRM real antes de proponer nada.
9. **`crm_revision_protocolo()`** — devuelve el checklist de §7. La tarea programada en Cowork
   queda en una línea y **el protocolo se cambia sin tocar nada en claude.ai**. Misma razón por
   la que el puente `propyte-mejoras` no implementa tools propias: una sola fuente de verdad, sin
   una segunda copia que pueda desincronizarse.

## 6. Modelo de datos consultado

Verificado contra `prisma/schema.prisma` el 2026-08-28:

| Modelo | Campos usados | Qué detecta |
|---|---|---|
| `ActionQueue` | `status`, `attempts`, `maxAttempts`, `error`, `createdAt` | acciones atascadas y agotadas |
| `ConnectorLeadLog` | `status`, `errorDetail`, `processedAt`, `receivedAt` | **leads que entraron y se cayeron** |
| `SlaTimer` | `status`, `dueAt`, `breachedAt` | SLA de primera respuesta incumplidos |
| `AgentRun` | `status`, `error` | bots caídos |
| `WorkflowEvent` | `processedAt` nulo | eventos encolados sin procesar |
| `AuditLog` | escrituras y su origen | qué cambió y quién |

`ConnectorLeadLog` con `status` de error es el hallazgo más caro del CRM: es un lead pagado que
nunca llegó a nadie.

## 7. El protocolo diario

Lo devuelve `crm_revision_protocolo()`. Cinco pasos:

1. **Situar.** `crm_codigo_cambios(desde: ayer)` + `crm_pulso()` + `crm_anomalias()` +
   `crm_fallos(desde: ayer)`. Anotar el SHA del sobre.
2. **Descartar lo ya sabido.** `mejoras_list_tasks(proyecto:'crm')` en **todos** los estados,
   con `estado:'descartada'` pedido **explícitamente** —el default las oculta—. Lo que ya tiene
   tarea no se vuelve a proponer; se actualiza si hay dato nuevo.
3. **Buscar en tres frentes.**
   - *Correctitud*: lo que cambió ayer, leído contra lo que toca.
   - *Operación*: anomalías y fallos, cada uno con su cifra.
   - *Oportunidad*: una práctica de `crm_practicas()` medida contra el CRM real.
4. **Medir antes de registrar.** Cada hallazgo necesita `archivo:línea@SHA` o una consulta con su
   número. Sin medición **no se crea tarea**: se anota como "sospecha sin medir" en el resumen de
   la corrida y ahí termina.
5. **Registrar.** `mejoras_create_task(proyecto:'crm', origen:'auditor',
   origen_ref:'revision-diaria@<SHA>')`. El **409 del dedup es una respuesta correcta**, no un
   error: significa que ya existe → se actualiza esa tarea con el dato nuevo.

**Una corrida que crea 0 tareas es una corrida exitosa.** Si no cambió nada y no hay anomalía,
cierra diciéndolo. Sin esta regla explícita el revisor se siente obligado a producir, y ahí
empieza el ruido.

### Por qué estos pasos

Los tres pasos defensivos salen de fallos ya pagados en este proyecto:

- **Paso 1 (rotular el SHA)** — una rama atrasada produjo 4 hallazgos falsos del tipo "esto no
  existe en el código".
- **Paso 4 (medir)** — de 2 tareas cosechadas y trabajadas, **2 ya estaban resueltas**: la
  cosecha había importado afirmaciones, no mediciones.
- **Paso 2 (listar las descartadas)** — lo archivado sale del listado pero sigue vivo, y el
  guardia que solo mira el listado lo recrea. Con `mejoras_list_tasks` ocultando las descartadas
  por defecto, un revisor diario re-propondría cada día justo lo que ya fue rechazado. El
  `dedupe_hash` del servidor no basta: solo pega en hallazgos idénticos, y un reformulado pasa.

## 8. El catálogo de prácticas

Archivo `practicas.data.ts`, versionado, que crece con el uso. Cada entrada:

```ts
{
  id: 'sla-primera-respuesta',
  area: 'velocidad',
  practica: 'La primera respuesta a un lead nuevo ocurre en minutos, no en horas.',
  por_que: 'La probabilidad de contacto cae de forma abrupta pasada la primera hora.',
  como_se_mide: 'SlaTimer: proporción con status BREACHED en los últimos 7 días, y la mediana de (breachedAt - createdAt).',
  ya_existe_si: 'Hay una SlaPolicy activa que cubre el evento de lead nuevo y su tasa de incumplimiento es baja.'
}
```

`como_se_mide` es obligatorio y es lo que hace útil el catálogo: obliga a que la propuesta llegue
con la cifra del CRM real en lugar de una recomendación de manual.

**Áreas iniciales:** velocidad de respuesta · calidad y origen del lead · higiene del pipeline ·
seguimiento y cadencias · datos de inventario · reportes y metas · adopción por el equipo.

El catálogo arranca corto y curado. Es preferible a que el revisor improvise de memoria.

## 9. Reglas no negociables

1. **Cero PII.** Conteos y agregados. Nunca listas de contactos, nombres ni teléfonos. Los
   ejemplos de `crm_fallos` van redactados.
2. **Solo lectura**, garantizada por el test-guardia de §4.2.
3. **Todo rotulado** con ref, SHA y hora de medición.
4. **Sin medición no hay tarea.**
5. **Dedup contra todos los estados**, descartadas incluidas.
6. **Truncado siempre declarado.**

## 10. Secretos y despliegue

| Variable | Dónde | Qué es |
|---|---|---|
| `MCP_REVISION_TOKEN` | Hostinger (crm.propyte.com) | **Cuarto secreto distinto.** No es `CRM_MCP_API_TOKEN`, ni `MCP_MEJORAS_TOKEN`, ni `MCP_BLOG_TOKEN`. `openssl rand -hex 32` |
| `GITHUB_REVISION_PAT` | Hostinger | PAT fine-grained, **solo** `Propyte-Team/propyte-crm`, permisos `contents:read` + `pull_requests:read` |

Sin `MCP_REVISION_TOKEN` la puerta responde 401 a todo; sin `GITHUB_REVISION_PAT` las tools de
código devuelven un error nombrando la variable, y las de datos siguen funcionando. Una puerta a
medias tiene que decir cuál mitad le falta.

**Conexión desde Cowork:** conector personalizado a
`https://crm.propyte.com/api/mcp/revision/<TOKEN>`.
Costo conocido y ya aceptado en blog y mejoras: el secreto queda en los logs de acceso del
servidor. Se mitiga con rotación → pantalla `/admin/revision/conectar` (ADMIN o DIRECTOR) que
muestra el token, la fecha de la última rotación y el botón para rotarlo, calcada de
`/mejoras/conectar` del Hub.

**Disparo:** tarea programada en Cowork, diaria. Su prompt es una línea: *"Corre la revisión
diaria del CRM siguiendo `crm_revision_protocolo()`."*

## 11. Pruebas

Espejo de la suite de la puerta del blog:

- `auth.test.ts` — sin token → 401; token inválido → 401; token válido → 200. Comparación
  timing-safe.
- `rpc.test.ts` — `initialize`, `notifications/initialized`, `tools/list` devuelve las 9,
  `tools/call` con nombre desconocido → `-32601`.
- `catalogo.test.ts` — **las 9 tools tienen descripción no vacía** y JSON Schema válido.
- `topes.test.ts` — cada tope de §4.5 se aplica y el truncado se declara en el sobre.
- `sobre.test.ts` — toda respuesta trae `ref`, `sha`, `medido_en`, `alcance`.
- `solo-lectura.test.ts` — el guardia de §4.2.
- `pii.test.ts` — las respuestas de `crm_pulso`, `crm_anomalias` y `crm_fallos` no contienen
  correos, teléfonos ni nombres de contacto, verificado con datos sembrados que sí los tienen.
- Handlers: casos con datos sembrados para `pulso`, `anomalias` y `fallos`.

## 12. Fuera de alcance

- **R2 — Capturas de UI.** Cowork no puede navegar un sitio con login. Requiere un capturador
  Playwright con sesión corriendo en el VPS, subida a Storage y una tool que devuelva las
  imágenes. Es la pieza más cara y la que menos bugs encuentra por unidad de esfuerzo. Va después
  de que R1 + R3 demuestren valor.
- **R4 — Errores de runtime.** No existe agregador de 500s de Next. `crm_fallos` cubre fallos de
  **negocio** (colas, conectores, SLA, bots, workflows), que es donde está el dinero. Cubrir las
  excepciones de runtime exige una tabla `error_log` e instrumentar el código de producción; es
  un proyecto aparte y no se mete de contrabando en este.
- **Escritura al CRM desde Cowork.** Decidido: solo propone. No se porta ningún token de
  escritura.

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El token en la ruta queda en logs de acceso | Rotación desde `/admin/revision/conectar`; el token solo lee |
| El revisor produce ruido diario | Pasos 2 y 4 del protocolo; "0 tareas es éxito" |
| La rama del árbol de `propyte-crm` la cambian sesiones paralelas | La puerta lee de GitHub por ref, nunca del disco del deploy |
| El catálogo de prácticas envejece | `como_se_mide` obligatorio: una práctica sin criterio no entra |
| Un `SELECT` pesado del pulso afecta al CRM | Agregados con índices existentes (`[status, runAfter]`, `[status, dueAt]`, `[status, receivedAt]`); medir en la implementación |

---

## 14. Cómo quedó implementado (2026-08-28)

Rama `feat/puerta-revision-cowork`, sobre `origin/main` = `ac155cbb`.
**132 pruebas propias verdes; suite completa del repo 1777/1777.**

### Lo que se desvía del diseño, y por qué

| § | El diseño decía | Quedó así |
|---|---|---|
| 4.1 | Una sola route, con el token en la URL | **Dos routes**: `/api/mcp/revision/[token]` (claude.ai) y `/api/mcp/revision` (cabecera Bearer). Es el patrón de las dos puertas del Hub: la cabecera es el camino correcto para todo cliente que pueda usarla, y la URL existe solo por el límite de claude.ai |
| 4.2 | "El route exporta únicamente POST" | Exporta los demás verbos para contestar **405 con el motivo**. Un 404 mandaría a revisar la URL cuando el problema es el método |
| 4.2 | El test-guardia era la garantía | Se le antepuso el **tipo**: `RevisionDb` no expone métodos de escritura, así que un handler que escriba no compila. El test cubre lo que el tipo no puede ver (`$queryRaw`, un `fetch` con POST) |
| 5.4 | "grep sobre la ref" | La búsqueda usa el índice de GitHub: **solo la rama por default, sin regex y sin número de línea**. Es más limitada de lo que suponía el diseño. La alternativa —bajar el árbol y grepear— cuesta decenas de peticiones y nginx corta lo que pasa minutos sin mandar bytes. La limitación va declarada en la descripción de la tool **y** en el cuerpo de cada respuesta |
| 8 | El agente elige qué práctica medir | **El servidor rota dos por día.** Un revisor al que se le pide "elige una" elige la primera de la lista todos los días: nada en su contexto distingue el martes del miércoles |
| 11 | Un archivo de test por invariante | Se agruparon en 7: `auth`, `rpc`, `catalogo`, `solo-lectura`, `redactar`, `topes`, `puerta` (integración de las 9 tools, incluida la de PII) y `http` (la puerta real contestando) |

### Añadido que el diseño no contemplaba

- **`redactar.ts`** — el spec decía "ejemplos redactados" sin decir cómo. El riesgo real no son los conteos: son los mensajes de error, que traen el payload que reventó. Tapa correos, teléfonos (en sus cinco formatos) y UUIDs, y `firmaDeError` agrupa el mismo fallo con distintos identificadores — sin eso, 400 instancias de un bug se leen como 400 bugs.
- **Reloj inyectado** — el instante se fija una vez por petición y lo comparten todos los handlers. Si cada uno leyera el suyo, dos consultas de la misma respuesta podrían caer en días distintos justo en el cambio de fecha.
- **Aviso de ventana acotada** en `crm_codigo_cambios`: pedir 6 meses y recibir 30 días sin aviso haría concluir "no hubo actividad antes".

### Lo que NO se construyó

- ~~`/admin/revision/conectar`~~ — **construida.** Ver §15.
- **R2 y R4**, que ya estaban fuera de alcance (§12).

### Hallazgo del entorno, no de la puerta

El `node_modules` del worktree es un junction al del árbol principal, así que **el cliente de Prisma generado es compartido entre worktrees**. Durante esta implementación `tsc` reportó 27 errores en 5 archivos ajenos (`comment-rules`, `handle-comment`, `permissions/can`) porque el cliente estaba generado desde el esquema de otra rama: `origin/main` **sí** tiene `excludePhrases`, `dailyCap` y los modelos de permisos, y el cliente no. Cero errores en el código de esta puerta.

⚠️ Consecuencia: `tsc` en un worktree con junction mide contra el esquema de quien haya corrido `prisma generate` al último. Correr `prisma generate` aquí **arreglaría este árbol y rompería el del vecino**, así que no se hizo.

🧨 Y el junction no se borra con `rm -rf`: eso se llevaría el `node_modules` original. Se quita con `cmd //c rmdir node_modules`.

### Antes de que esto sirva

1. `MCP_REVISION_TOKEN` (`openssl rand -hex 32`) y `GITHUB_REVISION_PAT` en Hostinger.
2. Mergear y desplegar.
3. Verificar contra prod: sin token → 401; con token → `tools/list` con 9 tools.
4. Conectar en Cowork: `https://crm.propyte.com/api/mcp/revision/<TOKEN>`.
5. Programar la tarea diaria: *"Corre la revisión diaria del CRM siguiendo `crm_revision_protocolo()`."*

---

## 15. La pantalla de conexión (2026-08-28)

`/admin/revision/conectar`, solo ADMIN y DIRECTOR. **132 pruebas propias.**

### El token se movió a la base, y eso se aparta del Hub

§10 prometía "un botón para rotarlo". **Una pantalla no puede reescribir una variable de
entorno de Hostinger**, así que con el diseño original ese botón no podía existir: las
puertas del Hub leen su token del entorno y su pantalla de conectar **solo lo muestra**.

El token vive ahora en `system_config` bajo la clave `mcp.revision.token`, y el entorno
queda como respaldo de arranque. El motivo no es comodidad: un secreto que solo se cambia
entrando al panel de Hostinger **no se rota nunca** —deja de ser una operación del producto
y se vuelve una tarea de infraestructura que nadie hace—. Y aquí pesa más que en el Hub,
porque este token viaja en la ruta y por lo tanto queda escrito en los logs de acceso.

**La base gana sobre el entorno, y ese orden es la diferencia entre una rotación real y una
que miente:** si el entorno ganara, la pantalla diría "rotado" y el secreto viejo seguiría
abriendo mientras la variable estuviera puesta. La pantalla avisa cuando el token en uso
viene del entorno y recomienda borrar la variable.

**Sin caché.** Cachear la lectura aunque fueran 30 segundos abriría una ventana en la que
el token recién revocado sigue funcionando. Es un `findUnique` por clave única y el tráfico
es un agente al día.

### Reparto de responsabilidades

| Archivo | Qué hace |
|---|---|
| `src/lib/mcp/revision/token.ts` | **Solo lee** el token. Vive dentro de la puerta |
| `src/lib/mcp/revision/conexion.ts` | Roles, armado de la URL y avisos. Puro y probado |
| `src/server/revision-token.ts` | **La escritura**, FUERA del directorio de la puerta |
| `.../admin/revision/conectar/page.tsx` + `PanelConexion.tsx` | La pantalla |

La escritura está fuera a propósito: el directorio de la puerta es de solo lectura y el
guardia lo vigila. Meter el `upsert` ahí lo rompería, y con razón — **la puerta no debe
poder cambiar su propia credencial**.

### Decisiones de la pantalla

- **El secreto viene tapado.** Esta pantalla se abre en juntas y se comparte pantalla. Se
  deja ver el host y la ruta, que identifican la puerta sin revelar nada.
- **Confirmación en dos pasos.** La rotación no tiene ventana de convivencia: rompe el
  conector que ya esté funcionando hasta que se pegue la URL nueva. Un botón de un clic
  sería una caída de servicio a un dedo de distancia.
- **El guardia se repite en la acción de servidor.** Una acción de servidor es un endpoint
  público: quien conozca su identificador puede invocarla sin pasar por la pantalla. El
  `redirect` del componente no la protege.
- **El token NUNCA entra al `AuditLog`.** Se registra que hubo rotación y cuándo. Un log que
  guarda la credencial convierte cada respaldo de la base en una copia del secreto.
- **Puerta propia, no una pestaña de `/admin`**, por el mismo motivo que las reglas de
  comentarios: `/admin` precarga usuarios, comisiones y API keys al payload. Aquí además se
  pinta un secreto, así que cuanto menos cargue alrededor, mejor.

### Dos correcciones a lo ya entregado

1. **`RevisionDb` no restringía nada.** `Pick<PrismaClient, "contact">` elige la CLAVE y
   deja el delegate entero —`create` incluido— del otro lado. El tipo parecía restrictivo y
   no lo era. Ahora cada modelo se mapea a `SoloLectura<…>` y `db.contact.create(...)` no
   compila. **Lo verifica `tsc`** con un `@ts-expect-error`: si el tipo dejara de impedirlo,
   la directiva sobraría y el typecheck fallaría por eso.
   La prueba anterior leía `types.ts` y buscaba la palabra "create" — pasaba sin probar
   nada. Dos literales del mismo archivo nunca prueban un comportamiento.

2. **Firma de Next 15 en un repo de Next 14.** Las routes traían
   `params: Promise<{token}>`, copiado del Hub. `tsc --noEmit` no lo delata: valida la
   anotación que uno escribe, no la que Next espera. El que falla es `next build`. Corregido
   a `params: { token: string }`, que es lo que usan las demás rutas dinámicas del repo.

### Lo que sigue faltando

`next build` no se corrió: el cliente de Prisma compartido por el junction está generado
desde el esquema de otra rama y hace fallar 27 comprobaciones en archivos ajenos (§14). El
build real ocurre en el servidor al desplegar.
