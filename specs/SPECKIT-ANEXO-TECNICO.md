# ANEXO TÉCNICO — Spec detallado Propyte CRM
### Diccionario de campos · Funciones · Motor de Workflows · Sistema de Inventarios

> **Complementa** (no reemplaza) al `SPECKIT-PROPYTE-CRM-CONSOLIDADO.md` v1.1. Aquí se baja a nivel campo/función/protocolo.
> **Base real:** esquema Prisma de `Propyte-Team/propyte-crm` (esquema `propyte_crm`), inspeccionado campo por campo.
> **Leyenda de origen:** `ACTUAL` = ya en el schema · `ZOHO` = brecha de paridad con Zoho · `NUEVO` = mejora propuesta.
> **Versión:** 1.0 — 2026-06-10 (entregado por Luis; versionado aquí verbatim)

---

## A. CONVENCIONES TRANSVERSALES

| Tema | Regla |
|---|---|
| Esquema DB | Todo en `propyte_crm`; catálogo en `real_estate_hub` (read-only). |
| PK | `id String @id @default(uuid())`. |
| Timestamps | `createdAt`, `updatedAt`; soft-delete `deletedAt DateTime?`. |
| Dinero | `Decimal @db.Decimal(14,2)` (valor desarrollo: 16,2). Moneda explícita (`Currency`). |
| Texto largo | `@db.Text`. Multivaluado simple: `String[]`. |
| Teléfono | Normalizado a **E.164** (`+52…`); clave de dedup. |
| RLS | Por `assignedToId` (asesor ve lo suyo), rol (Dirección ve todo), y `deletedAt IS NULL`. |
| PII sensible | Expediente KYC cifrado en reposo; nunca en logs ni en payloads de IA. |
| Enums | Definidos con `@@schema("propyte_crm")` (ya existen 30+). |
| Spec de campo | `Campo · Tipo · Req · Default · Origen · Reglas/Notas`. |

---

## B. CONTACTOS — DICCIONARIO COMPLETO

### B.1 `contacts` — campos ACTUALES (verbatim del schema)

| Campo | Tipo | Req | Default | Origen | Reglas / Notas |
|---|---|---|---|---|---|
| id | uuid | sí | uuid() | ACTUAL | PK |
| firstName | String | sí | — | ACTUAL | trim, 1–80 |
| lastName | String | sí | — | ACTUAL | trim, 1–80 |
| email | String? | no | — | ACTUAL | lowercase, formato email; opcional (muchos leads solo dejan teléfono) |
| phone | String | sí | — | ACTUAL | **E.164**; parte de la clave de dedup |
| secondaryPhone | String? | no | — | ACTUAL | E.164 |
| contactType | ContactType | sí | LEAD | ACTUAL | LEAD/PROSPECTO/CLIENTE/INVERSIONISTA/BROKER_EXTERNO/REFERIDO |
| leadSource | LeadSource | sí | — | ACTUAL | 12 valores (WALK_IN, FACEBOOK_ADS, …) |
| leadSourceDetail | String? | no | — | ACTUAL | texto libre (campaña/anuncio si no se normaliza en AdAttribution) |
| residenceCity | String? | no | — | ACTUAL | |
| residenceCountry | String? | no | — | ACTUAL | ISO-3166 recomendado |
| nationality | String? | no | — | ACTUAL | relevante para fideicomiso (extranjeros) |
| preferredLanguage | PreferredLanguage | sí | ES | ACTUAL | ES/EN — gobierna idioma de bot/correo/voz |
| investmentProfile | InvestmentProfile? | no | — | ACTUAL | END_USER/INVESTOR_RENTAL/FLIP/LAND/MIXED |
| propertyType | PropertyType? | no | — | ACTUAL | DEPARTAMENTO/CASA/TERRENO/MACROLOTE/LOCAL/OTRO |
| purchaseTimeline | PurchaseTimeline? | no | — | ACTUAL | IMMEDIATE / 1-3m / 3-6m / 6m+ |
| budgetMin | Decimal(14,2)? | no | — | ACTUAL | `budgetMin ≤ budgetMax` |
| budgetMax | Decimal(14,2)? | no | — | ACTUAL | usado por el matching invertido |
| paymentMethod | PaymentMethod? | no | — | ACTUAL | CONTADO/CRÉDITO/FINANCIAMIENTO/MIXTO |
| preferredZone | String? | no | — | ACTUAL | texto; idealmente catálogo de zonas del Hub |
| purchaseModality | PurchaseModality? | no | — | ACTUAL | PREVENTA/ENTREGA_INMEDIATA/REVENTA/ABIERTO |
| rentalStrategy | RentalStrategy? | no | — | ACTUAL | LONG_TERM/AIRBNB/BOTH/NA |
| assignedToId | uuid? | no | — | ACTUAL | FK→User; lo setea el ruteo |
| temperature | LeadTemperature | sí | COLD | ACTUAL | HOT/WARM/COLD/DEAD |
| score | Int | sí | 0 | ACTUAL | 0–100; lo escribe el scoring (§D/§F) |
| tags | String[] | sí | [] | ACTUAL | etiquetas libres / objection-killers |

