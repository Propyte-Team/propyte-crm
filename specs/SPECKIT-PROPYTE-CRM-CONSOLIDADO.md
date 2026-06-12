# SPECKIT — Propyte CRM (consolidado)
### CRM comercial nativo, alineado a Zoho, integrado con Hub (inventario) y Web

> **Versión:** 1.0 — 2026-06-10
> **Base de código:** `Propyte-Team/propyte-crm` (Next.js 14 + Prisma + Supabase `propyte_crm`)
> **No reemplaza:** la migración CRM→Hub en curso (`specs/crm-hub-migration-cleanup.md`), la matriz de paridad (`specs/zoho-parity-matrix.md`), ni el speckit del sitio (`SPECKIT-METAMORFOSIS-PROPYTE.md`). Este documento los **referencia** y se apoya en ellos.
> **Fuentes consolidadas:** investigación de CRMs líderes (Follow Up Boss, kvCORE, Sierra, PlanOK/Koud) · análisis de configuración Zoho (sesión paralela) · 2 ideas de EspoCRM `ext-real-estate` · descarte de OCA/Odoo (modelo de corretaje, no aplica) · inspección directa de los 3 repos Propyte.

---

## 0. MAPA DEL ECOSISTEMA — dónde vive cada cosa

Todo corre sobre **una sola Supabase** (`oaijxdpevakashxshhvm`), con esquemas separados. La regla de oro: **cada dato tiene un único dueño (SOT), y los demás lo leen.**

```
                         ┌───────────────────────────────────────────┐
                         │            SUPABASE (compartida)            │
                         │  real_estate_hub · investment_analytics ·   │
                         │  propyte_crm · reports · public             │
                         └───────────────────────────────────────────┘
        ┌──────────────────────┬──────────────────────┬──────────────────────┐
        ▼                      ▼                      ▼                      ▼
┌───────────────┐   ┌─────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  ZOHO CRM     │   │  PROPYTE_HUB        │  │ NEXT_PROPYTE_WEB │  │  PROPYTE-CRM     │
│  (actual)     │◄─►│  hub.propyte.com    │─►│  propyte.com     │  │ crm.propyte.com  │
│               │   │                     │  │                  │  │                  │
│ SOT COMERCIAL │   │ SOT INVENTARIO+CMS  │  │ Consumidor       │  │ NUEVO motor      │
│ hoy: leads,   │   │ developments,units, │  │ (lee catálogo +  │  │ COMERCIAL:       │
│ contactos,    │   │ editorial, media,   │  │  analytics, RSC/ │  │ leads, pipeline, │
│ negocios,     │   │ SEO, robots IA,     │  │  ISR). Emite     │  │ deals, comisión, │
│ pipeline      │   │ sync Zoho catálogo, │  │  leads ──────────┼─►│ actividades,     │
│               │   │ Meta               │  │  (webhook)       │  │ WhatsApp(Twilio) │
└───────┬───────┘   └──────────┬──────────┘  └──────────────────┘  └────────┬─────────┘
        │                      │  catálogo read-only (API/SQL)                │
        │                      └───────────────────────────────────────────► │
        │  coexistencia (parity matrix): inbound leads / outbound deals       │
        └────────────────────────────────────────────────────────────────────┘
```

### 0.1 Tabla de propiedad de datos (SOT)

| Dato | Dueño (SOT) | CRM hace… |
|---|---|---|
| Desarrollos / Unidades / Tipologías | **Hub** (`real_estate_hub`) | **Lee** por ID (read-only). No los posee. |
| Editorial, media, SEO, slugs, tours | **Hub / Web** | No toca. |
| Disponibilidad y **bloqueo de unidad** | **Hub** (capa de inventario) | **Solicita** un hold vía API; el Hub garantiza atomicidad. |
| Leads / Contactos | **CRM** (objetivo) · Zoho (hoy) | Posee; durante transición concilia con Zoho. |
| Pipeline / Negocios / Comisiones | **CRM** | Posee. |
| Actividades / WhatsApp / llamadas | **CRM** | Posee (Twilio). |
| Catálogo en Zoho | **Hub** (lo empuja) | No empuja catálogo a Zoho. |
| Métricas/analytics (AirDNA, ROI, zonas) | **investment_analytics** | Lee si las necesita en discovery. |

