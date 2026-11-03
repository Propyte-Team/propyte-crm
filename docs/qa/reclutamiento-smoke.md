# Prueba de humo — bot de reclutamiento F1

Spec: `docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md` (ver §14: el bot escribe en el
módulo Reclutamiento del #926, tabla `recruit_candidates`).

## Precondiciones (una vez, en prod, por quien tenga acceso a la BD)

1. Aplicar `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql` y después
   `prisma/migrations-manual/2026-11-03-reclutamiento-bot-v2.sql` (columna `cvUrl` e identidad v2). La v2 va
   **antes** del deploy: el código nuevo lee `cvUrl` y sin la columna el bot deja de evaluar.
2. Sembrar el guion nuevo: `npx tsx scripts/seed-bot-playbooks-segmento.ts` (reemplaza las tareas del
   playbook del «Agente Reclutamiento» conservando su id). Es seguro hacerlo **antes** del deploy: el
   código viejo ignora las claves nuevas. Y el código nuevo no evalúa mientras el guion sembrado sea el
   viejo (el hook exige la tarea `actitud_3`), así que el orden SQL → seed → deploy no deja huecos.
3. Mergear y desplegar.
4. Activar en Ajustes → Agentes del bot el «Agente Reclutamiento».
5. Confirmar que `bot_config.enabledChannels` incluye INSTAGRAM y MESSENGER (lo hace el SQL).
6. Opcional: `SystemConfig` `reclutamiento.responsables` = `{"MERIDA":["<userId>"]}` cuando Luis
   nombre al responsable de Mérida. Sin eso, el aviso va a la gerencia de la plaza y, si no hay, a ADMIN.

Orden de canales: Instagram, luego Messenger. WhatsApp cuando su conexión con Meta sea estable.

## Orden del guion (v2, 2026-11-03)

mayor de edad → nombre completo (siempre, aunque el perfil traiga nombre) → plaza → teléfono con lada →
comisión → disponibilidad → colchón (acepta «tengo otro trabajo») → movilidad → experiencia inmobiliaria →
cartera → experiencia en ventas → inglés → prospección digital → tres preguntas de actitud.
El bot no cierra ni pide CV hasta completar el guion. Al preguntar por la empresa u oficinas debe decir que
Propyte es una comercializadora inmobiliaria con producto en Tulum, Playa del Carmen, Cancún, Mérida y Telchac,
que la oficina de Playa está en Quinta Avenida esquina con calle 40 y la de Mérida es la de Yaxnáh Caucel, y
distinguir los desarrollos exclusivos (Yaxnáh Caucel, Turena, Nativa Tulum) del inventario co-broker.

## Caso 1 — APTO (Instagram)

Desde una cuenta de prueba, escribir «Hola, vi la vacante de asesor». Esperado: el clasificador marca
EMPLEO y el bot pregunta primero si es mayor de edad. Contestar: sí · nombre completo · Playa del Carmen · teléfono ·
«sí, me funciona» la comisión · tiempo completo · «tengo 4 meses de ahorro» · «tengo auto y puedo
moverme» · «2 años en bienes raíces» · «unos 20 contactos» · «vendí seguros» · «inglés conversacional» ·
«uso Instagram para prospectar» · tres respuestas de actitud con sustancia.

Esperado al final: el bot felicita, pide CV (PDF o Word) y horario para la entrevista.
En BD (`recruit_candidates`): fila con `source=CHAT`, `sourceRef=<conversationId>`, `contactId`,
`botResultado=APTO`, `botPuntaje ≥ 65`, `plaza=PDC`, `stage=CONTACTO_INICIAL`, `botResumen` lleno.
Tarea «Entrevistar candidato … — PDC» para el gerente de PDC y notificación en su campana con
«Ficha: /reclutamiento». Evento `recruitment.apto` en `workflow_events`.
En `/reclutamiento` la ficha muestra el teléfono desde que lo da (no hace falta terminar el guion).
Mandar un PDF → aparece en la columna CV de `/reclutamiento` (fila en `recruit_candidate_files` con
`source=CHAT`, `sourceRef=<messageId>`). Contestar «martes por la tarde» → `horarioEntrevista` lleno y
el bot confirma.
Abrir `/reclutamiento` como ADMIN y confirmar que el candidato aparece con origen CHAT.

## Caso 2 — REVISAR (Messenger)

Igual, pero al colchón contestar «no sé, no lo he calculado» con perfil fuerte. Esperado:
`botResultado=REVISAR`, `botMotivo=ambiguo:colchon_meses`, `stage=FILTRO_CV`; el bot pide CV y dice
«en dos días hábiles». Notificación, sin tarea. Evento `recruitment.revisar`.

## Caso 3 — NO APTO (Instagram)

Igual, pero a movilidad contestar «no puedo moverme». Esperado: el bot termina el bloque de preguntas
(no corta de golpe) y al completar cierra con tacto, sin pedir CV ni ofrecer entrevista.
`botResultado=NO_APTO`, `botMotivo=filtro:movilidad`, `stage=DESCARTADO`. Sin notificación. Evento
`recruitment.no_apto`.

## Caso 4 — pregunta fuera de guion

A mitad del guion preguntar «¿cuánto pagan?». Esperado: el bot contesta con la ficha (100 % comisión,
sin sueldo base, capacitación) y retoma la pregunta pendiente.

## Caso 5 — reclasificación

A mitad decir «en realidad quiero comprar un depa en Tulum». Esperado: el clasificador cambia a
LEAD_COMPRADOR y el siguiente mensaje lo atiende el Agente Lead Comprador. El candidato queda en
`recruit_candidates` en su etapa (descartarlo a mano en `/reclutamiento`; F2 lo automatiza).

## Caso 7 — CV por enlace (Instagram)

Instagram no deja mandar archivos. Pegar un enlace de Google Drive o Dropbox al CV. Esperado: «Ver enlace»
en la columna CV de `/reclutamiento` y en la tarjeta Reclutamiento de la ficha del contacto; el bot no
vuelve a pedir el CV.

## Caso 8 — otro ingreso

Al colchón contestar «tengo otro trabajo». Esperado: el bot sigue con la siguiente pregunta (no se atora) y
el filtro de colchón pasa. «No tengo trabajo ni ahorros» no debe pasar.

## Caso 6 — adjunto sin texto

Mandar solo un PDF, sin mensaje. Esperado: el bot lo reconoce («gracias por tu CV») y no lo vuelve a
pedir; el historial que ve el bot trae `[adjunto: <nombre>]`.

## Qué mirar si algo falla

- Logs del servidor con prefijo `[reclutamiento]` (sin migrar, evaluación, avisos, CV).
- `recruit_candidates.botEvaluadoAt` lleno pero `botResultado` null → un turno reservó la evaluación
  y falló; el siguiente mensaje del candidato no re-evalúa. Poner `botEvaluadoAt = NULL` para reintentar.
- Si el bot repite la misma pregunta, revisar que la respuesta tenga un sinónimo en `enumOptions` del
  playbook (`src/lib/bot/playbook/segment-playbooks.ts`) y volver a sembrar.
- Un CV mandado como **primer** mensaje (antes del primer turno del bot) no se liga: la fila del
  candidato se crea en el primer turno del bot y `ligarCv` no encuentra a quién colgarlo. No es un
  error: el bot pide el CV al final de todos modos y ese sí se liga.

## Bitácora

| Fecha | Canal | conversationId | Caso | Resultado |
|---|---|---|---|---|
| 2026-11-03 | Instagram | dbf17326-2a00-41cd-8130-c88db210e3ca | 1 | Falló: no preguntó nombre; se atoró en colchón («tengo otro trabajo»), cerró solo y pidió CV; sin evaluación ni teléfono en la ficha; describió mal Ancestral y Gran Coralia; «boutique»; sin dirección de oficina; CV por enlace de Drive no ligado; error 400 por dos mensajes seguidos. Corregido en F1.1 (plan 2026-11-03). |
| | | | | |
