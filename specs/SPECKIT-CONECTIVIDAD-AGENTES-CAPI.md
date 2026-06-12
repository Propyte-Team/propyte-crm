# SPECKIT — Conectividad, Agentes de IA & Conversions API (Propyte CRM)
### Agentes autónomos (estilo Zia) · Framework de conectores · Ingesta omnicanal · Gateway de Conversions API (Meta CAPI / Google / TikTok / LinkedIn) · Portales inmobiliarios

> **Companion #4.** Complementa el consolidado v1.1, el detallado v1.0 y personalización/equipos v1.0.
> **Base:** stack `propyte-crm` (Next.js + Prisma + Supabase + SDK de Anthropic + Twilio + Resend).
> **Investigación:** Zoho Zia Agents / Agent Studio / MCP (jul-2025 → Q1-2026) · Meta CAPI · TikTok Events API · LinkedIn Lead Sync + CAPI · portales MX. 
> **Versión:** 1.0 — 2026-06-10

---

## 0. SÍNTESIS DE LA INVESTIGACIÓN

### 0.1 Zoho Zia Agents (la dirección agentic)
Zoho pasó de IA **asistiva** a **agentic**: lanzó Zia LLM propietario, **25+ agentes pre-construidos**, **Agent Studio** no-code/low-code y un **servidor MCP** que abre sus acciones a agentes de terceros. Los agentes se aprovisionan como **"Digital Employees"** que operan **bajo la misma estructura de permisos que los usuarios humanos**, con 700+ acciones disponibles, y reasonan/ejecutan tareas multi-paso (no solo sugieren). En el roadmap: interoperabilidad **agente-a-agente (A2A)**. *Lección: el siguiente nivel no es "un bot que responde", es un agente con rol, permisos, herramientas y auditoría — como un empleado más.*

### 0.2 Conversions API (CAPI) — server-side, multi-plataforma
CAPI es envío **servidor-a-servidor**: manda eventos directo desde tu servidor a la plataforma, **no lo bloquea el navegador/iOS/Safari**, y para lead-gen **recupera 30–40% de conversiones perdidas**. Lo decisivo para inmobiliaria: permite mandar **eventos que el pixel nunca ve** — cambios de etapa del CRM, llamadas agendadas, contratos firmados. Y se puede mandar el **nivel de calidad del lead** desde el CRM para que la plataforma optimice por **compradores reales, no por llena-formularios**. Buenas prácticas: capturar el **click-id** al entrar el lead (`fbclid`/`gclid`/`ttclid`/`li_fat_id`), **deduplicar con `event_id`**, **hashear PII (SHA-256)**, batch + cola + reintentos con backoff + idempotencia, y monitorear **Event Match Quality (EMQ 0–10)**. `action_source = system_generated` para eventos de CRM.

### 0.3 TikTok & LinkedIn
- **TikTok:** *Lead Generation* (webhooks) para **ingesta** + *Events API / CRM Events API* para **devolver** el estatus del lead del CRM y optimizar con "Conversion Leads"; Pixel+Events API = ~19% más eventos y ~15% mejor CPA. Su *payload converter* acepta el formato de Meta CAPI (esquema unificable).
- **LinkedIn:** nuevo **Lead Sync API** unificado (consolida Ads + Events + fuentes orgánicas, con mapeo de campos) para **ingesta** + **Conversions API** para **devolver** conversiones. Webhooks con permiso `r_ads_leadgen_automation`. *(B2B — prioridad menor para Propyte, pero el patrón es idéntico.)*

### 0.4 Portales inmobiliarios MX
Mercado: **Inmuebles24** (líder, ~30% / 3.69M visitas-mes), **Vivanuncios** (hermano), **Propiedades.com**, **Lamudi/Proppit** (Proppit publica en 6 portales a la vez: iCasas, Trovit, Mitula…), y agregadores tipo **EasyBroker** (publican a múltiples portales con CRM integrado). Patrón de integración: extensión/feed **XML** o **API autenticada por API key**, bidireccional (publicar anuncios ↔ recibir leads). *Lección: conviene un agregador o un feed por portal, no integraciones a mano una por una.*

---

## 0.5 CONTRASTE — qué ya tenemos vs. qué falta

| Capacidad | Estado en speckits previos | Este doc |
|---|---|---|
| IA asistiva (chatbot, correo, voz, scoring) | ✅ consolidado §6 (L0–L2) | extiende a **L3 agentic** + infra |
| Motor de workflows | ✅ detallado §D | los agentes lo consumen |
| Meta Ads (ingesta) | ✅ vía Hub | se formaliza en framework |
| Export de conversiones a Google | ⚠️ campo suelto (detallado §B.4) | **Gateway CAPI multi-plataforma** |
| Agentes autónomos (Digital Employees) | ❌ | ✅ §2 |
| MCP / acciones expuestas a agentes | ❌ | ✅ §2.4 |
| Framework unificado de conectores | ❌ | ✅ §3 |
| Ingesta omnicanal (TikTok/LinkedIn/portales) | ⚠️ parcial (web webhook, Meta) | ✅ §4 |
| CAPI Meta/TikTok/LinkedIn (devolver eventos) | ❌ | ✅ §5 |
| Sindicación a portales + leads de portales | ❌ | ✅ §6 |