**Implicación crítica (corrige el speckit v0.1):** el CRM **no es dueño del inventario**. El Hub es el sistema **mandatorio** de inventarios. Por lo tanto el bloqueo y el anti-doble-venta **viven en la capa de inventario (Hub / `real_estate_hub`)**, no duplicados en el CRM. Esto coincide exactamente con su plan de migración (T5.1/T5.2: *"API catálogo read-only en Hub; el CRM consume; `Deal` liga IDs del Hub; borrar modelos `Development`/`Unit` Prisma"*).

---

## 1. PRINCIPIOS (constitution)

- **P1 — El CRM no posee el inventario.** Referencia el catálogo del Hub por `hubDevelopmentId` / `hubUnitId`. El bloqueo/anti-doble-venta se enforce en la capa de inventario, con constraint duro en Postgres (mejora sobre el recálculo de contadores de Zoho).
- **P2 — Speed-to-lead < 5 min.** Todo lead nuevo tiene owner asignado en <60 s (ruteo automático) y SLA: 1er contacto 5 min → reintento 30 min → WhatsApp mismo día. Lead sin actividad 24–48 h se re-rutea (anti-huérfanos). *Twilio ya está en el stack.*
- **P3 — Automatización conductual.** Los action plans se disparan por comportamiento (vio la unidad, abrió cotización, respondió WhatsApp), no solo por tiempo.
- **P4 — WhatsApp-first.** Canal primario (Twilio); todo queda en la timeline unificada del contacto. Email (Resend) y llamada secundarios.
- **P5 — Visibilidad total para Dirección.** Pipeline, actividad, SLA y conversión por asesor en un dashboard, sin pedir reportes.
- **P6 — Ciclo largo por diseño.** 2 semanas a 5 meses. El `DealStage` de 13 etapas vive hasta postventa/escrituración.
- **P7 — Simplicidad de adopción.** Vista "Hoy" del asesor ultra simple; operativo en horas, no días (lección Follow Up Boss).
- **P8 — Paridad-y-mejora con Zoho.** Cada concepto del CRM mapea a un módulo/picklist de Zoho (el equipo trabaja hoy ahí). Primero igualamos su realidad; luego mejoramos. Nunca un pipeline inventado que diverja de cómo venden hoy.
- **P9 — Consistencia de stack.** Todo Propyte es Next.js/Supabase. El CRM no introduce stacks ajenos (por eso EspoCRM/Odoo quedaron descartados como base).
- **P10 — IA con voz de marca (innegociable).** Toda salida generada por IA (chatbot, correo, voz, secuencias) pasa por la voz Sage del Playbook Comercial y un filtro de frases prohibidas. La IA respeta el data-gate: no inventa cifras (ROI, precios, % avance solo desde el Hub, con fuente trazable). Ver §6.0.
- **P11 — Humano en el lazo.** La IA agenda, califica y nutre; nunca cierra ni firma. Toda conversación de IA es tomable por un asesor con contexto completo. El nivel de autonomía es configurable por canal/etapa (sugerir → asistir → autónomo con red).

---

## 2. ALINEACIÓN CON ZOHO (paridad → mejora)

### 2.1 Mapeo de módulos

| Módulo Zoho (actual) | Destino en la nueva arquitectura |
|---|---|
| Proyectos Inmobiliarios (CustomModule1, ~700) | **Hub** `developments` — CRM solo lee |
| Propiedades / Unidades (Products, ~1,250) | **Hub** `units` — CRM solo lee |
| Prospectos + Contactos (~21,623) | **CRM** `Contact` (campo `contactType`) |
| Negocios (Potentials, ~216) | **CRM** `Deal` |
| Empresas (Accounts) | Desarrolladoras → **Hub** `developers`; brokerages → **CRM** broker |

### 2.2 Mapeo del pipeline (8 fases Zoho → 13 etapas CRM)

El `DealStage` de propyte-crm es una versión más granular que mapea limpio sobre las 8 fases de Zoho (así reporte y migración cuadran):

| Fase Zoho | Prob. Zoho | `DealStage` (propyte-crm) |
|---|---|---|
| *(pre-Demo)* | — | `NEW_LEAD`, `CONTACTED` |
| Demo | 10% | `DISCOVERY_DONE` |
| Recorrido | 20–30% | `MEETING_SCHEDULED`, `MEETING_COMPLETED` |
| Propuesta | 40–50% | `PROPOSAL_SENT`, `NEGOTIATION` |
| Apartado | 60–70% | `RESERVED` |
| Firma | 80% | `CONTRACT_SIGNED` |
| Escritura | 90% | `CLOSING` |
| Postventa | 100% | `WON` |
| Negocio Perdido | 0% | `LOST` |
| *(mejora, no existe en Zoho)* | — | `FROZEN` (pausado/reactivación) |

