# Auditoría UX de Configuración — 06 · Canales & Integraciones y Personal

Fecha: 2026-11-03 · Alcance: grupos «Canales & Integraciones» y «Personal» de `src/components/config/config-center.tsx`.
Roles que llegan aquí: ADMIN, DIRECTOR, GERENTE, MARKETING (Conexiones / Huérfanos), ADMIN (API keys) y todos (Mi perfil).
Solo lectura: no se tocó código. Tamaños: **QW** = quick win (≤ ½ día) · **M** = medio (1-2 días) · **R** = rediseño.

## 0. Hallazgos transversales

| # | Hallazgo | Impacto |
|---|----------|---------|
| T1 | **El estado de una conexión es un punto de color sin texto** (`STATUS_DOT`) y «N · fecha» sin etiqueta. Nadie sabe si algo está roto: `lastError` se pinta crudo (texto de la API de Meta) y `errorCount` ni se muestra. No hay forma de «probar» una cuenta ya conectada. | Alto |
| T2 | **Las claves de Meta se piden al usuario a mano**: Page ID, Page Access Token (long-lived), App Secret, Verify Token «lo inventas tú», Instagram Business ID, Phone Number ID, scopes (`leads_retrieval`, `pages_messaging`…). Son instrucciones para un desarrollador, no para gerencia/marketing. El único flujo sin claves es WhatsApp coexistencia (Embedded Signup): es el modelo a seguir. | Alto |
| T3 | **Acciones destructivas con `confirm()` nativo o sin confirmación**: eliminar conexión (confirm nativo), borrar webhook y revocar API key (sin confirmación), desconectar Gmail (sin confirmación), borrar plantilla (confirm nativo). | Alto |
| T4 | **Errores de validación que no llegan al usuario**: `/api/profile` y `/api/profile/templates` devuelven `parsed.error.flatten()` (objeto); la UI solo acepta string y muestra «Revisa los campos (formato inválido)» / «Error al crear (¿atajo /algo…?)». Los mensajes buenos de zod («Slug en kebab-case», «Atajo con formato /algo») se pierden. | Medio |
| T5 | **Jerga en el propio índice**: «Meta Lead Ads / IG / Messenger», «Con dueño técnico (.local)», «Cloud API directo», «Takeover humano», «Webhooks salientes». Un asesor no sabe qué hay detrás. | Medio |
| T6 | `src/components/admin/connectors-section.tsx` **es código muerto** (no lo importa nadie): duplica el alta de conectores con otros textos («Crear (queda en pausa hasta activar)», proveedores WEBSITE/ZAPIER). Confunde a quien mantiene. | Bajo |

## 1. Centro de conexiones — `/conexiones`