---

## 1. PRINCIPIOS

- **PA1 — Agente = empleado digital gobernado.** Todo agente autónomo se aprovisiona como un `User` con **rol, permisos (RBAC), herramientas y auditoría**, igual que un humano. Nunca actúa fuera de sus permisos.
- **PA2 — Guardarraíles de marca y data-gate sobre TODO agente.** Heredan §6.0 del consolidado: voz Sage + linter de frases prohibidas + data-gate (cifras solo del Hub). Un agente **nunca cierra ni firma**; agenda, califica, nutre, reportea. Respeta `doNotContact`/opt-out.
- **PA3 — Autonomía graduada con escalado.** L0 sugiere · L1 1-clic · L2 autónomo en FAQ/agenda · **L3 autónomo multi-paso con red** (ejecuta secuencias, escala a humano ante intención fuerte, monto alto o duda). El nivel se configura por agente y por acción.
- **PA4 — Conectar es configurar, no programar.** Toda plataforma nueva entra por el **framework de conectores** (registro + credenciales + mapeo + sync), no como integración bespoke.
- **PA5 — Eventos de salida de primera clase.** Las conversiones que el CRM conoce (lead calificado, apartado, ganado, + calidad del lead) se **devuelven** a las plataformas por CAPI para optimizar campañas hacia compradores.
- **PA6 — Respetar el SOT.** El **Hub** sindica el **catálogo** a portales (es dueño del inventario/CMS). El **CRM** ingiere **leads** de portales y devuelve **conversiones**. No se duplica catálogo.
- **PA7 — Privacidad por diseño.** PII hasheada (SHA-256) antes de salir; consentimiento y `action_source` correctos; bóveda de credenciales cifrada; nada de tokens en client-side.

---

## 2. CAPA DE AGENTES DE IA (estilo Zia, nativa con Claude)

### 2.1 Modelo del agente
**`agents`** (NUEVO): `id, name, type (PREBUILT|CUSTOM), systemUserId (FK→User, su identidad/RBAC), goal, autonomyLevel (L0–L3), brandProfile (Sage), allowedTools String[] (ver §2.4), trigger jsonb, schedule?, isActive`.
**`agent_runs`** (log): `id, agentId, trigger, input jsonb, steps jsonb (razonamiento+tool calls), output, status, escalatedToUserId?, startedAt, endedAt`.
Cada paso de un agente escribe `Activity` + `AuditLog` (trazable como un humano).

### 2.2 Agentes pre-construidos para Propyte
| Agente | Rol | Acciones (autonomía) |
|---|---|---|
| **Speed-to-lead / SDR** | primer contacto <5 min | saluda por WhatsApp, pre-califica, agenda, asigna (L3 con escalado) |
| **Calificador (bot)** | discovery conversacional | llena perfil de inversión, scoring, matching de unidades del Hub (L2) |
| **Follow-up / Nurture** | seguimiento por etapa | secuencias conductuales, reactivación de dormidos (L1/L2) |
| **Cobranza** | parcialidades | recordatorios D+1/7/15, escala a humano (L1) |
| **Sales Coach** | apoyo al asesor | resume timeline, sugiere next-best-action, detecta riesgos del deal (L0) |
| **Reporting** | Dirección | arma reportes/insights bajo demanda (estilo Ask Zia) (L1) |