### 2.3 Brechas de campo — qué AGREGAR a propyte-crm para igualar a Zoho

El schema Prisma ya cubre la mayoría. Faltan, tomados de la config Zoho real:

1. **Bloque de atribución publicitaria** (Zoho lo tiene completo): GCLID, palabra clave, red, dispositivo, `costPerClick`, `costPerConversion`, `conversionExportStatus`. *Especialmente el export de conversiones offline de vuelta a Google Ads — no trivial, preservarlo.* → tabla/campos `AdAttribution` ligados a `Contact`/`Deal` (o consumirlo del Hub/Meta, ver §3).
2. **Comportamiento web** (SalesIQ-equivalente): `visitorScore`, tiempo de permanencia, primera/última página, # chats. → consumir de analytics o `WebBehavior`.
3. **Expediente del cliente** (KYC): tipo y número de documento, nacimiento, estado civil, ocupación, RFC/TAX ID, régimen fiscal. → modelo `ContactDossier`.
4. **Cotización** como entidad (Zoho: "Cotización Enviada", módulo Cotizaciones). → `Quote` (unidad + descuento autorizado + esquema de pago + PDF + tracking de apertura).
5. **Plan de pagos / parcialidades** (Zoho los tiene sueltos en Negocio: enganche, mensualidades, contraentrega). → `PaymentPlan` + `PaymentSchedule` (estados pendiente/pagada/vencida/condonada).
6. **Documentación del negocio**: KYC, URL contrato enviado/firmado, comprobante de enganche, recibo, comprobante de domicilio, estatus de contrato. → `DealDocument`.
7. **Broker asociado + split** (Zoho: "Broker Asociado", comisión). El engine de comisiones ya existe; falta la entidad broker y el % de split en el deal. → `ExternalBroker`.
8. **Fechas hito explícitas** en `Deal`: fecha de apartado, firma, escritura, entrega (Zoho las tiene como campos separados).
9. **Motor de ruteo + SLA** (Zoho no lo tiene; es mejora): el enum `LeadAssignmentMode` ya está (ROUND_ROBIN/PERFORMANCE/MANUAL/GUARDIA); faltan tablas `RoutingRule` + `SlaPolicy` + el runner.

### 2.4 Dónde MEJORAMOS sobre Zoho

| Eje | Zoho hoy | Propyte CRM |
|---|---|---|
| Anti-doble-venta | recálculo de contadores (frágil) | constraint duro en capa de inventario (imposible por diseño) |
| Speed-to-lead | sin SLA formal | SLA <5 min + re-ruteo de huérfanos |
| Scoring | estático/manual | conductual (eventos web/cotización/WhatsApp) |
| Timeline | fragmentada por canal | unificada (WhatsApp/SMS/email/llamada en un hilo) |
| Multimoneda | tasa suelta | MXN/USD con FX congelado por cotización |
| Matching | manual | inverso: unidades del Hub ↔ requisitos del lead |

---

## 3. CONTRATOS DE INTEGRACIÓN

### 3.1 CRM ↔ Hub (inventario — read-only)
- El CRM **lee** catálogo (developments, units, developers) vía **API read-only del Hub** (su T5.1) o lectura directa del esquema `real_estate_hub` (RLS). `Deal` guarda `hubUnitId` / `hubDevelopmentId`; **se eliminan los modelos `Development`/`Unit` locales** (su T5.2).
- **Reserva/bloqueo de unidad:** el CRM **solicita** un hold vía API del Hub (`POST /api/inventory/units/:id/hold` con TTL p. ej. 72 h). El **Hub** ejecuta la transacción atómica (`SELECT … FOR UPDATE` + unicidad parcial de hold/venta activa) y responde OK/conflict. El Hub emite **webhook** al cambiar el estado de la unidad → el CRM actualiza el `Deal`. Anti-doble-venta garantizado en una sola capa.
- Expiración de holds: job en el Hub (pg_cron), no en el CRM.

### 3.2 CRM ↔ Web (intake de leads)
- La web emite leads al CRM (webhook `→ crm.propyte.com`, ya documentado en su `CLAUDE.md`). Payload mínimo: nombre, teléfono, email, idioma, desarrollo de interés (`hubDevelopmentId`), UTM/GCLID, fuente.
- **Decisión a tomar (OQ):** hoy la web también escribe `leads`/`contacts` en Supabase directo. Definir **un solo camino** de intake (recomendado: webhook → CRM como SOT comercial; el CRM deduplica por teléfono/email y dispara ruteo+SLA).

