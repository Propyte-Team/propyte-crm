# IMPLEMENTATION PLAN MAESTRO — Propyte CRM
### Plan ejecutable para convertir el speckit maestro en producto terminado

> **Version:** 1.0 — 2026-06-12  
> **Fuente:** `specs/SPECKIT-MAESTRO-PROPYTE-CRM.md`  
> **Objetivo:** que Sonnet/Codex pueda ejecutar el rebuild sin confundir "schema existe" con "feature terminada".  
> **Regla principal:** no avanzar de fase si la fase anterior no tiene build verde, smoke probado y criterios de aceptacion cerrados.

---

## 0. Instrucciones Para El Agente Que Ejecute

Antes de modificar codigo:

1. Leer `specs/SPECKIT-MAESTRO-PROPYTE-CRM.md`.
2. Leer este archivo completo.
3. Revisar `git status --short`.
4. No revertir cambios ajenos.
5. Trabajar en fases pequeñas y verificables.
6. Despues de cada bloque: correr pruebas/build relevantes.
7. Si una feature queda con stub, marcarla explicitamente como pendiente y no reportarla como terminada.

Definition of Done por ticket:

- Codigo implementado.
- UI usable si aplica.
- Permisos aplicados.
- Errores/loading/empty states considerados.
- Tests o smoke definidos.
- `npm.cmd test` verde si toca logica testeada.
- `npm.cmd run build` verde al cierre de fase.
- Documentacion actualizada si cambia contrato.

Comandos base en Windows:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

---

## 1. Estado Actual A Validar Al Inicio

### 1.1 Validacion tecnica inicial

Ejecutar:

```powershell
git status --short
npm.cmd test
npm.cmd run build
```

Resultado conocido al crear este plan:

- `npm.cmd test` pasa con 61 tests.
- `npm.cmd run build` falla por `hubUnitStatus` inexistente en `src/app/api/webhooks/hub-unit/route.ts`.

Si el resultado cambia, actualizar esta seccion antes de seguir.

### 1.2 Deuda critica conocida

- Build roto por `hubUnitStatus`.
- Inventario local (`Development`, `Unit`) contradice SOT Hub.
- Deal form consume `/api/developments` y `/api/units` locales.
- Cotizador pide UUID manual de Hub.
- Builder visual de workflows/cadencias no existe.
- Google/LinkedIn CAPI son stubs.
- RLS/record-level security por territorio no esta garantizada end-to-end.
- Falta E2E de lead→routing→deal→quote→hold.

---

## 2. Fase 0 — Estabilizacion Tecnica

**Objetivo:** build verde y base confiable antes de tocar producto.

### Ticket 0.1 — Corregir build roto por Hub webhook

Archivos probables:

- `src/app/api/webhooks/hub-unit/route.ts`
- `prisma/schema.prisma` si se decide agregar campo.
- migracion manual si se agrega columna.

Decision requerida:

- Opcion recomendada v1: no agregar `hubUnitStatus` todavia. Guardar el status dentro de `Deal.hubUnitSnapshot` o crear campo explicito bien nombrado si el producto lo necesita.
- Si se agrega campo: `hubUnitStatus String?` y migracion clara.
- Si no se agrega: eliminar update a campo inexistente y registrar evento en `Activity`/`AuditLog` o actualizar snapshot JSON.

Criterios de aceptacion:

- `npm.cmd run build` ya no falla por `hubUnitStatus`.
- Webhook responde 200 con payload valido.
- Webhook responde 401 sin secret.
- El comentario no debe decir "no bloquear si columna no existe" si TypeScript lo impide.

Verificacion:

```powershell
npm.cmd run build
```

### Ticket 0.2 — Limpiar roles inconsistentes

Archivos:

- `src/components/layout/sidebar.tsx`
- cualquier constante de roles.

Acciones:

- Reemplazar `ASESOR_SENIOR`/`ASESOR_JUNIOR` por `ASESOR_SR`/`ASESOR_JR`.
- Crear helper central si ya existe patron.

Criterios:

- Sidebar muestra secciones correctas para ADMIN, DIRECTOR, GERENTE, TEAM_LEADER, ASESOR_SR, ASESOR_JR, ASESOR.
- No quedan strings de roles inexistentes.

Verificacion:

```powershell
rg -n "ASESOR_SENIOR|ASESOR_JUNIOR" src
npm.cmd run build
```

