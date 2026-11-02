# Bot de reclutamiento de asesores — diseño

Fecha: 2026-11-02 · Repo: `propyte-crm` · Rama: `feat/bot-reclutamiento`
Aprobado por Luis en conversación (plazas y vehículo ajustados por él; todo lo demás como se propuso).

## 1. Objetivo

Que el bot del CRM perfile, por WhatsApp, Messenger e Instagram, a cada persona que llega
por la campaña de reclutamiento de asesores inmobiliarios; le pida su CV; decida si es
APTO, REVISAR o NO APTO con criterios configurables; y deje al candidato dentro del CRM en
un apartado de reclutamiento con etapas, puntaje y CV, donde un humano cierre el proceso.

WhatsApp ya está encendido en el bot pero su conexión con Meta sigue inestable: no es la
prioridad de prueba. Instagram y Messenger se encienden con este trabajo.

## 2. Enfoque elegido

Extender el bot conversacional existente (`src/lib/bot/`), no construir un agente aparte.

- Ya existe el `BotAgentProfile` "Agente Reclutamiento" (migración manual
  `2026-07-14-bot-agentes.sql`) y su playbook "Reclutamiento — perfil de candidato" en
  `src/lib/bot/playbook/segment-playbooks.ts:174-233`, que captura 6 campos. Se reescribe.
- Los tres canales entran por `handleInboundMessage` (`src/lib/messaging/core.ts`) y
  salen por `sendChannelMessage` (`src/lib/messaging/dispatcher.ts`). Nada cambia ahí.
- El bot es LLM puro: el playbook le da el objetivo del turno (`BotTask`) y
  `playbook/extract.ts` + `capture.ts` + `apply.ts` escriben lo que el candidato dijo.
  Reutilizamos ese motor; agregamos la evaluación al terminar las tareas.

Descartados: agente con herramientas (`src/lib/agents/runner.ts`, no conectado a los
webhooks) y link a formulario externo (pierde el perfilado conversacional).

## 3. Criterios y puntaje

Todo vive en `SystemConfig` clave `reclutamiento.modelo` (JSON validado con zod; inválido →
default en código), igual que `scoring.modelo`. Editable desde Ajustes sin deploy.

### 3.1 Filtros eliminatorios (todos deben cumplirse)

| Clave | Pregunta del bot | Cumple si |
|---|---|---|
| `mayor_edad` | edad o confirmación | ≥ 18 |
| `acepta_comision` | esquema 100 % comisión, sin sueldo base | sí |
| `disponibilidad` | tiempo completo / medio tiempo / fines de semana / no sé | completo o medio tiempo |
| `colchon_meses` | meses de gastos cubiertos mientras cierra su primera venta | ≥ 3 |
| `plaza` | Playa del Carmen / Mérida / otra | `PDC` o `MERIDA`, o `otra` con disposición a mudarse |
| `movilidad` | vehículo propio y disposición a moverse por la zona | ambos sí |

### 3.2 Puntuables (0 a 100)

| Clave | Opciones → puntos | Máx. |
|---|---|---|
| `experiencia_inmobiliaria` | ninguna 0 · < 1 año 10 · 1–3 años 18 · > 3 años 25 | 25 |
| `cartera_clientes` | no 0 · < 10 contactos 8 · 10–50 contactos 14 · > 50 o inversionistas 20 | 20 |
| `actitud` | rúbrica de IA sobre 3 preguntas situacionales (ver 4.3) | 20 |
| `experiencia_ventas` | ninguna 0 · otro giro 8 · ventas consultivas o alto valor 15 | 15 |
| `ingles` | no 0 · básico 4 · conversacional 10 | 10 |
| `prospeccion_digital` | no 0 · redes activas o publica contenido 5 | 5 |
| `cv_recibido` | sí 5 | 5 |

Los 10 puntos que antes eran "auto propio" se repartieron a `experiencia_ventas` (nuevo),
porque el vehículo pasó a ser filtro eliminatorio por decisión de Luis.

### 3.3 Resultado

- **APTO**: pasa todos los filtros y puntaje ≥ 65.
- **REVISAR**: pasa todos los filtros y 40 ≤ puntaje < 65; **o** falla exactamente un filtro
  por respuesta ambigua ("no sé", sin dato) y puntaje ≥ 65.
- **NO APTO**: falla un filtro con respuesta clara, o puntaje < 40.

Umbrales (65 / 40), puntos por opción y qué filtros son eliminatorios son editables.

## 4. Flujo de conversación

El playbook tiene cuatro bloques de tareas en orden. Una o dos preguntas por turno; el
bot sigue tono, `maxLines` y brand linter del `BotConfig` como cualquier otro agente.

