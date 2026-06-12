# SPECKIT MAESTRO — Propyte CRM
### El CRM inmobiliario operativo, seguro, agentic y minimalista de Propyte

> **Version:** 2.0 — 2026-06-12  
> **Base:** `propyte-crm` (Next.js 14, Prisma, Supabase `propyte_crm`, NextAuth, Twilio, Resend, Anthropic, CAPI).  
> **Este documento consolida:** `SPECKIT-PROPYTE-CRM-CONSOLIDADO.md`, `SPECKIT-ANEXO-TECNICO.md`, `SPECKIT-ANEXO-B-MULTICANAL-PERFILES.md`, `SPECKIT-PERSONALIZACION-Y-EQUIPOS.md`, `SPECKIT-CONECTIVIDAD-AGENTES-CAPI.md`, `SPECKIT-DISENO-WEB-MINIMALISTA.md`, `SPECKIT-GOOGLE-WORKSPACE.md`, `SPECKIT-PLATAFORMA-SEGURIDAD-EXPERIENCIA-PROPYTE-CRM.md` y la auditoria tecnica del 2026-06-12.
> **Regla:** este speckit maestro es la fuente de verdad de producto. Los speckits previos quedan como anexos historicos y detalle tecnico.

---

## 0. Veredicto de Estado Actual

### 0.1 Estado honesto

El proyecto **no esta terminado**. Existe una base amplia y valiosa: schema grande, modulos de CRM, workflows, inbox, cotizador, CAPI, agentes, metadata y UI inicial. Pero el sistema actual esta en estado **MVP/rebuild parcial**, no en estado de CRM inmobiliario de produccion.

La evidencia principal:

- El build de produccion falla por un campo inexistente: `hubUnitStatus` se intenta actualizar en `src/app/api/webhooks/hub-unit/route.ts`, pero no existe en `Deal`.
- El speckit exige que el CRM no posea inventario, pero el schema conserva `Development` y `Unit` locales.
- El deal form y la pagina de desarrollos todavia usan catalogo local, no el Hub como SOT.
- El cotizador pide manualmente un UUID de unidad del Hub.
- Las cadencias no tienen builder visual; se crean via API o quedan para “proxima fase”.
- Google/LinkedIn CAPI son stubs.
- No hay suficiente cobertura E2E, permisos/RLS reales por territorio, UX completa, ni QA visual integral.

### 0.2 Principio de salida

Una feature solo cuenta como terminada si cumple:

1. Schema y migracion aplicada.
2. API/servicio funcional.
3. UI usable por el rol objetivo.
4. Permisos y auditoria aplicados.
5. Estados vacios, errores y loading resueltos.
6. Tests unitarios o de integracion segun riesgo.
7. Smoke E2E del flujo principal.
8. Build verde.
9. Documentacion operativa minima.

Schema creado o endpoint cableado **no equivale** a feature terminada.

---

## 1. Vision de Producto

Propyte CRM debe ser el sistema comercial propio de Propyte: un CRM inmobiliario nativo para preventa, desarrollos, brokers, inversionistas, walk-ins, WhatsApp, cotizaciones, seguimiento, comisiones, cobranza, cumplimiento y direccion.

Debe superar a Zoho en lo que importa para Propyte:

- Speed-to-lead real menor a 5 minutos.
- Inventario siempre consistente contra el Hub.
- Timeline unificada por contacto/deal.
- WhatsApp-first con takeover humano.
- Cotizacion inmobiliaria profesional.
- Agentes IA gobernados, no bots sueltos.
- Automatizacion conductual.
- Dashboards de direccion accionables.
- Seguridad, cumplimiento y auditoria desde la base.
- UI minimalista, densa, elegante y rapida.

El CRM no debe sentirse como SaaS generico. Debe sentirse como una herramienta interna premium: sobria, precisa, rapida, con datos trazables y flujos pensados para asesores inmobiliarios reales.

---

## 2. Mapa del Ecosistema y SOT

Todo vive sobre una Supabase compartida con esquemas separados:

| Dominio | Sistema dueño | CRM hace |
|---|---|---|
| Desarrollos, unidades, media, editorial, SEO | `Propyte_hub` / `real_estate_hub` | Lee por API/proyeccion. Nunca edita catalogo. |
| Disponibilidad, holds, venta de unidad | Hub | Solicita hold/reserva/liberacion. Hub ejecuta atomicidad. |
| Leads, contactos, deals, actividades | CRM | Es SOT comercial objetivo. |
| WhatsApp, SMS, llamadas, timeline | CRM | Es dueño operativo. |
| Cotizaciones, planes de pago, documentos | CRM | Crea y conserva snapshot comercial. |
| Comisiones | CRM | Calcula, audita y reporta. |
| Meta Ads / catalogo ads | Hub para ingesta/ads; CRM para conversiones comerciales | Evitar doble envio. |
| Zoho | SOT comercial temporal / archivo futuro | Coexistencia hasta cutover. |
| Web publica | Next_Propyte_web | Emite leads al CRM. |

### 2.1 Frontera critica

El CRM **no posee inventario**. `Development` y `Unit` locales deben eliminarse o quedar solo como cache/proyeccion temporal sin capacidad de escritura. Todo hold, release, sold, disponibilidad y anti-doble-venta vive en el Hub.

---

## 3. Constitucion del CRM

- **P1 — Inventario Hub-first.** CRM referencia `hubDevelopmentId`, `hubUnitId`, `holdId`, nunca decide disponibilidad por si mismo.
- **P2 — Speed-to-lead <5 min.** Lead nuevo debe tener owner, primer toque y SLA corriendo en segundos.
- **P3 — WhatsApp-first.** WhatsApp es canal primario; email y llamada son secundarios pero integrados.
- **P4 — Timeline unica.** Contacto/deal muestran WhatsApp, SMS, email, llamadas, notas, tareas, documentos, cotizaciones y cambios de etapa.
- **P5 — IA gobernada.** Toda salida IA pasa por voz Sage, data-gate, opt-out, permisos y auditoria.
- **P6 — Humano en el lazo.** IA califica, agenda, resume, sugiere y nutre; nunca firma ni cierra.
- **P7 — Configurable sin caos.** Metadata-driven, pero con gobernanza anti-sprawl.
- **P8 — Seguro por defecto.** RBAC, field-level security y record-level security desde DB.
- **P9 — Minimalismo operativo.** Blanco/negro, color solo como señal; datos y acciones por encima de decoracion.
- **P10 — Producto completo, no demo.** Una feature no termina sin UX, permisos, pruebas, build y smoke.

---

## 4. Arquitectura Objetivo

### 4.1 Capas

1. **Core comercial:** contactos, deals, pipeline, actividades, tareas, comisiones.
2. **Inventario externo:** API Hub read-only + holds/reservas via Hub.
3. **Automatizacion:** eventos, reglas, action queue, SLA, cadencias.
4. **Comunicacion:** WhatsApp Cloud/Twilio, SMS, voz, email, Google Calendar/Gmail.
5. **IA agentic:** agentes como usuarios, tools, MCP, Agent Studio.
6. **Conectores:** webhooks, Meta/TikTok/Google/LinkedIn/portales, CAPI.
7. **Personalizacion:** objetos, campos, layouts, relaciones, vistas.
8. **Seguridad/compliance:** RLS, MFA, consentimientos, ARCO, retencion, auditoria.
9. **Experiencia:** vistas guardadas, busqueda global, command palette, PWA, i18n.

### 4.2 Contratos de integracion

#### CRM ↔ Hub

- `GET /api/catalog/developments`
- `GET /api/catalog/developments/:id`
- `GET /api/catalog/units?filters`
- `GET /api/catalog/units/:id`
- `POST /api/inventory/units/:id/hold`
- `POST /api/inventory/holds/:id/release`
- `POST /api/inventory/holds/:id/confirm`
- Webhook Hub→CRM: `unit.status_changed`, `hold.expired`, `hold.confirmed`, `unit.sold`.

El Hub debe garantizar atomicidad con constraint/RPC/transaccion. El CRM solo consume resultado.

#### Web → CRM

La web debe emitir leads al CRM por webhook unico:

```json
{
  "firstName": "Luis",
  "lastName": "Perez",
  "phone": "+529841234567",
  "email": "luis@example.com",
  "preferredLanguage": "ES",
  "hubDevelopmentId": "uuid",
  "utm": {},
  "gclid": "...",
  "fbclid": "...",
  "source": "WEBSITE"
}
```