Relaciones actuales: `deals[]`, `activities[]`, `walkIns[]`, `units[]` (ReservedByContact), `messages[]`.

### B.2 Campos a AGREGAR a `contacts`

| Campo | Tipo | Origen | Razón |
|---|---|---|---|
| contactStatus | ContactStatus (NUEVO enum) | ZOHO | Zoho: Nuevo/Sin respuesta/Contactado. Distinto de `contactType` (ciclo vs naturaleza). |
| urgency | Urgency? (NUEVO enum: ALTA/MEDIA/BAJA) | ZOHO | Campo "Urgencia" de Zoho. |
| lastActivityAt | DateTime? | NUEVO | Detección de huérfanos/dormidos (P2). |
| originalCreatedAt | DateTime? | ZOHO | "Fecha de creación original" (preserva fecha de migración). |
| doNotContact | Boolean @default(false) | NUEVO | Cumplimiento. |
| whatsappOptOut | Boolean @default(false) | NUEVO | Opt-out WhatsApp/SMS. |
| recordingConsent | Boolean @default(false) | NUEVO | Consentimiento de grabación de llamada. |
| mergedIntoId | uuid? (self-FK) | NUEVO | Dedup: apunta al contacto superviviente. |
| zohoId | String? @unique | NUEVO | ID externo para conciliación con Zoho. |
| hubContactId | String? | NUEVO | Vínculo a contacto del Hub si aplica. |
| dossierId | uuid? (1:1) | ZOHO | → ContactDossier (B.3). |

### B.3 `contact_dossiers` (KYC / Expediente) — NUEVA entidad 1:1

> PII sensible. Cifrado en reposo, RLS estricta (solo asesor asignado + Dirección + cobranza). Solo se llena al avanzar a CLIENTE.

| Campo | Tipo | Origen | Notas |
|---|---|---|---|
| id | uuid | — | PK |
| contactId | uuid @unique | — | FK→Contact |
| documentType | DocumentType (INE/PASAPORTE/FM2/FM3/OTRO) | ZOHO | |
| documentNumber | String (cifrado) | ZOHO | |
| birthDate | DateTime? | ZOHO | |
| birthPlace | String? | ZOHO | |
| maritalStatus | MaritalStatus? | ZOHO | Soltero/Casado/Divorciado/Viudo |
| occupation | String? | ZOHO | |
| taxId | String? (cifrado) | ZOHO | RFC / TAX ID |
| taxRegime | TaxRegime? | ZOHO | PFAE/PM/PF |
| corrStreet/Colonia/City/State/Zip/Country | String? | ZOHO | Domicilio de correspondencia (6 campos) |

### B.4 `ad_attributions` — NUEVA entidad (1:1 con Contact, o 1:N por touch)

> **Decisión (OQ §6 del consolidado):** construir aquí, o **leer del pipeline Meta del Hub** para evitar doble fuente. Si el Hub centraliza Meta, esta tabla es una **proyección** del Hub.

