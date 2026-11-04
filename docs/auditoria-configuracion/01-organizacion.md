# Auditoría UX — Configuración › Organización

Fecha: 2026-11-03 · Rama: `reglas-asignacion` · Alcance: las 4 tarjetas del grupo "Organización" de `src/components/config/config-center.tsx`.
Usuarios objetivo: gerencia (ADMIN/DIRECTOR/GERENTE), Karla (ventas) y asesores. Solo lectura de código; no se modificó nada.

Leyenda de tamaño: **QW** = quick win (≤ medio día) · **M** = medio (1-2 días) · **R** = rediseño (más).

---

## 0. Hallazgos transversales

| # | Hallazgo | Dónde | Propuesta | Tamaño |
|---|---|---|---|---|
| T1 | **Dos "mundos" de UI distintos** en la misma sección: `/admin?tab=…` usa shadcn (Card/Dialog/Toast) y `TeamsSection` usa clases `crm-card`/`form-input`, inputs inline sin labels y un `msg` de texto plano en vez de toast. | admin-content.tsx vs teams-section.tsx | Unificar: diálogos + toast en Equipos & Territorios, o al menos labels visibles y toast. | M |
| T2 | **Feedback perdido**: crear/editar usuario y crear/editar regla de comisión hacen `window.location.reload()` y luego `toast(...)`; el toast nunca se ve. | admin-content.tsx L271-272, 306-307, 431-432, 447-448 | Actualizar estado local (como ya hace `handleToggleActive`) o `router.refresh()`; mostrar toast antes. | QW |
| T3 | **Errores Zod llegan como objeto** (`parsed.error.flatten()`): el cliente hace `typeof data.error === "string" ? … : "Error"`, así que el usuario ve "Error" o "No se pudo guardar la regla" sin saber qué campo falló. | teams/route.ts, territories/route.ts, routing-rules/route.ts, teams-section.tsx L63, L80, routing-rules-block.tsx L85 | Devolver `{ error: "mensaje", fields: {...} }` con el primer mensaje en español; pintar el error junto al campo. | QW |
| T4 | **Jerga de motor en textos de usuario**: "round-robin global (válido)", "sin forecast manager — recomendado para no romper rollups de forecast", "estrategia", "ruteo", "falta aplicar la migración de marcas". | teams-section.tsx L182, teams/route.ts L49, territories/route.ts L53, user-brands-field.tsx L34 | Reescribir en lenguaje de negocio ("reparto de leads", "turno general"). Quitar el warning de forecast manager hasta que exista en la UI. | QW |
| T5 | **Enums crudos en pantalla**: `TULUM`/`PDC`/`MERIDA` en badges de equipos y territorios; `JUNIOR` como rol en equipo; `ASESOR_SR`, `ASESOR_JR`, `TEAM_LEADER`, `GERENTE`, `ASESOR` como checkboxes de destino; `ADMIN` en la tabla de usuarios (no está en `ROLE_LABELS`). | teams-section.tsx L134, 141, 190; routing-rules-block.tsx L162; admin-content.tsx L609 | Usar `PLAZA_LABELS`/`ROLE_LABELS` en todos lados; añadir `ADMIN: "Administrador"` a `ROLE_LABELS` (o un `ROLE_LABELS_ALL`). | QW |
| T6 | **Recargas de página completas** (`window.location.reload`) en 4 handlers: pierde filtros, scroll y el diálogo. | admin-content.tsx | Igual que T2. | QW |
| T7 | Permisos reales (ADMIN/DIRECTOR/GERENTE y las Reglas A-E de admin.ts) solo se descubren al fallar; el botón existe, se pulsa, llega un toast rojo. | admin-content.tsx, admin.ts L132-209 | Deshabilitar botón con tooltip "Solo un Administrador puede…" usando el mismo criterio que el servidor. | QW |

---

## 1. Usuarios & Roles — `/admin?tab=users`

Sirve a: ADMIN, DIRECTOR, GERENTE (`requireAdminRole`). Karla y asesores no entran.

