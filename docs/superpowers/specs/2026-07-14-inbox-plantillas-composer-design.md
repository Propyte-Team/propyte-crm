# Inbox: plantillas y respuestas rápidas en el composer (Frente 3 de 4)

**Fecha:** 2026-07-14 · **Aprobado por:** Luis (roadmap 4 frentes + "continua") · Rama `feat/inbox-templates`.

## Estado previo

- `UserTemplate` (F5) YA existe: personales + globales, `shortcut` (`@@unique(userId,shortcut)`), `body`, `channel` (WHATSAPP/EMAIL/SMS), `usageCount`, linter de marca. API `GET/POST/DELETE /api/profile/templates`. Se gestionan en /settings.
- El composer del Inbox NO las usa (0 referencias en components/inbox).
- Variables: convención existente `{{contact.firstName}}`/`{{contact.lastName}}` en `workflows/actions.ts::renderTemplateBody`, con regla J.2: línea con variable sin resolver se elimina (nunca enviar `{{...}}` crudo).

## Diseño

1. **`src/lib/templates/fill.ts` (puro, TDD):** `fillTemplate(body, vars)` — sustituye `{{k}}`, elimina líneas con `{{...}}` sin resolver, trim. Extraído de `renderTemplateBody` (que pasa a usarlo — una sola semántica J.2 en todo el CRM).
2. **Composer del Inbox:**
   - Carga plantillas al montar (`GET /api/profile/templates`), filtra `isActive` + `channel === "WHATSAPP"` (las de chat sirven igual en IG/Messenger; EMAIL fuera por subject).
   - Escribir `/` al inicio de palabra abre dropdown (filtra por shortcut/nombre, acento-insensible; ↑↓ + Enter selecciona, Esc cierra). Botón ⚡ junto al clip abre el mismo menú (descubribilidad).
   - Al seleccionar: `fillTemplate(body, {contact.firstName/lastName del hilo})` reemplaza el token `/...` en el composer. El texto queda editable antes de enviar.
   - Funciona también en modo nota interna (es solo inserción de texto).
3. **`POST /api/profile/templates/use` {id}:** incrementa `usageCount` (fire-and-forget al insertar) — el orden del dropdown mejora solo (la API ya ordena por usageCount).

## Fuera de alcance (follow-ups)
- Valores INSTAGRAM/MESSENGER en `TemplateChannel` (migración + UI settings) — hoy las de chat se marcan WHATSAPP.
- Más variables (`{{deal.*}}`, plaza) — la función es extensible.

## Verificación
TDD `fill.ts` + test del route `/use` + regresión de `actions.ts`; gates vitest/tsc/build; smoke manual en Inbox.