| Campo | Tipo | Origen | Notas |
|---|---|---|---|
| gclid | String? | ZOHO | Google Click ID |
| fbclid / socialLeadId | String? | ZOHO | Meta "Social Lead ID" |
| utmSource/Medium/Campaign/Term/Content | String? | ZOHO/NUEVO | 5 campos UTM |
| campaignName / adName / adsetName | String? | ZOHO | nombres legibles |
| network / device / keyword | String? | ZOHO | red, dispositivo, palabra clave |
| costPerClick / costPerConversion | Decimal(10,2)? | ZOHO | |
| conversionExportStatus | String? | ZOHO | **Export offline a Google Ads** — preservar |
| conversionExportedAt | DateTime? | ZOHO | |
| landingPage / referrer | String? | NUEVO | |
| firstTouch / lastTouch | DateTime? | NUEVO | atribución first/last |

### B.5 `web_behavior` — NUEVA entidad (equivalente SalesIQ)

| Campo | Tipo | Notas |
|---|---|---|
| visitorScore | Int? | score de interés web |
| firstVisitAt / lastVisitAt | DateTime? | |
| daysVisited | Int? | |
| avgTimeOnSiteMin | Decimal(6,2)? | tiempo medio de permanencia |
| chatCount | Int? | # de chats SalesIQ/bot |
| firstPageUrl | String? | primera página |
| pagesViewed | String[]? | rutas vistas (alimenta scoring conductual) |

### B.6 Invariantes de Contacto
- `budgetMin ≤ budgetMax` (si ambos presentes).
- Clave de dedup: `normalize(phone)` (E.164) **o** `lower(email)` dentro de la org.
- `contactType` LEAD→PROSPECTO requiere al menos 1 `Deal`; PROSPECTO→CLIENTE requiere Deal en `RESERVED+`.
- `doNotContact = true` ⇒ ningún workflow de IA/outbound puede dispararle.
- `mergedIntoId != null` ⇒ contacto oculto en listas; sus deals/activities re-apuntan al superviviente.

---

## C. FUNCIONES (operaciones de negocio)

> Formato: **Función** — *actor* · entrada → efecto · eventos emitidos. Cada función escribe `AuditLog` y, si toca al contacto/deal, una `Activity`.

### C.1 Contactos
- **captureLead** — *webhook web / Meta(Hub) / bot / walk-in* · payload lead → crea/actualiza `Contact`, corre dedup, dispara ruteo+SLA · `contact.created`, `lead.captured`.
- **dedupeAndMerge** — *sistema/admin* · candidato → fusiona por phone/email, setea `mergedIntoId`, re-apunta relaciones · `contact.merged`.
- **autoRouteLead** — *sistema* · contact → aplica `RoutingRule`, setea `assignedToId`, crea `SlaTimer` · `lead.assigned`.
- **assignContactManual** — *Dirección/coordinador* · {contactId, userId} → reasigna · `lead.reassigned`.
- **scoreContact** — *sistema (por evento)* · contact → recalcula `score`+`temperature` · `contact.scored`.
- **updateProfile** — *asesor/bot* · campos discovery → actualiza perfil de inversión.
- **convertContactType** — *asesor* · transición de ciclo con guardas (B.6).
- **optOut** — *contacto/asesor* · setea `whatsappOptOut`/`doNotContact` · `contact.opted_out`.
- **softDeleteContact** — *admin* · setea `deletedAt`.