### 1.1 Tabla y acciones (admin-content.tsx)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Filtro rol / plaza | Filtra la tabla en cliente. | No hay búsqueda por nombre/email, que es lo que realmente se usa con 20+ usuarios. No hay filtro por estado (activo/inactivo) ni por team leader. El filtro de rol no incluye ADMIN. | Caja de búsqueda por nombre/correo; chips Activo/Inactivo; incluir Administrador. | QW |
| Columna "Team Leader" | Muestra `user.teamLeader.name`. | Concepto paralelo a "Equipos" de la sección Equipos & Territorios: dos jerarquías que no se sincronizan (un asesor puede tener team leader X y estar en el equipo de Y). | Decidir una sola fuente (ver §4) y mostrar "Equipo" en la tabla. | R |
| Lápiz (editar) | Abre `UserFormDialog`. | Ícono sin texto ni `title`. | `title="Editar"`. | QW |
| Llave (reset contraseña) | Solo ADMIN/DIRECTOR. | OK, pero el admin inventa una contraseña y la manda por WhatsApp (comentario en admin.ts L239-241). | Botón "Enviar enlace de restablecimiento" por correo; mostrar contraseña temporal generada con botón copiar. | M |
| Desactivar / Activar | Toggle `isActive`. | Sin confirmación al desactivar (cierra sesión y acceso de la persona). Reactivar solo ADMIN: el botón desaparece para otros sin explicar. | Confirm ligero al desactivar ("¿Quitar acceso a X? Sus leads siguen asignados"). Tooltip cuando no se puede reactivar. | QW |
| Papelera (eliminar definitivo) | Soft-delete con `window.confirm`. | Está a 1 clic junto a "Editar", mismo tamaño; `window.confirm` nativo. El texto habla de "su sesión… en cuanto vuelva a pedir datos al CRM". ¿Qué pasa con sus contactos/deals? No se dice. | Mover a menú "⋯" › "Eliminar definitivamente" con AlertDialog que diga qué pasa con sus leads (reasignar a…). | M |
| "Mostrar eliminados" | Lista de soft-deleted. | No permite restaurar; filas sin acciones. | Acción "Restaurar" (solo ADMIN) o quitar el checkbox y meterlo en el historial. | M |
| "Ver historial" | Diálogo con activado/desactivado/eliminado. | Solo 3 tipos de evento; no registra cambios de rol, plaza, team leader ni creación. Vive en un diálogo global en vez de por usuario. | Historial por usuario (desde el lápiz) incluyendo cambios de rol/plaza. | M |