### Ticket 0.3 — Auditoria de migraciones y Prisma

Archivos:

- `prisma/schema.prisma`
- `prisma/migrations-manual/*`
- `task_manager.md` o nuevo `docs/CRM-IMPLEMENTATION-STATUS.md`.

Acciones:

- Listar modelos que existen en schema.
- Marcar cuales estan aplicados en BD, pendientes o temporales.
- Identificar modelos que deben retirarse en Fase 1 (`Development`, `Unit` locales).

Criterios:

- Documento de estado claro.
- No se aplica migracion destructiva sin decision explicita.

### Salida de Fase 0

- `npm.cmd test` verde.
- `npm.cmd run build` verde.
- Documento de estado actualizado.
- No hay errores TypeScript conocidos.

---

## 3. Fase 1 — Hub Como Inventario Unico

**Objetivo:** que el CRM deje de operar inventario local y consuma Hub como SOT.

### Ticket 1.1 — Definir contrato de cliente Hub

Archivos nuevos/probables:

- `src/lib/hub/client.ts`
- `src/lib/hub/types.ts`
- `.env.example`

Implementar:

- `listHubDevelopments(filters)`
- `getHubDevelopment(id)`
- `listHubUnits(filters)`
- `getHubUnit(id)`
- `requestUnitHold({ hubUnitId, dealId, contactId, ttlHours })`
- `releaseUnitHold(holdId)`
- `confirmUnitHold(holdId)`

Env vars:

- `HUB_API_BASE_URL`
- `HUB_API_KEY` o mecanismo firmado acordado.
- `HUB_WEBHOOK_SECRET`

Criterios:

- Cliente tipado.
- Timeouts y errores claros.
- No exponer secrets al cliente.
- Si Hub API aun no existe, crear adapter mock solo para dev con bandera explicita `HUB_API_MODE=mock`, nunca silencioso.

Verificacion:

```powershell
npm.cmd run build
```

### Ticket 1.2 — Reemplazar endpoints locales de catalogo

Archivos:

- `src/app/api/developments/route.ts`
- `src/app/api/units/route.ts`
- `src/server/developments.ts`
- `src/app/(dashboard)/developments/*`
- `src/components/developments/*`

Acciones:

- Convertir `/developments` en vista read-only desde Hub.
- Eliminar botones de crear/editar desarrollo en CRM.
- Mostrar fuente/procedencia del dato.
- Mantener filtros: plaza, zona, status, presupuesto, tipo, busqueda.

Criterios:

- Ningun usuario puede crear/editar desarrollos/unidades desde CRM.
- UI dice claramente si el dato viene del Hub.
- Build verde.

Busqueda obligatoria:

```powershell
rg -n "createDevelopment|updateDevelopment|prisma\.development|prisma\.unit" src
```

### Ticket 1.3 — Deal form usa Hub

Archivos:

- `src/components/pipeline/deal-form.tsx`
- `src/app/api/deals/route.ts`
- `src/lib/validations/deal.ts`
- `src/server/deals.ts`

Acciones:

- Reemplazar `developmentId/unitId` locales por `hubDevelopmentId/hubUnitId`.
- Selector de desarrollo/unidad consumiendo Hub.
- Guardar snapshot basico de unidad en deal.
- No reservar unidad al crear deal; reservar solo al avanzar a `RESERVED` o accion "Apartar".

Criterios:

- Crear deal sin unidad funciona.
- Crear deal con unidad Hub guarda IDs Hub.
- No escribe `developmentId/unitId` locales.
- Validacion clara si unidad no existe/no disponible.

### Ticket 1.4 — Hold/reserva contra Hub

Archivos:

- `src/app/api/deals/[id]/route.ts`
- `src/components/pipeline/stage-transition-dialog.tsx`
- `src/app/api/webhooks/hub-unit/route.ts`
- `src/lib/hub/client.ts`

Acciones:

- Al pasar a `RESERVED`, solicitar hold/confirmacion al Hub.
- Si Hub responde conflicto, bloquear transicion y mostrar unidad no disponible.
- Guardar `holdId`, `holdExpiresAt`, `hubUnitSnapshot`.
- Webhook actualiza deal/snapshot/timeline.

Criterios:

- No se puede entrar a `RESERVED` sin hold confirmado.
- Conflicto de Hub no cambia etapa.
- Timeline registra hold/reserva/liberacion.