### C.2 Deals / Pipeline
- **createDeal** — *sistema al calificar / asesor* · {contactId, dealType, developmentId?} → `Deal` en `NEW_LEAD` · `deal.created`.
- **advanceStage** — *asesor* · {dealId, toStage} → valida transición (máquina de estados §C.7), escribe historial, recalcula `probability` · `deal.stage_changed`.
- **requestUnitHold** / **releaseUnitHold** / **confirmReservation** — ver §E.4 (cruzan al Hub).
- **generateQuote** — *asesor/bot* · {dealId, unitId(Hub), discount, scheme} → `Quote` + PDF + tracking · `quote.created`.
- **buildPaymentPlan** — · {quoteId, scheme} → `PaymentPlan` + `PaymentSchedule[]`.
- **recordPayment** — *cobranza* · {scheduleId, amount} → marca parcialidad pagada/vencida · `payment.recorded`.
- **computeCommission** — *sistema al `CONTRACT_SIGNED`* · deal → aplica `CommissionRule` por `dealType`×`leadSourceCategory`×`role`, llena `commission*` · `commission.computed`.
- **markWon / markLost** — *asesor* · markLost exige `lostReason` (obligatoria) · `deal.won`/`deal.lost`.
- **freezeDeal / reactivateDeal** — *asesor* · `FROZEN` con fecha de reactivación.

### C.3 Inventario (todas vía API del Hub — read/hold, nunca write directo)
- **listAvailableUnits(filters)** — filtra por desarrollo, presupuesto, recámaras, zona, status=DISPONIBLE.
- **getUnit(hubUnitId)** — proyección de detalle.
- **holdUnit / confirmSale / releaseHold** — ver §E.4.
- **matchUnitsToLead(contactId)** — matching invertido: cruza `budgetMin/Max`, `propertyType`, `preferredZone`, `purchaseTimeline` ↔ unidades disponibles del Hub; devuelve top-N.

### C.4 Comunicación / Actividad
- **logActivity** — registra `Activity` (19 tipos: CALL_*, WHATSAPP_*, MEETING_*, DISCOVERY_CALL, PROPOSAL_DELIVERY, …).
- **sendWhatsApp(template)** / **sendEmail** — Twilio/Resend; respeta opt-out y voz de marca (§D.6); escribe `Message`+`Activity`.
- **scheduleCall / logCallOutcome** — dialer; outcome → scoring + next-best-action.
- **completeTask** — cierra `Activity` tipo TASK/FOLLOW_UP.

### C.5 Workflows (motor) — ver §D
- **emitEvent**, **evaluateRules**, **enrollInPlan**, **advancePlanStep**, **executeAction**, **escalate**.

### C.6 Dashboards / Reportes
- **funnelByDevelopment**, **slaCompliance(byAdvisor)**, **absorptionRate**, **commissionForecast(30/60/90)**, **collectionsAging**, **agentTodayView**.

### C.7 Máquina de estados del Deal (transiciones válidas)
```
NEW_LEAD → CONTACTED → DISCOVERY_DONE → MEETING_SCHEDULED → MEETING_COMPLETED
        → PROPOSAL_SENT → NEGOTIATION → RESERVED → CONTRACT_SIGNED → CLOSING → WON
Cualquier etapa activa → LOST (requiere lostReason) | FROZEN (requiere fecha reactivación)
FROZEN → (vuelve a la etapa previa)   RESERVED ⇒ exige unitHold confirmado (Hub)
```
- `probability` se deriva de `stage` (mapa de §2.2 del consolidado).
- `RESERVED` no se permite sin un hold confirmado contra el Hub (invariante anti-doble-venta).

---

## D. SISTEMA DE WORKFLOWS (motor de automatización)

### D.1 Arquitectura
**Event-driven, data-driven.** Cada cambio de dominio emite un evento → el motor evalúa reglas → encola acciones que ejecuta un runner (API routes Next.js + cola; jobs temporales con pg_cron). Las reglas y secuencias viven en **JSONB**, no en código por-secuencia (un solo runner las interpreta).

```
[dominio] --emit--> WorkflowEvent(log append-only)
        --> RuleEngine(evalúa AutomationRule por prioridad)
        --> ActionQueue --> ActionRunner --> {tarea, WhatsApp, email, llamada, reasignación, IA…}
                                         --> Activity + AuditLog (siempre)
SlaEngine y ActionPlanScheduler corren por tiempo (pg_cron) sobre SlaTimer / Enrollment.nextRunAt
```

### D.2 Modelo de datos del motor (NUEVO)

**`workflow_events`** (log append-only): `id, type (WorkflowEventType), entityType, entityId, payload jsonb, occurredAt, processedAt?`.

