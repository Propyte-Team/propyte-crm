# Auditoría UX — Configuración › Automatización (Flujos, Cadencias, SLA, Agentes)

Fecha: 2026-11-03 · Alcance: `Configuración → Flujos de trabajo y SLA` + "Agentes automáticos". Journey (canvas) lo audita otro agente.
Usuarios: Dirección/Admin (únicos que pueden editar: `canEdit = ADMIN|DIRECTOR`), Karla (ventas) y asesores (solo ven).

## 0. Hallazgo previo: "Agentes automáticos" ya no existe en Configuración
- `src/components/config/agents-section.tsx` y `agent-studio.tsx` **no están en el repo**. La cabecera de `config-center.tsx` documenta que el 2026-10-09 se retiró la UI de "Agentes automáticos" (Agent Studio / AgentDef) por falta de uso (2 agentes inactivos, 0 corridas). El backend (`src/lib/agents`, modelos AgentDef/AgentRun) sigue para el servidor MCP.
- Lo que hoy se llama "agente" en Configuración son dos tarjetas que enlazan a `/admin`: **Agentes conversacionales** (`src/components/admin/bot-agents-tab.tsx`, modelo `BotAgentProfile`: nombre, segmento por tipo de contacto, identidad en texto libre, playbook, tono) y **Marcas del agente** (`/admin?tab=botBrands`).
- Riesgo UX: dentro de las reglas sigue existiendo la acción "🤖 Respuesta IA" con un campo "Instrucción" en texto libre (`AI_REPLY.goal = saludo_calificacion` en el ejemplo de Luis). No hay enlace entre esa instrucción y los agentes conversacionales/playbooks que sí existen. Propuesta en §5.3 (acción "El bot responde").

## 1. Pantalla: Flujos de trabajo y SLA (`automation-section.tsx`)

Lista madre con 4 bloques: Observabilidad del motor, Reglas, Cadencias, Políticas SLA.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Subtítulo "Cola de acciones: PENDING 3 · FAILED 1" | Conteo crudo de la cola por estado | Enums en inglés como primera línea de la pantalla; nadie de negocio sabe qué es "cola" | Mover al bloque de salud; etiquetas "En espera / Ejecutando / Fallidas / Hechas" | quick win |
| Bloque "Observabilidad del motor" (4 KPIs + errores) | Salud del motor | Nombre técnico; "Eventos pendientes", "Procesados (24h)" no significan nada para Karla; menciona el cron `/api/cron/workflows` en texto visible; error crudo `actionType · entityType · error (2/3)` | Renombrar "¿Está funcionando la automatización?" con semáforo + una frase ("Todo al día · 134 acciones hoy"). Errores en frase: "No se pudo enviar WhatsApp a Juan Pérez (regla Bienvenida) · Reintentar". Cron detrás de "Detalles técnicos" | quick win |
| Lista de reglas: `{triggerType} · N acciones · última: fecha` | Resumen de cada regla | Muestra `EVENT`, `STAGE_CHANGE` en crudo; no dice qué hace la regla | Resumen en frase generado del modelo: "Cuando entra un lead · si viene de Meta · asignar → bot saluda → avisar" (función pura `describeRule(rule)` sobre node-catalog + constants) | quick win |
| Botón "Editar en Journey" (icono rama) | Abre el canvas | Icono sin texto; dos editores para lo mismo confunden | Texto "Ver como diagrama"; único punto de entrada al canvas desde la regla | quick win |
| Switch activo/pausado | Activa/pausa regla o cadencia | Sin confirmación ni efecto visible ("¿y los contactos en cadencia?") | Toast "Regla pausada · no afecta acciones ya programadas" | quick win |
| "Cadencias (action plans)" / "Políticas SLA (speed-to-lead)" | Títulos de bloque | Jerga en inglés entre paréntesis | "Secuencias de seguimiento" / "Tiempos de respuesta" | quick win |
| Lista de cadencias: "N pasos · N enrolados" | Resumen | "enrolados" es jerga | "N pasos · N contactos en curso" + primera línea de pasos ("Día 0 WhatsApp → Día 2 llamada → Día 5 email") | quick win |
| Lista SLA: "prioridad 100 · 12 timers históricos" | Resumen | "timers" es interno | "Responder en 15 min · reintento cada 1 h · huérfano a las 24 h" | quick win |
| Estado vacío | — | "Sin reglas todavía" sin ejemplos | Galería de recetas en tarjetas (§5.4) | medio |

