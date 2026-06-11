# Audit Playwright — propyte-crm núcleo (post-migración CRM→Hub)

> Fecha: 2026-06-10 · Base: main `670f52d` · Auditor: Claude (sesión autónoma autorizada por Luis)
> Usuario temporal: `audit-temp@propyte.local` (ADMIN) — **DESACTIVADO al cierre** (reactivar: `isActive=true` en Admin)
> Datos de prueba: contactos/deals de prueba **ELIMINADOS de la BD al cierre** (verificado: 0 filas)
>
> **✅ TODOS LOS BUGS DE ESTE AUDIT FUERON CORREGIDOS en la rama `feat/audit-fixes-minimal-ui`**
> (misma sesión, re-verificados con Playwright + build de producción verde). Detalle por bug abajo.

## Estado general

El núcleo CRM quedó **funcional** tras la demolición (~23K líneas): login (password), dashboard,
contactos (crear/listar), pipeline (crear deal, cambiar etapa con historial), deal detail,
comisiones, reportes, walk-ins, career y admin cargan sin crashes. tsc limpio, BD conecta.

## Bugs encontrados

| # | Severidad | Bug | Evidencia / Causa |
|---|-----------|-----|-------------------|
| 1 | Alta | Validación de teléfono rechaza el formato que su propio placeholder sugiere (`+52 984 123 4567` = 16 chars > max 15) | Zod `max(15)` cuenta espacios. Normalizar antes de validar |
| 2 | Media | `GET /api/users?role=advisor` → **500** | `contact-form.tsx:187` manda `advisor`, no existe en enum `UserRole` → PrismaClientValidationError. El dropdown de asesores del form de contacto **nunca carga**. API debe validar y devolver 400; el form debe pedir roles reales |
| 3 | Media | Crear deal no refresca el kanban (tarjeta invisible hasta reload); crear contacto no refresca el conteo del header ("0 contactos en total" con 1 en tabla) | Falta refetch/optimistic update tras POST |
| 4 | Media | Fecha de cierre off-by-one: capturé 2026-09-30, muestra "29 sep 2026" | Date parseada UTC, mostrada local |
| 5 | Baja | `favicon.ico` 404 en todas las páginas | No existe en `public/` |

## Hallazgos UX / arquitectura

- **`/career` es ruta huérfana** — funciona pero no está en el sidebar; nadie puede llegar.
- **`/developments` tiene botón "Nuevo Desarrollo"** — contradice P1 del speckit (el CRM NO posee
  inventario; catálogo viene del Hub read-only, Fase A). Tab solitaria "Desarrollos" arriba
  (residuo de la tab "Captura" eliminada).
- **Login se puede enviar antes de hidratar** (primera carga dev): el form hace submit nativo GET y
  pierde los valores. En prod con build optimizado es menos probable; mitigable con `action`+disabled.
- **Tema actual**: dark teal en todo (sidebar, botones, cards). Luis pidió rediseño
  **minimalista blanco/negro, color SOLO en etiquetas de etapa**. El restyle es el grueso del rebuild visual.
- Pipeline kanban: 13 etapas con scroll horizontal; activas 10 + Ganado/Perdido/Congelado solo en
  el modal de cambio. Cambio de etapa registra actividad correctamente.
- Notificaciones muestran badge "3" hardcodeado-aparente con BD vacía (verificar fuente).

## Veredicto rama `import-crm-base-fork` (pedido de Luis)

Es un fork de **NextCRM** (pdovhomilja/nextcrm-app, Next 16/React 19/Prisma 7/Better Auth) sin
historia común con main, con spec previo `specs/propyte-own-crm.md` (12-may). **Superseded** por el
SPECKIT consolidado (10-jun) que fija base = propyte-crm limpio y conserva el dominio ya construido
(13 etapas, comisiones multinivel, Twilio, walk-ins). El fork queda como **referencia** (patrones
shadcn/ui, ideas de stack Next 16) — NO como base. No mergear.

## Fixes aplicados (rama `feat/audit-fixes-minimal-ui`)

| Bug/Hallazgo | Fix | Archivos |
|---|---|---|
| #1 Teléfono max(15) | Normalización (sin espacios/guiones/paréntesis) antes de validar, regex `+?\d{10,15}`; se persiste normalizado (mejor dedup) | `lib/validations/contact.ts`, `components/contacts/contact-form.tsx` |
| #2 `role=advisor` 500 | API valida contra enum `UserRole` (400 si inválido) y acepta lista CSV; el form pide `ASESOR,ASESOR_SR,ASESOR_JR,TEAM_LEADER` | `api/users/route.ts`, `contact-form.tsx` |
| #3 Conteos stale + kanban sin refetch | Headers movidos a componentes cliente (conteo en vivo); `useState`→`useEffect` para sincronizar `localDealsByStage` (bug real: el initializer solo corre al montar) | `contacts/page.tsx`, `contacts-list.tsx`, `pipeline/page.tsx`, `pipeline-view.tsx`, `kanban-board.tsx` |
| #4 Fecha off-by-one | `formatCalendarDate` con `timeZone: "UTC"` para fechas-calendario (cierre esperado/real) | `pipeline/[id]/deal-detail-client.tsx` |
| #5 favicon 404 | `src/app/icon.svg` (P en cuadro negro) | nuevo |
| /career huérfano | "Mi Carrera" en sidebar (roles asesor/TL) | `layout/sidebar.tsx` |
| Roles sidebar desalineados | navItems con valores reales del enum (`TEAM_LEADER`, `ASESOR_SR/JR`, `MARKETING`); antes un TEAM_LEADER veía menú vacío | `layout/sidebar.tsx` |
| Badge notificaciones "3" hardcodeado | Conteo real desde `/api/notifications?unreadOnly=true` | `layout/topbar.tsx` |
| `npm test` exit 1 | vitest config apuntaba a `intake/`/`robots/` demolidos; ahora `src/**/*.test.ts*` + `passWithNoTests` | `vitest.config.ts` |

## Rediseño minimalista B/N (pedido de Luis)

- **Light por default** (antes dark teal). Tokens reescritos en `globals.css`: blanco/negro/grises;
  la "acción" (`--color-teal` histórico) ahora es negro en light / blanco en dark.
- **El color queda SOLO en etiquetas con significado**: etapas del pipeline (STAGE_COLORS intactos,
  dots + barras del chart por etapa), temperatura (hot/warm/cold), estados semánticos
  (éxito/error/alerta, WCAG: -700 en fondo claro, -400 en oscuro).
- KPI cards sin chips pastel decorativos (caen al neutro). Dark mode disponible vía toggle, neutro sin tintes.
- `text-white` hardcodeados → `var(--text-inverse)` en sidebar/topbar/login (para que dark no rompa).
- Pendiente de pulir en próximas sesiones: páginas internas con colores embebidos menores
  (`recent-activities` icon colors, portal, landing `src/app/page.tsx` — fuera de alcance, tiene tokens propios).

Screenshots "after": `after-01-dashboard.png`, `after-02-pipeline.png`.

## Screenshots

`audit-01-dashboard.png` … `audit-12-deal-detail.png` (antes) y `after-*.png` (después) en esta carpeta.