**`automation_rules`**: `id, name, isActive, priority Int, triggerType (TriggerType), triggerConfig jsonb, conditions jsonb (DSL §D.4), actions jsonb (lista de ActionSpec), cooldownMinutes?`.

**`action_plans`**: `id, name, isActive, entryTrigger jsonb, exitConditions jsonb`.
**`action_plan_steps`**: `id, planId, order Int, delayMinutes Int, actionType (ActionType), config jsonb, conditions jsonb?, autonomyLevel (L0/L1/L2)`.
**`action_plan_enrollments`**: `id, planId, entityType, entityId, currentStep Int, status (ACTIVE/PAUSED/COMPLETED/EXITED), nextRunAt DateTime, enrolledAt`.

**`routing_rules`**: `id, priority, conditions jsonb (plaza/language/source/score/profile), strategy (LeadAssignmentMode), targets jsonb (teamId/userIds + weights), isActive`.

**`sla_policies`**: `id, name, firstTouchMinutes (def 5), retryMinutes (def 30), orphanHours (def 24–48), escalationChain jsonb, businessHours jsonb, channelFallback jsonb (WhatsApp/SMS)`.
**`sla_timers`**: `id, contactId, dealId?, type (FIRST_TOUCH/RETRY/ORPHAN), dueAt, status (RUNNING/MET/BREACHED), metAt?`.

### D.3 Enums del motor (NUEVO)
- **TriggerType:** `EVENT`, `TIME`, `BEHAVIORAL`, `INACTIVITY`, `STAGE_CHANGE`, `SLA_BREACH`, `SCORE_THRESHOLD`.
- **WorkflowEventType:** `lead.captured`, `lead.assigned`, `contact.scored`, `deal.stage_changed`, `quote.opened`, `whatsapp.replied`, `unit.viewed`, `payment.overdue`, `visit.completed`, `deal.won`, `deal.lost`, …
- **ActionType:** `CREATE_TASK`, `SEND_WHATSAPP`, `SEND_EMAIL`, `MAKE_CALL`, `ASSIGN`, `REASSIGN`, `NOTIFY`, `UPDATE_FIELD`, `ADD_TAG`, `CHANGE_STAGE`, `ENROLL_PLAN`, `ESCALATE`, `AI_DRAFT`, `AI_REPLY`, `AI_CALL_SUMMARY`, `WEBHOOK`.

### D.4 DSL de condiciones (JSONB)
```jsonc
{ "all": [
    { "field": "contact.score", "op": "gte", "value": 70 },
    { "field": "contact.preferredLanguage", "op": "eq", "value": "EN" },
    { "any": [
        { "field": "deal.stage", "op": "eq", "value": "PROPOSAL_SENT" },
        { "field": "event.type", "op": "eq", "value": "quote.opened" }
    ]}
]}
```
Operadores: `eq, neq, gt, gte, lt, lte, in, nin, contains, exists, changed_to`.

### D.5 Workflows canónicos (deben existir al lanzar)

| # | Workflow | Trigger | Condición | Acción(es) | Autonomía |
|---|---|---|---|---|---|
| 1 | **Lead nuevo digital** | EVENT `lead.captured` | source ∈ {FB,Google,Web,WhatsApp} | autoRoute → SlaTimer(5min) → bot saluda + califica → notifica asesor | L2 (bot) |
| 2 | **Speed-to-lead dialer** | EVENT `lead.assigned` | horario laboral | click-to-call al asesor → marca al lead | L1 |
| 3 | **Anti-huérfano** | INACTIVITY 24–48h | sin `lastActivityAt` | re-rutea + alerta a coordinador | L2 |
| 4 | **Post-visita sin cotización** | STAGE_CHANGE a MEETING_COMPLETED + 48h | sin Quote | tarea "enviar cotización" + draft IA de unidad sugerida | L0 |
| 5 | **Apartado → firma** | STAGE_CHANGE a RESERVED | — | checklist KYC + recordatorios D+2/D+5 | L1 |
| 6 | **Pago vencido** | TIME (parcialidad due) | status=vencida | WhatsApp D+1 / llamada D+7 / escala cobranza D+15 | L1 |
| 7 | **Reactivación dormidos** | SCORE_THRESHOLD / INACTIVITY 30d | temperature WARM→COLD | secuencia IA con nueva unidad que encaje (matching) | L1 |
| 8 | **Postventa entrega** | EVENT `deal.won` | — | secuencia de bienvenida + encuesta + referidos | L1 |