## 2. Modal "Nueva regla / Editar regla" (`workflow-builder.tsx` + `condition-tree.tsx`)

Formulario plano: plantilla → nombre/prioridad/descripción → Disparador → Condiciones → Acciones → Cooldown → Guardar.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| "Empezar desde plantilla" (select) | Pre-llena con 3 recetas (`builder-templates.ts`: Lead/Broker/Empleo por campaña) | Texto de opción larguísimo; recetas acopladas a `adAttribution.campaignName contains "[LEADS]"` (marcador que nadie conoce); solo al crear | Tarjetas de recetas con frase e ícono; 6 recetas de negocio (§5.4) | medio |
| Prioridad (menor = primero) | Orden de evaluación | Número sin contexto; default 100 | Esconder en "Avanzado"; mostrar como orden arrastrable en la lista | quick win |
| Descripción | Texto libre | Redundante si la frase se autogenera | Quitar; la frase la sustituye | quick win |
| Disparador: select `TRIGGER_CATALOG` + valor | Elige cuándo dispara | Labels ok ("Evento del sistema") pero EVENT exige escribir a mano `lead.captured`; `SCORE_THRESHOLD` pide número sin escala; `INACTIVITY` en horas; `TIME`, `BEHAVIORAL`, `SLA_BREACH` sin campo (el usuario no sabe si funcionan) | Lista cerrada de disparadores en español (§5.1) alimentada por un catálogo de eventos emitidos (hoy no existe). Ocultar TIME/BEHAVIORAL si el motor no los evalúa | medio |
| Condiciones: campo (input texto + datalist `FIELD_SUGGESTIONS`) | Qué campo evaluar | El usuario escribe `contact.leadSource` a mano; `contact.custom.` sin ayuda; `adAttribution.*` sin saber qué es | Select de campos con etiqueta ("Fuente del lead", "Temperatura", "Plaza", "Campaña") → mapa campo↔etiqueta↔tipo↔catálogo (§5.2). Faltan `contact.plaza` y `contact.assignedTo` | medio |
| Condiciones: operador (`= igual`, `en lista`, `cambió a`…) | Comparación | 11 operadores siempre visibles aunque no apliquen (`> mayor` para fuente) | Operadores filtrados por tipo de campo: enum → "es / no es / es una de"; número → "mayor / menor"; texto → "contiene" | quick win |
| Condiciones: valor (texto; `a,b,c` para listas) | Valor | Se escribe `FACEBOOK_ADS,GOOGLE_ADS` a mano; error silencioso si se equivoca | Multi-check con etiquetas de `LEAD_SOURCE_LABELS`, `PLAZA_LABELS`, `CONTACT_TYPE_LABELS`, `LEAD_TEMPERATURE_LABELS`, `STAGE_LABELS`, `LIFECYCLE_LABELS`, `URGENCY_LABELS`, `CONTACT_STATUS_LABELS` (todas existen en `constants.ts`) | medio |
| "Cumplir todas / cualquiera" + "Grupo" | AND/OR anidado | Correcto pero árido; subgrupos rara vez necesarios | Frase "si **todas** estas se cumplen" como chips; subgrupo solo en "Avanzado" | quick win |
| Acciones: select `NODE_CATALOG` + campos | Qué hacer | Labels con emoji ok, pero campos crudos: WhatsApp `template` texto libre (`bienvenida_es`); Notificar `type: workflow` (clave interna visible); `ENROLL_PLAN.planId` "ID del plan" (pegar un cuid); `ASSIGN.reason` texto sin estrategia; `UPDATE_FIELD` con claves `temperature`/`leadSource` y valor libre; `AI_REPLY.goal` clave de prompt | Cada acción con selector real (§5.3): plantillas existentes, cadencias por nombre, usuarios/equipos, playbooks. Quitar `type` de Notificar (default `workflow`) | medio |
| "Retrasar (min)" por acción | Delay | Minutos; 1440 = 1 día no es obvio | Selector "Inmediato / 15 min / 1 h / 1 día / personalizado" con unidad | quick win |
| Cooldown (minutos, opcional) | Evita re-disparos | Jerga; sin default; "ej. 1440" | "No repetir para el mismo contacto durante: [1 día ▾]" | quick win |
| Guardar pausada / Guardar y activar | Persistir | Sin preview de qué va a pasar; sin probar con contacto; el API responde `Datos inválidos` + `details` que el modal descarta (solo muestra `d.error`) | Panel "Así quedará" (frase + línea de tiempo de acciones); "Probar con un contacto…" (dry-run con `evaluateConditions`); mapear `details.fieldErrors` a mensajes por campo | medio / rediseño (dry-run) |
| Banner "usa ramas de decisión; edítala en Journey" | Guard anti-pérdida | Correcto, pero deja al usuario sin ver nada | Mostrar la frase en solo lectura + botón "Abrir diagrama" | quick win |