### 3.3 CRM ↔ Zoho (coexistencia → cutover)
- Durante la transición, rige la matriz de paridad (`specs/zoho-parity-matrix.md`): outbound de deals y inbound de leads. **No reabrir esa discusión aquí.**
- Objetivo final: el CRM se vuelve SOT comercial; Zoho se retira o queda como archivo. El cutover es una fase explícita (§7, Fase E), no un big-bang.

### 3.4 CRM ↔ Meta / Twilio
- Meta se está **centralizando en el Hub** (su T3.x). El CRM **consume** los Meta leads desde el Hub, no integra Meta por su cuenta.
- Twilio (WhatsApp/SMS/voz) es del CRM: alimenta `Message` + `Activity` y habilita el SLA de speed-to-lead.

---

## 4. MODELO DE DATOS — base propyte-crm + brechas

### 4.1 Se conserva (ya correcto y de dominio)
`User` (RBAC, CareerLevel, Plaza, SEDETUS) · `Contact` (con perfil de inversión: `investmentProfile`, `purchaseTimeline`, `budgetMin/Max`, `paymentMethod`, `preferredZone`, `temperature`, `score`) · `Deal` (13 etapas, comisiones multinivel, `lostReason`) · `Activity` · `CommissionRule` · `WalkIn` · `Message` (Twilio) · `AuditLog` · `Notification` · `WebhookConfig`.

### 4.2 Se convierte en referencia al Hub
`Development` / `Unit` → **referencias** (`hubDevelopmentId`, `hubUnitId`). Eliminar los modelos locales una vez exista la API de catálogo del Hub (su T5.1/T5.2). El `reservedByContact/User` y `salePrice` migran al evento de hold/venta contra el Hub.

### 4.3 Se agrega (brechas de §2.3 + ideas de referencia)
`AdAttribution` · `WebBehavior` · `ContactDossier` (KYC) · `Quote` · `PaymentPlan` + `PaymentSchedule` · `DealDocument` · `ExternalBroker` · `RoutingRule` + `SlaPolicy` + `SlaTimer` · `ActionPlan` + `ActionPlanStep` + `Enrollment`.

**Idea EspoCRM #1 — matching invertido:** servicio (no entidad pesada) que cruza unidades disponibles del Hub ↔ requisitos del `Contact` (`budgetMin/Max`, `propertyType`, `preferredZone`, `purchaseTimeline`). Sugiere al asesor "estas 3 unidades encajan". ~200 líneas TS.

**Idea EspoCRM #2 — árbol de ubicación:** *opcional y probablemente del Hub* (zona→plaza→sub-zona o desarrollo→torre→piso). Solo si el Hub no lo cubre ya; no duplicar geografía.

---

## 5. MÓDULOS NÚCLEO (lo que el CRM posee)

1. **Intake + ruteo + SLA** — captura multicanal (web webhook, Meta vía Hub, WhatsApp, walk-in, referido, broker), dedup, ruteo configurable, SLA engine, re-ruteo de huérfanos.
2. **Pipeline** — Kanban 13 etapas (dnd-kit ya presente), historial de etapa, razones de pérdida obligatorias.
3. **Deals + comisiones** — engine multinivel ya existente (asesor/TL/gerente/director/broker).
4. **Timeline de actividad** — WhatsApp/SMS (Twilio), email (Resend), llamada, notas.
5. **Cotizador + planes de pago + cobranza** — esquemas parametrizables, PDF con branding, aging de parcialidades.
6. **Dashboards** — Dirección (funnel por desarrollo, absorción, SLA por asesor, forecast de cobranza), asesor ("Hoy"), cobranza.
7. **Walk-ins** — captura en sala de ventas (ya presente).
8. **Matching invertido** — unidades del Hub ↔ requisitos del lead.
9. **Capa de IA y seguimiento automatizado** — chatbot, correo IA, voz/llamadas, scoring predictivo, next-best-action (ver §6).

---

## 6. CAPA DE IA Y SEGUIMIENTO AUTOMATIZADO