### Ticket 1.5 — Retirar inventario local del camino critico

Archivos:

- Todos los que salgan de `rg "Development|Unit|developmentId|unitId|prisma\.development|prisma\.unit" src`.
- `prisma/schema.prisma` en una fase posterior si la BD lo permite.

Acciones:

- Remover dependencias de modelos locales en flujos principales.
- Mantener modelos solo si estan documentados como legacy/cache temporal.

Criterios:

- Deal, quote, reports y developments no dependen de escritura local.
- Queda plan de migracion para borrar modelos Prisma.

### Salida de Fase 1

- CRM consume Hub para catalogo.
- No hay creacion/edicion local de inventario.
- `RESERVED` exige Hub hold.
- Build verde.

---

## 4. Fase 2 — Core Comercial Usable

**Objetivo:** que un asesor pueda operar su dia completo dentro del CRM.

### Ticket 2.1 — Vista Hoy del asesor

Archivos:

- `src/app/(dashboard)/hoy/page.tsx` o `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/today/*`
- `src/server/dashboard.ts`
- `src/components/layout/sidebar.tsx`

Contenido:

- Leads nuevos sin tocar.
- SLA en riesgo.
- Tareas vencidas/hoy.
- Conversaciones sin responder.
- Visitas de hoy.
- Deals calientes.
- Cotizaciones abiertas.
- Next-best-action.

Criterios:

- ASESOR ve solo su trabajo.
- TEAM_LEADER ve equipo.
- Direccion ve resumen agregable.
- Empty state util.
- Mobile usable.

### Ticket 2.2 — Deal detail como centro operativo

Archivos:

- `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx`
- `src/components/pipeline/*`
- `src/components/activities/*`
- `src/components/quotes/*`

Contenido:

- Header: etapa, valor, asesor, contacto, unidad, SLA.
- Riel lateral: unidad Hub, cotizaciones, documentos, comision, proximas acciones.
- Timeline central.
- Checklist por etapa.
- Acciones: llamar, WhatsApp, agendar, cotizar, apartar, avanzar.

Criterios:

- No hay datos importantes enterrados.
- Acciones principales visibles.
- Etapa usa colores del sistema.
- Carga y errores claros.

### Ticket 2.3 — Contact detail completo

Archivos:

- `src/app/(dashboard)/contacts/[id]/page.tsx`
- `src/components/contacts/contact-detail.tsx`
- `src/components/metadata/custom-fields-section.tsx`

Contenido:

- Perfil comercial.
- Datos de contacto.
- Consentimiento/opt-out.
- Deals.
- Timeline.
- Campos custom.
- Merge/dedup candidatos.
- Preferencias idioma/zona/presupuesto.

Criterios:

- ASESOR no ve campos restringidos.
- Editar respeta field permissions.
- Contacto con `doNotContact` muestra alerta.

### Ticket 2.4 — Timeline unica

Archivos:

- `src/components/activities/activity-timeline.tsx`
- modelos/API de messages/activities/documents/quotes.

Acciones:

- Unificar actividades, mensajes, notas, cambios de etapa, quotes, documentos.
- Filtros por tipo.
- Notas internas diferenciadas.

Criterios:

- Un asesor entiende historial completo sin cambiar de pantalla.
- No mezcla notas internas con mensajes externos.

### Salida de Fase 2

- Vista Hoy operable.
- Deal detail completo.
- Contact detail completo.
- Timeline unica.
- Smoke: lead existente → tarea → WhatsApp → deal → avanzar etapa.

---

## 5. Fase 3 — Cotizador, Documentos y Cobranza

### Ticket 3.1 — Selector real de unidad Hub en cotizador

Archivos:

- `src/components/quotes/quote-form.tsx`
- `src/server/quotes.ts`
- `src/app/api/quotes/route.ts`
- `src/lib/hub/client.ts`

Acciones:

- Quitar input manual de UUID.
- Buscar unidad Hub.
- Mostrar precio, m2, status, desarrollo, fuente y fecha.
- Congelar snapshot.

Criterios:

- No se puede cotizar unidad inexistente.
- Snapshot queda en `Quote.unitSnapshot`.

### Ticket 3.2 — Builder de plan de pagos

Archivos:

- `src/components/quotes/payment-plan-form.tsx`
- `src/components/quotes/payment-schedule-table.tsx`
- `src/server/quotes.ts`
- `src/app/api/quotes/[id]/plan/route.ts`