## 3. Cadencias (`cadence-editor.tsx`)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Paso: "Esperar N min" + select de acción | Secuencia | Select muestra enums crudos `SEND_WHATSAPP`, `AI_DRAFT`… (`ACTION_OPTIONS` local; NO usa `labelFor` de node-catalog); minutos en vez de días; **no hay campos de config por paso** (no se puede elegir plantilla ni texto; `config` queda `{}`) | Reusar `NODE_CATALOG` + `BUILDER_ACTION_FIELDS` igual que el builder; "Día 2 · 10:00" en vez de "2880 min"; línea de tiempo vertical | medio |
| Nivel de autonomía `L0/L1/L2` | Automático / propuesta / requiere OK | Códigos de ingeniería | "Automático" · "Sugerir al asesor" · "Pedir aprobación" con ícono; default L1 para mensajes | quick win |
| Condiciones de salida | Cuándo sacar al contacto | Mismo editor crudo | Chips preset: "Sale si responde", "si avanza de etapa", "si se marca perdido" (generan el DSL) | quick win |
| `ACTION_OPTIONS` incluye `AI_DRAFT`, `WEBHOOK`, `UPDATE_FIELD` | — | Un asesor no necesita webhook en una cadencia | Ocultar tras "Avanzado" | quick win |
| Sin "quién está dentro" | — | Nadie ve a quién afecta | Contador clicable → lista de contactos en curso | medio |

## 4. Políticas SLA (`sla-policy-editor.tsx`)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| "Es la política default" + Prioridad | Fallback y orden | Dos conceptos técnicos juntos | "Aplica a: Todos los demás / Un segmento"; orden por arrastre | quick win |
| Segmento (condiciones) | Para quién | Mismo editor crudo | Mismo selector de campos/valores de §5.2 ("Fuente es Meta Ads y Plaza es Tulum") | medio (hereda) |
| "1er toque (min) · Reintento (min) · Huérfano (hrs)" | Tiempos | Unidades mezcladas, "huérfano" sin explicar | Frase: "Contactar en **15 min** · si no, recordar cada **1 h** · si nadie lo toma en **24 h** reasignar". Tooltip por término | quick win |
| Horario laboral: zona horaria (texto `America/Cancun`) + 7 filas | Ventana | Escribir un tz IANA a mano | Select de 3-4 zonas MX; "Copiar lunes a todos" | quick win |
| Borrar: `confirm()` nativo "timers históricos" | — | Jerga | "Las métricas pasadas se conservan" | quick win |

