# Click-to-call + auto-log de llamadas (Twilio Voice, WebRTC) v1

> Spec de diseño · 2026-06-18 · rama `feat/crm-click-to-call`
> Gap del speckit consolidado §5.11.5 (registro automático de llamadas) + §6.3 (voz). Materializa el "auto-log determinista" (Fase B); el resumen IA queda para Fase D.

## 1. Objetivo y alcance

Permitir al asesor **llamar al contacto desde el CRM** y que la llamada se **registre automáticamente** (duración, resultado, grabación, notas) sin captura manual. Saliente y entrante.

**Decisiones base (aprobadas por Luis, 2026-06-18):**
- **Modo de llamada:** navegador con **WebRTC** (`@twilio/voice-sdk`, ya instalado). El asesor habla por la computadora.
- **Grabación:** **sí**, con aviso de audio bilingüe al inicio; `recordingUrl` se guarda en la actividad.
- **Alcance:** salientes (click-to-call) **+** entrantes (el número Twilio rutea al asesor).
- **Enfoque:** completar y robustecer el scaffolding existente (`lib/twilio/{client,voice}.ts`, webhooks `twiml`/`status`, token generation), no empezar de cero.

### Fuera de v1 (YAGNI)
- Power-dialer / cadencias de llamada (§6.3 Fase D).
- Voz IA fuera de horario / IVR / cola de entrantes.
- Transcripción y resumen IA de la grabación (Fase D) — `recordingUrl` queda listo para alimentarlo.
- Reenvío a asesor de guardia en entrante (v1: si el asignado no contesta → buzón).

## 2. Estado actual (scaffolding existente — se reutiliza)

| Pieza | Estado | Acción |
|---|---|---|
| `src/lib/twilio/client.ts` (`getTwilioClient`, `validateTwilioSignature`) | ✅ funcional | reutilizar |
| `@twilio/voice-sdk` + `twilio` en package.json | ✅ instalados | reutilizar |
| `src/app/api/webhooks/twilio/voice/twiml/route.ts` (`<Dial><Number>`) | ⚠️ básico | extender (aviso + record + params + inbound) |
| `src/app/api/webhooks/twilio/voice/status/route.ts` + `lib/twilio/voice.ts` `handleCallStatus` | ⚠️ frágil | reescribir (busca por `callSid`, no por texto en `description`) |
| token generation para el SDK | ⚠️ revisar | exponer `GET /api/twilio/voice/token` |
| `Contact.recordingConsent`, `doNotContact`, `phone`, `preferredLanguage` | ✅ existen | reutilizar |
| `Activity` (`duration_minutes`, `outcome`, `CALL_INBOUND/OUTBOUND`) | ⚠️ faltan campos | + `callSid`, `recordingUrl` |
| `src/server/activities.ts` (`createActivity`/`updateActivity`), `/api/activities` | ✅ funcional | reutilizar para el log |
| `ActivityLog` / `activity-log-form.tsx` | ✅ funcional | extender (picklist outcome + link grabación) |

## 3. Datos (migración aditiva)

Migración manual `prisma/migrations-manual/2026-06-18-click-to-call.sql` (aditiva + idempotente).

| Cambio | Detalle |
|---|---|
| `Activity` += `callSid String?` | índice **único parcial** (`WHERE callSid IS NOT NULL`) — correlación con Twilio + dedup; reemplaza el hack de buscar el SID en `description`. |
| `Activity` += `recordingUrl String?` | URL de la grabación (la fija el recording callback). |
| `LeadSource` += `LLAMADA_ENTRANTE` | para leads creados por una llamada entrante de número desconocido. |

**Outcome:** se mantiene `Activity.outcome String?` (ya existe). El form de llamada lo escribe vía **picklist** con valores canónicos: `Contestó` · `No contestó` · `Buzón` · `Agendó` · `No interesó`. No se crea enum (evita migración de enum y casts; el picklist vive en la UI + una constante compartida).

## 4. Saliente (click-to-call)

1. Botón **"Llamar"** en el detalle de Contact/Deal (junto a `ActivityLog`). **Deshabilitado si `contact.doNotContact`** o sin teléfono.
2. El browser pide token: `GET /api/twilio/voice/token` → Access Token con **Voice grant**, `identity = userId`, `outgoingApplicationSid = TWILIO_TWIML_APP_SID`.
3. `device.connect({ To: contact.phone, contactId, userId })` (params custom viajan al TwiML).
4. Twilio invoca el **TwiML de salida** (Voice URL de la TwiML App) → responde:
   - `<Say language="es-MX|en-US">` aviso de grabación según `preferredLanguage`.
   - `<Dial callerId="{TWILIO_PHONE_NUMBER}" record="record-from-answer-dual" recordingStatusCallback="/api/webhooks/twilio/voice/recording"><Number>{To}</Number></Dial>`.
