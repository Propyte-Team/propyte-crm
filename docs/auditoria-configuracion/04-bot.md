# Auditoría UX — Configuración · grupo "Bot conversacional"

Fecha: 2026-11-03 · Alcance: las 5 tarjetas del grupo en `/configuracion` → `/admin?tab=bot|playbook|botAgents|botBrands|comments`.
Roles que llegan aquí: ADMIN, DIRECTOR, GERENTE (`admin/page.tsx`); MARKETING solo a `/admin/comentarios`. Karla (ventas) y asesores no ven nada de esto.

Resumen en una frase: el grupo expone el motor (niveles L0-L2, claves `firstName`/`budgetMin`, prompts crudos, slugs, IDs de Meta) y reparte **el mismo concepto en tres pantallas** (tono y playbook se eligen en Bot, en Agentes y en Marcas) sin decir cuál manda. No hay forma de probar el bot antes de encenderlo, salvo en Comentarios.

---

## 0. Problemas transversales

| # | Problema | Dónde | Propuesta | Tamaño |
|---|---|---|---|---|
| T1 | **Tono y playbook se configuran en 3 lugares** (global → agente por tipo de contacto → marca) y la pantalla no explica la precedencia. El usuario cambia el tono global y "no pasa nada" porque la marca lo pisa. | bot-config-tab, bot-agents-tab, brand-form-dialog | Un bloque fijo "¿Con qué contesta el bot?" que muestre la cadena resuelta (Marca X → Agente Brokers → global) y, en cada selector heredado, texto "Hereda: Profesional-cálido (global)". A mediano plazo: una sola pantalla "Bot" con pestañas Marcas / Segmentos en vez de tres tarjetas. | medio (texto) / rediseño (fusión) |
| T2 | **No se puede probar el bot** antes de encenderlo (solo Comentarios tiene probador). | todas menos comments | "Probar conversación": panel lateral que simula un chat con la config actual (marca + tipo de contacto + tono) en seco, sin tocar WhatsApp. Reusar el pipeline de `bot-respond` en modo dry-run. | rediseño |
| T3 | Errores y confirmaciones con `alert()` / `window.confirm()` nativos en Agentes, Marcas y Comentarios; toasts en Bot y Playbook. | bot-agents-tab, brand-form-dialog, comment-rules-tab | Unificar en toast + `Dialog` de confirmación. | quick win |
| T4 | Errores de validación llegan crudos de zod ("key debe ser snake_case minúscula", "Los tipos de contacto no son válidos", `fieldErrors` concatenados). | playbook-tab, bot-agents-tab, brand-helpers `apiErrorMessage` | Validar en cliente antes de mandar y mapear mensajes a español de negocio. | quick win |
| T5 | Jerga en el **índice** de Configuración: "Autonomía L0-L2", "Clasificador por tipo de contacto", "Identidad + playbook por segmento". | config-center.tsx | Reescribir ítems: "Cuándo contesta solo", "Qué pregunta a cada tipo de cliente", "Cómo se presenta cada marca". | quick win |
| T6 | Sin estado "cambios sin guardar" ni confirmación al salir; cada tab tiene su propio botón Guardar en lugar distinto (abajo, por fila, en modal). | todas | Barra sticky "Tienes cambios sin guardar · Guardar / Descartar" compartida. | medio |

---

## 1. Bot: tono y comportamiento (`/admin?tab=bot`)

