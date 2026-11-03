# Bot de reclutamiento — F1.1 (correcciones de la prueba) + F2 (módulo) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corregir lo que falló en la primera prueba real (Instagram, 2026-11-03, conversación `dbf17326-…`) y mostrar en el CRM todo lo que el bot captura.

**Contexto:** spec `docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md` (§14) y anexo
`docs/superpowers/plans/2026-11-02-bot-reclutamiento-f1-integracion-926.md`. F1 está en `main` (PR #222), SQL
`prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql` aplicado y guion sembrado en prod.

**Qué pasó en la prueba (hechos, de la BD):**
- El guion marcó `nombre` como hecho sin preguntar (`skipIfFilled` + firstName de Instagram).
- El motor se quedó en `colchon_meses` («Tengo otro trabajo» no casa con ningún enum); el modelo se salió del guion,
  cerró la charla y pidió el CV por su cuenta. Nunca llegó a COMPLETED → sin evaluación, sin teléfono en la ficha.
- El agente recibió el catálogo de ventas (filtro por zona) y habló de Ancestral y Gran Coralia como departamentos.
- `LEGACY_IDENTITY` dice «inmobiliaria boutique de la Riviera Maya».
- Dos mensajes entrantes en 2 s → segundo run con historial terminado en `assistant` → HTTP 400 (nota interna).
- CV llegó como enlace de Drive (Instagram no manda archivos): no se ligó.
- `/reclutamiento` no lee ninguna columna `bot*`.

**Decisiones de Luis (2026-11-03):** descripción nueva en el prompt de TODOS los agentes; desarrollos desde el Hub
distinguiendo exclusivos (Yaxnáh Caucel, Turena, Nativa Tulum, lotes/macrolotes Tulum y Mérida) de co-broker; Mérida
solo oficina de Yaxnáh Caucel; CV: intentar archivo, aceptar enlace; módulo con lo necesario y tarjeta en la ficha del
contacto («mirror»). Primera pregunta: mayor de edad. «Gerente de Ventas», no «gerente de la plaza».

**Datos del Hub (vista `real_estate_hub.v_developments`, leída en vivo por `src/lib/hub/catalog.ts`):**
`crm_relationship` ∈ {Exclusivo, Co-broker, Referidos, NULL}; `property_types` text[] (Departamento, Casa, Terreno,
Villa, Penthouse, Local); `city`; `realName` = `d.name`. Gate público: `approved_at IS NOT NULL AND deleted_at IS NULL`.

**Textos oficiales:**
- Empresa: «Propyte es una comercializadora inmobiliaria con producto en Tulum, Playa del Carmen, Cancún, Mérida y Telchac.»
- Oficina PDC: «Quinta Avenida esquina con calle 40, Playa del Carmen (ubicación privilegiada, en plena Quinta).»
- Oficina Mérida: «la oficina de ventas de Yaxnáh Caucel, en Ciudad Caucel, Mérida.»

**Reglas del repo:** vitest (`npm test` completo antes del PR; `npx vitest run <ruta>` por tarea), `tsc --noEmit` con
`NODE_OPTIONS=--max-old-space-size=8192` filtrando a archivos tocados (hay ~7000 errores preexistentes de entorno),
commits con autor `Propyte-Luis <marketing@propyte.com>`, SQL manual en `prisma/migrations-manual/` (sin CI de
migraciones). No tocar `.env`.

---

## Task 1 — Núcleo: el historial siempre termina en `user`

**Files:** `src/lib/bot/bot-respond.ts:342-379` (+ test nuevo `src/lib/bot/bot-respond.historial.test.ts` o ampliar el existente).

- Tras el `reduce`, si `history[history.length-1].role === "assistant"`, el último mensaje real es del bot: no hay nada
  que contestar. Registrar `console.info("[bot] historial termina en assistant, se omite el turno", {contactId})` y
  `return false` (mismo contrato que el watermark de líneas 548-556). No llamar a Claude, ni al playbook, ni al hook.
- Test: con mensajes `INBOUND, OUTBOUND` (último OUTBOUND) `botRespond` devuelve false sin llamar a `askClaude`
  (mockear prisma como en `bot-respond.reclutamiento.test.ts`).
- Commit: `fix(bot): no correr el turno si el historial termina en mensaje del bot (HTTP 400 prefill)`.

## Task 2 — Descripción de Propyte en el prompt base

**Files:** `src/lib/bot/claude.ts:21,292`, `src/lib/bot/classify.ts:36`, snapshots `src/lib/bot/__snapshots__/claude.brand.test.ts.snap`.

- Reemplazar «inmobiliaria boutique de la Riviera Maya» por «comercializadora inmobiliaria con producto en Tulum,
  Playa del Carmen, Cancún, Mérida y Telchac» en `SAGE_SYSTEM_PROMPT` y `LEGACY_IDENTITY`. En `classify.ts` cambiar
  «(Propyte, Riviera Maya)» por «(Propyte: Tulum, Playa del Carmen, Cancún, Mérida y Telchac)».
- Actualizar snapshots con `npx vitest run src/lib/bot/claude.brand.test.ts -u` y revisar el diff: solo esa línea.
  `claude.brand.test.ts:39-40` (con brand NO menciona Propyte/Riviera Maya/Tulum) debe seguir verde.
- `tone-presets.ts:23` («boutique premium») es descripción de tono: no se toca.
- Commit: `feat(bot): Propyte como comercializadora inmobiliaria en el prompt base`.

## Task 3 — Guion y cierre del agente de reclutamiento

**Files:** `src/lib/bot/playbook/segment-playbooks.ts` (bloque «Agente Reclutamiento»), `segment-playbooks.test.ts`,
`src/lib/reclutamiento/modelo.ts:61`, `modelo.test.ts`, `src/lib/reclutamiento/hook.ts`, `hook.test.ts` (si existe) ,
`src/lib/bot/bot-respond.ts:492-504`, `src/lib/timeline/custom.ts` (VALORES de colchon_meses).

Guion:
- Orden nuevo: `mayor_edad`, `nombre`, `plaza`, `telefono`, `acepta_comision`, `disponibilidad`, `colchon_meses`,
  `movilidad`, `experiencia_inmobiliaria`, `cartera_clientes`, `experiencia_ventas`, `ingles`, `prospeccion_digital`,
  `actitud_1..3`.
- `nombre`: `skipIfFilled: false` (revisar cómo lo expresa el seed: si el tipo no tiene el campo, agregarlo al spec del
  playbook y al seed `scripts/seed-bot-playbooks-segmento.ts`). Objetivo: «Pide su nombre completo (nombre y apellidos),
  aunque ya conozcas su nombre de perfil.»
- `telefono`: objetivo «Pide un teléfono con WhatsApp a 10 dígitos, con lada (por ejemplo 984 o 999).»
- `colchon_meses`: nueva opción `OTRO_INGRESO` con sinónimos «tengo otro trabajo», «otro trabajo», «otro ingreso»,
  «tengo trabajo», «sigo trabajando», «tengo ingresos», «me mantiene», «mi pareja», «mis papás». Va ANTES de las
  opciones numéricas. En `modelo.ts` `colchon_meses.pasa` += `OTRO_INGRESO`; en `custom.ts` etiqueta «Otro ingreso».
  Test en `segment-playbooks.test.ts`: «Tengo otro trabajo» → OTRO_INGRESO; «12 meses» sigue → MAS_DE_SEIS.

Hook (`hook.ts`):
- Mientras el playbook esté IN_PROGRESS, `contexto` = guion + ficha:
  «Reglas del guion: estás en medio de una entrevista por chat. NO cierres la conversación, NO pidas CV, NO ofrezcas ni
  prometas entrevista y NO des por terminado nada hasta que el sistema te lo indique. Si el candidato pregunta algo o
  se desvía, contesta breve con la ficha y retoma la pregunta pendiente en el mismo mensaje. Si una respuesta no fue
  clara, vuelve a preguntar de otra forma. Solo describe productos y oficinas con la ficha; no inventes desarrollos.
  Ficha de la vacante: ${ficha}».
- `bot-respond.ts:502`: anexar `hr.contexto` aunque `playbookObjective` sea undefined (usar `DEFAULT` + contexto).
- Cierres (`OBJETIVOS_CIERRE`): «gerente de la plaza» → «Gerente de Ventas». APTO_SIN_CV / REVISAR_SIN_CV: «Pide su
  CV: como archivo PDF o Word si puede adjuntarlo, o un enlace (Drive, Dropbox) si el canal no permite archivos.»
  Todos los cierres que mencionen contacto: «Dile que el Gerente de Ventas lo contacta por WhatsApp al número que
  dejó.» (ya no «por este chat»).
- `modelo.ts` `FICHA_DEFAULT` → ver Task 4 (la escribe Task 4; aquí solo cambiar «gerente de la plaza»).
- Commit: `feat(reclutamiento): guion reordenado, nombre siempre, colchón con otro ingreso, reglas de no cerrar`.

## Task 4 — Ficha dinámica con desarrollos del Hub

**Files:** nuevo `src/lib/hub/reclutamiento-inventario.ts` (+test), nuevo `src/lib/reclutamiento/ficha.ts` (+test),
`src/lib/reclutamiento/modelo.ts:84-87`, `src/lib/reclutamiento/hook.ts`, `src/lib/bot/bot-respond.ts:387-393`.

- `src/lib/hub/reclutamiento-inventario.ts`: `desarrollosParaReclutamiento(): Promise<DesarrolloReclutamiento[]>`
  con `prisma.$queryRawUnsafe` sobre `real_estate_hub.v_developments d` con el `PUBLIC_GATE` de `catalog.ts:30`
  (importarlo o duplicar la constante con comentario), columnas: `d.name AS nombre, d.city AS ciudad,
  d.crm_relationship AS relacion, d.property_types AS tipos, d.available_units AS disponibles`. Normalizar
  `relacion`: `EXCLUSIVO` si `lower(relacion)` empieza con «exclus», `REFERIDOS` si «refer», `CO_BROKER` si
  «co-brok»/«cobrok», si NULL → `CO_BROKER`. Cache en memoria 10 min (patrón simple: variable módulo + timestamp).
  Nunca lanza: error → `[]` con `console.warn("[reclutamiento] inventario del Hub no disponible", err)`.
- `src/lib/reclutamiento/ficha.ts`: `construirFicha(base: string, devs: DesarrolloReclutamiento[]): string`.
  Salida (texto plano, líneas cortas):
  ```
  ${base}
  Oficinas: Playa del Carmen, Quinta Avenida esquina con calle 40 (ubicación privilegiada, en plena Quinta).
  Mérida: oficina de ventas de Yaxnáh Caucel, en Ciudad Caucel.
  Desarrollos exclusivos de Propyte (producto propio): Yaxnáh Caucel (casas, Mérida); Turena (departamentos y
  penthouses, Telchac); Nativa Tulum (departamentos y penthouses, Tulum).
  Además comercializamos inventario de otros desarrolladores (co-broker): Playa del Carmen: 14 desarrollos (terrenos,
  casas, departamentos); Tulum: 6 (terrenos, departamentos, villas); Cancún: ...
  ```
  Tipos en español y plural: Terreno→terrenos, Casa→casas, Departamento→departamentos, Villa→villas,
  Penthouse→penthouses, Local→locales. Sin precios. Ciudades ordenadas por número de desarrollos desc. Si `devs` vacío,
  omitir las dos líneas de desarrollos (la ficha base ya dice «inventario de desarrollos»).
- `modelo.ts` `FICHA_DEFAULT` nueva: «Propyte es una comercializadora inmobiliaria con producto en Tulum, Playa del
  Carmen, Cancún, Mérida y Telchac. Buscamos asesores inmobiliarios para Playa del Carmen y Mérida. Esquema 100 %
  comisión (sin sueldo base), comisiones competitivas por venta, capacitación continua, inventario propio y de
  co-broker, y acompañamiento del equipo. Necesitas vehículo propio y disponibilidad para moverte por la zona. El
  proceso: una charla aquí, tu CV y una entrevista con el Gerente de Ventas.»
- `hook.ts`: donde use `cfg.ficha`, usar `construirFicha(cfg.ficha, await desarrollosParaReclutamiento())`.
- `bot-respond.ts`: si `esAgenteReclutamiento(agentProfile)` (sin brand), NO llamar a `findMatchingDevelopments`;
  pasar `catalog: []` para que el bloque diga que no hay catálogo. Ojo: `agentProfile` debe resolverse antes de la
  línea 387; si no, mover la consulta del catálogo después de resolverlo.
- Tests: `construirFicha` con 3 exclusivos + co-broker en 2 ciudades → texto esperado; con `[]` → solo base + oficinas.
  `desarrollosParaReclutamiento` mockeando `$queryRawUnsafe`: normalización de relación y cache.
- Commit: `feat(reclutamiento): ficha con oficinas y desarrollos del Hub; sin catálogo de ventas en el agente`.

## Task 5 — Copiar al candidato en cada turno (nombre, teléfono, correo, respuestas)

**Files:** `src/lib/reclutamiento/candidato.ts` (+test), `src/lib/reclutamiento/hook.ts`.

- `sincronizarCandidato({candidatoId, contacto: {firstName,lastName,phone,email}, respuestas})`: `updateMany` sobre
  `recruitCandidate` where id, data solo con lo que no esté vacío: `fullName` (first + last trim) si ≠ «Candidato por
  chat», `phone`, `email`, `botRespuestas: respuestas` (siempre que tenga alguna clave). No pisa `stage` ni `bot*` de
  evaluación. Nunca lanza.
- `hook.ts`: en la rama IN_PROGRESS, tras `recargarContacto`, llamar `sincronizarCandidato` con `leerRespuestas(custom)`.
  También en la rama «ya evaluado» (por si llega el teléfono después).
- Test: con firstName «Myriam», phone «+52…» y 3 respuestas → updateMany con esos campos; con contacto vacío → sin update.
- Commit: `feat(reclutamiento): la ficha del candidato se actualiza en cada turno del bot`.

## Task 6 — CV por enlace

**Files:** `prisma/schema.prisma` (RecruitCandidate: `cvUrl String?`), `prisma/migrations-manual/2026-11-03-reclutamiento-bot-v2.sql`,
`src/lib/reclutamiento/cv.ts` (+test), `src/lib/reclutamiento/hook.ts` (`cierreDe` / `tieneCv`), `src/lib/reclutamiento/candidato.ts` (`CandidatoBot.tieneCv`).

- SQL v2 (idempotente, cabecera como la v1): `ALTER TABLE … ADD COLUMN IF NOT EXISTS "cvUrl" TEXT;` + `UPDATE
  bot_agent_profiles SET identity = <identidad nueva>` WHERE name='Agente Reclutamiento' AND deletedAt IS NULL AND
  identity NOT LIKE '<prefijo nuevo>%'. Identidad nueva = la de la v1 con «comercializadora inmobiliaria con producto en
  Tulum, Playa del Carmen, Cancún, Mérida y Telchac» en vez de la frase de plazas, «Gerente de Ventas», y la frase
  «No cierres ni pidas CV hasta que el sistema te lo indique.» Rollback: DROP COLUMN.
- `cv.ts`: `ligarCvPorEnlace(msg)`: si el mensaje INBOUND tiene body con URL (`https?://\S+`) de dominios drive.google.com,
  docs.google.com, dropbox.com, onedrive.live.com, 1drv.ms, icloud.com, wetransfer.com, o cuya ruta termina en .pdf/.doc/.docx
  → candidato por contactId (reusar `asegurarCandidato`-like lookup sin crear) → `updateMany` `cvUrl` si estaba vacío.
  Nunca lanza. Llamarla desde `src/lib/messaging/core.ts` junto a `ligarCv` (mismo import dinámico).
- `tieneCv` = archivo CV o `cvUrl`. Cierres: ya lo cubre Task 3.
- Tests: enlace de Drive → cvUrl; texto sin enlace → nada; enlace a instagram.com → nada.
- Commit: `feat(reclutamiento): aceptar el CV como enlace (Instagram no manda archivos)`.

## Task 7 — `/reclutamiento` muestra lo del bot

**Files:** `src/lib/reclutamiento/shared.ts:136-156` (`CandidatoFila`), `src/server/reclutamiento.ts` (SELECT, FilaDb, aFila),
`src/components/reclutamiento/reclutamiento-client.tsx`, nuevo `src/components/reclutamiento/evaluacion-bot.tsx`, tests de `aFila`/filtros si existen.

- `CandidatoFila` += `cvUrl`, `botCanal`, `botResultado`, `botPuntaje`, `botMotivo`, `botResumen`, `botRespuestas`
  (Record<string,string>|null), `botDesglose`, `horarioEntrevista`, `conversationId` (= `sourceRef` cuando `source==="CHAT"`).
- Tabla: columna «Origen» (MANUAL / canal en texto: Instagram, Messenger, WhatsApp) y «Bot» (badge APTO verde /
  REVISAR ámbar / NO_APTO gris + puntaje «72/100»; vacío si no evaluó; «en guion» si `source==="CHAT"` y sin evaluar).
  Columna CV: además del archivo, si `cvUrl` → enlace «Ver enlace» (target _blank, rel noopener). Teléfono: enlace
  `tel:` + botón WhatsApp (`https://wa.me/<digits>`) como en contact-detail.
- Chips de filtro por veredicto (APTO / REVISAR / NO_APTO / sin evaluar) junto a los de etapa.
- `CandidatoDialog`: sección de solo lectura «Evaluación del bot» (`evaluacion-bot.tsx`): veredicto+puntaje, motivo
  legible (`filtro:movilidad` → «No pasó el filtro: Movilidad»; `ambiguo:colchon_meses` → «Respuesta ambigua: Colchón»;
  `puntaje` → «Por puntaje»), resumen, horario de entrevista, respuestas con etiquetas/valores de
  `src/lib/timeline/custom.ts` (reusar `etiquetaCustom`/`valorCustom` si están exportadas; si no, exportarlas), y botón
  «Abrir conversación» → `/inbox?c=${conversationId}`.
- Roles: sin cambios. Mantener `sinMigracion` funcionando (si falta `cvUrl` la lista debe seguir: tratar P2022 igual
  que hoy).
- Commit: `feat(reclutamiento): origen, veredicto, respuestas, CV por enlace y conversación en la pantalla`.

## Task 8 — Tarjeta «Reclutamiento» en la ficha del contacto

**Files:** `src/server/reclutamiento.ts` (`candidatoDeContacto(contactId)`), `src/app/(dashboard)/contacts/[id]/page.tsx`,
`src/components/contacts/contact-detail.tsx` (col. izquierda, antes de `CustomFieldsSection`), nuevo `src/components/contacts/reclutamiento-card.tsx`.

- `candidatoDeContacto`: findFirst por `contactId`, `deletedAt: null`, select id, stage, botResultado, botPuntaje,
  botResumen, horarioEntrevista, cvUrl, files CV (1), source. P2021/P2022 → null.
- `page.tsx`: cargarlo solo si `puedeVerReclutamiento(role)`; pasar `candidatoReclutamiento` a `ContactDetail`.
- Card: título «Reclutamiento», etapa con color de `ETAPAS`, veredicto badge + puntaje, resumen (3 líneas, clamp),
  horario, «Ver CV» / «Ver enlace», y link «Abrir en Reclutamiento» → `/reclutamiento`. Si no hay candidato → no se
  renderiza.
- Commit: `feat(contactos): tarjeta de reclutamiento en la ficha del contacto`.

## Task 9 — Seed, QA y docs

**Files:** `scripts/seed-bot-playbooks-segmento.ts` (si Task 3 lo necesita), `docs/qa/reclutamiento-smoke.md`, bitácora.

- Smoke: actualizar precondiciones (SQL v2 → seed → deploy), orden de preguntas, caso «CV por enlace», caso «otro
  ingreso», y registrar la prueba del 2026-11-03 en la bitácora con lo que falló.
- Commit: `docs(reclutamiento): humo v2 y bitácora de la primera prueba`.

## Cierre

- `npm test` completo y `tsc` filtrado a archivos tocados.
- Revisión final de integración (subagente): cierres, ficha, catálogo apagado, sincronización, UI.
- Push `feat/bot-reclutamiento-v2`, PR con orden de salida: SQL v2 → seed → merge.