### 1.2 Formulario crear/editar (user-form-dialog.tsx, user-brands-field.tsx)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Nombre, correo | Texto. | Correo no se normaliza en cliente (servidor sí hace lowercase). | — | — |
| Contraseña (solo alta) | Mín. 6; reset exige 8. | Inconsistente. El admin elige la contraseña del nuevo usuario y debe pasársela a mano. | Generar contraseña temporal + "copiar" + opción "enviar invitación por correo". Unificar mínimo en 8. | M |
| Rol | Select con `ROLE_LABELS`. | No hay descripción de qué puede hacer cada rol (¿qué ve un "Hostess"? ¿"Desarrollador Externo"?). ADMIN no asignable desde UI (ok por seguridad) pero no se explica. | Texto de ayuda por rol bajo el select (1 línea). | QW |
| Plaza | Select. | Obligatoria incluso para MARKETING/DEVELOPER_EXT. | Default a la plaza del admin; ayuda "se usa para repartir leads". | QW |
| Nivel de carrera | JR / SR / TOP_PRODUCER / TEAM_LEADER / GERENTE. | **Redundante y contradictorio con Rol**: existe rol `ASESOR_SR` y nivel `SR`; rol `TEAM_LEADER` y nivel `TEAM_LEADER`. Nada impide "Rol: Gerente, Nivel: Junior". Nadie sabe cuál manda. | Ocultar bajo "Avanzado" y derivarlo del rol por defecto; o eliminar del formulario y gestionarlo desde el plan de carrera. | M |
| Team Leader | Select de usuarios ADMIN/TL/GERENTE/DIRECTOR. | Ver §1.1: duplica "Equipos". Item "Sin asignar" con value `"none"` (hack Radix). | Unificar con Equipos (§4). | R |
| Marcas que ve | Checkboxes por marca (solo editar, solo ADMIN). | Al crear dice "Edítalo después para prenderle otras marcas": 2 pasos para algo que debería ser 1. Texto "falta aplicar la migración de marcas por usuario" es de desarrollador. Regla "vacío no se puede guardar" aparece solo al enviar. | Permitir elegir marcas en el alta (POST a `/brands` tras crear). Reemplazar texto de migración por "No disponible por ahora". | QW/M |
| Teléfono | Texto libre. | Sin formato ni validación. | Máscara +52. | QW |
| Número / vencimiento SEDETUS | Texto + fecha. | Aparece para todos los roles (Marketing, Hostess). Sin aviso de vencimiento en ninguna parte visible. | Mostrar solo para roles de asesor; sección colapsable "Licencia". | QW |
| Validación | Zod cliente + servidor. | Mensajes del servidor (`updateUserSchema`) sin texto en español: `z.string().min(2)` → "String must contain…". | Añadir mensajes en español a `updateUserSchema`. | QW |

---

## 2. Comisiones — `/admin?tab=commissions`

Sirve a: ADMIN/DIRECTOR/GERENTE. Impacta a asesores (cálculo de comisión en deals).

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Lista agrupada por tipo de deal | Tabla por `dealType`. | Es una matriz 3D (5 tipos × 3 fuentes × 8 roles = 120 combinaciones posibles) presentada como listas planas. No se ve de un vistazo "¿cuánto gana un Asesor Senior por un lead Propyte en Nativa Contado?" ni qué combinación falta. | Vista de matriz: filas = rol, columnas = fuente, una pestaña por tipo de deal; celdas editables inline con "—" donde no hay regla. | R |
| Nueva regla (diálogo) | 3 selects + % + activa. | **Sin control de duplicados** (`createCommissionRule` no verifica dealType+fuente+rol): se pueden crear 2 reglas iguales con % distinto y el usuario no sabe cuál aplica. Selects vacíos por defecto; nada precargado. | Unicidad en servidor (`@@unique` o `findFirst` previo) con mensaje "Ya existe una regla para esa combinación, edítala". Precargar el tipo de deal del grupo desde donde se pulsó "+". | QW |
| Rol que recibe la comisión | Incluye Hostess, Marketing, Desarrollador Externo. | Roles que no cobran comisión ensucian la lista. | Limitar a roles comisionables (constante). | QW |
| Porcentaje | Número 0-100, step 0.01. | Sin indicación de "¿% de qué?" (precio, comisión total, honorarios). | Texto de ayuda: "% sobre el honorario total del deal" (confirmar con negocio). | QW |
| Regla activa | Checkbox. | Al crear siempre marcado (ok). En la tabla "Sí/No" verde: bien. | — | — |
| Eliminar | `handleDeleteRule` directo. | **Sin confirmación**; irreversible (hard delete). | AlertDialog o preferir "Desactivar". | QW |
| Editar | Reabre diálogo. | Permite cambiar dealType/fuente/rol de una regla existente, lo que de facto "mueve" la regla; junto con la falta de unicidad genera duplicados. | En edición bloquear las 3 llaves, solo editar % y activa. | QW |
| Vigencia | — | No existe "desde / hasta": cambiar el % reescribe la historia de deals pasados (según cómo se calcule). | Fuera de alcance UX; anotar como riesgo. | R |

---

## 3. Acuerdo de actividad — `/admin?tab=settings`