## 5. Inventario para el editor en frase

Formato propuesto: **Cuando** [disparador] · **si** [condición…] · **entonces** [acción → acción → acción] · **no repetir** [plazo].

### 5.1 Disparadores (fuente: `TRIGGER_CATALOG` + eventos emitidos por `emitEvent`)
| Clave motor | Etiqueta propuesta | Selector | Catálogo |
|---|---|---|---|
| EVENT `lead.captured` | Entra un lead nuevo | — | falta `EVENT_CATALOG` (crear en `src/lib/workflows/`, derivado de las llamadas a `emitEvent`) |
| EVENT `contact.created` | Se crea un contacto (manual) | — | ídem |
| EVENT `contact.scored` | Cambia el score | — | ídem |
| EVENT `contact.opted_out` | El contacto pide no ser contactado | — | ídem |
| EVENT `lead.orphaned` | Un lead queda sin asesor | — | ídem |
| EVENT `sla.breach` / SLA_BREACH | Se vence el tiempo de respuesta | política SLA (lista) | `SlaPolicy` |
| EVENT `payment.overdue` | Un pago se atrasa | — | ídem |
| STAGE_CHANGE | Avanza a la etapa… | select etapa | `PIPELINE_STAGES` (existe) |
| LIFECYCLE_CHANGE | Pasa a ser… (Lead/MQL/SQL…) | select | `LIFECYCLE_ORDER/LABELS` (existe) |
| SCORE_THRESHOLD | Supera un score de… | slider 0-100 | — |
| INACTIVITY | Lleva N días sin actividad | días (no horas) | — |
| TIME / BEHAVIORAL | Programado / Comportamiento web | ocultar hasta que el motor los evalúe | — |

### 5.2 Condiciones (fuente: `FIELD_SUGGESTIONS` → convertir en `FIELD_CATALOG` con etiqueta/tipo/opciones)
| Campo DSL | Etiqueta | Tipo | Selector / catálogo existente |
|---|---|---|---|
| contact.leadSource | Fuente del lead | enum | multi-check `LEAD_SOURCE_ORDER` + `LEAD_SOURCE_LABELS` (agrupar "Meta" = FACEBOOK_ADS, INSTAGRAM, META_ADS, MESSENGER) |
| contact.contactType | Tipo de contacto | enum | `CONTACT_TYPE_ORDER/LABELS` |
| contact.temperature | Temperatura | enum | `LEAD_TEMPERATURE_LABELS` |
| contact.contactStatus | Estado | enum | `CONTACT_STATUS_ORDER/LABELS` |
| contact.lifecycleStage | Ciclo de vida | enum | `LIFECYCLE_ORDER/LABELS` |
| contact.urgency | Urgencia | enum | `URGENCY_LABELS` |
| contact.score | Score | número | slider |
| contact.budgetMax | Presupuesto máx. | moneda | input con `CURRENCY_LABELS` |
| contact.plaza (**falta** en FIELD_SUGGESTIONS; verificar que `evaluateConditions` lo resuelva) | Plaza | enum | `PLAZA_LABELS` / enum Prisma `Plaza` |
| contact.assignedTo (**falta**) | Asesor asignado | usuario | lista de `User` activos |
| contact.tags | Etiqueta | texto | tags existentes (falta endpoint de catálogo) |
| adAttribution.campaignName / adName / adsetName / network | Campaña / Anuncio / Conjunto / Red | texto | "contiene"; idealmente autocompletar desde `AdAttribution` distinct (falta endpoint) |
| deal.stage / deal.dealType / deal.estimatedValue | Etapa / Tipo de operación / Valor | enum/número | `PIPELINE_STAGES`, `DEAL_TYPE_LABELS` |
| contact.custom.* | Campo personalizado | según campo | `fields-section` ya lista los custom fields (reusar su API) |
| event.type | (ocultar; lo cubre el disparador) | — | — |