Objetivo: **contacto inmediato y seguimiento sin fricción, con opción de IA en cada canal**, sin sacrificar la voz de marca. Se apoya en el stack actual: SDK de Anthropic (ya en `package.json`), Twilio WhatsApp/SMS/voz, Resend, WhatsApp Cloud API, y ManyChat/Zapier disponibles.

### 6.0 Guardarraíles transversales (aplican a TODA salida de IA)
- **Voz Sage + Playbook.** Todo texto/voz generado se rige por el system prompt de marca (pedagógico, anti-hype, data-grounded) y un **linter de frases prohibidas** que bloquea antes de enviar: "oportunidad única", "plusvalía garantizada", "paraíso", urgencia/escasez manufacturada.
- **Data-gate.** La IA **no inventa cifras.** ROI, precios y % de avance solo desde el catálogo del Hub (SOT), con fuente trazable. Sin dato verificado → no se afirma.
- **Niveles de autonomía (config por canal/etapa):** **L0 Sugerir** (IA redacta, asesor envía — default en correo/sensibles) · **L1 Asistir** (envío con aprobación 1-clic) · **L2 Autónomo con red** (IA responde sola en FAQ/agenda/primer toque, escala ante intención fuerte o duda).
- **Human-in-the-loop + handoff.** Toda conversación de IA es tomable por un asesor con contexto completo (timeline unificada). La IA nunca cierra ni firma.
- **Cumplimiento.** Aviso de grabación en llamadas; opt-out en WhatsApp/SMS; bilingüe ES/EN según `preferredLanguage`.

### 6.1 Chatbot conversacional (WhatsApp-first + web)
- Canal primario **WhatsApp** (Twilio/Cloud API) + widget web, bilingüe ES/EN, **respuesta en segundos 24/7** (cumple P2 aun fuera de horario).
- **RAG sobre el catálogo del Hub** — responde sobre desarrollos/unidades/precios **reales**, filtrando por presupuesto/zona/recámaras del lead.
- **Pre-calificación** — captura perfil de inversión, presupuesto, timeline, forma de pago → llena `Contact` y dispara scoring (el caso ManyChat de la estrategia, ahora nativo con Claude).
- **Agenda visitas** (crea `Activity`), **handoff con resumen** al asesor ante intención fuerte, **memoria de sesión** en la timeline `Message`.
- **Implementación:** Claude-native vía SDK de Anthropic (recomendado, control de marca total) o ManyChat para flujos simples + Zapier como puente.

### 6.2 Correo con IA (Resend)
- **Borrador / auto-respuesta** en voz de marca; **L0** por default para el asesor, **L1/L2** en confirmaciones y FAQ.
- **Triage de bandeja** — clasifica intención del correo entrante y propone siguiente acción.
- **Secuencias inteligentes** — drip por etapa/comportamiento, personalizado con datos del Hub (no plantillas frías). Apertura/click alimentan el scoring.

### 6.3 Llamadas y voz (Twilio + @twilio/voice-sdk)
- **Dialer speed-to-lead** — al entrar el lead, click-to-call / power-dialer; conecta primero al asesor y luego marca al lead (agente en línea, sin delay).
- **Cadencias de llamada** — secuencia de intentos (día 1 ×2, día 2, día 4, día 7…) con reglas de reintento y respaldo WhatsApp/SMS.
- **Voz IA fuera de horario** — agente de voz que atiende, califica básico y agenda cuando no hay asesor; escala a humano en horario.
- **Grabación → transcripción → resumen** — Claude resume la llamada y la registra como `Activity` (con outcome + next-best-action).

### 6.4 Scoring de clientes con IA
- **Modelo híbrido** sobre `Contact.score`/`temperature`: fuente (calidad del canal) + perfil (presupuesto, timeline, profile) + **comportamiento** (vistas de unidad, apertura de cotización, respuestas WhatsApp, asistencia a visita).
- **Predictivo** — probabilidad de conversión y de "listo para apartar"; detecta leads dormidos con señal de reactivación.
- **Alimenta el ruteo** (mejores leads a mejores asesores) y prioriza la cola del dialer. **Re-scoring por evento**, no batch nocturno.

### 6.5 Orquestación y siguiente-mejor-acción
- **Action plans conductuales** (del §4.3) con contenido generado por IA por paso, disparados por evento.
- **Next-best-action** — la IA sugiere el siguiente paso por deal ("llamar", "enviar cotización de unidad X", "reactivar").
- **Resumen de timeline** — Claude resume el historial para retomar en segundos.
- **Anti-huérfanos** — sin toque (IA o humano) en 24–48 h → re-ruteo automático (P2).