Funciones:

- Enganche.
- Mensualidades.
- Contraentrega.
- Fechas.
- Ajustes manuales con auditoria.

Criterios:

- Totales cuadran con precio final.
- Estados: pendiente, pagada, vencida, condonada.

### Ticket 3.3 — PDF/landing de cotizacion

Archivos:

- Nuevo generador PDF o HTML imprimible.
- `src/app/api/quotes/[id]/send/route.ts`
- `src/app/q/[token]/page.tsx` si se usa landing publica.

Contenido:

- Branding Propyte.
- Unidad.
- Precio.
- Plan.
- Vigencia.
- Disclaimer.
- CTA WhatsApp/agenda.

Criterios:

- Abrir landing marca `openedAt`.
- Enviar marca `sentAt`.
- Expirada no permite aceptar.

### Ticket 3.4 — Documentos y cobranza

Archivos:

- `src/components/quotes/deal-documents-section.tsx`
- `src/app/api/deals/[id]/documents/*`
- `src/app/(dashboard)/cobranza/page.tsx` si se crea.

Funciones:

- Subir/enlazar documentos.
- Verificacion.
- Aging de pagos.
- Recordatorios.

Criterios:

- Roles restringidos.
- Documentos sensibles no visibles para roles no autorizados.

### Salida de Fase 3

- Desde deal real se crea quote, plan, se envia, se trackea apertura y se ve cobranza.

---

## 6. Fase 4 — Automatizacion Visual

### Ticket 4.1 — Observabilidad de workflows

Archivos:

- `src/components/config/automation-section.tsx`
- `src/app/api/admin/automation/route.ts`
- `src/lib/workflows/*`

Agregar:

- Eventos pendientes/procesados.
- Cola por status.
- Errores recientes.
- Ultimas ejecuciones.
- Retry manual.

Criterios:

- Admin entiende si el motor esta vivo.
- No requiere mirar DB.

### Ticket 4.2 — Builder de reglas

Funciones:

- Crear regla.
- Trigger.
- Condiciones DSL visual.
- Acciones.
- Cooldown.
- Activar/pausar.
- Simular contra entidad.

Archivos probables:

- `src/components/config/workflow-builder.tsx`
- `src/app/api/admin/automation/rules/route.ts`
- validaciones Zod.

Criterios:

- No se escriben JSON crudos en UI final.
- Preview muestra que hara la regla.

### Ticket 4.3 — Builder de cadencias/action plans

Funciones:

- Crear plan.
- Pasos con delays.
- Condiciones de salida.
- Enrolar/desenrolar.
- Pausar.

Criterios:

- Ya no aparece texto "se crean desde la API o builder proxima fase".

### Ticket 4.4 — Workflows canonicos productivos

Activar con seeds/config:

1. Lead digital nuevo.
2. Speed-to-lead.
3. Anti-huerfano.
4. Post-visita sin cotizacion.
5. Apartado a firma.
6. Pago vencido.
7. Reactivacion dormidos.
8. Postventa.

Criterios:

- Cada workflow tiene prueba o smoke.
- Cada accion deja Activity/AuditLog.

---

## 7. Fase 5 — Personalizacion, Equipos y Vistas

### Ticket 5.1 — UI completa de Teams/Territories

Archivos:

- `src/components/config/teams-section.tsx`
- `src/app/api/admin/teams/*`
- `src/app/api/admin/territories/*`
- `src/lib/teams/territory.ts`

Funciones:

- Crear equipo.
- Agregar/quitar miembros con historial.
- Crear territorio.
- Asignar miembros.
- Definir reglas.
- Ver carga/potencial.

Criterios:

- Baja de usuario no deja leads huerfanos.
- Ruteo usa territorio antes de asesor.

### Ticket 5.2 — RLS/visibilidad

Acciones:

- Definir politicas DB o enforcement API transitorio documentado.
- Probar roles.
- Evitar confiar solo en UI.

Criterios:

- Asesor no puede leer registros fuera de scope por API.
- TL ve equipo.
- Direccion ve todo.

### Ticket 5.3 — Field/Layout editor completo

Archivos:

- `src/components/config/fields-section.tsx`
- `src/app/api/admin/metadata/fields/route.ts`
- `src/lib/metadata/*`

Funciones:

- Crear/editar metadata.
- Picklists.
- Permisos por rol.
- Layout sections.
- Required/hidden/read/edit.
- Duplicates warning.

Criterios:

- apiName inmutable.
- archive no borra valores.
- AuditLog.

### Ticket 5.4 — Vistas guardadas

Modelos:

- `SavedView`
- `UserPreference`

Funciones:

- Guardar filtros/columnas/sort/vista.
- Scope personal/team/org.
- Default por modulo.
- Export respetando permisos.

Modulos iniciales:

- Contacts.
- Pipeline.
- Quotes.
- Reports.

---

## 8. Fase 6 — Inbox, Email, Calendar y Notificaciones

### Ticket 6.1 — WhatsApp production-ready

Acciones:

- Decidir Cloud API vs Twilio o transport intercambiable.
- Templates.
- Estados de mensaje.
- Opt-out.
- Reintentos.
- Logs.

Criterios:

- Enviar/recibir desde numero productivo.
- Opt-out bloquea outbound.
- Takeover humano probado.

### Ticket 6.2 — Email v1

Opciones:

- BCC-to-CRM rapido.
- OAuth Gmail completo.

Implementar al menos:

- Enviar email desde CRM via Resend/Gmail.
- Registrar en timeline.
- Firma de usuario.
- Plantillas.

### Ticket 6.3 — Calendar v1

Funciones:

- Crear evento desde Activity.
- Link a Google Calendar.
- Recordatorios.
- Vista calendario simple.

### Ticket 6.4 — Notificaciones

Funciones:

- In-app realtime/polling.
- Preferencias.
- Digest opcional.
- SLA en riesgo.
- Lead nuevo.
- Mencion/asignacion/pago vencido.

---

## 9. Fase 7 — Agentes IA

### Ticket 7.1 — Guardrails robustos

Archivos:

- `src/lib/bot/brand-linter.ts`
- `src/lib/bot/claude.ts`
- `src/lib/agents/tools.ts`
- `src/lib/agents/runner.ts`

Requisitos:

- Voz Sage.
- Frases prohibidas.
- Data-gate.
- Opt-out.
- RBAC.
- Escalamiento.
- AuditLog.

### Ticket 7.2 — Agent Studio

Funciones:

- Crear/editar agente.
- Prompt/goal.
- Tools permitidas.
- Autonomia.
- Trigger.
- Horario.
- Limites.
- Simulacion.
- Versionado.

### Ticket 7.3 — Agentes v1

Implementar:

- SDR Speed-to-lead.
- Calificador.
- Sales Coach.

Criterios:

- Cada agente tiene usuario sistema.
- Corridas auditadas.
- Puede fallar de forma visible si falta `ANTHROPIC_API_KEY`.
- No envia mensajes prohibidos.

### Ticket 7.4 — Next-best-action y resumen

Pantallas:

- Deal detail.
- Contact detail.
- Vista Hoy.

Funciones:

- Resumen timeline.
- Siguiente accion.
- Riesgos.
- Objeciones.

---

## 10. Fase 8 — Conectores y CAPI

### Ticket 8.1 — Connector observability

UI:

- Estado por conector.
- Ultimo sync.
- Errores.
- Leads recibidos.
- Conversiones enviadas.

### Ticket 8.2 — Meta/TikTok CAPI productivo

Criterios:

- Eventos Lead/Qualified/MeetingScheduled/Reserved/Won.
- PII hasheada.
- event_id idempotente.
- Reintentos.
- Logs por plataforma.

### Ticket 8.3 — Google offline conversions

Requiere:

- OAuth Google Ads.
- gclid persistido.
- Adapter real reemplaza stub.

### Ticket 8.4 — Portal lead ingestion

Prioridad:

- Elegir Inmuebles24/Lamudi/EasyBroker.
- Webhook/feed.
- Mapping.
- Dedup.
- SLA.

---

## 11. Fase 9 — Seguridad, Compliance y Cutover Zoho

### Ticket 9.1 — MFA y sesiones

Funciones:

- MFA roles sensibles.
- Lista/revocacion sesiones.
- Rate limit login.

### Ticket 9.2 — Consentimientos y ARCO

Modelos:

- `ConsentRecord`
- `ArcoRequest`
- `DataRetentionPolicy`

Funciones:

- Registrar aviso por canal.
- Exportar datos titular.
- Bloquear/suprimir segun politica.