Sirve a gerencia/dirección: define cómo contesta el bot en las cuentas sin marca. Archivo: `src/components/admin/bot-config-tab.tsx`, `bot-channels.ts`, `src/server/bot-config.ts`, `bot-config.schema.ts`, `src/lib/bot/config.ts`, `tone-presets.ts`.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Bot activo (checkbox) | Enciende/apaga el bot global. | No dice que las marcas con agente propio siguen contestando; checkbox sin estilo, no switch. | Switch con texto "Apagado: nadie contesta solo en cuentas sin marca. Las marcas con agente encendido siguen." | quick win |
| Canales en que contesta | WhatsApp / Instagram / Messenger. | Bien etiquetado. El esquema acepta SMS pero la UI no lo muestra (ok, oculto a propósito). | Mantener. Agregar "Ver cuentas afectadas" (link a /conexiones). | quick win |
| Tono → Preset | 4 presets con ejemplo Cliente/Sage. | "Preset" es jerga; el nombre "Sage" está hardcodeado; no se ve que marcas/agentes lo pisan. | Label "Estilo de conversación"; ejemplos como burbujas de chat; nota "Las marcas y agentes con tono propio no cambian". | quick win |
| Autonomía L0 / L1 / L2 | Sugiere / envía con aprobación / autónomo. | **Claves técnicas visibles** ("L2 — autónomo con red"). Default L2 sin explicar "red". | Radio con 3 tarjetas en español: "Solo sugiere al asesor", "Pide aprobación antes de enviar", "Contesta solo (escala a humano si hay queja, apartado, tema legal o negociación)". Quitar L0/L1/L2 del texto. | quick win |
| Arranque WARM_NAME / DIRECT | Saludo con nombre o directo. | Opción menor que distrae. | Mover a "Avanzado" plegado; o mostrar ejemplo de cada uno. | quick win |
| Longitud máxima (líneas) 1–8 | Tope de líneas por respuesta. | Número sin contexto; nadie sabe qué es "4 líneas". | Selector "Corto (2) / Normal (4) / Largo (6)" con ejemplo. | quick win |
| Data-gate estricto (no inventar cifras) | El bot no inventa precios. | **Jerga "data-gate"**; nadie debería apagarlo. | Eliminar del formulario (siempre true) o mover a Avanzado como "Permitir cifras aproximadas". | quick win |
| Modelo (Claude Sonnet 5.5 …) | Modelo de IA. | Decisión técnica y de costo que gerencia no debe tocar; IDs de modelo. | Ocultar bajo "Avanzado (solo ADMIN)" o sacarlo a variable de entorno. | quick win |
| Escalamiento (prometido en la tarjeta) | `escalationTriggers` (apartar, queja, legal_fiscal, negociacion). | **No existe UI**: la tarjeta lo anuncia, la pantalla no lo muestra. Se guarda lo que ya había. | Lista de chips "Pasa a humano cuando…" con los 4 defaults y posibilidad de agregar. | medio |
| Clasificar contactos (`classifyContacts`) | El bot detecta tipo de contacto. | No editable; solo vive en el motor. | Mostrar como switch en Agentes ("Detectar tipo de contacto automáticamente"). | quick win |
| Guardar configuración | Un botón al final. | Sin dirty state; error zod crudo en toast. | Ver T4/T6. | quick win |

Fricción extra: 4 cards apiladas sin jerarquía; lo importante (encendido, canales, cuándo contesta solo) pesa igual que modelo y arranque. Propuesta: 2 bloques "Básico" y "Avanzado" plegado.

---

## 2. Playbook de calificación (`/admin?tab=playbook`)

Sirve a gerencia/ventas: define qué datos pide el bot y en qué orden. Archivos: `playbook-tab.tsx`, `src/server/bot-playbook.ts`, `bot-playbook.schema.ts`, `src/lib/bot/playbook/fields.ts`.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Selector de playbook + "(activo)" | Elige cuál editar. | "Activo" es solo el global; agentes y marcas eligen otro y el usuario no lo ve. | Mostrar junto a cada playbook quién lo usa ("Global · Agente Brokers · Marca Nativa"). | medio |
| Crear playbook base | Crea uno vacío llamado "Calificación". | Cada clic crea otro "Calificación" idéntico → duplicados con el mismo nombre. No hay plantillas. | Pedir nombre al crear + plantillas ("Comprador", "Broker", "Reclutamiento") con tareas precargadas. | medio |
| Activar / Desactivar | Pone `activePlaybookId`. | Botón separado de Guardar: activar NO guarda las tareas editadas; nadie lo sabe. | Un solo "Guardar" + switch "Es el playbook global" dentro del form; o avisar "Guarda antes de activar". | quick win |
| Eliminar playbook | Borra. | `window.confirm`; si era el activo, el bot se queda sin playbook en silencio. | Dialog con aviso "Es el activo: el bot dejará de calificar". Bloquear si una marca/agente lo usa. | quick win |
| Nombre | Texto. | Ok. | — | — |
| Tarea → Objetivo | Frase que guía al bot. | Ok (placeholder útil). Máximo 500 sin contador. | Contador. | quick win |
| Tarea → Campo destino | Dónde se guarda. | **Claves crudas en inglés**: `firstName`, `budgetMin`, `preferredZone`, `purchaseTimeline`, `custom.xyz`. Grupos "Nativos / Custom". | Etiquetas en español ("Nombre", "Presupuesto mínimo", "Zona de interés", "Cuándo compra") con la clave solo en tooltip; grupos "Del contacto / Personalizados". | quick win |
| Tarea → Tipo de captura | Cómo interpreta la respuesta. | Etiquetas ya en español, pero el usuario no entiende "Monto" vs "Rango de presupuesto" ni "Zona". Se auto-asigna al elegir campo nativo: ¿para qué mostrarlo? | Ocultar cuando el campo es nativo (ya viene fijo); mostrar solo para custom con 4 opciones simples. | quick win |
| Tarea → Opciones (ENUM) | `valor:sinónimo1,sinónimo2` por línea. | **Mini-lenguaje en textarea monoespaciada**; valores nativos en inglés (`IMMEDIATE`, `ONE_TO_THREE_MONTHS`, `END_USER`). | Lista de filas "Opción | Cómo lo dice el cliente (chips)"; valores nativos con etiqueta en español y clave oculta. | medio |
| Tarea → Obligatoria / Omitir si ya está lleno | Flags. | Sin ayuda. "Omitir si ya está lleno" casi siempre true. | Tooltip; dejar "Omitir" como default oculto en Avanzado. | quick win |
| `extractionHint` | Pista para el extractor. | Existe en datos, **no se puede editar**. | O exponer como "Pista para el bot (opcional)" o quitar del modelo de UI. | quick win |
| Reordenar (drag) | Orden de preguntas. | Bien. Sin flechas para teclado/móvil. | Botones ↑↓ además del drag. | quick win |
| Guardar | Guarda todo. | Límite de 30 tareas no se avisa; error "key debe ser snake_case" si falla. | Validación en cliente. | quick win |
| Vista previa | — | **No existe**: no se ve cómo quedará la conversación. | Columna derecha "Así lo pregunta el bot" generada a partir de objetivos + tono. | medio |

