# Prueba de humo — bot de reclutamiento F1

Spec: `docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md` (ver §14: el bot escribe en el
módulo Reclutamiento del #926, tabla `recruit_candidates`).

## Precondiciones (una vez, en prod, por quien tenga acceso a la BD)

1. Aplicar `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql`.
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

## Caso 1 — APTO (Instagram)

Desde una cuenta de prueba, escribir «Hola, vi la vacante de asesor». Esperado: el clasificador marca
EMPLEO y el bot pregunta nombre y plaza. Contestar: Playa del Carmen · teléfono · mayor de edad sí ·
«sí, me funciona» la comisión · tiempo completo · «tengo 4 meses de ahorro» · «tengo auto y puedo
moverme» · «2 años en bienes raíces» · «unos 20 contactos» · «vendí seguros» · «inglés conversacional» ·
«uso Instagram para prospectar» · tres respuestas de actitud con sustancia.

Esperado al final: el bot felicita, pide CV (PDF o Word) y horario para la entrevista.
En BD (`recruit_candidates`): fila con `source=CHAT`, `sourceRef=<conversationId>`, `contactId`,
`botResultado=APTO`, `botPuntaje ≥ 65`, `plaza=PDC`, `stage=CONTACTO_INICIAL`, `botResumen` lleno.
Tarea «Entrevistar candidato … — PDC» para el gerente de PDC y notificación en su campana con
«Ficha: /reclutamiento». Evento `recruitment.apto` en `workflow_events`.
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
| | | | | |