El CRM deduplica, enruta, dispara SLA, crea atribucion y activa agente SDR si corresponde.

#### CRM ↔ Zoho

Coexistencia controlada hasta cutover:

- Mapeo de modulos y picklists.
- Importacion/consolidacion de contactos y deals.
- Paridad de reportes durante N dias.
- Freeze de edicion en Zoho.
- CRM pasa a SOT comercial.

---

## 5. Modelo de Datos Maestro

### 5.1 Core existente que se conserva

- `User`
- `Contact`
- `Deal`
- `Activity`
- `Message`
- `Conversation`
- `CommissionRule`
- `WalkIn`
- `Notification`
- `AuditLog`
- `ApiKey`
- `WebhookConfig`

### 5.2 Modelos que deben convertirse o eliminarse

- `Development`
- `Unit`

Estado objetivo:

- Eliminados del schema local, o convertidos temporalmente a cache read-only.
- Ningun flujo de negocio debe escribir disponibilidad local.
- `Deal` debe guardar `hubDevelopmentId`, `hubUnitId`, `holdId`, `holdExpiresAt`, `hubUnitSnapshot`.

### 5.3 Campos/entidades comerciales requeridos

#### Contacto

- `contactStatus`: NUEVO, SIN_RESPUESTA, CONTACTADO, EN_SEGUIMIENTO, DESCARTADO.
- `urgency`: ALTA, MEDIA, BAJA.
- `lastActivityAt`.
- `originalCreatedAt`.
- `doNotContact`.
- `whatsappOptOut`.
- `recordingConsent`.
- `mergedIntoId`.
- `zohoId`.
- `hubContactId`.
- `custom jsonb`.

#### Expediente/KYC

`ContactDossier` con PII cifrada:

- documento, nacimiento, estado civil, ocupacion, RFC/TAX ID, regimen fiscal, domicilio.
- Acceso restringido a asesor asignado, direccion, cobranza/admin.

#### Atribucion

`AdAttribution`:

- UTM, gclid, fbclid, ttclid, liFatId, portalLeadId.
- campaña/adset/ad.
- firstTouch/lastTouch.
- cost/cpc/cpa si aplica.
- conversion export status.

#### Comportamiento web

`WebBehavior`:

- paginas vistas, primera/ultima pagina, sesiones, chats, visitor score, eventos de unidad.

#### Deal

Campos requeridos:

- `hubDevelopmentId`, `hubUnitId`, `holdId`, `holdExpiresAt`, `hubUnitSnapshot`.
- `reservedAt`, `contractSignedAt`, `deedAt`, `deliveredAt`.
- `externalBrokerId`.
- `custom jsonb`.
- `previousStage` para reactivar `FROZEN`.

#### Cotizacion/cobranza/documentos

- `Quote`
- `PaymentPlan`
- `PaymentSchedule`
- `DealDocument`
- `ExternalBroker`

Requisito: cotizacion congela precio, unidad, FX, descuento, condiciones y fuente del dato al momento de emitir.

---

## 6. Pipeline y Ciclo Comercial

### 6.1 Etapas

| Etapa CRM | Equivalente Zoho | Probabilidad base |
|---|---|---|
| `NEW_LEAD` | pre-Demo | 5% |
| `CONTACTED` | pre-Demo | 8% |
| `DISCOVERY_DONE` | Demo | 10% |
| `MEETING_SCHEDULED` | Recorrido | 20% |
| `MEETING_COMPLETED` | Recorrido | 30% |
| `PROPOSAL_SENT` | Propuesta | 40% |
| `NEGOTIATION` | Propuesta | 50% |
| `RESERVED` | Apartado | 65% |
| `CONTRACT_SIGNED` | Firma | 80% |
| `CLOSING` | Escritura | 90% |
| `WON` | Postventa | 100% |
| `LOST` | Perdido | 0% |
| `FROZEN` | Pausado | conserva etapa previa |

### 6.2 Guardas de etapa