### 4.1 Bloque A — apertura y datos básicos
`firstName`, `plaza`, `phone` (si el canal no lo trae), `email`. Si llega por Instagram o
Messenger pide el teléfono para la entrevista; si llega por WhatsApp ya lo tiene.

### 4.2 Bloque B — filtros eliminatorios
Los seis de 3.1, en el orden de la tabla. Si una respuesta clara reprueba un filtro, el
bot **no corta la charla ahí**: termina el bloque B (máximo dos preguntas más) y pasa al
cierre de NO APTO. Así no se siente un interrogatorio que se corta de golpe.

### 4.3 Bloque C — puntuables y actitud
Las cinco preguntas puntuables de 3.2 y tres situacionales abiertas:
1. ¿Por qué quieres vender bienes raíces y no otra cosa?
2. Cuéntame la última vez que te dijeron que no y qué hiciste.
3. ¿Qué meta te pondrías a 12 meses en el equipo?

Las tres respuestas se guardan tal cual. Una llamada aparte a Claude (función
`evaluarActitud` en `src/lib/reclutamiento/actitud.ts`) aplica una rúbrica fija de cuatro
ejes (motivación concreta, tolerancia al rechazo, ambición medible, claridad al expresarse,
0 a 5 cada uno) y devuelve JSON `{puntos: 0-20, razones: string[]}`. Timeout 6 s; si falla,
`actitud = null` y el resultado baja a REVISAR si eso cambia la banda.

### 4.4 Bloque D — CV
El bot pide el CV "en PDF, foto o Word" y explica que puede mandarlo en cualquier momento.
Si ya lo mandó antes (ver 6), salta la tarea.

### 4.5 Cierre según resultado
- **APTO**: felicita, resume en una línea por qué encaja, pide **preferencia de horario**
  para entrevista (mañana / tarde, qué días) y la guarda. Anuncia que un gerente lo contacta.
- **REVISAR**: agradece, dice que el equipo revisa su perfil y lo contacta en 2 días hábiles.
- **NO APTO**: agradece, dice con tacto que hoy el perfil no coincide con lo que busca el
  equipo (sin listar los filtros que falló), deja la puerta abierta. No ofrece entrevista.

Preguntas fuera del guion (sueldo, comisiones, zona, horario, qué es Propyte): el bot
responde con la **ficha de vacante** (texto en `SystemConfig` `reclutamiento.ficha`, editable)
y retoma la tarea pendiente. Insulto, queja o petición de humano → `[ESCALAR]` como hoy.

### 4.6 Entrada al guion y reclasificación
- Campaña con "EMPLEO" en el nombre → `ContactType.EMPLEO` (ya existe en
  `workflows/builder-templates.ts`).
- Clasificador LLM (`classify.ts`): se le añade al prompt la pista de palabras clave
  *vacante, trabajo, empleo, reclutamiento, quiero ser asesor, unirme al equipo*.