### D.6 Guardarraíles de IA en el motor (heredados de §6.0 del consolidado)
Toda acción `AI_*` pasa por: (a) **brand linter** (frases prohibidas → bloquea), (b) **data-gate** (cifras solo del Hub con fuente), (c) **autonomyLevel** del step (L0 sugiere / L1 1-clic / L2 autónomo con escalado). Respeta `doNotContact`/`whatsappOptOut`.

### D.7 Garantías operativas
- **Idempotencia:** cada acción tiene `dedupeKey` (entity+rule+día); reintentos no duplican envíos.
- **Cooldown:** `cooldownMinutes` por regla evita loops de eventos.
- **Auditoría:** toda ejecución → `AuditLog` + `Activity`. Trazable end-to-end.
- **Métrica clave:** mediana de `FIRST_TOUCH` (objetivo <5 min) y % de `sla_timers` BREACHED por asesor.

---

## E. SISTEMA DE INVENTARIOS (CRM ↔ Hub)

### E.1 Principio
El **Hub es el SOT del inventario** (sistema mandatorio). El CRM **lee** catálogo y **solicita holds**; **nunca** escribe estado de unidad directo. El anti-doble-venta se enforce **en una sola capa: el Hub**.

### E.2 Contrato de datos (proyección read-only que el CRM consume del Hub)
**Development:** `hubId, name, plaza, developmentType, status, priceMin/Max, currency, deliveryDate, constructionProgress`.
**Unit:** `hubId, developmentId, unitNumber, unitType, area_m2, price, currency, floor, view, orientation, prototype, status, blockedUntil?`.
> En el CRM, `Deal.hubUnitId` / `Deal.hubDevelopmentId` reemplazan a los modelos locales `Unit`/`Development` (migración T5.1/T5.2). Opcional: cache de solo-lectura invalidado por webhook.

### E.3 Máquina de estados de la unidad (vive en el Hub)
```
DISPONIBLE → BLOQUEADA(hold, TTL p.ej. 72h) → APARTADA → VENDIDA
   ▲              │                                  │
   └── LIBERADA ──┘ (expira/cancela)        VENDIDA es terminal
```
Solo el Hub ejecuta transiciones (RPC transaccional). El CRM las solicita y reacciona a webhooks.

### E.4 Protocolo de hold / reserva (secuencia)
```
1. CRM  → Hub   GET  /inventory/units?developmentId&budget&beds&zone&status=DISPONIBLE
2. CRM  → Hub   POST /inventory/units/:hubUnitId/hold  { dealId, userId, ttlHours }
   Hub: BEGIN; SELECT … FOR UPDATE;
        IF status='DISPONIBLE' THEN set BLOQUEADA, blockedUntil=now()+ttl, hold row
        ELSE 409 CONFLICT; COMMIT
   Hub → CRM   200 { holdId, expiresAt }  |  409 { reason }
3. Hub  → CRM   webhook  unit.status_changed { hubUnitId, status:'BLOQUEADA', dealId }
   CRM: Deal.stage=RESERVED (si procede), guarda holdId/expiresAt
4. (firma)  CRM → Hub  POST /inventory/units/:id/confirm-sale { dealId, salePrice }
   Hub: BLOQUEADA→VENDIDA (valida que el hold sea de ese deal) → webhook
5. (expira/cancela)  Hub job (pg_cron) libera holds vencidos → BLOQUEADA→DISPONIBLE → webhook
```

