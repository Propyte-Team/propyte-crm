# Provisioning de usuarios de prueba

> Basado en hechos reales de `references/recon-notes.md §5`. **El MCP `propyte-crm` es read-only en usuarios** (solo `GET /users`), no puede crear. Hay dos vías reales de alta, con roles permitidos distintos.

## Mapa persona → rol real del enum `UserRole`

| Persona del auditor | Rol a usar | Vía de alta |
|---|---|---|
| Asesor inmobiliario | `ASESOR_SR` | UI Admin (permitido) |
| Gerente / Team Leader | `GERENTE` | UI Admin (permitido) |
| Director | `DIRECTOR` | UI Admin (permitido) |
| Marketing | `MARKETING` | UI Admin (permitido) |
| Admin / Sistemas | `ADMIN` | Reuso de ADMIN temporal (ver bootstrap) |
| (negative test) Mantenimiento | `MANTENIMIENTO` | Solo script DB (UI lo bloquea) — para confirmar el bug de sidebar vacío |
| (negative test) Broker | `BROKER` | Solo script DB (UI lo bloquea) |

**Por qué el mapeo:** el Zod de `createUser` (`src/server/admin.ts:41-50`) solo acepta los 8 roles legacy (`DIRECTOR, GERENTE, TEAM_LEADER, ASESOR_SR, ASESOR_JR, HOSTESS, MARKETING, DEVELOPER_EXT`). **NO** puede crear `ADMIN`, `ASESOR` (plano), `BROKER` ni `MANTENIMIENTO` desde la UI — para esos se necesita un script directo contra la BD.

## Bootstrap del ADMIN (necesario primero — la UI Admin exige sesión ADMIN/DIRECTOR/GERENTE)

1. **Verificar en vivo** el estado de `audit-temp@propyte.local` (creado en la auditoría 2026-06-10, quedó `isActive=false` y sin password usable):
   - Como ADMIN real (o por script de lectura) revisar `isActive` y si tiene `passwordHash`.
2. **Reactivar + resetear password** por script directo (no hay UI de "reset password by admin" — gap conocido BUG-01). Patrón: `scripts/seed-admin-users.ts` (usa `prisma.user.update` con `bcrypt` para el hash y `isActive: true`). Password de sesión efímero, **no se commitea ni va al AUDIT.md**.
3. Confirmar login manual de `audit-temp@propyte.local` en el navegador antes de seguir.

**Nunca** usar como "ADMIN temporal":
- `mcp@propyte.local` — usuario de sistema, password inutilizable a propósito.
- `marketing@nativatulum.mx` — cuenta ADMIN real de producción de Luis.

## Alta de los usuarios de rol (ya logueado como ADMIN)

En `/admin` → crear usuario. Columnas obligatorias (`NOT NULL`): `email`, `name`, `role`, `plaza`, `passwordHash` (`id`/`updatedAt` los pone Prisma; `careerLevel` default `JR`). `Plaza` ∈ `{PDC, TULUM, MERIDA}`.

**⚠️ Regla anti-secuestro (ver `safety-contract.md` §6):** los **asesores** QA deben crearse en **plaza `MERIDA`** (sin inbound real; PDC/TULUM sí reciben leads y el round-robin se los asignaría). Ventana corta + teardown que reasigna leads reales extraviados. Los roles no-asesor (gerente/director/marketing) pueden ir en cualquier plaza (no entran al pool de intake de la misma forma).

- `qa-asesor@propyte.local` → `ASESOR_SR`, plaza **`MERIDA`**
- `qa-gerente@propyte.local` → `GERENTE`, plaza `TULUM`
- `qa-director@propyte.local` → `DIRECTOR`, plaza `TULUM`
- `qa-marketing@propyte.local` → `MARKETING`, plaza `TULUM`
- (opcional negative test, por script DB) `qa-mantenimiento@propyte.local` → `MANTENIMIENTO`

Password de sesión efímero por usuario; no persistir en el repo ni en el doc.

## Baja (teardown — ver también `safety-contract.md`)

- Borrar todos los `qa-*@propyte.local` creados en esta corrida.
- Devolver `audit-temp@propyte.local` a `isActive=false`.
- Verificar en BD que no quedó residuo (`SELECT email FROM propyte_crm.users WHERE email LIKE 'qa-%@propyte.local'` → 0 filas). Si quedó, listarlo en el AUDIT.md.