---

## 3. Agentes conversacionales (`/admin?tab=botAgents`)

Sirve a gerencia: una "persona" del bot por tipo de contacto (Comprador, Broker, Reclutamiento…). Archivos: `bot-agents-tab.tsx`, `src/server/bot-agents.ts`, `bot-agents.schema.ts`.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Texto de cabecera | Explica clasificador. | Habla de "clasifica", "flujo global", "segmento": jerga. | "El bot detecta si escribe un comprador, un broker o un candidato y usa el agente de ese tipo. Si no hay, usa la configuración general." | quick win |
| Nombre | Texto. | Ok. | — | — |
| Activo (checkbox) | Habilita el agente. | Nace apagado sin decirlo; no se ve qué tipos quedan sin agente. | Resumen arriba: "Compradores → Agente Ventas · Brokers → sin agente (usa global)". | medio |
| Prioridad (input numérico) | Desempate si un tipo está en dos agentes. | **Campo sin etiqueta**, solo `title` al hover; concepto de motor. | Ocultar; si dos agentes activos comparten tipo, bloquear con mensaje "Brokers ya lo atiende Agente X". | quick win |
| Chips de tipo de contacto | Qué tipos atiende. | Bien (etiquetas del CRM). | — | — |
| Identidad y misión (textarea) | Va al prompt. | Placeholder dice "entra al prompt del bot": **el usuario redacta un prompt**. Sin ejemplo ni plantilla. | Campos guiados: "Se presenta como…", "Su objetivo es…", "Nunca debe…" que se arman en prompt por detrás; botón "Usar ejemplo". | medio |
| Playbook / Tono (selects) | Override por agente. | Duplica Bot y Marcas (T1). Etiqueta "Cálido cercano MX" distinta a "Cálido-cercano (MX)" del tab Bot. | Mostrar valor heredado; unificar etiquetas importando `TONE_PRESETS`. | quick win |
| Guardar / Eliminar por fila | Persisten cada agente. | `alert()` para errores; sin dirty state por fila; "Sin agentes. Crea uno o **corre el seed de la migración**" (texto para devs). | Toast, badge "sin guardar", vacío: "Aún no hay agentes. Crea el primero". | quick win |
| Probar | — | No existe. | Ver T2. | rediseño |

---

## 4. Marcas del agente (`/admin?tab=botBrands`)