- `RESERVED` exige hold confirmado en Hub.
- `CONTRACT_SIGNED` exige documentos minimos y KYC requerido.
- `WON` exige contrato/cierre y datos de valor.
- `LOST` exige `lostReason`.
- `FROZEN` exige fecha/motivo de reactivacion.
- Cambios de etapa escriben `Activity`, `AuditLog`, evento workflow y posible CAPI.

### 6.3 Deal detail objetivo

La pantalla de deal debe tener:

- Header compacto: etapa, valor, asesor, contacto, unidad, SLA.
- Riel lateral: unidad Hub, precio, fuente, cotizaciones, documentos, comision, proximas acciones.
- Timeline central: todas las interacciones.
- Acciones principales: llamar, WhatsApp, agendar, cotizar, apartar, avanzar etapa.
- Next-best-action IA.
- Checklist por etapa.

---

## 7. Modulos de Producto

### 7.1 Vista Hoy del Asesor

Pantalla inicial para asesores:

- Leads nuevos sin tocar.
- SLA en riesgo.
- Tareas vencidas y de hoy.
- Conversaciones sin responder.
- Visitas agendadas.
- Deals calientes.
- Cotizaciones abiertas.
- Recomendacion IA de siguiente accion.

Debe ser simple: el asesor debe saber que hacer en menos de 10 segundos.

### 7.2 Contactos

- Lista tabla/kanban por estado.
- Vistas guardadas.
- Filtros por fuente, temperatura, asesor, zona, presupuesto, etapa.
- Importacion CSV con dedup.
- Merge guiado.
- Perfil comercial + timeline + deals + documentos + consentimiento.

### 7.3 Pipeline

- Kanban 13 etapas.
- Tabla avanzada.
- Drag/drop con dialogo de transicion y guardas.
- Bulk actions.
- Forecast por etapa.
- Alertas de SLA y huérfanos.

### 7.4 Inbox WhatsApp

- Tres paneles: conversaciones, hilo, contexto.
- Bot/humano/takeover.
- Notas internas.
- Plantillas y atajos.
- Opt-out.
- Resumen IA.
- Mensajes con estado.
- Filtros: mias, bot, humanas, sin leer, SLA.

### 7.5 Cotizador

Debe reemplazar captura manual de UUID por selector real:

- Buscar unidad del Hub.
- Ver disponibilidad en tiempo real.
- Comparar 2-3 unidades.
- Congelar snapshot.
- Configurar descuento con permisos.
- Esquemas: contado, financiamiento directo, credito bancario, mixto.
- Plan de pagos editable.
- PDF/landing compartible.
- Tracking de envio, apertura y vencimiento.
- Enviar por WhatsApp/email.
- Convertir apertura/interes a evento de workflow.

### 7.6 Cobranza

- Aging de parcialidades.
- Recordatorios automaticos.
- Registro de pagos.
- Escalamiento.
- Estado por deal/cliente.
- Reporte de cobranza 30/60/90.

### 7.7 Comisiones

- Reglas por deal type, fuente, rol y broker.
- Calculo en firma/cierre.
- Estados: pendiente, facturada, pagada.
- Split broker externo.
- Auditoria y bloqueo por permisos.

### 7.8 Walk-ins

- Captura mobile/tablet.
- Asignacion inmediata.
- Conversion a contacto/deal.
- Medicion por sala/hostess/asesor.
- Firma de consentimiento/aviso si aplica.

### 7.9 Reportes direccion

- Funnel por etapa, asesor, fuente, zona, desarrollo.
- SLA por asesor/equipo.
- Conversion lead→visit→quote→reserved→won.
- Forecast.
- Comisiones.
- Cobranza.
- Campañas y CAPI.
- Inventario consultado desde Hub.

---

## 8. Automatizacion y Workflows

### 8.1 Motor

Arquitectura:

`domain event → WorkflowEvent → RuleEngine → ActionQueue → ActionRunner → Activity/AuditLog`

Debe soportar:

- Triggers por evento, etapa, tiempo, inactividad, SLA breach, score.
- DSL de condiciones `all/any`.
- Acciones: task, WhatsApp, email, call, assign, notify, update field, tag, stage, enroll plan, escalate, AI draft/reply/summary, webhook.
- Idempotencia por `dedupeKey`.
- Cooldown.
- Retry con backoff.
- Observabilidad.

### 8.2 Workflows canonicos