### 6.6 Encaje en el roadmap
- **Fase B:** chatbot WhatsApp (L0/L1) + dialer speed-to-lead + scoring v1 (perfil+fuente).
- **Fase D:** scoring conductual/predictivo + correo IA + voz IA fuera de horario + next-best-action + action plans con IA.
- Los guardarraíles de §6.0 **no son una fase**: son condición de salida de cualquier feature de IA desde el día 1.

---

## 7. ROADMAP (alineado a la migración en curso)

> **Pre-requisito:** termina primero la limpieza CRM→Hub (`specs/crm-hub-migration-cleanup.md`). El rebuild del núcleo comercial arranca con el CRM ya "limpio".

- **Fase A — Catálogo desde el Hub.** API read-only del Hub + el CRM la consume; `Deal` liga IDs del Hub; eliminar `Development`/`Unit` locales. *(= sus T5.1/T5.2.)*
- **Fase B — Núcleo comercial.** Intake (web webhook) + dedup + ruteo + SLA <5 min + pipeline 13 etapas + actividades Twilio + **chatbot WhatsApp (L0/L1) + dialer speed-to-lead + scoring v1**. *Aquí se materializa el speed-to-lead.*
- **Fase C — Cotización y cobranza.** `Quote` + `PaymentPlan`/`PaymentSchedule` + `DealDocument` + vista de cobranza.
- **Fase D — Automatización con IA.** Action plans conductuales + scoring conductual/predictivo + correo IA + voz IA fuera de horario + next-best-action + matching invertido + bloqueo de unidad contra el Hub.
- **Fase E — Cutover Zoho.** Concilia, valida conteos N días, dashboards de Dirección, retira Zoho como SOT comercial.

---

## 8. FRONTERAS — lo que el CRM NO hace

- No posee inventario (el Hub es mandatorio).
- No es el CMS ni hace SEO/editorial/robots (Hub/Web).
- No empuja catálogo a Zoho (lo hace el Hub).
- No reescribe la web ni duplica su speckit.
- No integra Meta por su cuenta (lo consume del Hub).

---

## 9. OPEN QUESTIONS

1. **Intake único de leads:** ¿webhook web→CRM como camino único, o se mantiene la escritura directa de la web a Supabase? (define dedup + SLA).
2. **API de inventario del Hub:** ¿está lista la API read-only + endpoint de hold con webhook de estado? (bloquea Fase A/D — depende de T5.1).
3. **Bloqueo de unidad:** ¿se enforce con función Postgres en `real_estate_hub` o vía servicio del Hub? (recomendado: constraint + RPC en el esquema del Hub).
4. **Duración de coexistencia con Zoho** antes del cutover (Fase E).
5. **Multimoneda:** ¿FX congelado por cotización (recomendado) o tasa global?
6. **Atribución:** ¿`AdAttribution` se construye en el CRM o se lee del pipeline Meta del Hub? (evitar doble fuente).
7. **Picklists canónicos:** confirmar que los enums Prisma cuadran con los picklists ya canonizados en el Hub (33 valores) y Zoho.
8. **Autonomía de IA default por canal:** ¿L0 en correo / L2 en FAQ del chatbot? ¿quién aprueba subir de nivel?
9. **Bot: Claude-native vs ManyChat para arrancar** (ManyChat estaba diferido a mes 3+ de la estrategia). Recomendado Claude-native por control de marca.
10. **Voz IA fuera de horario:** alcance v1 (¿solo agendar/calificar?) y proveedor de síntesis de voz ES/EN.
11. **Cumplimiento MX:** consentimiento/aviso de grabación en llamadas y opt-out WhatsApp/SMS — confirmar requisitos.

---

## 10. REFERENCIAS (no duplicar)

- `propyte-crm/specs/crm-hub-migration-cleanup.md` — plan de migración CRM→Hub.
- `propyte-crm/specs/zoho-parity-matrix.md` — coexistencia/sync con Zoho.
- `Next_Propyte_web/SPECKIT-METAMORFOSIS-PROPYTE.md` (v3.0) — speckit del sitio.
- Análisis de configuración Zoho (sesión paralela) — módulos, campos, automatizaciones.
- Investigación de industria 2026 — speed-to-lead, ruteo, automatización conductual, modelo de preventa de desarrollador.

*Fin — SPECKIT Propyte CRM consolidado v1.1 (+ capa de IA y seguimiento automatizado).*
