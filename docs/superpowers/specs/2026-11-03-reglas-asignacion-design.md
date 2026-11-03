# Reglas de asignación en Configuración → Equipos & Territorios

Fecha: 2026-11-03 · Rama: `feat/reglas-asignacion`

## Problema
La tarjeta "Equipos & Territorios" promete "Reglas de asignación", pero no hay forma de
crearlas desde el CRM. El motor (`src/lib/workflows/routing.ts`) ya evalúa dos tipos:

- **Reglas de ruteo** (`RoutingRule`): condiciones sobre el contacto → estrategia
  (round-robin, por carga, guardia, manual) + destino (roles, usuarios o plaza). Solo
  existe una, sembrada por script; se tocan únicamente por MCP.
- **Reglas de territorio** (`TerritoryRule`): condiciones que meten al lead en un
  territorio; el ruteo elige después dentro de sus miembros. Solo por `PUT` crudo.

Miembros de territorio tampoco se editan desde la UI.

## Alcance (acordado con Luis)
Las dos clases de regla en la misma pantalla, más miembros de territorio desde la UI.

## Diseño

### API
- `GET/POST /api/admin/routing-rules` y `PATCH/DELETE /api/admin/routing-rules/[id]`.
  Lectura ADMIN/DIRECTOR/GERENTE. Crear y borrar (soft, `deletedAt`) ADMIN/DIRECTOR.
  Editar y activar/desactivar también GERENTE. Mismo reparto de permisos que equipos.
- Validación en `src/lib/validations/routing-rule.ts`: nombre, prioridad 1–1000,
  `conditions` con el DSL existente (`conditionsDslSchema`), `strategy` del enum
  `LeadAssignmentMode`, `targets` = `{ roles?: UserRole[], userIds?: guid[], plaza?: Plaza }`.
  Una regla nueva nace **activa** (a diferencia del MCP), porque la crea una persona desde
  la UI y la ve en la lista.
- Territorios: se reutiliza `PUT /api/admin/territories` (miembros + reglas). Sin cambios.

### UI (`src/components/config/`)
- `teams-section.tsx` conserva Equipos y Territorios y agrega:
  - Bloque **Reglas de ruteo** (`routing-rules-block.tsx`): lista por prioridad con nombre,
    resumen legible de condiciones, estrategia y destino, interruptor activa/inactiva,
    botones editar y eliminar. Formulario inline para crear/editar: nombre, prioridad,
    estrategia, destino (roles multi-select, usuarios específicos, plaza) y el
    `ConditionTreeEditor` existente.
  - Cada territorio se expande (`territory-editor.tsx`) para editar **miembros**
    (usuario + VIEW/EDIT) y **reglas de entrada** (prioridad + condiciones + activa).
    Guardar manda el `PUT` con la lista completa.
- Sugerencias de campo para contacto en `src/lib/teams/rules-model.ts`:
  `contact.leadSource`, `contact.contactType`, `contact.targetPlaza`,
  `contact.preferredZone`, `contact.preferredLanguage`, `contact.budgetMin`,
  `contact.budgetMax`, `contact.propertyType`, `contact.temperature`, `contact.score`,
  `adAttribution.campaignName`, `adAttribution.adsetName`, `adAttribution.network`.
  También helpers puros: resumen de condiciones y de destino (testeables).

### Lo que NO cambia
El motor de ruteo. La pantalla solo escribe las tablas que el motor ya lee.

### Pruebas
- Unitarias de los helpers puros y de la validación de `targets`.
- Tests de ruta para `routing-rules` (sin sesión, rol sin permiso, crear, PATCH parcial,
  DELETE soft) con el mismo estilo que `brands/route.test.ts`.
- Verificación manual en el navegador contra el dev server.