Sirve a: gerencia define mínimos; afecta a asesores.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Los 6 campos (llamadas, WhatsApps, visitas, seguimientos, respuesta máx., días sin actividad) | Guardan `SystemConfig.activity_agreement`. | **Nada lo consume**: `activity_agreement` / `minDailyCalls` / `maxFirstResponseMinutes` solo aparecen en admin-content.tsx, constants.ts y un test. La pantalla es un placebo: el gerente cambia "20 llamadas" y no pasa nada en dashboards, alertas ni SLA. | Decidir: (a) conectarlo al dashboard del asesor y a las políticas SLA de Automatización, o (b) ocultar la tarjeta hasta que tenga efecto. Mientras, aviso en pantalla: "Estos valores son informativos; aún no generan alertas". | QW (aviso) / R (conectar) |
| Inputs numéricos | `parseInt || 0`. | Sin mínimo/máximo, acepta 0 y negativos en el input (`type=number` sin `min`). Sin unidad en el label (minutos vs días está en el texto, ok). Sin "Restablecer valores recomendados" aunque `ACTIVITY_AGREEMENT_DEFAULTS` existe. | `min=0`, botón "Restablecer recomendados", mostrar el valor recomendado como ayuda. | QW |
| "Tiempo máximo de respuesta" | 5 min default. | Se solapa con las **Políticas SLA** de Automatización (otra pantalla define lo mismo). Doble fuente de verdad. | Mover a SLA o enlazar: "El tiempo de respuesta se controla en Flujos y SLA →". | M |
| Guardar | Server action. | Sin "cambios sin guardar"; sin último editor/fecha. | Guardar automático al salir del campo o indicador de dirty. | QW |

---

## 4. Equipos & Territorios — `TeamsSection` (construido hoy)

Sirve a: ADMIN/DIRECTOR crean; GERENTE asigna miembros y edita reglas. Lo que decide **a quién le cae cada lead**: la pantalla más delicada del grupo.

### 4.1 Modelo mental (el problema de fondo)

La pantalla expone **tres capas de reglas con condiciones** que el usuario debe entender a la vez: (1) reglas de entrada de territorio, (2) reglas de ruteo con prioridad, (3) el "turno general". Además hay un cuarto concepto, Equipos, que **no influye en el reparto** (`routing.ts` y `territory.ts` nunca leen `Team`/`TeamMember`). Y un quinto, "Team Leader" en el usuario (§1). Un gerente no puede responder "¿por qué le cayó este lead a Pedro?" mirando esta pantalla.

Propuesta de fondo (**R**): una sola pantalla "Reparto de leads" con un asistente de 3 pasos por regla — *Cuándo* (condiciones con selectores) → *A quién* (equipo/territorio/personas) → *Cómo* (turno / menos carga) — y un simulador "¿A quién le caería un lead de Meta, Tulum, zona Aldea Zama?" que reutilice `autoRouteLead` en modo dry-run (ya registra `pasos` con el motivo de cada regla).

### 4.2 Equipos (teams-section.tsx)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Crear equipo (nombre, plaza, líder) | POST `/api/admin/teams`. | Inputs inline sin labels, plaza en enum crudo ("PDC"). Select de líder lista **todos** los usuarios activos (hostess, marketing). Sin confirmación visual más que un `msg` arriba. | Labels; `PLAZA_LABELS`; filtrar líder a TL/GERENTE/DIRECTOR; toast. | QW |
| Badge "sin forecast manager" | Warning. | Campo que **no se puede configurar en la UI** (ni en crear ni editar): badge amarillo permanente e incomprensible. | Quitar badge y warning hasta que exista el campo; o añadir select "Responsable de pronóstico" bajo Avanzado. | QW |
| Miembros (chips) | `nombre · JUNIOR`. | `roleInTeam` siempre `JUNIOR` (la UI no lo manda) y se muestra en inglés en mayúsculas. | Ocultar `roleInTeam` (no se usa) o mostrar el rol real del usuario con `ROLE_LABELS`. | QW |
| + agregar miembro / OK | POST miembro. | Dos pasos (select + botón OK que aparece). Un usuario puede estar en varios equipos sin aviso. Lista incluye roles no vendedores. | Autoagregar al seleccionar; avisar "Ya está en el equipo X, ¿moverlo?". | QW |
| Quitar miembro (ícono) | DELETE sin confirmación. | Sin confirm; sin feedback. | Confirm ligero + toast. | QW |
| Editar / desactivar / renombrar equipo | **No existe en UI** (el PATCH sí existe). Tampoco `parentTeamId`. | Un equipo mal creado queda para siempre. | Menú "⋯" con Renombrar, Cambiar líder, Desactivar. | M |
| Propósito | — | No se explica para qué sirve un equipo si no reparte leads. | Si no tiene efecto todavía, texto: "Los equipos agrupan asesores para reportes; el reparto se define abajo". O eliminarlos de esta pantalla. | QW |