5. El **endpoint TwiML crea la `Activity(CALL_OUTBOUND)`** con `callSid` (param `CallSid` de Twilio) + `contactId` + `userId`, `status: PENDIENTE`. (El browser no reporta el SID.)
6. `statusCallback` y `recordingStatusCallback` completan la actividad (§6).

## 5. Entrante

1. El número Twilio recibe → **TwiML de entrada** (`/api/webhooks/twilio/voice/incoming`).
2. Match `From` → `Contact` por teléfono (búsqueda flexible exact OR `endsWith` últimos 10, como el inbox). Desconocido → `captureLead({ source: "LLAMADA_ENTRANTE", phone: From })`.
3. Aviso de grabación bilingüe (`<Say>`).
4. `<Dial timeout="20" record="record-from-answer-dual"><Client>{identity del asesor asignado}</Client></Dial>` — suena en el browser del asesor (`Device.on("incoming")`).
5. **Si el asesor está offline o no contesta** → `<Record>` buzón con aviso → `Activity(CALL_INBOUND, outcome: "Buzón")` + `recordingUrl` + `Notification` al asesor.
6. Si contesta → `Activity(CALL_INBOUND)` con duración/grabación vía callbacks.

## 6. Auto-log (webhooks robustecidos)

- **`handleCallStatus`** (reescrito): busca la `Activity` por **`callSid`**. En estados finales (`completed`/`no-answer`/`busy`/`failed`): fija `duration_minutes = ceil(CallDuration/60)`, `status: COMPLETADA`, `completedAt`. `outcome` automático para no-completed (`no-answer`→"No contestó", `busy`→"No contestó", `failed`→"No contestó"); para `completed` el asesor lo elige en el form (no se sobreescribe si ya hay outcome).
- **`recordingStatusCallback`** (nuevo `/api/webhooks/twilio/voice/recording`): valida firma, busca por `callSid`, guarda `recordingUrl` (`RecordingUrl` + `.mp3`).
- Todos los webhooks validan `X-Twilio-Signature` con `validateTwilioSignature` (ya existe).

## 7. UI

- **`call-button.tsx`** (cliente): inicializa el `Device` con el token; estados idle / timbrando / en-llamada (con timer) / colgada; pide permiso de micrófono. Al colgar una saliente contestada, abre un mini-form (picklist de resultado + notas) → `PATCH /api/activities/[id]`.
- **`ActivityLog`**: las actividades CALL muestran duración, resultado y un link **"Escuchar grabación"** (`recordingUrl`, si existe).
- El `Device` se registra al cargar el CRM (layout autenticado) para poder recibir entrantes; si el micrófono no se concede, el botón degrada a un mensaje claro.

## 8. Compliance

- Aviso de grabación al inicio (TwiML `<Say>` ES/EN) — mecanismo de aviso mínimo (México). Marca `contact.recordingConsent = true` al primer log con grabación.
- Respeta `doNotContact` (no permite iniciar saliente).

## 9. Testing

- **Unit:** mapeo `CallStatus`→outcome; `handleCallStatus` localiza por `callSid` y completa duración/estado; `recordingStatusCallback` guarda `recordingUrl`; token endpoint arma el grant correcto; match entrante por teléfono + `captureLead`; parseo de webhooks con `X-Twilio-Signature` mockeada.
- **Verificación manual:** WebRTC real (saliente + entrante + buzón) lo prueba Luis (requiere cuenta Twilio + micrófono).

## 10. Prerequisitos de Luis (Twilio)

1. Cuenta Twilio + número de voz con permisos de México.
2. **TwiML App**: Voice Request URL → `https://crm.propyte.com/api/webhooks/twilio/voice/twiml` (salida); el número entrante apunta a `…/voice/incoming`; status callback → `…/voice/status`.
3. **API Key/Secret** (para firmar Access Tokens del SDK).
4. Env vars (nombres reales del código): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_TWIML_APP_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `NEXT_PUBLIC_APP_URL`.

## 11. Riesgos / notas

- **Asesor debe tener el CRM abierto** para recibir entrantes por WebRTC; si no, buzón (aceptado en v1). Reenvío a guardia = follow-up.
- **Costo Twilio** pago-por-uso (voz por minuto + grabación + almacenamiento). No licencia fija.
- **Grabaciones en Twilio**: la `recordingUrl` apunta a Twilio (requiere auth) — para v1 se enlaza tal cual; mover a Supabase Storage = follow-up si se quiere control de retención.
- **Identidad del Device** = `userId`; el ruteo entrante usa el `assignedToId` del contacto.