- Si a mitad del guion el contacto dice que quiere **comprar o invertir**, el clasificador
  (ya reclasifica tras #783) lo pasa a COMPRADOR; el candidato queda en etapa DESCARTADO con
  motivo `reclasificado_a_ventas` y el agente de ventas toma la charla.

## 5. Datos

### 5.1 Tabla nueva `recruitment_candidates` (modelo Prisma `RecruitmentCandidate`)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | cuid | |
| `contactId` | String `@unique` | relación 1:1 con `Contact` |
| `etapa` | enum `RecruitmentStage` | ver 5.2 |
| `plaza` | `Plaza?` | `PDC` o `MERIDA` (enum existente, que ya incluye MERIDA) |
| `canal` | `Channel` | canal del primer mensaje |
| `respuestas` | Json | `{clave: {valor, textoOriginal, at}}` para todas las preguntas |
| `filtros` | Json | `{clave: "PASA" \| "FALLA" \| "AMBIGUO"}` |
| `puntaje` | Int? | 0–100, null hasta evaluar |
| `desglose` | Json? | puntos por clave + `actitud.razones` |
| `resultado` | enum `RecruitmentVerdict?` | APTO / REVISAR / NO_APTO |
| `motivo` | String? | p. ej. `filtro:colchon_meses`, `reclasificado_a_ventas`, texto libre del humano |
| `cvUrl`, `cvMime`, `cvFilename`, `cvMessageId` | String? | del `Message` que lo trajo |
| `horarioEntrevista` | String? | preferencia que dijo el candidato |
| `entrevistaAt` | DateTime? | la fija el humano |
| `responsableId` | String? | usuario |
| `resumenIA` | String? | 3 líneas que genera el bot al evaluar |
| `evaluadoAt`, `createdAt`, `updatedAt` | DateTime | |

Se crea la fila en cuanto un contacto entra al agente de reclutamiento (etapa NUEVO).
El playbook **sigue escribiendo en `Contact`** lo que ya es nativo (`firstName`, `phone`,
`email`, `residenceCity`); lo específico del candidato va a `respuestas`, no a `custom.*`.
`fields.ts` gana un `targetField` virtual `recruitment.<clave>` que `apply.ts` enruta a la
tabla nueva.

Migración SQL manual en `prisma/migrations-manual/2026-11-02-recruitment-candidates.sql`,
aplicada en prod **antes** de mergear (este repo no corre `prisma migrate deploy`).

### 5.2 Etapas (`RecruitmentStage`)

```
NUEVO → PERFILANDO → CV_PENDIENTE → APTO | REVISAR | NO_APTO → ENTREVISTA → CONTRATADO | DESCARTADO
```

- El bot mueve: NUEVO→PERFILANDO (primera respuesta), PERFILANDO→CV_PENDIENTE (bloque D),
  CV_PENDIENTE→APTO/REVISAR/NO_APTO (evaluación). Si el CV llega después, no cambia etapa:
  solo suma los 5 puntos y recalcula `resultado` si cruza banda hacia arriba.
- El humano mueve cualquier etapa a cualquiera desde la UI; queda `Activity` + `AuditLog`.
- Transiciones válidas del bot en `src/lib/reclutamiento/etapas.ts` (función pura, testeada).

### 5.3 Configuración (`SystemConfig`)

- `reclutamiento.modelo`: filtros, puntos, umbrales (3.x).
- `reclutamiento.ficha`: texto de la vacante para preguntas fuera de guion.
- `reclutamiento.responsables`: `{PDC: [userId], MERIDA: [userId], default: [userId]}`.
  Default en código: usuarios activos con rol GERENTE de esa plaza; si no hay (Mérida hoy
  no tiene equipo en el CRM), los ADMIN.

## 6. CV y adjuntos

Hoy `core.ts:268-282` espeja todo adjunto al bucket `chat-media` y lo deja en
`Message.mediaUrl/mediaType/mediaFilename/mediaMimeType`. El bot no ve adjuntos
(`bot-respond.ts:107-109` solo pasa `m.body`).

Cambios:
1. Tras guardar un mensaje INBOUND con media en una conversación cuyo contacto tiene fila en
   `recruitment_candidates` y `cvUrl` vacío, si el MIME es PDF, imagen o Word →
   `cvUrl/cvMime/cvFilename/cvMessageId` se llenan y se marca `respuestas.cv_recibido`.
   Función `ligarCv` en `src/lib/reclutamiento/cv.ts`, llamada desde `core.ts`.
2. El historial que ve el bot incluye `[adjunto: archivo.pdf]` en lugar de cuerpo vacío,
   para que no pida el CV que ya llegó.
3. Recordatorio: si etapa `CV_PENDIENTE` y sin `cvUrl` tras 24 h, un solo mensaje de
   recordatorio por el mismo canal, vía el motor de workflows existente (evento
   `recruitment.cv_pending`). En WhatsApp, fuera de la ventana de 24 h, se usa la plantilla
   aprobada; si no hay plantilla, no se manda.
4. **Fase 3**: leer el PDF (`pdf-parse`) o la imagen (visión de Claude) y proponer valores
   para `experiencia_inmobiliaria`, `experiencia_ventas` e `ingles` **solo si el candidato
   no los contestó**. Nunca sobrescribe una respuesta dicha.

## 7. Avisos y tareas

Al fijar `resultado`:

- **APTO**: `Task` "Entrevistar candidato {nombre} — {plaza}" asignada al primer responsable
  de la plaza, vence en 2 días hábiles, con enlace al candidato; notificación in-app a todos
  los responsables de la plaza por el mecanismo que ya usa el Pond; evento de workflow
  `recruitment.apto`.
- **REVISAR**: notificación a responsables; sin tarea; evento `recruitment.revisar`.
- **NO APTO**: sin aviso; evento `recruitment.no_apto` (por si marketing quiere medir).

Conversación: al cerrar, el bot deja `Conversation.status` como está (BOT) para que el
candidato pueda seguir escribiendo; la etapa en la tabla es la fuente de verdad.

## 8. Pantalla "Reclutamiento"

Ruta `src/app/(dashboard)/reclutamiento/`. Roles: ADMIN, DIRECTOR, GERENTE, MARKETING
(mismo patrón que `/meta-leads` en `sidebar.tsx`).

- **Tablero** por etapa (columnas de 5.2) con conteo, y vista de tabla alternativa.
  Filtros: plaza, canal, resultado, rango de puntaje, fecha, responsable, con/sin CV.
- **Detalle lateral** al hacer clic: datos del contacto, respuestas con texto original,
  puntaje con desglose y razones de actitud, CV (visor PDF o imagen, descarga), resumen IA,
  horario preferido. Acciones: cambiar etapa (con motivo si va a DESCARTADO), asignar
  responsable, fijar fecha de entrevista, abrir conversación en el inbox, re-evaluar.
- **Ajustes → Reclutamiento**: formulario sobre `reclutamiento.modelo` (puntos por opción,
  umbrales, filtros eliminatorios on/off), `reclutamiento.ficha` y
  `reclutamiento.responsables`. Guarda con validación zod; muestra qué resultado tendrían los
  candidatos actuales con el modelo nuevo antes de guardar (simulación, no reescribe).
- API: `GET/PATCH /api/reclutamiento/candidatos[/:id]`, `POST .../:id/reevaluar`,
  `GET/PUT /api/admin/reclutamiento/config`. Todas con comprobación de rol y de plaza para
  GERENTE (solo ve su plaza; ADMIN/DIRECTOR/MARKETING ven todo).

## 9. Canales

- `BotConfig.enabledChannels` pasa a `["WHATSAPP","INSTAGRAM","MESSENGER"]` por SQL en prod
  al desplegar F1 (hoy solo WhatsApp). Es un dato, no código.
- Orden de prueba: Instagram y Messenger primero; WhatsApp cuando su conexión con Meta quede
  estable (bloqueado por el App Review en curso).

## 10. Errores y casos borde

- El candidato manda varias respuestas en ráfaga: los webhooks ya agrupan y llaman al bot
  una vez por contacto; `extract.ts` captura varias claves de un solo mensaje.
- Responde en inglés: el bot contesta en el idioma del candidato; las opciones se mapean igual.
- Audio: no se transcribe; el bot pide que lo escriba.
- Candidato ya existente como COMPRADOR que ahora pide trabajo: el clasificador no cambia
  tipos distintos de COMPRADOR/LEAD más de 3 veces; si entra por campaña EMPLEO se crea la
  fila de candidato igual y el bot usa el agente de reclutamiento para esa conversación.
- Fallo de Claude en la evaluación: `resultado = null`, etapa queda en CV_PENDIENTE, se
  reintenta en el siguiente mensaje o desde "re-evaluar" en la UI.
- Modelo de configuración inválido: default en código, aviso en Ajustes.
- Candidato pide que borren sus datos: se escala a humano; el flujo de borrado es el del CRM.

## 11. Pruebas

Vitest, patrón de `bot-respond.agents.test.ts` (`vi.mock("@/lib/db")`).

- Puras: `evaluar()` (filtros, bandas, ambiguo→REVISAR, modelo default vs. editado),
  `transicionValida()` (5.2), mapeo de opciones a puntos, zod del modelo.
- Playbook: `segment-playbooks.test.ts` valida los `targetField` nuevos `recruitment.*`.
- Integración simulada: inbound con PDF liga el CV; evaluación APTO crea Task y notifica;
  reclasificación a COMPRADOR descarta al candidato; mensaje con adjunto aparece en el
  historial del bot.
- API: rol y plaza en los endpoints; GERENTE de PDC no ve candidatos de MERIDA.
- Prueba de humo documentada en `docs/qa/reclutamiento-smoke.md`: un candidato APTO, uno
  REVISAR y uno NO APTO por Instagram y por Messenger, con los textos esperados.

## 12. Entrega

| Fase | Contenido | PR |
|---|---|---|
| F1 | playbook nuevo, modelo de criterios, tabla + migración, evaluación, actitud, ligar CV, avisos y tareas, pista del clasificador, canales | 1 |
| F2 | pantalla `/reclutamiento`, detalle, Ajustes → Reclutamiento, APIs | 2 |
| F3 | lectura de CV con IA, recordatorio de CV a 24 h | 3 |

Cada PR con tests verdes y `tsc` limpio en los archivos tocados. Antes de mergear F1:
aplicar la migración en prod y sembrar el playbook nuevo (`scripts/seed-bot-playbooks-segmento.ts`
actualizado, idempotente, reemplaza el de reclutamiento viejo).

## 13. Fuera de alcance

Agendar en Google Calendar (OAuth pendiente), transcribir audios, firmar contrato, alta del
candidato como usuario del CRM al contratarlo, portal público de vacantes.