### 4.3 Territorios (teams-section.tsx + territory-editor.tsx)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Crear territorio (nombre, plaza, zonas) | POST. | **Plaza y Zonas son decorativas**: `resolveTerritoryForContact` solo evalúa `rules`; el gerente escribe "Aldea Zama, Centro" creyendo que así entran los leads de esas zonas y no pasa nada hasta que además crea una regla `contact.preferredZone in …`. Zonas en texto libre separado por comas. | Al crear, generar automáticamente la regla de entrada equivalente (`targetPlaza = X` y `preferredZone in zonas`), o quitar los campos y dejar solo reglas. Zonas como chips (input tipo tags). | M |
| Tipo GEO/SEGMENT, territorio padre | Existen en API, no en UI. Se muestra "⊂ Padre" si viene por API. | Cosas que solo se hacen por API/MCP. | Añadir "Pertenece a" (select) bajo Avanzado o eliminar la jerarquía. | M |
| Texto vacío | "Sin ellos, el ruteo usa round-robin global (válido)". | Jerga. | "Sin territorios, los leads se reparten por turno entre todos los asesores de la plaza". | QW |
| Botón "Miembros y reglas" | Abre `TerritoryEditor` inline. | Ícono lápiz; no hay renombrar/eliminar/desactivar territorio (no existe DELETE). | Menú "⋯" + endpoint de baja blanda. | M |
| Miembros + nivel "ver / editar" | `accessLevel` VIEW/EDIT. | **`accessLevel` no lo lee nadie** (0 usos en `src/lib`). Es un select por chip que no hace nada. | Eliminar el select; dejar solo la lista de miembros. | QW |
| Texto "Sin miembros, el territorio no restringe a nadie" | — | Cierto pero peor: en `routing.ts` L305-308 si ningún candidato es miembro, el territorio **se ignora en silencio**. El usuario cree que acotó y no acotó. | Validar al guardar: "Este territorio no tiene asesores de la plaza X; no restringirá el reparto". | QW |
| Reglas de entrada: prioridad numérica | Input 1-1000, sugiere 100, 110… | Número mágico. "Entre territorios gana el más específico (hijo antes que padre) y luego la menor prioridad": frase imposible para un gerente. | Orden por arrastre (drag) o flechas; prioridad derivada del orden. Ocultar el número. | M |
| Reglas de entrada: condiciones (`ConditionTreeEditor`) | Campo libre con datalist (`contact.leadSource`, `adAttribution.campaignName`…), operador (`= igual`, `en lista`, `cambió a`…), valor libre. | **Claves crudas**: el usuario debe escribir `contact.targetPlaza` y el valor interno `TULUM` (no "Tulum"); `contact.leadSource` exige el enum exacto (`META_ADS`?). Operadores que no aplican a ruteo (`cambió a`, `existe`). Subgrupos all/any. Sin validación de campo inexistente: una regla con `contac.plaza` se guarda y nunca cumple. | Reemplazar por constructor con selectores: campo = lista en español (`FIELD_LABELS` ya existe), operador según tipo, valor = select con las opciones reales del enum (fuente, plaza, tipo de propiedad, idioma) y número para presupuesto/score. Dejar el editor libre bajo "Modo avanzado". | M |
| Guardar territorio | PUT reemplaza **todos** los miembros y reglas (`deleteMany` + `createMany`). | Si dos gerentes editan a la vez, el último pisa al primero; las reglas pierden `id` (auditoría dice solo "rules: 3"). Sin confirmación. | PATCH por regla o versión optimista (`updatedAt`). | M |