### 2.3 Agent Studio (constructor no-code)
Panel para definir un agente con: **prompt** (rol + voz de marca inyectada), **herramientas** permitidas, **nivel de autonomía**, **trigger** (evento/horario/inactividad del §D), y **límites** (horario, opt-out, tope de monto). Versiona y audita. Reusa el registro de metadata (companion #3) para saber qué campos/objetos puede tocar.

### 2.4 MCP — acciones del CRM como herramientas
Un **servidor MCP** expone las funciones del CRM (detallado §C: `captureLead`, `scoreContact`, `advanceStage`, `requestUnitHold`, `generateQuote`, `sendWhatsApp`, `matchUnitsToLead`, etc.) como **tools** tipadas. Beneficio doble:
- Los **agentes internos** (Claude vía SDK de Anthropic) las invocan con autonomía gobernada.
- **Agentes externos** (p.ej. Claude Cowork, o incluso el MCP de Zoho durante la coexistencia) pueden operar el CRM con permisos acotados.
Toda tool valida RBAC del `systemUserId` del agente + guardarraíles (PA2).

### 2.5 Orquestación A2A
Agentes con skills complementarios se encadenan (ej.: SDR capta → Calificador perfila → Follow-up nutre → Sales Coach asiste al humano en el cierre). Un orquestador enruta por evento; cada handoff queda en `agent_runs` + timeline.

> **Relación con §6 del consolidado:** §6 definió la capa asistiva (L0–L2) y sus guardarraíles; **este §2 agrega el tier agentic (L3), el modelo de agente-como-usuario, Agent Studio y MCP.** Mismos guardarraíles, más autonomía e infraestructura.

---

## 3. FRAMEWORK UNIFICADO DE CONECTORES

> Objetivo: que sumar TikTok, un portal o LinkedIn sea **configuración**, no un proyecto. Una sola abstracción inbound/outbound (filosofía Zoho Marketplace).

### 3.1 Componentes
- **Connector registry** (`connectors`): `id, platform (META|GOOGLE|TIKTOK|LINKEDIN|INMUEBLES24|LAMUDI_PROPPIT|PROPIEDADES|VIVANUNCIOS|EASYBROKER|ZAPIER|CUSTOM), direction (INBOUND|OUTBOUND|BOTH), authType (OAUTH2|API_KEY|WEBHOOK), status, config jsonb`.
- **Credential vault** (`connector_credentials`): tokens/keys **cifrados** (nunca client-side), refresh OAuth automático.
- **Webhook gateway**: endpoints firmados (HMAC) para ingesta en tiempo real (Meta/TikTok/LinkedIn/portales/web).
- **Field-mapping layer** (`field_mappings`): mapea campos de la plataforma ↔ `Contact`/`Deal` (reusa el registro de metadata #3). Replica la lógica de "CELDAS DE APOYO" del Excel actual.
- **Sync engine**: cola + reintentos con backoff + idempotencia + rate-limit por plataforma.
- **Observabilidad** (`connector_logs`): éxito/fallo, latencia, EMQ, errores por plataforma; alertas.

### 3.2 Coordinación con el Hub
Meta (ingesta de ads/leads/spend) se **centraliza en el Hub** (consolidado §3.4): el CRM **consume** del Hub, no integra Meta dos veces. Los demás canales pueden entrar directo al CRM o vía Hub según convenga (OQ §9).

---

## 4. INGESTA OMNICANAL DE LEADS (INBOUND)

### 4.1 Canales y método
| Canal | Método de ingesta | Click-id a capturar |
|---|---|---|
| Meta Lead Ads | vía Hub → CRM | `fbclid` / Social Lead ID |
| Google Ads | landing/web webhook | `gclid` |
| TikTok Lead Gen | webhook (TikTok Custom API) | `ttclid` |
| LinkedIn | **Lead Sync API** + webhook | `li_fat_id` |
| Portales (Inmuebles24, Lamudi, Propiedades, Vivanuncios) | webhook/feed o agregador (EasyBroker/Proppit) | portal lead id |
| Web propio | webhook → CRM (ya definido) | utm + gclid/fbclid |
| WhatsApp entrante | Twilio → CRM | — |

### 4.2 Flujo unificado
`webhook gateway` → normaliza al **esquema de lead único** (nombre, teléfono E.164, email, idioma, desarrollo de interés, source, click-id) → **dedup** (phone/email) → crea/actualiza `Contact` + `AdAttribution` → dispara **ruteo + SLA <5 min** (detallado §D) y, si aplica, el **agente Speed-to-lead** (§2.2). El click-id se **persiste desde el primer toque** (requisito para CAPI, §5).

---

## 5. GATEWAY DE CONVERSIONS API (OUTBOUND / "DEVOLVER INFORMACIÓN")

> Esto es el "manejo de CAPI en Meta para reenviar información" — generalizado a todas las plataformas. El CRM **sabe** cuándo un lead se califica/aparta/gana; lo **devuelve** para que los algoritmos optimicen hacia compradores.

### 5.1 Esquema de evento único → adaptadores por plataforma
**`conversion_events`** (outbound log): `id, contactId, dealId?, eventName (Lead|Qualified|MeetingScheduled|Reserved|Won), eventId (dedup), occurredAt, value?, currency, leadQualityTier, clickIds jsonb, hashedPII jsonb, platforms String[], status, emq?`.
Un **adaptador por plataforma** traduce el evento al payload nativo:
- **Meta CAPI:** `action_source=system_generated`, `event_id` (dedup vs pixel), PII SHA-256, envía calidad del lead.
- **Google:** enhanced/offline conversions con `gclid`.
- **TikTok Events API / CRM Events API:** estatus de lead para "Conversion Leads" (acepta formato Meta vía su converter).
- **LinkedIn CAPI:** conversión con `li_fat_id`.

### 5.2 Qué eventos mandar (mapeados al pipeline)
| `DealStage` → | Evento a plataformas | Por qué |
|---|---|---|
| lead capturado | `Lead` | base |
| `DISCOVERY_DONE` + score alto | `Qualified` (+ tier) | **optimizar por calidad, no volumen** |
| `MEETING_SCHEDULED` | `MeetingScheduled` | señal media-baja del funnel |
| `RESERVED` | `Reserved` (+ value) | señal fuerte de compra |
| `WON` | `Won` (+ value MXN) | cierre real → optimización por ROI |

### 5.3 Garantías
Batch + cola async + reintentos con backoff + **idempotencia por `event_id`**; PII hasheada; monitoreo de **EMQ** y error-codes por plataforma; respeta consentimiento/opt-out. **Dedup con el pixel** y **sender único por plataforma** (evitar que Hub y CRM manden el mismo evento — OQ §9).

---

## 6. CONECTIVIDAD CON PORTALES INMOBILIARIOS

> Bidireccional, con frontera de SOT clara.

### 6.1 Sindicación de anuncios (OUT) — la hace el **Hub**
El Hub (dueño del catálogo/CMS) publica desarrollos/unidades a portales vía **feed XML por portal** o **API/agregador** (EasyBroker/Proppit publican a varios a la vez). El CRM **no** sindica catálogo. Estados de publicación y mapeo de campos viven en el Hub.

### 6.2 Ingesta de leads de portales (IN) — la hace el **CRM**
Cada portal entrega leads por **webhook/extensión/feed**; entran por el framework de conectores (§3) → esquema único → dedup → ruteo/SLA (§4). Se etiqueta `leadSource = PORTAL_INMOBILIARIO` + `leadSourceDetail = <portal>`.

### 6.3 Portales objetivo (MX)
Inmuebles24, Vivanuncios, Propiedades.com, Lamudi/Proppit; **EasyBroker** como posible agregador (publica a múltiples + CRM-friendly). Priorizar por tráfico/leads y por el modelo de Propyte (desarrollos/preventa → Lamudi e Inmuebles24 pesan más).

---

## 7. ADICIONES AL MODELO DE DATOS (resumen)

`agents` · `agent_runs` · `connectors` · `connector_credentials` · `field_mappings` · `connector_logs` · `conversion_events`.
En `Contact`/`AdAttribution`: asegurar `fbclid`, `gclid`, `ttclid`, `li_fat_id`, `portalLeadId`, `consentFlags`. (Varios ya propuestos en detallado §B.4 — aquí se completan los click-ids multi-plataforma.)

---

## 8. ROADMAP (encaja con las fases previas)

- **Fase C1 — Framework de conectores + ingesta omnicanal.** Registro + vault + webhook gateway + mapeo; activar TikTok Lead Gen y al menos 1 portal (Inmuebles24 o Lamudi). *(habilita más fuentes para el speed-to-lead).*
- **Fase C2 — Gateway de Conversions API.** Esquema de evento único + adaptador **Meta CAPI** primero (devolver Qualified/Reserved/Won + calidad), luego Google/TikTok/LinkedIn. *(cierra el loop de optimización).*
- **Fase C3 — Capa de agentes.** MCP server (acciones del CRM como tools) + agentes pre-construidos (Speed-to-lead, Calificador) en L2 → L3 con guardarraíles; luego Agent Studio.
- **Fase C4 — Sindicación a portales (Hub) + A2A.** Feed/agregador de salida desde el Hub; orquestación agente-a-agente.

> Guardarraíles de marca/data-gate y RBAC-de-agentes: **condición de salida** de toda feature de IA/conector, no una fase.

---

## 9. OPEN QUESTIONS

1. **Sender único de conversiones:** ¿el CRM manda CAPI directo, o vía el pipeline Meta del Hub? (evitar doble envío; recomendado: CRM dueño de eventos comerciales, Hub dueño de ingesta de ads).
2. **Agregador de portales:** ¿usar EasyBroker/Proppit como hub de sindicación + leads, o integrar portales uno a uno por feed/API?
3. **Autonomía máxima de agentes v1:** ¿se permite L3 (multi-paso autónomo) en producción desde el inicio, o se arranca L2 y se sube con métricas?
4. **MCP externo:** ¿exponer el servidor MCP a agentes de terceros (Zoho/Cowork) ahora, o solo a agentes internos primero? (superficie de seguridad).
5. **LinkedIn:** ¿entra en alcance v1 (B2B, brokers institucionales) o se difiere?
6. **Consentimiento/PII:** confirmar política de hashing + consentimiento por canal para cumplir con plataformas y normativa MX.
7. **Calidad del lead a plataformas:** ¿qué umbral de `score`/etapa define "Qualified" que se devuelve a Meta/TikTok? (afecta la optimización).

*Fin — Speckit Conectividad, Agentes & Conversions API v1.0.*