1. Lead digital nuevo: dedup, routing, SLA 5 min, bot saluda, notifica asesor.
2. Speed-to-lead dialer: si horario laboral, call flow inmediato.
3. Anti-huérfano: sin toque 24/48h, re-ruteo y alerta.
4. Post-visita sin cotizacion: tarea + draft IA.
5. Apartado a firma: checklist KYC/documentos.
6. Pago vencido: WhatsApp, llamada, escalamiento.
7. Reactivacion dormidos: matching de unidad + secuencia.
8. Postventa: bienvenida, encuesta, referidos.

### 8.3 Builder visual

El CRM debe tener un builder de workflows/cadencias:

- Trigger.
- Condiciones.
- Acciones.
- Delay.
- Autonomia IA.
- Preview de afectados.
- Simulacion sobre un contacto/deal.
- Versionado y rollback.

---

## 9. Personalizacion, Equipos y Relaciones

### 9.1 Equipos y territorios

Separar:

- Jerarquia RH: `User.teamLeaderId`, carrera, rol.
- Territorios: matriz de visibilidad/asignacion por plaza/zona/segmento.

Modelos:

- `Team`
- `TeamMember`
- `Territory`
- `TerritoryMember`
- `TerritoryRule`

Reglas:

- El ruteo resuelve primero territorio, despues asesor.
- Team Leader ve descendientes.
- Asesor ve lo suyo y lo permitido por territorio.
- Direccion ve todo.
- Baja/suspension de usuario exige reasignacion.

### 9.2 Editor de objetos/campos

Metadata-driven:

- `custom_objects`
- `custom_fields`
- `field_options`
- `layouts`
- `layout_sections`
- `layout_fields`
- `field_permissions`

Principios:

- Campos core son columnas Prisma.
- Campos custom viven en `custom jsonb`.
- Searchable se promueve a indice/columna generada si realmente se usa.
- `apiName` es inmutable.
- Borrado es archivado.
- Solo admin crea campos.
- Detector de duplicados semanticos.
- AuditLog siempre.

### 9.3 Relaciones

Modelos:

- `relationships`
- `relationship_labels`
- `lookup_projections`
- `rollup_fields`
- `record_links`

Tipos:

- LOOKUP.
- MASTER_DETAIL.
- MANY_TO_MANY.

UI requerida:

- Picker typeahead.
- Listas relacionadas.
- Proyeccion de lookup.
- Busqueda global multi-modulo.
- Seguridad por campo/record.

---

## 10. Conectividad, CAPI y Portales

### 10.1 Framework de conectores

Todo canal entra por:

- Registro de conector.
- Vault de credenciales cifrado.
- Mapeo de campos.
- Webhook gateway firmado.
- Sync engine con cola/reintentos.
- Logs y observabilidad.

Proveedores:

- Meta.
- Google.
- TikTok.
- LinkedIn.
- Website.
- WhatsApp.
- Zapier.
- Inmuebles24.
- Lamudi/Proppit.
- Propiedades.com.
- Vivanuncios.
- EasyBroker.
- Custom.

### 10.2 Ingesta omnicanal

Canales:

- Web propia.
- Meta via Hub.
- TikTok Lead Gen.
- Google Ads landing/webhook.
- LinkedIn Lead Sync.
- Portales inmobiliarios.
- WhatsApp entrante.
- Walk-in.
- Referidos.
- Brokers.

Todos normalizan a `IncomingLead`, deduplican y disparan ruteo/SLA.

### 10.3 Gateway CAPI

Eventos:

- Lead.
- Qualified.
- MeetingScheduled.
- Reserved.
- Won.

Garantias:

- `event_id` idempotente.
- SHA-256 de PII.
- Click IDs persistidos.
- Cola async.
- Backoff.
- EMQ/error monitoring.
- Consentimiento/opt-out.
- Sender unico por plataforma para evitar duplicados Hub/CRM.

Prioridad:

1. Meta CAPI real.
2. TikTok Events API real.
3. Google offline/enhanced conversions.
4. LinkedIn CAPI.

### 10.4 Portales

- Hub sindica catalogo/anuncios.
- CRM ingiere leads de portales.
- Portal lead id debe persistirse.
- Usar agregador si reduce mantenimiento.