Operadores por tipo: enum → es / no es / es una de / no es ninguna de; número → mayor / menor / entre; texto → contiene / es; cualquiera → está vacío / tiene valor (`exists`); "cambió a" solo con disparadores de cambio.

### 5.3 Acciones (fuente: `NODE_CATALOG`; etiqueta en español y selector real por campo)
| Tipo | Etiqueta propuesta | Campos hoy | Selector propuesto / catálogo |
|---|---|---|---|
| ASSIGN / REASSIGN | Asignar asesor / Reasignar | `reason` texto | Estrategia: "Según reglas de asignación" · "Round robin del equipo…" · "A una persona…" → lista de `Team`/`User`; `routing.ts` ya tiene `rule.strategy` |
| SEND_WHATSAPP | Enviar WhatsApp | `template` clave + `body` | Select de plantillas existentes (modelo `UserTemplate` + plantillas Meta aprobadas); preview del texto; variables {{nombre}} |
| AI_REPLY | El bot responde | `goal` clave (`saludo_calificacion`) | Select de **playbook / agente conversacional** (`BotPlaybook`, `BotAgentProfile`) en vez de clave libre |
| AI_DRAFT | Sugerir borrador al asesor | `goal` | ídem + nivel "Sugerir" |
| NOTIFY | Avisar a… | title/message/`type: workflow` | Destinatario: asesor asignado / gerente / usuario fijo; quitar `type` |
| CREATE_TASK | Crear tarea | subject/description/dueInMinutes | Asunto con sugerencias; "vence en" 1 h / mañana / 3 días |
| ENROLL_PLAN | Meter en secuencia | `planId` cuid | Select de cadencias por nombre (`/api/admin/automation` ya devuelve `plans`) |
| CHANGE_STAGE / SET_LIFECYCLE | Mover a etapa / Cambiar ciclo | select (ok) | ok; `allowBackward` → "permitir retroceder" en Avanzado |
| ADD_TAG | Poner etiqueta | texto | combobox con tags existentes |
| UPDATE_FIELD | Cambiar campo | field select con claves crudas + value texto | etiqueta por campo y valor con el catálogo del campo |
| ESCALATE / MAKE_CALL / AI_CALL_SUMMARY | Escalar al gerente / Programar llamada / Resumir llamada | reason/goal | ok; IA en Avanzado |
| WEBHOOK | Enviar a otro sistema | url | solo Admin, en Avanzado |

### 5.4 Recetas sugeridas (sustituyen `RULE_TEMPLATES`)
1. Lead de Meta → asignar por reglas → bot saluda → avisar al asesor. 2. Lead sin respuesta en 15 min → recordar al asesor → a los 60 min escalar. 3. Lead caliente (score ≥ 70) → tarea de llamada hoy. 4. Lead de broker → tipo Broker + etiqueta. 5. Reservado → secuencia "Cierre". 6. 7 días sin actividad → secuencia "Reactivación".

## 6. Propuestas priorizadas