### 4.4 Reglas de ruteo (routing-rules-block.tsx)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Resumen de regla en lista | "Cuando fuente = META_ADS → ASESOR_SR de TULUM · Turno (round-robin)". | Muy bien como idea; pero valores y roles salen crudos (`describeTargets` une `t.roles` sin etiqueta, `t.plaza` sin `PLAZA_LABELS`). | Pasar `ROLE_LABELS`/`PLAZA_LABELS` y mapear valores de enum a etiquetas. | QW |
| Nombre | Texto, mín. 3, único. | Duplicado solo se detecta al guardar (409). Ok. | — | — |
| Prioridad | Número 1-1000. | Igual que §4.3: número mágico; además hay dos sistemas de prioridad (territorio y ruteo) con la misma palabra. | Reordenar por arrastre; mostrar "#1, #2…" según posición. | M |
| Estrategia | Turno / Menor carga / Guardia / Manual. | **Guardia y Manual hacen exactamente lo mismo** (`candidates[0]`, routing.ts L329-332): "Guardia (primero disponible)" promete disponibilidad que no se comprueba. "Round-robin" entre paréntesis es jerga. | Dejar 2 opciones: "Por turno" y "Al que tenga menos leads". Ocultar Guardia/Manual hasta implementarlas. | QW |
| Asignar a › Por rol y plaza | Checkboxes `ASESOR`, `ASESOR_SR`, `ASESOR_JR`, `TEAM_LEADER`, `GERENTE` + select plaza. | Enums crudos; `ASESOR` no existe en `ROLE_LABELS` (¿rol legado?). "Sin roles marcados = asesores (todos los niveles)" en letra de 11px. Select "Plaza del lead" vs plaza fija: no se explica que **sin plaza resoluble la regla no asigna** (#729). | Etiquetas en español; quitar `ASESOR` si es legado; ayuda: "Si el lead no trae plaza, esta regla no asigna; elige una plaza fija para evitarlo". | QW |
| Asignar a › Usuarios específicos | Chips de asesores. | Solo roles ruteables (bien). Sin búsqueda; con 30 asesores es una sopa. | Buscador + agrupar por plaza. | QW |
| Aplica cuando (`ConditionTreeEditor`) | Igual que §4.3. | Mismo problema de claves crudas; aquí es aún más grave porque son las reglas principales. | Mismo constructor con selectores. | M (compartido) |
| Activar/desactivar (ícono Power) | PATCH. | Sin confirmación ni toast; solo `msg` si falla. | Toast "Regla pausada". | QW |
| Eliminar | `window.confirm` nativo + borrado blando. | Confirm nativo feo pero existe. | AlertDialog del sistema. | QW |
| Relación con territorios | Encabezado: "Se evalúan por prioridad… Si ninguna asigna, el lead entra al turno general". Arriba: "El ruteo asigna PRIMERO por territorio". | Dos frases que el usuario debe combinar mentalmente. No hay diagrama ni ejemplo. | Bloque "Cómo se reparte un lead" con 3 pasos ilustrados + botón "Probar con un lead" (simulador). | M (texto) / R (simulador) |
| Permisos | GERENTE edita pero no crea ni elimina; botones simplemente no aparecen. | Sin explicación. | Tooltip "Solo Dirección crea reglas". | QW |

---

## 5. Propuestas priorizadas

### Quick wins (≤ medio día c/u)
1. **Quitar los `window.location.reload()`** y mostrar el toast de éxito (T2/T6) — admin-content.tsx.
2. **Etiquetas en español para todos los enums** en Equipos & Territorios y reglas (plaza, roles, `roleInTeam`, `ADMIN`) (T5) — teams-section, routing-rules-block, rules-model, constants.
3. **Aviso "sin efecto todavía"** en Acuerdo de actividad + `min=0` + "Restablecer recomendados" (§3).
4. **Unicidad de regla de comisión** + confirmación al eliminar + bloquear llaves al editar (§2).
5. **Eliminar lo decorativo**: select ver/editar de miembros de territorio, badge/warning "forecast manager", estrategias Guardia/Manual, operadores `cambió a`/`existe` en ruteo (§4).
6. **Errores de API legibles** (primer mensaje en español en vez de `flatten()`) (T3).
7. **Confirmaciones ligeras** al desactivar usuario, quitar miembro, pausar regla (§1, §4).
8. Reescribir textos con jerga (T4) y añadir tooltips de permiso (T7).

### Medio (1-2 días c/u)
9. **Constructor de condiciones con selectores** (campo en español → operador según tipo → valor desde enum) con "modo avanzado" para el editor libre. Compartido por territorios y reglas de ruteo. Es la mejora de mayor impacto/costo de todo el grupo.
10. Al crear territorio, **generar la regla de entrada** a partir de plaza/zonas (o quitar esos campos).
11. Menú "⋯" para editar/desactivar equipos y territorios (hoy solo por API).
12. Orden por arrastre en vez de prioridad numérica (territorio y ruteo).
13. Contraseña temporal generada + invitación por correo; marcas en el alta.
14. Ocultar "Nivel de carrera" y SEDETUS bajo "Avanzado"/por rol.

### Rediseño
15. **"Reparto de leads"**: una sola pantalla con asistente Cuándo → A quién → Cómo y simulador dry-run sobre `autoRouteLead`.
16. Unificar Team Leader (usuario) con Equipos; decidir si Equipos reparte leads o solo agrupa para reportes.
17. Matriz de comisiones (rol × fuente por tipo de deal) con edición inline.
18. Conectar Acuerdo de actividad con dashboard/SLA o retirarlo.

---

## 6. Archivos involucrados

- `src/components/config/config-center.tsx` — tarjetas del grupo.
- `src/components/admin/admin-content.tsx` — tabs users / commissions / settings, handlers y reloads.
- `src/components/admin/user-form-dialog.tsx`, `user-brands-field.tsx`, `user-brands-helpers.ts`, `reset-password-dialog.tsx`, `user-history-dialog.tsx`.
- `src/components/admin/commission-rule-dialog.tsx`.
- `src/server/admin.ts` — schemas Zod (mensajes), Reglas A-E, `createCommissionRule` (sin unicidad), `updateSystemConfig`.
- `src/lib/constants.ts` — `ROLE_LABELS` (falta ADMIN), `PLAZA_LABELS`, `ACTIVITY_AGREEMENT_DEFAULTS`, `CAREER_REQUIREMENTS`.
- `src/components/config/teams-section.tsx`, `territory-editor.tsx`, `routing-rules-block.tsx`, `condition-tree.tsx`.
- `src/lib/teams/rules-model.ts` — `FIELD_LABELS`, `STRATEGY_LABELS`, `describeTargets`, `nextPriority`.
- `src/lib/validations/routing-rule.ts` — `ROUTING_TARGET_ROLES` (incluye `ASESOR`), estrategias.
- `src/app/api/admin/teams/route.ts`, `teams/[id]/route.ts`, `territories/route.ts`, `routing-rules/route.ts`, `routing-rules/[id]/route.ts` — errores `flatten()`, warnings de forecast manager, PUT que reemplaza.
- `src/lib/workflows/routing.ts`, `src/lib/workflows/ruteables.ts`, `src/lib/teams/territory.ts` — comportamiento real (Guardia = Manual, territorio ignorado si sin candidatos, `zones`/`plaza`/`accessLevel` sin uso).