---

## 11. Agentes IA

### 11.1 Principios

- Agente = empleado digital con `User`, rol, permisos, herramientas y auditoria.
- No actua fuera de RBAC/RLS.
- Respeta voz Sage, data-gate y opt-out.
- Escala a humano ante intencion fuerte, queja, temas legales/fiscales, monto alto o incertidumbre.

### 11.2 Niveles

- L0: sugiere.
- L1: prepara y requiere aprobacion 1 clic.
- L2: autonomo en FAQ/agenda/primer toque con red.
- L3: multi-paso con limites y escalado.

### 11.3 Agentes preconstruidos

- SDR Speed-to-lead.
- Calificador.
- Follow-up/Nurture.
- Cobranza.
- Sales Coach.
- Reporting/Ask Propyte.

### 11.4 Agent Studio

Debe permitir:

- Crear/editar agente.
- Prompt con voz de marca inyectada.
- Herramientas permitidas.
- Autonomia.
- Triggers.
- Horarios.
- Limites.
- Preview/simulacion.
- Versionado.
- Auditoria.

### 11.5 Tools/MCP

Tools internas:

- `captureLead`
- `scoreContact`
- `advanceStage`
- `requestUnitHold`
- `generateQuote`
- `sendWhatsApp`
- `sendEmail`
- `matchUnitsToLead`
- `createTask`
- `summarizeTimeline`
- `escalateToHuman`

Exponer MCP externo solo cuando seguridad y scopes esten listos.

---

## 12. Google Workspace y Conectividad Diaria

### 12.1 SSO

Google Workspace debe ser login principal.

### 12.2 Email

Opciones:

- BCC-to-CRM como v1 rapida.
- OAuth Gmail bidireccional como objetivo.

Funciones:

- Enviar desde CRM.
- Registrar correos en timeline.
- Plantillas.
- Firma.
- Triage IA.
- Opt-out.

### 12.3 Calendar

- Actividades/visitas crean eventos.
- Eventos de calendar pueden reflejarse en CRM.
- Recordatorios.
- Links de agenda.

### 12.4 Contactos

- Sync limitado y gobernado.
- Evitar que Google Contacts se vuelva SOT.

---

## 13. Seguridad y Cumplimiento

### 13.1 Autenticacion

- Google SSO.
- Email/password fallback.
- MFA para roles sensibles.
- Politicas de sesion.
- Revocar sesiones.
- Impersonation solo auditada y con banner.

### 13.2 Autorizacion

Tres capas:

1. RBAC por rol.
2. Field-level security.
3. Record-level security via RLS por asesor/equipo/territorio.

La UI no es frontera de seguridad. La DB/API debe enforcear.

### 13.3 Privacidad y LFPDPPP

Modelos requeridos:

- `consent_records`
- `data_retention_policies`
- `arco_requests`
- marca de datos sensibles.

Requisitos:

- Aviso de privacidad por punto de captura.
- Versionado de consentimiento.
- Derechos ARCO.
- Bloqueo y supresion segun politica.
- KYC cifrado.
- PII nunca en logs.

### 13.4 Seguridad app

- Zod en todos los endpoints.
- Rate limiting login/API/webhooks.
- Webhooks firmados HMAC.
- Secrets solo en env/vault.
- AuditLog para metadata, permisos, agentes, exportaciones, impersonation y acciones sensibles.
- Alertas por exportaciones/accesos anomalos.

---

## 14. Experiencia, Vistas y Navegacion

### 14.1 Vistas

`saved_views`:

- owner.
- module.
- filters DSL.
- columns.
- sort.
- viewType: table, kanban, calendar, map.
- scope: personal, team, org.
- default.

Acciones:

- Guardar vista.
- Compartir.
- Column chooser.
- Densidad.
- Bulk actions.
- Export con permisos.

### 14.2 Busqueda

- Busqueda global contactos/deals/unidades Hub/documentos.
- Command palette.
- Atajos para power users.

### 14.3 PWA/movil

- Responsive real.
- Click-to-call.
- WhatsApp en un toque.
- Vista Hoy mobile.
- Disponibilidad de unidades en vivo.
- Escrituras criticas fallan cerrado si no hay red.

### 14.4 i18n