Pantalla única: lista por plataforma (Meta, TikTok, Google, LinkedIn, Pinterest), cada cuenta con acciones inline, tres asistentes (genérico, «Meta DMs», WhatsApp oficial) y el editor de mapeo. Sirve a ADMIN/DIRECTOR/GERENTE/MARKETING.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|--------|----------|----------|-----------|--------|
| Eyebrow «Admin» + «Multicuenta por plataforma» | Título | Dice «Admin» aunque la ven MARKETING/GERENTE; «multicuenta» es jerga | «Canales conectados · De aquí entran tus prospectos» | QW |
| Grupos YouTube / Pinterest «push-only · v2» | Placeholders sin función | Muestran notas de roadmap («Push de conversiones (Conversions API) en v2») como si fueran opciones | Quitarlos del listado o chip «Próximamente» sin texto técnico | QW |
| Contador `2/3` mono por plataforma | Activas/total | Sin etiqueta | «2 activas de 3» o quitar | QW |
| Punto de estado + «12 · 03 nov» | Estado y último lead | Ver T1: sin texto, sin «hace N días», sin alerta si lleva días sin leads o con errores | **Semáforo con texto**: «Recibiendo · último lead hace 2 h» / «Sin leads desde hace 9 días» / «Error: token caducado» + botón «Probar ahora» | M |
| `lastError` crudo | Último error del proveedor | Texto en inglés de Graph («(#190) Error validating access token…») | Diccionario de errores frecuentes → «El acceso a la página caducó. Vuelve a conectar.» con botón que abre el flujo correcto | M |
| Acción «Pausar / Activar» | Cambia status | No explica qué pasa con lo que llega en pausa (se descarta) | Tooltip/confirmación corta «Mientras esté en pausa, lo que llegue por esta cuenta se descarta» | QW |
| Acción «Marca» → select «Marca del agente / Predeterminada (Propyte)» | Atribuye leads y persona del bot | El concepto «marca del agente» no se explica; cambio inmediato sin confirmar | Etiqueta «Marca» + ayuda de 1 línea; guardar con confirmación | QW |
| Acción «Editar mapeo» (solo META/INSTAGRAM) | Abre MappingEditor | Ver §1.3 | — | — |
| Acción «Token» → «Nuevo Page Access Token» · «App Secret y Verify Token se conservan» | Rota el token de IG/Messenger | Claves crudas; el usuario no sabe de dónde sale el token | Mover bajo «Avanzado» y, a largo plazo, sustituir por reconexión OAuth (R1) | QW / R |
| Acción «Eliminar» | Soft-delete | `confirm()` nativo; no dice que los leads históricos se conservan ni que se pierde el webhook | Diálogo propio con consecuencias y «Pausar» como alternativa sugerida | QW |
| Badges coexistencia («Conectado (app y CRM)», «Sincronizando historial 40 %», «Sin webhooks», «Desconectado por el negocio») | Estado del número coex | Bien resuelto salvo «Sin webhooks» (jerga) | «No recibe mensajes · vuelve a conectar» | QW |
| Botón «Conectar WhatsApp (oficial)» no disponible → «Falta configurar en el servidor: META_WA_… Ver docs/whatsapp-coexistencia-meta-setup.md» | Aviso cuando faltan env vars | Nombres de variables y ruta de docs a un usuario de negocio | «WhatsApp oficial aún no está habilitado. Pide a tu administrador activarlo.» (detalle técnico solo para ADMIN) | QW |
| Sección «WhatsApp de asesores» | Números propios (scope ADVISOR) | Correcta; «Sin dueño» para número sin owner y Eliminar sin diálogo | Mismo diálogo de eliminar; etiqueta «Asesor no asignado» | QW |
| Link «Leads huérfanos N →» | Atajo al panel | Bien; falta el mismo contador en la tarjeta del índice | Badge con el conteo en la card de Configuración | QW |

### 1.1 Asistente genérico «＋ Conectar cuenta» (`connect-wizard.tsx` + `registry.ts`)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|--------|----------|----------|-----------|--------|
| Pasos 1-3 (texto) | Instrucciones | «Abre tu app de Meta», «Genera un Page Access Token con permiso leads_retrieval (long-lived)», «scope r_marketing_leadgen_automation» | Mientras no haya OAuth: pasos con capturas y vocabulario de negocio; marcar el asistente como «Para tu administrador técnico» | M |
| Campos Facebook Lead Ads: Page ID · Page Access Token (long-lived) · App Secret · Verify Token (lo inventas tú) | Credenciales | 4 claves crudas; el Verify Token se pide al usuario en vez de generarse; **no se muestra la URL del webhook** que hay que pegar en Meta (`webhookPath` existe en el registro pero el wizard no lo enseña; solo lo hacía el componente muerto) | Generar Verify Token automáticamente; mostrar «URL del webhook» + «Verify Token» con botón copiar al terminar el alta | QW |
| Campos WhatsApp Cloud API: Phone Number ID (Cloud API) · Número · Marca visible · Access Token (System User, permanente) · «metadata.phone_number_id del webhook» | Alta manual de número | Ya existe el flujo oficial sin claves; este queda como vía técnica | Ocultar bajo «Avanzado: alta manual» y dejar el botón oficial como camino principal | QW |
| Campos Google Ads: Customer ID · Developer Token · OAuth Client ID/Secret · Refresh Token · Webhook Key | 6 claves | Imposible para no-desarrollador | Mismo tratamiento «Avanzado»; candidato a OAuth | QW / R |
| Nombre de la cuenta (default = proveedor) · Marca | Identidad | Sin ayuda de para qué sirve el nombre («Facebook · Lead Ads» repetido si hay 2) | Placeholder «Página Nativa Tulum»; sugerir nombre con el `accountName` que devuelve «Probar conexión» | QW |
| «Probar conexión» → «Conectado: X» / `detail` | Valida contra la API | Bien. Errores «Datos inválidos» / «No se pudo validar» sin pista | Mensajes por causa (token inválido, página distinta, permisos faltantes) | QW |
| «Guardar y activar» | POST + PATCH ACTIVE | «Cuenta creada, pero no se pudo activar» deja estado ambiguo | Un solo endpoint que crea activa | QW |

### 1.2 Asistente «Conectar página de Meta (DMs)» (`meta-dms-wizard.tsx`)
Es el mejor flujo manual: una captura para Messenger + Instagram, el lookup llena el IG ID, suscribe webhooks y ofrece reintento. Problemas restantes:

| Opción | Problema | Propuesta | Tamaño |
|--------|----------|-----------|--------|
| Paso 2: «pages_messaging, instagram_manage_messages, pages_manage_metadata» · «webhook /api/webhooks/meta-dm» | Scopes y rutas crudas | Esconder en «Detalles técnicos» plegado | QW |
| Resultado: «Página suscrita a los webhooks: messages, messaging_postbacks… faltan: feed» | Nombres de eventos de Meta | «Lista para recibir mensajes» / «Falta activar comentarios → Reintentar» | QW |
| Nombre: «Se crearán: «Messenger \| DM Nativa» e «IG - Nativa»» | Prefijos técnicos en el nombre de la cuenta | Nombre limpio + chip de canal | QW |

### 1.3 Editor de mapeo (`mapping-editor.tsx`, `mapping-model.ts`)

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|--------|----------|----------|-----------|--------|
| Origen: Pregunta / Metadata / Valor fijo + «nombre de la pregunta (ej. full_name)» | Define de dónde sale el dato | Texto libre: el usuario debe conocer el `key` interno del formulario de Meta | Dropdown con las preguntas del último lead recibido (el endpoint `test-mapping` ya conoce el último lead) | M |
| Metadata: `campaign_name, adset_id, leadgen_id…` | Claves de Meta | Crudas | Etiquetas «Nombre de campaña», «Conjunto de anuncios»… | QW |
| Destino «campo destino (ej. fullName, custom.presupuesto)» | Campo del contacto | Nombres de API en inglés; `custom.*` sin lista | Select con etiquetas en español (las del módulo Campos) | QW |
| Traducción de valores: `HOT/WARM/COLD`, `END_USER`, `ONE_TO_THREE_MONTHS` · «omitir / dejar valor original / valor fijo» | Value-map de enums | Enums crudos | Usar las etiquetas que ya usa el CRM (constants) | QW |
| «Probar» → `<pre>` JSON | Dry-run | JSON al usuario | Tabla «Campo → Valor que quedaría» | QW |
| Error «rules.0.target: target inválido» | Validación zod | Críptico | Mensaje por fila, en español | QW |

## 2. Leads huérfanos — `/conexiones/huerfanos`
Panel bien resuelto (asignación rápida y masiva con confirmación, mensajes de resultado en español). Sirve a gerencia/Karla para rescatar prospectos.

| Opción | Problema | Propuesta | Tamaño |
|--------|----------|-----------|--------|
| Nombre «Leads huérfanos» | Metáfora interna | «Prospectos sin atender» | QW |
| Sección «Con dueño técnico» · «cuenta interna o de pruebas (correo .local)» · «dueño bot@….local» | Explica una convención de sistema | «Asignados a una cuenta del sistema (nadie los atiende)»; el correo .local solo en tooltip | QW |
| Sección «Llegaron a una cuenta sin registrar» · «Llegó a `WhatsApp +52… (id 1234567)`» | El id numérico no ayuda; la solución («dar de alta la cuenta en Conexiones») está en comentarios de código, no en pantalla | Botón «Registrar esta cuenta» que abra Conexiones con el asistente correcto y el número precargado | M |
| «Solo ves los de las marcas que tienes prendidas» | Depende del concepto «vista de marca» | «Marcas visibles: Nativa, Propyte (cambiar)» | QW |
| «Mostrando 90 de 120, los más recientes» | Sin paginar; el tope es el del lote | Paginación o «Cargar más» | M |
| Fuente cruda si falta en `LEAD_SOURCE_LABELS` | Enum en pantalla | Completar diccionario | QW |

## 3. API keys & Webhooks — `/admin?tab=integrations` (`integrations-tab.tsx`)
Sirve solo a ADMIN/integrador. Es técnico por naturaleza; lo que falla es la protección y la retroalimentación.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|--------|----------|----------|-----------|--------|
| Caja «Conectores de Leads → Ir a Conexiones» | Redirección | Residuo de la migración | Quitar; la card del índice ya separa ambos | QW |
| Webhooks: Evento (Contacto creado, «Deal cambio de etapa»…) + URL | Alta | Sin nombre/descripción; anglicismo «Deal»; el `toast` muestra parte del secret | Campo «Nombre» (ej. «Zapier → Sheets»), etiquetas «Oportunidad…», toast sin secret | QW |
| Columna «Secret» con ojo/copiar | Ver y copiar | Secret visible en lista; sin rotación | Mostrar una sola vez al crear (igual que API keys) + «Regenerar» | QW |
| Estado «Activo/Inactivo» como Badge clicable | Toggle | No parece botón | Switch explícito | QW |
| Icono basura | Elimina | **Sin confirmación** (T3) | Diálogo de confirmación | QW |
| Sin «enviar prueba» ni historial de entregas | — | No se sabe si el webhook funciona ni cuándo falló | Botón «Enviar evento de prueba» + últimas 10 entregas con código HTTP | M |
| API keys: Nombre → «Generar» → se muestra una vez · Prefijo · Último uso · Revocar | Gestión de llaves | Patrón correcto. «Revocar» **sin confirmación** y es irreversible; no dice qué puede hacer la llave | Confirmación; texto «Permite crear contactos y deals vía API (ver docs)» | QW |
| Ubicación | Tab dentro de /admin | Convive con pestañas de negocio | Card del índice con chip «Avanzado · integradores» y descripción de uso («Conectar Zapier/Make») | QW |

## 4. Tarjeta «WhatsApp» → `/inbox`
Items de la card: «Inbox con bot», «Takeover humano», «Cloud API directo». **No es configuración**: manda a la bandeja operativa. La configuración real de WhatsApp está repartida: números (Conexiones), bot por marca (`/admin?tab=botBrands`), tono/encendido (`/admin?tab=bot`), plantillas (Mi perfil), número propio (Mi perfil → Mi WhatsApp).

Propuesta (M): convertir la card en **«WhatsApp»** como hub de configuración, no de operación: (1) números conectados con semáforo (filtro WHATSAPP de Conexiones) y botón «Conectar número oficial», (2) «¿El bot contesta en este número?» por línea, (3) atajo a plantillas de WhatsApp, (4) link secundario «Ir a la bandeja». Alternativa QW: eliminar la card y que Conexiones muestre WhatsApp primero.

## 5. Mi perfil & Plantillas — `/settings` (`settings-view.tsx`, `mi-whatsapp.tsx`)
Sirve a todos los roles (asesores incluidos). Título «Mi Configuración» vs card «Mi perfil & Plantillas»: unificar.

| Pestaña · Opción | Qué hace | Problema | Propuesta | Tamaño |
|------------------|----------|----------|-----------|--------|
| Orden de pestañas Perfil · Correo · Tarjeta · Plantillas · Google Workspace | Navegación | Lo más valioso (conectar Gmail) va al final; «Correo» y «Google Workspace» son dos caminos de envío y no se dice cuál manda | Fusionar en «Mi correo»: conexión Gmail arriba, alias y firma abajo con nota «si Gmail está conectado, se envía desde ahí» | M |
| Perfil: Puesto, Bio ES/EN, Teléfono directo, WhatsApp, Link de agenda | Datos de tarjeta | Correcto. **Bug**: `save()` omite cadenas vacías → no se puede borrar un valor guardado. Sin indicador de cambios sin guardar | Enviar `null` al vaciar; «Guardar» deshabilitado si no hay cambios | QW |
| Mensajes de error «Revisa los campos (formato inválido)» | Validación | T4: se pierden los mensajes de zod | Aplanar `fieldErrors` a texto por campo | QW |
| Correo: «Alias de envío — Debe ser @propyte.com — el envío sale del SMTP central» | Remitente | «SMTP central» es jerga; no valida inline | «Tu correo de envío (@propyte.com)» con validación al escribir | QW |
| Correo: «Firma (HTML)» textarea + vista previa `dangerouslySetInnerHTML` | Firma | Un asesor no escribe HTML | Generar la firma desde el perfil (nombre, puesto, teléfono, tarjeta) con 1-2 plantillas; HTML bajo «Avanzado» | M |
| Tarjeta: «Slug de tu tarjeta — kebab-case; INMUTABLE una vez publicado (se imprime en QR)» | URL pública | «slug», «kebab-case»; irreversible sin confirmación; sin vista de la URL final | Autogenerar desde el nombre (ya existe `suggestedSlug`), mostrar «crm.propyte.com/t/luis-garcia», diálogo «Esta dirección no se podrá cambiar» | QW |
| Tarjeta: Ver / QR (SVG) / vCard (.vcf) | Descargas | Bien; «(SVG)» y «(.vcf)» sobran | «QR para imprimir», «Guardar contacto» | QW |
| Google Workspace: Conectar / Reconexión requerida / Desconectar | OAuth Gmail | Desconectar sin confirmación; no dice qué deja de funcionar | Confirmación con consecuencias | QW |
| Plantillas: Canal, Idioma, Nombre, «/atajo», cuerpo, «Variables: {{contact.firstName}} {{user.name}}…» | CRUD | Variables crudas; badges `WHATSAPP`/`ES`; **no hay editar**, solo crear/borrar; atajo validado solo en servidor; `brandWarnings` concatenado en un mensaje | Botones «Insertar nombre / mi nombre / mi tarjeta»; editar inline; validar atajo al escribir; badges «WhatsApp · Español» | M |
| Mi WhatsApp: «Conectar mi WhatsApp» · «Posibles prospectos» (Es prospecto / Ignorar) | Coexistencia del asesor | Muy buen copy. Solo: aviso de env vars faltantes (igual que §1) y «versión 2.24.17 o más nueva» | Mismo mensaje «pide a tu administrador»; «ten WhatsApp Business actualizado» | QW |

## 6. Propuestas priorizadas

**Quick wins (≤ ½ día c/u)**
1. Confirmaciones propias para eliminar conexión, borrar webhook, revocar API key, desconectar Gmail, borrar plantilla (T3).
2. Estado con texto + «hace N» en cada cuenta de Conexiones; mostrar `errorCount`; traducir los 5 errores más comunes de Meta.
3. Mostrar URL del webhook + Verify Token generado al terminar el alta de Lead Ads; dejar de pedir el Verify Token.
4. Aplanar errores zod en /settings y permitir vaciar campos (bug de `save()`).
5. Etiquetas en español en mapeo (metadata, destinos, enums, fallback) y resultado en tabla.
6. Copy del índice sin jerga; quitar YouTube/Pinterest «v2» y el aviso con env vars; renombrar «Leads huérfanos».
7. Secret de webhook oculto tras crear; switch de estado; nombre del webhook.
8. Borrar `connectors-section.tsx` (muerto).
9. Slug de tarjeta autogenerado con vista de URL y confirmación de inmutabilidad.

**Medio (1-2 días)**
10. Botón «Probar ahora» por cuenta existente (reusar `/test` con credenciales guardadas y `/health?probe=1` para IG/Messenger, hoy solo usado en Comentarios).
11. Mapeo con dropdown de preguntas del último lead recibido.
12. «Registrar esta cuenta» desde Huérfanos → Conexiones precargado; paginación.
13. Webhooks salientes: evento de prueba + historial de entregas.
14. Fusionar Correo + Google Workspace; firma generada desde el perfil.
15. Plantillas: editar, variables por botón, validación inline.
16. Card «WhatsApp» como hub de configuración (números, bot por línea, plantillas) en vez de link al inbox.

**Rediseño**
- R1. **Conexión de Meta por OAuth (Facebook Login for Business)** para Lead Ads, Instagram y Messenger, igual que ya hace WhatsApp coexistencia: elegir Página → listo. Elimina Page ID/Token/App Secret/Verify Token de la UI; el alta manual queda en «Avanzado» para soporte. Es la única forma de que «no sea tan complicado».
- R2. Conexiones como lista única «Cuentas conectadas» con semáforo, filtros por canal/marca y un solo botón «Agregar canal» (asistente por canal), en lugar de 5 grupos con proveedores vacíos.

## 7. Archivos involucrados
- Índice: `src/components/config/config-center.tsx`
- Conexiones: `src/app/(dashboard)/conexiones/page.tsx`, `src/components/conexiones/connections-view.tsx`, `connect-wizard.tsx`, `meta-dms-wizard.tsx`, `mapping-editor.tsx`, `brand-select.tsx`, `whatsapp-coex-connect.tsx`, `src/lib/connectors/registry.ts`, `src/lib/intake/mapping-model.ts`, `src/lib/whatsapp/coex/status.ts`
- APIs leídas: `src/app/api/admin/connectors/route.ts`, `[id]/route.ts`, `test/route.ts`, `health/route.ts`
- Huérfanos: `src/app/(dashboard)/conexiones/huerfanos/page.tsx`, `src/components/conexiones/orphan-leads-view.tsx`, `orphan-bulk.ts`
- Integraciones: `src/components/admin/integrations-tab.tsx`; muerto: `src/components/admin/connectors-section.tsx`
- Personal: `src/app/(dashboard)/settings/page.tsx`, `src/components/settings/settings-view.tsx`, `mi-whatsapp.tsx`, `src/app/api/profile/route.ts`, `src/app/api/profile/templates/route.ts`, `src/lib/validations/rebuild-f1.ts`