Sirve a dirección/marketing: cómo se presenta el bot por marca (Nativa, Propyte…), su conocimiento y catálogo. Archivos: `brands/brands-tab.tsx`, `brand-form-dialog.tsx`, `brand-helpers.ts`, `src/lib/validations/brand.ts`, API `/api/admin/brands`.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Lista de marcas | Tarjeta por marca con estado y cuentas. | Bien. "Usa el bot global" en la predeterminada confunde (¿está encendida o no?). | Badge "Sigue la configuración de Bot (encendido)" leyendo `botEnabled` global. | quick win |
| Editar predeterminada | Solo renombra. | El usuario abre el modal esperando editar conocimiento y solo ve Nombre. | Explicar en la tarjeta y ofrecer link "Configurar en Bot". O permitir conocimiento también en la predeterminada. | quick win / medio |
| Identificador (slug) | Clave técnica inmutable. | **Técnico, visible y obligatorio**; se autogenera. | Ocultar; generar siempre desde el nombre. Mostrar en Avanzado solo lectura. | quick win |
| Presentación (persona) | Prompt de identidad. | Placeholder "Eres el asistente comercial de {Marca}, …": **prompt crudo en 2ª persona**. Mismo concepto que "Identidad" en Agentes. | Campos guiados (nombre del asistente, cómo se presenta, qué ofrece) o plantilla. Unificar con Agentes. | medio |
| Conocimiento (textarea 20 000) | Lo que el bot puede citar. | Un bloque libre gigante; help text en mayúsculas "QUÉ NO SE PUEDE DECIR". Sin estructura ni validación de lo esencial. | Secciones plegables: Precios y promos · Crédito/pagos · Horarios y contacto · No decir. Botón "Plantilla". Aviso si faltan precios. | medio |
| Desarrollos del Hub | Catálogo por marca. | Buscador bueno. Los ya guardados muestran el **id crudo** hasta que aparecen en una búsqueda (`devNames[id] ?? id`). Tope 20 solo al llegar. | El API de GET brands devuelva nombres; mostrar "x/20". | quick win |
| Plaza predeterminada | Plaza. | Ok. | — | — |
| Tono / Playbook / Responsable | Overrides. | Tres formas de decir "hereda": "Usar el global", "Ninguno", "El global". | Unificar: "Igual que el bot general (X)". | quick win |
| Canales + "Usar los globales" | Canales de la marca. | Bien; validación clara. | — | — |
| Agente encendido | Prende el bot de la marca. | Deshabilitado al crear (flujo de 2 pasos a propósito); `window.confirm` si no hay conocimiento. | Mantener la regla; reemplazar confirm por aviso inline "Sin conocimiento el bot solo saluda y escala". | quick win |
| Cuentas asignadas | Qué conectores usan la marca. | Se asignan en otra pantalla (Conexiones). | Botón "Asignar cuentas" que abra selector aquí. | medio |
| Probar | — | No existe. | Ver T2. | rediseño |

---

## 5. Reglas de comentarios (`/admin?tab=comments` y `/admin/comentarios`)

Sirve a marketing: palabra clave en IG/FB → respuesta pública + DM. Archivos: `comments/comment-rules-tab.tsx`, `comment-rule-dialog.tsx`, `comment-rule-tester.tsx`, `comment-rule-logs.tsx`, `comment-accounts-health.tsx`, `app/(dashboard)/admin/comentarios/page.tsx`, APIs `/api/admin/comment-rules*`, `/api/admin/connectors/health`.

Es la pantalla mejor resuelta del grupo (probador, historial, diagnóstico, avisos de choque). Lo que queda:

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Lista de reglas | Resumen por regla. | Estados en mayúsculas "ACTIVA / EN PAUSA"; línea de métricas densa. | Switch pausar/activar en la fila; estados en minúscula. | quick win |
| Cuenta | Conector IG/FB. | Mensaje de vacío manda a "Admin → Integraciones" (ruta equivocada; es Conexiones). | Corregir link a `/conexiones`. | quick win |
| Frases que disparan / negativas | Chips. | Muy bien explicado. | — | — |
| Respuestas públicas (rotan) | Hasta 5 variantes. | Bien. | — | — |
| Mensaje privado (DM) | Plantilla con `{{usuario}}`. | Variable técnica con llaves. | Botón "Insertar nombre del usuario". | quick win |
| Publicaciones (opcional) | Filtro por post. | **Pide IDs crudos de Meta ("MEDIA-1"), no URLs**; hay que esperar al primer comentario para copiarlo del log. | Selector de publicaciones recientes vía Graph (thumbnail + fecha); aceptar URL de FB y resolverla. | medio |
| Prioridad | Desempate. | Número; ya hay aviso de choque en cliente. | Mover a Avanzado. | quick win |
| Tope diario | Fusible antispam. | Bien explicado. | — | — |
| Modal 9 campos en columna | — | Largo; lo básico y lo avanzado pesan igual. | Agrupar: Básico (cuenta, nombre, frases, respuestas, DM) / Avanzado (negativas, posts, prioridad, tope). | quick win |
| Probar una regla | Simulador en seco. | Modelo a seguir para el resto del bot. | — | — |
| Historial | Logs con reintento. | Estados crudos "público: SENT", "DM: FAILED"; "regla borrada". | Traducir (Enviado / Falló / Omitido / Pendiente). | quick win |
| Diagnóstico de cuentas | Revisa credenciales y webhook. | Texto menciona `feed`, `comments`, objeto `instagram`: inevitable pero sin "qué hacer". | Encabezar cada hallazgo con la acción ("Pulsa Suscribir página" / "Pide a un admin de Meta habilitar comentarios de Instagram en la app"). | quick win |
| Ruta `/admin/comentarios` | Puerta para MARKETING. | El back link dice "← Dashboard" en vez de "← Configuración". | Unificar chrome con `/admin`. | quick win |
| Errores | `alert()` al pausar. | T3. | Toast. | quick win |