### E.5 Anti-doble-venta (enforce en el Hub, no en el CRM)
```sql
-- en real_estate_hub: a lo sumo un hold/venta ACTIVO por unidad
CREATE UNIQUE INDEX one_active_claim_per_unit
  ON inventory_holds (unit_id)
  WHERE status IN ('BLOQUEADA','APARTADA','VENDIDA');
-- + RPC hold_unit() con SELECT … FOR UPDATE dentro de transacción
```
Imposible por diseño: dos asesores en sala de ventas no pueden apartar la misma unidad. Reemplaza el recálculo de contadores frágil de Zoho (mejora).

### E.6 Contadores y reconciliación
`availableUnits/soldUnits/reservedUnits` los **recalcula el Hub** por trigger sobre cambios de unidad. El CRM solo los **muestra** (no los mantiene). Dashboards de absorción leen del Hub.

### E.7 Resiliencia
- Hold con TTL ⇒ no quedan unidades "trabadas" si un deal muere.
- Webhook con reintento + reconciliación periódica (CRM compara su referencia vs Hub).
- Si el Hub no responde el `hold`, el CRM **no** avanza a RESERVED (falla cerrado, nunca optimista sobre inventario).

---

## F. ESCENARIO END-TO-END (validación del diseño)

| Paso | Disparo | Funciones / Workflows | Inventario |
|---|---|---|---|
| 1. Lead entra por WhatsApp | mensaje entrante | `captureLead` → `autoRouteLead` (RoutingRule por idioma/plaza) → SlaTimer(5min) → bot (L2) saluda y pre-califica | — |
| 2. Bot califica | bot llena perfil | `updateProfile` + `scoreContact` (sube `score`/`temperature`) | `matchUnitsToLead` (sugiere 3 del Hub) |
| 3. Asesor contacta | `lead.assigned` | WF#2 dialer (L1) click-to-call → `logCallOutcome` | — |
| 4. Agenda visita | bot/asesor | `logActivity(MEETING_SCHEDULED)` → `advanceStage` | — |
| 5. Visita (walk-in) | llega a sala | `WalkIn` + `advanceStage(MEETING_COMPLETED)` | lista unidades disponibles |
| 6. Propuesta | asesor | `generateQuote` (data-gate: precios del Hub) → `advanceStage(PROPOSAL_SENT)` | `getUnit` |
| 7. Apartado | cliente acepta | `requestUnitHold` → Hub 200 → webhook → `advanceStage(RESERVED)` | **hold atómico** |
| 8. Contrato/Firma | docs | `advanceStage(CONTRACT_SIGNED)` → `computeCommission` | — |
| 9. Escritura | cierre | `advanceStage(CLOSING→WON)` → `confirmSale` | **VENDIDA** (terminal) |
| 10. Postventa | `deal.won` | WF#8 bienvenida + referidos | contadores Hub actualizados |

Si en el paso 7 otro asesor intenta la misma unidad ⇒ Hub responde `409` ⇒ el segundo deal no llega a RESERVED. Cero doble-venta.

---

## G. OPEN QUESTIONS técnicos (suman a las del consolidado)

1. **AdAttribution:** ¿tabla propia en CRM o proyección del pipeline Meta del Hub? (define dónde vive el export de conversiones a Google).
2. **Cache de catálogo:** ¿el CRM consulta el Hub en vivo por request, o mantiene cache read-only invalidado por webhook? (latencia vs frescura en sala de ventas).
3. **TTL de hold:** ¿72h fijo o configurable por desarrollo/etapa de preventa?
4. **Cifrado de KYC:** ¿pgcrypto en `real_estate_hub`/`propyte_crm` o cifrado a nivel app? Definir manejo de llaves.
5. **Runner de workflows:** ¿cola propia (pg + cron) o servicio externo? Para empezar, pg_cron + API routes es suficiente.
6. **Merge de contactos:** ¿auto-merge sobre match exacto de teléfono, o siempre con confirmación humana? (riesgo de fusionar distintos por teléfono compartido).
7. **businessHours por plaza:** Tulum/PDC/Mérida pueden diferir; ¿una sola política SLA o por plaza?

*Fin — Anexo técnico detallado v1.0.*