- ES/EN completo.
- Idioma de usuario y contacto.
- Formato local de moneda/fecha.

### 14.5 Onboarding

- Tour por rol.
- Checklist de primeros 10 minutos.
- Datos de ejemplo controlados.
- Estados vacios utiles.

---

## 15. Diseño Web Minimalista

### 15.1 Tesis visual

Monocromo absoluto: blanco, negro y grises. Color solo como señal de:

1. Etapa del pipeline.
2. Temperatura del lead.
3. Estado semantico.

El dato manda. La pantalla debe leerse como instrumento de precision, no como landing ni dashboard generico.

### 15.2 Evitar

- Gradientes decorativos.
- Morado/indigo generico.
- Glassmorphism.
- Glow.
- Tarjetas con sombra pesada.
- `rounded-3xl` por inercia.
- Emoji/AI sparkle.
- Feature grids de marketing dentro del producto.
- Copy hype.

### 15.3 Tokens

- Ink: `#0A0A0A`.
- Surface: `#FFFFFF`.
- Surface 2: `#FAFAFA`.
- Bordes hairline.
- Boton primario: negro con texto blanco.
- Boton secundario: hairline + texto negro.
- Tipografia UI: Space Grotesk.
- Numeros/datos: JetBrains Mono o Geist Mono tabular.
- Radios: 4/8/12.
- Sombras solo en overlays reales.

### 15.4 Elementos firma

- Sistema de color de etapas consistente en chip, kanban, barra, timeline.
- Cifra con procedencia: dato + fuente + fecha.
- Timeline limpia.
- Record detail con riel de contexto.

### 15.5 Piso de calidad visual

- Contraste WCAG AA.
- Foco de teclado visible.
- Motion 100-200ms, sin exceso.
- `prefers-reduced-motion`.
- Mobile sin solapamientos.
- No texto desbordado.
- Estados vacios con voz Sage.

---

## 16. Roadmap Maestro

### Fase 0 — Estabilizacion

Objetivo: que el proyecto pueda compilar y ser auditado.

- Corregir `hubUnitStatus` o agregar campo correcto.
- `npm test` verde.
- `npm run build` verde.
- TypeScript sin errores.
- Limpiar roles incorrectos.
- Revisar `.env.example`.
- Documentar migraciones aplicadas vs pendientes.
- Smoke auth/dashboard/contact/pipeline.

Salida: build verde y checklist tecnico confiable.

### Fase 1 — Hub como inventario unico

- Implementar/consumir API catalogo Hub.
- Reemplazar `/api/developments` y `/api/units` locales.
- Deal form usa unidades Hub.
- Cotizador usa selector Hub.
- Hold/reserve/release via Hub.
- Webhook Hub→CRM robusto.
- Eliminar/aislar `Development`/`Unit` locales.

Salida: CRM no posee inventario.

### Fase 2 — Core comercial usable

- Vista Hoy.
- Contact detail completo.
- Deal detail completo.
- Pipeline con guardas.
- Timeline unica.
- Tareas y actividades ergonomicas.
- SLA visible.
- Empty states.

Salida: un asesor puede trabajar su dia completo en el CRM.

### Fase 3 — Cotizador y cobranza

- Selector de unidad.
- Quote builder.
- Payment plan builder.
- PDF/landing.
- Envio WhatsApp/email.
- Tracking.
- Aging cobranza.
- Documentos por deal.

Salida: propuesta→apartado→firma→cobranza operable.

### Fase 4 — Automatizacion visual

- Builder de workflows.
- Builder de cadencias.
- SLA editor real.
- Simulador.
- Observabilidad de cola.
- Workflows canonicos activos.

Salida: operaciones puede configurar seguimiento sin tocar codigo.

### Fase 5 — Personalizacion y equipos

- Teams/territories UI completa.
- RLS/visibilidad por territorio.
- Field editor completo.
- Layout editor.
- Relationship picker/listas relacionadas.
- Vistas guardadas.
- Busqueda global.

Salida: CRM configurable con gobernanza.

### Fase 6 — Inbox y comunicaciones

- WhatsApp production-ready.
- Plantillas.
- Cloud API/Twilio decision cerrada.
- Email/Gmail v1.
- Calendar v1.
- Notificaciones realtime/push/digest.