---

## 6. Propuestas priorizadas

### Quick wins (≤ medio día cada una)
1. Renombrar autonomía: quitar L0/L1/L2, tres opciones en español con descripción (bot-config-tab).
2. Ocultar bajo "Avanzado": Modelo, Arranque, Data-gate (fijo en true), Prioridad (agentes y comentarios), slug de marca.
3. Campo destino del playbook con etiquetas en español y clave en tooltip; ocultar "Tipo de captura" para campos nativos; opciones ENUM nativas traducidas (`fields.ts` + mapa de labels).
4. Texto "Hereda: X (global)" en todos los selectores de tono/playbook de Agentes y Marcas; unificar wording "Igual que el bot general".
5. Reescribir ítems de las 5 tarjetas del índice sin jerga (config-center.tsx).
6. Reemplazar `alert/confirm` por toast + Dialog en Agentes, Marcas y Comentarios; mapear errores zod a español.
7. Comentarios: estados traducidos, link a /conexiones, botón "Insertar nombre", modal en Básico/Avanzado.
8. Playbook: pedir nombre al crear, avisar "guarda antes de activar", flechas ↑↓, contador de caracteres.
9. Agentes: etiqueta visible para prioridad (o quitarla), vacío sin "seed de la migración", switch "Detectar tipo de contacto".
10. Marcas: GET devuelve nombres de desarrollos; aviso inline en vez de confirm al encender sin conocimiento.

### Medio (1–2 días)
- UI de escalamiento ("Pasa a humano cuando…") en Bot, que hoy la tarjeta promete y no existe.
- Resumen "¿Quién contesta?" (marca → agente → global) arriba de Bot, Agentes y Marcas.
- Playbook: plantillas (Comprador / Broker / Reclutamiento), editor de opciones ENUM con filas y chips, vista previa "Así lo pregunta el bot", "usado por" en el selector.
- Conocimiento de marca con secciones plegables y plantilla; presentación/identidad con campos guiados compartidos entre Agentes y Marcas.
- Selector de publicaciones recientes en reglas de comentarios.
- Barra sticky de cambios sin guardar común a los 5 tabs.

### Rediseño (> 2 días)
- "Probar conversación": sandbox en seco con la config efectiva (marca + tipo de contacto + playbook + tono), accesible desde Bot, Agentes y Marcas.
- Fusionar Bot / Agentes / Marcas en una sola pantalla "Bot" con pestañas General · Por marca · Por tipo de contacto, y Playbooks como sub-recurso ("Qué pregunta"). Elimina la triple duplicación de tono/playbook.
- Asistente de primera configuración (4 pasos: canales → cómo se presenta → qué pregunta → cuándo pasa a humano) que deja todo encendido con defaults sensatos.

---

## 7. Archivos involucrados

- Índice: `src/components/config/config-center.tsx`; contenedor `src/components/admin/admin-content.tsx`, `src/app/(dashboard)/admin/page.tsx`.
- Bot: `src/components/admin/bot-config-tab.tsx`, `bot-channels.ts`, `src/server/bot-config.ts`, `bot-config.schema.ts`, `src/lib/bot/config.ts`, `src/lib/bot/tone-presets.ts`, `src/lib/bot/model.ts`.
- Playbook: `src/components/admin/playbook-tab.tsx`, `src/server/bot-playbook.ts`, `bot-playbook.schema.ts`, `src/lib/bot/playbook/fields.ts`.
- Agentes: `src/components/admin/bot-agents-tab.tsx`, `src/server/bot-agents.ts`, `bot-agents.schema.ts`, `src/lib/constants.ts` (CONTACT_TYPE_LABELS).
- Marcas: `src/components/admin/brands/brands-tab.tsx`, `brand-form-dialog.tsx`, `brand-helpers.ts`, `src/lib/validations/brand.ts`, `src/app/api/admin/brands/**`.
- Comentarios: `src/components/admin/comments/*.tsx`, `src/app/(dashboard)/admin/comentarios/page.tsx`, `src/app/api/admin/comment-rules/**`, `src/app/api/admin/connectors/health`, `src/lib/comments/match.ts`.
