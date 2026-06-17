# Vista de contactos duplicados (detectar + fusionar) — §5.10.2

> Fecha: 2026-06-16. Utilidad de gestión de duplicados para el equipo (apoya el cutover Zoho: 27% sin fuente, ~2,264 dups). Sin migración: el modelo `Contact` ya tiene `mergedIntoId`/`mergedFrom` y existe `normalizePhoneE164`.
> Rama apilada. Admin-only (operación destructiva).

## Alcance v1

1. **Detección + vista** `/duplicados` (admin): agrupa contactos activos por **email (lower)** o **teléfono normalizado E.164**; muestra grupos (≥2) lado a lado con campos clave + `_count` de deals/activities.
2. **Fusión** de un grupo: el admin elige **sobreviviente**; el resto se fusiona: repunta relaciones → enriquece campos vacíos del sobreviviente → marca loser `mergedIntoId=survivor` + `deletedAt=now()`. Reversible (soft-delete + linaje).

## Detección — helper puro + server

- **Helper puro** `buildDuplicateGroups(contacts)` (testeable): union-find por clave `email.toLowerCase()` y por `normalizePhoneE164(phone)`; devuelve grupos de tamaño ≥2 (arrays de ids). Dos contactos quedan en el mismo grupo si comparten email O teléfono normalizado.
- **Server** `findDuplicateGroups()`: trae contactos `deletedAt: null, mergedIntoId: null` (id, firstName, lastName, email, phone, assignedTo, _count deals/activities, createdAt), corre el helper, y devuelve los grupos hidratados (ordenados por tamaño desc).

## Fusión — `mergeContacts({ survivorId, loserId })` (transacción)

Reglas (todo dentro de `prisma.$transaction`):
1. Validar survivor≠loser, ambos existen, `deletedAt: null`, `mergedIntoId: null`. Error claro si no.
2. **Repuntar relaciones N (no únicas)** loser→survivor con `updateMany({ where:{contactId: loserId}, data:{contactId: survivorId} })`: `Deal`, `Activity`, `WalkIn`, `Message`, `SlaTimer`, `ConnectorLeadLog`, `ConversionEvent`, `Shortlist`.
3. **Relaciones 1:1 UNIQUE** (`ContactDossier`, `AdAttribution`, `WebBehavior`, `Conversation`): repuntar **solo si el sobreviviente NO tiene** una; si ambos tienen, **dejar la del loser** colgada del loser soft-deleted (no se borra, evita perder datos y evita violar el unique). (`Conversation` tiene unique por canal; mismo criterio por registro.) Implementación: para cada 1:1, contar las del survivor; si 0 y el loser tiene → repuntar; si no → skip.
4. **Enriquecer** sobreviviente: para campos escalares opcionales del survivor que estén `null/''` y el loser tenga valor (`email`, `secondaryPhone`, `leadSourceDetail`, etc.), copiarlos. NO sobrescribir valores existentes del survivor.
5. **Marcar loser:** `mergedIntoId = survivorId`, `deletedAt = now()`, preservar `originalCreatedAt` (si survivor no lo tiene, copiar el del loser o el menor `createdAt`).
6. Devolver `{ survivorId }`. (Evento `contact.merged` para workflows = follow-up; no en v1 para no disparar nada en prod.)

> **No tocar GmailThread** (FK lógica sin relación Prisma; sus filas quedan en el loser soft-deleted — follow-up si se requiere).

## API

| Ruta | Método | RBAC |
|---|---|---|
| `/api/contacts/duplicates` | GET | FULL_ACCESS_ROLES (ADMIN/DIRECTOR/DEVELOPER_EXT/MANTENIMIENTO) |
| `/api/contacts/merge` | POST `{survivorId, loserId}` | FULL_ACCESS_ROLES |

- Auth `getServerSession`; 403 si rol no permitido. `mergeContacts` devuelve `{error}|{survivorId}` → POST mapea error→400.

## UI

- Página `/duplicados` (sidebar, grupo admin/Dirección; solo roles FULL_ACCESS la ven):
  - Lista de grupos; cada grupo = card con los contactos lado a lado (nombre, email, teléfono, asesor, #deals/#activities, fecha). Radio para elegir sobreviviente (default = el de más actividad/más antiguo). Botón "Fusionar en el seleccionado" → confirm (`window.confirm`) → `POST /api/contacts/merge` para cada loser del grupo → recargar.
  - Estado vacío "No se detectaron duplicados".
- Server page gatea por rol; si no FULL_ACCESS → redirect `/dashboard`.

## Pruebas

- `buildDuplicateGroups` (vitest): agrupa por email compartido; por teléfono normalizado compartido (incluye normalización `521`→`+52`); transitividad (A~B por email, B~C por phone → {A,B,C}); ignora singletons; ignora email/phone vacíos.
- `mergeContacts`: tocará BD → verificación por build + smoke con contactos de prueba (crear 2 dups, fusionar, confirmar repunte de un Deal/Activity y soft-delete+mergedIntoId del loser). No unit test (convención del repo).

## Riesgos / notas

- **Destructiva sobre BD compartida.** Mitigado: transacción, soft-delete + `mergedIntoId` (reversible: `UPDATE contacts SET deletedAt=null, mergedIntoId=null` y repuntar de vuelta si hiciera falta), admin-only, manejo no-destructivo de 1:1 (skip en vez de borrar). **Smoke solo con contactos de prueba.** Recomendado que Luis revise el merge antes de usarlo sobre datos reales del cutover.
- Detección excluye ya-fusionados (`mergedIntoId: null`) y borrados (`deletedAt: null`), consistente con el dedup de intake (`src/lib/intake/capture-lead.ts`).
- Sin migración (campos `mergedIntoId`/`mergedFrom` ya existen).