| # | Propuesta | Impacto | Tamaño | Archivos |
|---|---|---|---|---|
| 1 | Frase-resumen `describeRule()` en lista y en modal ("Cuando… si… entonces…") | Alto: se entiende cada regla sin abrirla | quick win | nuevo `src/lib/workflows/describe-rule.ts`, `automation-section.tsx`, `workflow-builder.tsx` |
| 2 | Catálogo de campos de condición con etiqueta/tipo/opciones + selectores por catálogo (fuentes, plazas, tipos, etapas) | Alto: elimina `contact.leadSource` y `FACEBOOK_ADS,GOOGLE…` tecleados | medio | `builder-model.ts` (FIELD_CATALOG), `condition-tree.tsx`, `constants.ts` |
| 3 | Catálogo de disparadores en español (eventos emitidos) y ocultar TIME/BEHAVIORAL | Alto | medio | `node-catalog.ts` (EVENT_CATALOG), `workflow-builder.tsx`, `rebuild-f1.ts` |
| 4 | Selectores reales en acciones: cadencia por nombre, plantilla WA de lista, playbook en "bot responde", destinatario en Notificar, estrategia en Asignar | Alto | medio | `node-catalog.ts` (FieldDef kind `select-async` con `source`), `workflow-builder.tsx`, endpoint nuevo `/api/admin/automation/catalogs` |
| 5 | Cadencias: usar `NODE_CATALOG` (labels + campos) en vez de `ACTION_OPTIONS`; L0-L2 → palabras; días en vez de minutos | Alto | quick win | `cadence-editor.tsx` |
| 6 | Renombrar bloques y KPIs (Observabilidad → "¿Funciona?", cola en español, quitar cron del texto) | Medio | quick win | `automation-section.tsx` |
| 7 | Delay/cooldown con presets y unidad; prioridad y descripción a "Avanzado" | Medio | quick win | `workflow-builder.tsx` |
| 8 | Operadores filtrados por tipo de campo | Medio | quick win | `condition-tree.tsx` |
| 9 | Errores del API por campo (`details.fieldErrors` → mensaje) | Medio | quick win | `workflow-builder.tsx`, `rules/route.ts` |
| 10 | SLA en frase + tz select | Medio | quick win | `sla-policy-editor.tsx` |
| 11 | Recetas en tarjetas (6) con frase e ícono | Medio | medio | `builder-templates.ts`, `workflow-builder.tsx` |
| 12 | Panel "Así quedará" + "Probar con un contacto" (dry-run: `evaluateConditions` sobre un contacto real → lista de acciones que ejecutaría) | Alto | rediseño | endpoint nuevo `rules/dry-run`, `workflow-builder.tsx`, `src/lib/workflows/evaluate-conditions.ts` |
| 13 | Editor en frase con pasos visuales (chips editables en una línea + timeline de acciones) sustituyendo el formulario | Alto | rediseño | nuevo `rule-sentence-editor.tsx` sobre el mismo `builder-model.ts` (sin tocar motor ni API) |

## 7. Archivos involucrados
- UI: `src/components/config/automation-section.tsx`, `workflow-builder.tsx`, `condition-tree.tsx`, `cadence-editor.tsx`, `sla-policy-editor.tsx`, `config-center.tsx`; `src/components/admin/bot-agents-tab.tsx` (agentes conversacionales).
- Modelo puro: `src/lib/workflows/builder-model.ts` (FIELD_SUGGESTIONS; `DEAL_STAGES` duplica `PIPELINE_STAGES`), `builder-templates.ts`, `src/lib/journey/node-catalog.ts` (NODE_CATALOG, TRIGGER_CATALOG, TRIGGER_FIELDS, coerceFieldConfig).
- Validación/motor: `src/lib/validations/rebuild-f1.ts` (conditionDslOps, TRIGGER_TYPES, workflowActionTypes, AutonomyLevel L0-L2), `src/lib/workflows/routing.ts`, `sla.ts`, `evaluate-conditions.ts`.
- Catálogos existentes: `src/lib/constants.ts` (LEAD_SOURCE_*, PLAZA_LABELS, CONTACT_TYPE_*, CONTACT_STATUS_*, LIFECYCLE_*, LEAD_TEMPERATURE_LABELS, URGENCY_LABELS, PIPELINE_STAGES/STAGE_LABELS, DEAL_TYPE_LABELS); Prisma `LeadSource`, `Plaza`, `AutonomyLevel`, `UserTemplate`, `BotPlaybook`, `BotAgentProfile`, `ActionPlan`, `SlaPolicy`, `Team`, `User`.
- Faltan: catálogo de eventos (`EVENT_CATALOG`), catálogo de campos de condición con tipo/etiqueta, endpoint de catálogos para selectores (plantillas, cadencias, usuarios, tags, campañas), dry-run de reglas.
- API: `src/app/api/admin/automation/route.ts`, `rules/route.ts`, `plans/`, `sla/`, `retry/`.