Salida: comunicacion diaria centralizada.

### Fase 7 — Agentes IA

- Guardrails completos.
- Agent Studio.
- SDR/Calificador/Sales Coach.
- Tools con RBAC.
- Next-best-action.
- Summaries.
- Escalamiento.

Salida: IA util sin perder control.

### Fase 8 — Conectores y CAPI

- Meta/TikTok CAPI productivo.
- Google offline conversions.
- Portal lead ingestion.
- Logs/EMQ.
- Consentimiento y sender unico.

Salida: marketing optimiza por compradores reales.

### Fase 9 — Seguridad, compliance y cutover Zoho

- MFA.
- RLS completo.
- Consent records.
- ARCO.
- Retencion.
- Importacion Zoho.
- Paridad y freeze.
- CRM como SOT comercial.

Salida: produccion institucional.

### Fase 10 — Pulido de clase mundial

- PWA.
- i18n completo.
- Performance budgets.
- Accesibilidad.
- E2E suite.
- QA visual.
- Observabilidad.
- Documentacion operativa.

Salida: CRM inmobiliario Propyte v1 listo para escalar.

---

## 17. Backlog Prioritario Inmediato

1. Arreglar build.
2. Decidir `hubUnitStatus`: campo real, snapshot o eliminar escritura.
3. Cerrar API Hub catalog/hold.
4. Rehacer `/developments` como read-only Hub.
5. Rehacer deal form para Hub IDs.
6. Rehacer cotizador con selector Hub.
7. Crear Vista Hoy.
8. Crear deal detail como pantalla central.
9. Crear builder de cadencias.
10. Implementar saved views.
11. Implementar consentimiento basico.
12. Endurecer RBAC/RLS.
13. E2E de lead→routing→WhatsApp→deal→quote→hold.

---

## 18. Definition of Done Global

Una fase queda terminada solo si:

- Build verde.
- Migraciones aplicadas o documentadas.
- Tests relevantes verdes.
- Smoke E2E con usuario realista.
- Permisos probados por al menos ADMIN, DIRECTOR/GERENTE, TEAM_LEADER, ASESOR.
- UI revisada desktop/mobile.
- Estados vacios y errores escritos.
- Logs/auditoria donde aplique.
- Sin stubs silenciosos en el camino critico.
- Documentacion actualizada.

---

## 19. Open Questions Consolidadas

1. Hub API: ¿ya existe catalog read-only y hold atomico o debe construirse primero?
2. Sender unico CAPI: ¿CRM envia conversiones directo o via Hub?
3. WhatsApp production: ¿Cloud API directo, Twilio o ambos con transport intercambiable?
4. Google Workspace: ¿empezar con BCC-to-CRM o OAuth Gmail completo?
5. MFA: ¿todos o solo roles sensibles?
6. Portales: ¿EasyBroker/Proppit agregador o integraciones directas?
7. Zoho cutover: ¿cuantos dias de paridad antes de declarar CRM SOT?
8. IA: ¿L2 al inicio y L3 despues de metricas, o L3 controlado desde v1?
9. RLS: ¿se implementa 100% en Postgres desde la siguiente fase o se transiciona por API?
10. Retencion: ¿periodos por lead frio, cliente, KYC y prospecto descartado?

---

## 20. Referencias

- `specs/SPECKIT-PROPYTE-CRM-CONSOLIDADO.md`
- `specs/SPECKIT-ANEXO-TECNICO.md`
- `specs/SPECKIT-ANEXO-B-MULTICANAL-PERFILES.md`
- `specs/SPECKIT-PERSONALIZACION-Y-EQUIPOS.md`
- `specs/SPECKIT-CONECTIVIDAD-AGENTES-CAPI.md`
- `specs/SPECKIT-DISENO-WEB-MINIMALISTA.md`
- `specs/SPECKIT-GOOGLE-WORKSPACE.md`
- `specs/crm-hub-migration-cleanup.md`
- `specs/zoho-parity-matrix.md`
- Downloads: `SPECKIT-PLATAFORMA-SEGURIDAD-EXPERIENCIA-PROPYTE-CRM.md`

*Fin — SPECKIT MAESTRO Propyte CRM v2.0.*