### Ticket 9.3 — Importacion/paridad Zoho

Acciones:

- Import CSV/API.
- Dedup.
- Mapeo picklists.
- Reporte de discrepancias.
- Validar N dias.

### Ticket 9.4 — Cutover

Checklist:

- Freeze de edicion Zoho.
- CRM como SOT.
- Backups.
- Rollback plan.
- Comunicacion interna.

---

## 12. Fase 10 — Pulido de Clase Mundial

### Ticket 10.1 — QA visual y sistema de diseño

Acciones:

- Revisar todas las pantallas contra speckit minimalista.
- Eliminar color decorativo.
- Revisar mobile.
- Revisar contraste.
- Revisar textos desbordados.

### Ticket 10.2 — Performance

Acciones:

- Paginacion/virtualizacion.
- Indices DB.
- Cache metadata.
- Optimistic UI con rollback.

### Ticket 10.3 — E2E suite

Flujos minimos:

1. Login.
2. Crear lead.
3. Auto-route.
4. Enviar WhatsApp/registrar actividad.
5. Crear deal.
6. Seleccionar unidad Hub.
7. Crear quote.
8. Apartar unidad.
9. Marcar contrato.
10. Ver comision/cobranza.

### Ticket 10.4 — Documentacion operativa

Crear:

- Guia de admin.
- Guia de asesor.
- Runbook de crons.
- Runbook de conectores.
- Runbook de incidentes.
- Mapa de env vars.

---

## 13. Orden Recomendado Para Sonnet

No ejecutar en paralelo fases que dependen de inventario.

Orden exacto:

1. Fase 0 completa.
2. Fase 1 completa.
3. Fase 2 tickets 2.1 y 2.2.
4. Fase 3 tickets 3.1 y 3.2.
5. Fase 4 observabilidad antes de builder.
6. Fase 5 RLS antes de vistas compartidas.
7. Fase 6 WhatsApp antes de agentes autonomos.
8. Fase 7 guardrails antes de Agent Studio.
9. Fase 8 CAPI despues de eventos comerciales confiables.
10. Fase 9 cutover solo con CRM operando internamente.
11. Fase 10 continuo, pero cierre formal al final.

---

## 14. Prompts Sugeridos Para Ejecutar Con Sonnet

### Prompt inicial

```text
Lee `specs/SPECKIT-MAESTRO-PROPYTE-CRM.md` y `specs/IMPLEMENTATION-PLAN-MAESTRO-PROPYTE-CRM.md`.
No implementes aun. Primero audita el estado actual contra Fase 0 y dime:
1. que falla,
2. que archivos estan implicados,
3. que ticket de Fase 0 atacaras primero,
4. como verificaras que quedo terminado.
```

### Prompt de ejecucion por ticket

```text
Ejecuta solo el Ticket X.Y del implementation plan.
Mantente dentro del alcance.
Al terminar corre las verificaciones indicadas.
No declares la fase terminada si el build falla o queda un stub en camino critico.
```

### Prompt de cierre de fase

```text
Revisa todos los criterios de salida de la Fase X.
Corre tests/build/smoke indicados.
Actualiza documentacion de estado si aplica.
Dime que queda pendiente antes de pasar a la siguiente fase.
```

---

## 15. Regla Antialucinacion De Avance

Sonnet debe reportar estado usando estas etiquetas:

- **No iniciado:** no hay codigo ni contrato.
- **Modelado:** schema/tipos existen, pero no UI/API completa.
- **Cableado:** API/servicio existe, pero falta UX, permisos, pruebas o integracion real.
- **Operable:** usuario puede usarlo en flujo real, con errores manejados.
- **Produccion:** operable + permisos + tests + build + monitoring + docs.

Solo **Produccion** cuenta como terminado.

---

## 16. Checklist Diario De Trabajo

Al empezar:

- `git status --short`
- Revisar fase/ticket actual.
- Leer archivos implicados.

Durante:

- Cambios pequeños.
- No mezclar refactors.
- No tocar inventario local salvo Fase 1.
- No introducir stubs silenciosos.

Al cerrar:

- `npm.cmd test` si aplica.
- `npm.cmd run build` al cierre de fase.
- Registrar pendientes.
- Decir claramente que no se pudo verificar si algo fallo.

*Fin — Implementation Plan Maestro Propyte CRM v1.0.*
