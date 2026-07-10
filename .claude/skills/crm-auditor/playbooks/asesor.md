# Playbook — Asesor inmobiliario (PRIORIDAD)

## Persona
Asesor de ventas (rol de prueba `ASESOR_SR`). Ve **solo sus propios** leads/deals (scoping por `assignedToId`, `src/server/deals.ts:56-96`). Objetivo: atender el lead con la mejor información según su **origen** y **tipo de contacto**.

## Precondición
- Login como `qa-asesor@propyte.local` (ver `provisioning.md`).
- Datos QA por `safety-contract.md` (tag `QA_AUDIT` + prefijo de nombre + correo/teléfono del equipo).
- **Los leads QA deben quedar asignados a `qa-asesor`** o no serán visibles para él (scoping "own"). Si el alta de lead no asigna automáticamente, asignarlo (o crear el lead ya logueado como asesor).

## Dimensión: tipo de contacto (repetir el journey por cada tipo relevante)
`ContactType` real (9): `LEAD, PROSPECTO, CLIENTE, INVERSIONISTA, BROKER_EXTERNO, REFERIDO, EMPLEO, COMPRADOR (default), REFERIDOR`. Priorizar para el asesor: **LEAD, PROSPECTO, INVERSIONISTA, COMPRADOR, BROKER_EXTERNO**.

## Dimensión: origen del lead
`LeadSource` real (21). Probar al menos: `FACEBOOK_ADS` (lo que Meta Lead Ads asigna por defecto — `src/lib/intake/connectors.ts:131`), `TIKTOK_ADS`, `WEBSITE`, `WHATSAPP`, `REFERIDO_CLIENTE`.
- **Prueba clave (bug candidato conocido, recon-notes §3):** crear un lead QA con origen `TIKTOK_ADS` o `META_ADS` y abrir su detalle. Los mapas de labels ES solo cubren 12/21 orígenes → verificar si la UI muestra el label correcto o cae en `undefined`/el valor crudo. Si se rompe/muestra crudo → ticket `bug`/`ux`.

## Journey (ejecutar por cada combinación tipo×origen priorizada)

1. **Ver lead nuevo** — ir a `/contacts`. Éxito: el lead QA aparece en la lista y es filtrable por tag `QA_AUDIT`. Hallazgo si no aparece o el filtro no existe.
2. **Identificar origen** — abrir `/contacts/[id]`. Éxito: el detalle muestra claramente el origen (`leadSource`) y su etiqueta legible, y da al asesor el contexto para atenderlo (campaña/canal). Hallazgo si el origen no es evidente o el label falla (ver prueba clave arriba).
3. **Dossier del contacto** — en el mismo detalle. Éxito: hay historial/atributos suficientes (tipo, teléfono, tags, actividad). Hallazgo (missing-feature) si falta contexto que un asesor necesita para atender según el tipo.
4. **Registrar actividad** — crear una nota/tarea (`/activities` o desde el detalle). Éxito: se guarda y aparece en el historial del contacto. Hallazgo si no persiste o no refresca.
5. **Enviar mensaje / WhatsApp** — `/inbox`. Éxito: se puede abrir/crear el hilo del contacto QA, componer y —según la política de la corrida— enviar al teléfono QA del equipo; probar el takeover humano si el hilo es de bot. Hallazgo si el compose/takeover falla o no hay hilo para el contacto.
6. **Mover deal en el kanban** — `/pipeline`: crear/mover el deal QA de etapa. Éxito: el cambio de etapa persiste tras recargar (`/pipeline`). Hallazgo si no refresca o no persiste (regresión del bug de kanban de 2026-06-10 — cruzar prior-art).
7. **Cotizar** — `/cotizaciones` (o desde el deal). Éxito: genera una cotización asociada al deal QA; revisar copy (BUG conocido de copy roto en Cotizaciones, task_manager.md). Hallazgo si no se puede cotizar o el copy está roto.
8. **Agendar reunión/tarea** — Éxito: queda agendada y visible en el historial/`/hoy`/`/activities`.
9. **Automatizaciones** — tras crear el lead QA, verificar (recon-notes §6) si se disparó alguna cadencia/regla: revisar en el historial del contacto/deal si apareció un `Activity` de `CREATE_TASK`/`SEND_WHATSAPP`, o pedir a un pase Sistemas/QA que confirme vía `/api/admin/automation`. Hallazgo (automation-gap) si el proceso de venta esperaba un follow-up automático y no ocurrió.

## Criterio de hallazgo
Cualquier paso que: no exista, falle, muestre info incorrecta según origen/tipo, o carezca de un paso esperado del proceso de venta. Clasificar (`bug`/`missing-feature`/`ux`/`permiso-gap`/`automation-gap`/`mejora`) y cruzar contra prior-art antes de escribir el ticket.
