# Diseño — Remitente + Plantillas en envío 1:1 (Track 1+2 de Gmail)

> **Fecha:** 2026-06-15 · Extiende GW-1 (Gmail bidireccional, ya en prod).
> **Aprobado por Luis.** Heatmap fuera de alcance. Envío masivo y Newsletter = proyectos separados futuros.

## Objetivo
En el drawer "Enviar email" (GW-1), permitir elegir el **remitente** entre los send-as verificados de la cuenta Gmail del asesor, e **insertar plantillas** (asunto+cuerpo con variables). La firma ya se anexa (GW-1).

## Decisiones
- **Remitente = send-as verificados (auto).** Se agrega el scope readonly `gmail.settings.basic` para leer la config "Send mail as" de la cuenta. El drawer ofrece solo remitentes que Google aceptará (evita el reescrito silencioso del From). Trade-off aceptado: re-consent una vez por asesor.
- **Sin confiar ciegamente:** la ruta `/send` valida que el `from` elegido esté en la lista verificada; si no, usa el primary.
- **Degradación suave (PG8):** sin scope / sin alias verificados → selector muestra solo el primary; sin plantillas → no aparece ese dropdown. Nada rompe.

## Cambios
1. **`workspace.service.ts`** — `GOOGLE_SCOPES += "gmail.settings.basic"` (readonly).
2. **`gmail.ts`**
   - `listSendAsAddresses(userId)` → `users.settings.sendAs.list`; devuelve `{ email, name, isPrimary, isDefault }[]` filtrando `verificationStatus='accepted'` + primary. Degrada a `[]` si falta scope/no conectado (nunca lanza).
   - `sendGmail({..., from? })`: si `from` se provee, se usa en el header From; la **validación** vive en la ruta.
   - `renderEmailTemplate(body, subject, contact)` — resuelve `{{contact.firstName|lastName}}`, quita líneas con `{{...}}` sin resolver (patrón J.2 de `actions.ts`).
3. **Rutas**
   - `GET /api/google/gmail/send-as` → lista verificada (auth; degrada a `[]`).
   - `POST /api/google/gmail/send` → acepta `from`; valida contra `listSendAsAddresses`; si inválido usa primary.
4. **`email-composer-drawer.tsx`**
   - Dropdown **"Desde"** (default = `emailFromAlias` del perfil si está en la lista, si no el primary/default).
   - Dropdown **"Plantilla"** (plantillas EMAIL de `/api/profile/templates`): al elegir rellena asunto+cuerpo con variables resueltas; mantiene firma.
   - Envía `from` en el POST.
   - Props nuevas: `contactFirstName`, `contactLastName` (desde contact-detail y deal-detail) para resolver variables.

## Prerrequisitos (config, una vez — Luis/Workspace)
- Alta de `info@`/otros como **"Send mail as" verificado** en la cuenta Gmail del asesor.
- Reconectar Gmail desde `/settings` tras el deploy (scope nuevo).

## Testing
- vitest: filtrado/validación de send-as (función pura) + `renderEmailTemplate` (variables, líneas sin resolver).
- `npm run build` verde.
- Envío real desde alias → lo prueba Luis (consent + config send-as no automatizable headless).

## Fuera de alcance
- Envío masivo (mismo correo a N leads) — proyecto aparte.
- Campañas de Newsletter + analítica (opens/clicks/bounces vía ESP) — proyecto aparte.
- Heatmap dentro del correo (técnicamente inviable).
