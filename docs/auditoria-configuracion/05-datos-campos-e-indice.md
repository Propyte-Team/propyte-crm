# Auditoría UX de Configuración — 05: Datos & Campos e índice

Fecha: 2026-11-03 · Alcance: grupo "Datos & Campos" del centro de configuración y el índice mismo.
Solo lectura de código; sin cambios. Tamaños: **QW** = quick win (≤ ½ día) · **M** = medio (1-2 días) · **R** = rediseño.

Roles que usan estas pantallas: **Admin** (Luis / soporte técnico) configura; **Director/Gerencia** consulta y limpia datos; **Karla (ventas)** y **asesores** solo deberían ver su perfil. Hoy el índice se lo enseña casi todo a todos.

---

## 1. Índice de Configuración (`config-center.tsx`)

**Qué hace:** grid de 6 grupos / 19 tarjetas. 4 tarjetas abren un editor embebido (Automatización, Equipos, Campos, Visibilidad); el resto enlaza a `/admin?tab=…`, `/journey`, `/duplicados`, `/conexiones`, `/inbox`, `/settings`.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Subtítulos de tarjetas (`items`) | Lista de "features" bajo cada título | Jerga de motor/desarrollador visible al usuario: "Catálogo anti-sprawl", "Enforcement en API", "Autonomía L0-L2", "Reglas de flujo (8 canónicas)", "Merge humano-en-loop", "Cloud API directo", "Takeover humano", "Con dueño técnico (.local)", "Tono elegible (4 presets)", "Campos custom (Contact/Deal)", "Picklists", "Clasificador por tipo de contacto". También roadmap en producción: "Contacto (más módulos pronto)". | Sustituir cada lista por **una frase de propósito** en lenguaje de negocio ("Decide qué datos ve y edita cada puesto"). Si se quiere lista, que sean tareas ("Agregar un campo", "Ocultar un campo a los asesores"). Ver §5. | QW |
| Agrupación por módulo técnico | Grupos: Organización, Automatización, Bot, Datos & Campos, Canales, Personal | Los grupos reflejan arquitectura, no tareas. "Reglas de asignación" vive dentro de Equipos; "Visibilidad de campos" (permisos) está en Datos y no junto a Usuarios & Roles; "Leads huérfanos" (cola operativa) está en Canales; "Duplicados" (limpieza) en Datos. | Reagrupar por tarea del usuario (§5). | M |
| Mezcla administración / uso diario | Tarjetas "WhatsApp" → `/inbox`, "Leads huérfanos", "Journey", "Duplicados", "Mi perfil" | Un asesor entra a Configuración y ve 19 tarjetas, 11 con chip "Admin", y la mayoría le lleva a un callejón ("Solo ADMIN puede…"). El inbox de WhatsApp no es configuración. | Quitar "WhatsApp" del índice (ya está en el menú). Mover Huérfanos y Duplicados a un grupo "Calidad de datos" visible a Gerencia. Filtrar por rol de verdad (hoy `roles` solo se usa en Journey y Duplicados). | QW |
| Chip "Admin" | Marca tarjetas administrativas | Inconsistente: Usuarios/Comisiones (`/admin`) lo llevan, pero Bot/Playbook/Agentes/Marcas/Comentarios (también `/admin`) no; "Flujos de trabajo y SLA" tampoco aunque solo Admin edita. El chip no oculta nada, solo decora. | Reemplazar chip por filtrado real con `roles` en cada tarjeta y un texto "Solo lectura" cuando el rol puede ver pero no editar. | QW |
| Roles de Duplicados | Tarjeta visible a ADMIN/DIRECTOR | La página y la API aceptan también DEVELOPER_EXT y MANTENIMIENTO; quien no tiene permiso es redirigido en silencio a `/hoy`. | Unificar la lista de roles en un solo lugar y mostrar "No tienes acceso" en vez de redirigir. | QW |
| Navegación de secciones embebidas | `setSection` cambia la vista sin tocar la URL | Al refrescar o usar "atrás" del navegador se pierde la sección (solo el deep-link inicial `?section=` funciona). No hay breadcrumb, solo "← Configuración". | Sincronizar `section` con la URL (`router.replace`) y breadcrumb "Configuración › Campos". | QW |
| Sin búsqueda ni "para qué sirve" | — | 19 tarjetas sin buscador ni descripción de propósito; el usuario tiene que adivinar en qué tarjeta está "ocultar el presupuesto a los brokers". | Buscador de ajustes (filtra tarjetas por título/frase/sinónimos) + frase de propósito por tarjeta. | M |
| Grupo "Bot conversacional" | 5 tarjetas | Tres tarjetas con conceptos solapados (Bot: tono / Agentes conversacionales / Marcas del agente). Fuera del alcance de este reporte, pero el índice debería presentarlas como un solo "Asistente" con pestañas. | Ver auditoría del área Bot. | R |

---

## 2. Módulos & Campos (`fields-section.tsx` + `api/admin/metadata/fields`)

**Qué hace:** lista los campos personalizados de Contacto o Deal y permite al Admin crear uno y archivarlo. A pesar del título, **no gestiona módulos**. Sirve a Admin; otros roles ven la lista sin explicación.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Título y subtítulo | "Módulos & Campos — Catálogo anti-sprawl: nombre interno inmutable, archivar conserva valores" | Puro lenguaje de desarrollador; el título promete módulos que no existen. | "Campos de la ficha" / "Agrega datos propios a contactos y negocios. Puedes ocultarlos después sin perder lo capturado." | QW |
| Selector de objeto | Contacto / Deal | "Deal" en inglés; el CRM habla de negocios/oportunidades. Un `<select>` suelto arriba a la derecha sin etiqueta. | Pestañas "Contacto · Negocio" como encabezado. | QW |
| Campo "nombre interno" (`apiName`) | Primer input del formulario, placeholder `contact_mi_campo` | El usuario debe inventar un identificador técnico en snake_case con prefijo. Errores de API: `Debe iniciar con "contact_" (convención <objeto>_<snake>)`, `snake_case en minúsculas (ej. contact_referido_por)`, `"id" es un nombre reservado`. Es inmutable y nadie lo explica. | **Generarlo automáticamente** a partir de la etiqueta (`contact_` + slug sin acentos) y mostrarlo solo en un bloque "Avanzado" plegado, de solo lectura con botón "editar". | QW |
| Tipo de campo | `<select>` con TEXT, TEXTAREA, NUMBER, CURRENCY, DATE, BOOLEAN, EMAIL, PHONE, URL, PICKLIST | Claves crudas en inglés. Además la UI ofrece 10 de los 15 tipos de la API (PERCENT, DATETIME, MULTI_PICKLIST, USER, LOOKUP solo por API). | Etiquetas en español con icono y ejemplo: Texto corto, Texto largo, Número, Monto ($), Porcentaje, Fecha, Fecha y hora, Sí/No, Correo, Teléfono, Enlace, Lista (una opción), Lista (varias), Usuario. Ocultar LOOKUP bajo "Avanzado". | QW |
| Formulario de alta | 4 inputs en una fila, solo placeholders | Sin etiquetas visibles, sin marcar obligatorios, sin `<form>` (Enter no envía), sin ayuda contextual, sin "¿dónde va a aparecer este campo?". El mensaje de éxito "Campo creado ✓" es un texto gris que se pierde. | Convertir en asistente/modal de 2 pasos: (1) ¿Qué quieres capturar? etiqueta + tipo + ejemplo; (2) ¿Dónde y para quién? grupo de la ficha, obligatorio, quién lo ve (reusa la rejilla de §3). Toast de éxito con enlace "ver en la ficha". | M |
| Opciones de lista | Input "Opciones separadas por coma: Notaría 1, Notaría 7" | Solo aparece al elegir PICKLIST; una línea para N opciones; no se pueden ordenar, colorear ni editar después; el `value` se genera con acentos (`notaría_1`). | Editor de opciones en filas (agregar, ordenar, color), normalizar `value` sin acentos. | M |
| Errores de validación (400) | La API devuelve `parsed.error.flatten()` como objeto | La UI cae en "Error de validación" genérico (no es string) sin decir qué campo falló (p. ej. etiqueta vacía, nombre < 3 caracteres). | Validar en cliente antes de enviar y mapear errores de Zod por campo. Mensajes de la API en español sin referencias internas ("Solo ADMIN crea campos (PC2)" → quitar "(PC2)"; "PICKLIST requiere opciones" → "Agrega al menos una opción"). | QW |
| Aviso de similares (409) | Muestra `apiName — label` y "Crear de todos modos" | Útil, pero muestra el nombre técnico primero y el detector marca con ≥1 token en común (muchos falsos positivos: "Notaría" vs "Teléfono notaría"). | Mostrar solo etiqueta + "¿No es este?" con enlace; subir umbral o ponderar. | QW |
| Archivar | Icono sin texto con `title`; `confirm()` nativo | Única acción posible sobre un campo existente. Sin deshacer, sin ver archivados, **sin forma de restaurar** (ni la API lo permite). | Menú "⋯" por fila: Editar etiqueta/ayuda, Obligatorio, Archivar (con toast "Deshacer"). Pestaña "Archivados" con "Restaurar" (requiere `archive:false` en PATCH). | M |
| Editar campo existente | — | La API PATCH soporta etiqueta, texto de ayuda, obligatorio, buscable y orden; **la UI no expone nada de eso**. Solo por API. | Edición inline de etiqueta y ayuda; arrastre para orden. | M |
| "Permisos por rol" (ítem de la tarjeta) | — | Prometido en el índice; la API incluye `permissions` de cada campo custom pero **no hay UI** para fijarlos. Solo DB/API. | Reusar la rejilla de visibilidad (§3) para campos custom; mientras, quitar el ítem del índice. | M |
| Lista "Catálogo (N)" | Etiqueta + `apiName` en mono + badge `TEXT` + "obligatorio" + "N opciones" | Claves técnicas en cada fila; estado vacío: "Sin campos custom en este objeto. Los campos núcleo viven en el schema tipado." | Etiqueta, tipo en español, grupo de la ficha, "visible para: todos / 3 roles". Vacío: "Aún no has agregado campos propios. Los campos estándar (nombre, teléfono…) se administran en Qué ve cada puesto." | QW |
| Separación campos core / custom | Esta pantalla = solo custom; §3 = solo core | La división es por origen técnico (columna Prisma vs `CustomFieldDef`), no por tarea. El usuario quiere "los campos de la ficha" en un solo lugar. | Una sola pantalla "Campos de la ficha" con lista unificada (estándar con candado + propios) y por cada campo: visible/editable por rol. | R |

---

## 3. Visibilidad de campos (`core-fields-section.tsx` + `api/admin/metadata/core-fields`)

**Qué hace:** para un rol elegido, fija por campo estándar del Contacto si lo edita, solo lee u oculto. Sirve a Admin. Buen patrón base (segmented control por fila, guardado inmediato), pero una sola dimensión a la vez.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Subtítulo | "Controla qué campos del contacto ve y edita cada rol. Sin override = puede editar." | "override" es jerga; el índice añade "Enforcement en API". | "Por defecto todos los puestos pueden editar todo; aquí restringes." | QW |
| Selector de rol | 12 roles, default Asesor | Incluye roles técnicos (Developer ext., Mantenimiento) y Admin (¿tiene sentido ocultarle campos al Admin?). Un rol a la vez: para comparar hay que ir cambiando. | Matriz campos × roles con celdas de 3 estados, roles técnicos al final plegados; o mantener selector pero con resumen "3 ocultos · 2 solo lectura" por rol. | M |
| Botones Edita / Solo lectura / Oculto | Guarda al clic | Correcto, pero sin indicador visual de "tiene restricción" al recorrer la lista; "Error al guardar" genérico; sin acciones masivas ("ocultar todo el grupo Perfil de inversión para Broker"). | Marcar filas con restricción, acción por grupo, "Copiar permisos de otro rol". | M |
| Acoplamientos ocultos | Permiso de "Estado" cubre subestado y razón de salida; ocultar "Registrado por" oculta la lista de referidos | Documentado solo en comentarios de código (`#953`, `#907`). El usuario no se entera. | Texto de ayuda por campo: "También controla: subestado, razón de salida". | QW |
| Campos gestionados por el sistema | "Estado anterior (Zoho)", "Score", "Flujo", "Usuario de WhatsApp" aparecen como "Edita" | Son calculados o mantenidos por triggers; "Edita" es falso y confunde. | Mostrarlos con candado "lo calcula el sistema" y solo permitir Visible/Oculto. | QW |
| Solo Contacto | `object` fijo en "contact" | El índice dice "(más módulos pronto)". No hay pestaña Negocio ni mensaje claro. | Quitar la promesa del índice; cuando exista Negocio, pestañas como en §2. | QW |
| No-admin | "Solo ADMIN puede configurar la visibilidad de campos." | Llega hasta aquí porque la tarjeta se muestra a todos. | Filtrar la tarjeta por rol; para Director mostrar la rejilla en solo lectura. | QW |
| Vista previa | — | No hay forma de ver "cómo queda la ficha para un Asesor" tras configurar. | Botón "Ver ficha como Asesor" (reusa la ficha con el mapa de permisos). | M |

---

## 4. Duplicados (`app/(dashboard)/duplicados/page.tsx` → `components/contacts/duplicados-client.tsx`, APIs `contacts/duplicates` y `contacts/merge`)

**Qué hace:** lista grupos de contactos coincidentes (teléfono/email = fuerte; nombre = débil), propone un "sobreviviente" y fusiona el resto. Es **limpieza operativa** para Gerencia/Director, no configuración. Es la pantalla más clara de las tres, pero le faltan salidas.

| Opción | Qué hace | Problema | Propuesta | Tamaño |
|---|---|---|---|---|
| Subtítulo y textos | "Elige el sobreviviente y fusiona", "Coincidencia fuerte/débil", "N deals · act." | "Sobreviviente" y "deals" son lenguaje de motor/inglés. | "Elige el contacto principal; los demás se unen a él". "Mismo teléfono o correo" / "Nombre parecido". "negocios · actividades". | QW |
| Confirmación de fusión | `window.confirm("…Es reversible (soft-delete).")` | "soft-delete" es jerga y la promesa es engañosa: **no existe pantalla para deshacer** una fusión. Si falla a mitad, `alert()` y los restantes quedan sin fusionar sin aviso. | Modal propio: "Se conservará X. Se moverán N negocios y M actividades. Los otros contactos se archivarán." Reportar resultado por grupo; añadir "Deshacer fusión" en la ficha (la API ya guarda `mergedIntoId`). | M |
| Selección del principal | Radio; se preselecciona el de más negocios+actividades, luego el más antiguo | Buen default pero invisible: no dice "Sugerido" ni por qué. Nombres sin enlace a la ficha para verificar antes de fusionar. | Badge "Sugerido: más historial" y enlace a cada ficha (nueva pestaña). | QW |
| Datos que gana el principal | El servidor "enriquece" al principal con los campos vacíos del otro | No se muestra qué teléfono/correo/asesor se conserva cuando ambos tienen valor. | Vista comparativa por campo con selección (teléfono, correo, asesor, fuente) al estilo "elige el valor". | R |
| "No es duplicado" | — | No existe. Las coincidencias débiles por nombre (homónimos) reaparecen para siempre. | Botón "No son la misma persona" que registra la exclusión del par. | M |
| Volumen | Lista completa, sin paginar, sin filtro, sin contador global | Con cientos de grupos la pantalla no escala; no hay filtro por asesor, por tipo de coincidencia ni búsqueda. | Pestañas "Seguras (tel/correo)" / "Por revisar (nombre)", contador y filtro por asesor. | M |
| Ubicación en el índice | Grupo "Datos & Campos", chip Admin | Es trabajo de calidad de datos para Gerencia, igual que Leads huérfanos. | Grupo "Calidad de datos" visible a ADMIN/DIRECTOR/GERENTE. | QW |

---

## 5. Propuesta de nuevo índice de Configuración

Principio: agrupar por **tarea y persona**, una frase de propósito por tarjeta, y mostrar solo lo que el rol puede usar.

| Grupo (quién lo ve) | Tarjeta | Subtítulo propuesto |
|---|---|---|
| **Mi cuenta** (todos) | Mi perfil | Tu firma, tarjeta digital y plantillas de mensajes |
| **Equipo y permisos** (Admin; Director solo lectura) | Usuarios | Alta, puesto y acceso de cada persona |
| | Equipos y zonas | Quién atiende qué plaza y a quién le llegan los leads nuevos |
| | Qué ve cada puesto | Decide qué datos del contacto ve y edita cada rol |
| | Comisiones | Cómo se reparten las comisiones por tipo de venta |
| | Metas de actividad | Mínimos diarios y semanales de llamadas, mensajes y visitas |
| **Proceso de ventas** (Admin, Director) | Etapas del pipeline | Mapa del recorrido del cliente (hoy "Journey") |
| | Seguimientos automáticos | Recordatorios y tareas que el CRM crea solo (hoy "Cadencias") |
| | Tiempos de respuesta | Cuánto puede esperar un lead antes de alertar (hoy "SLA") |
| | Reglas automáticas | "Cuando pase X, haz Y" (hoy "8 canónicas") |
| **Fichas y datos** (Admin; Gerencia ve Calidad) | Campos de la ficha | Agrega datos propios a contactos y negocios (fusiona §2 + §3) |
| | Calidad de datos | Duplicados y leads sin asesor, listos para revisar |
| **Asistente de WhatsApp y redes** (Admin, Marketing) | Comportamiento del asistente | Tono, cuándo responde solo y cuándo pasa a un humano |
| | Guion de calificación | Preguntas que hace el asistente para calificar |
| | Perfiles por tipo de cliente | Cómo se presenta con clientes, brokers y candidatos |
| | Marcas | Qué sabe y qué ofrece por cada marca |
| | Respuestas en redes | Comentarios y mensajes automáticos en Instagram y Facebook |
| **Conexiones** (Admin) | Meta, Instagram y Messenger | Cuentas conectadas y de dónde llegan los leads |
| | WhatsApp | Número conectado y estado |
| | Avanzado: API y webhooks | Para integraciones técnicas |

Se elimina del índice: "WhatsApp → inbox" (es uso diario, ya está en el menú). Las etiquetas técnicas (SLA, Journey, cadencia, API) pueden quedar entre paréntesis en la frase de propósito durante la transición.

---

## 6. Propuestas priorizadas

**Quick wins (≤ ½ día c/u)**
1. Reescribir títulos y subtítulos de las 19 tarjetas y de las 3 pantallas en lenguaje de negocio; quitar "(PC2)", "soft-delete", "override", "anti-sprawl", "Deal", "deals".
2. Filtrar tarjetas por rol con `roles` en todas (no solo Journey/Duplicados) y quitar "WhatsApp" del índice; unificar roles de Duplicados.
3. Generar `apiName` automáticamente desde la etiqueta y esconderlo en "Avanzado"; tipos de campo con etiquetas en español.
4. Validación en cliente del alta de campo con errores por campo; aviso de similares mostrando etiquetas.
5. Visibilidad: candado en campos calculados por el sistema, texto de ayuda con acoplamientos ("también controla subestado…"), quitar "(más módulos pronto)".
6. Duplicados: badge "Sugerido", enlace a fichas, textos "contacto principal", mover a "Calidad de datos".
7. Sincronizar sección embebida con la URL + breadcrumb.

**Medio (1-2 días)**
8. Asistente de "Nuevo campo" en 2 pasos (qué capturar → dónde y para quién) con toast y enlace a la ficha.
9. Editar/archivar/restaurar campos desde la UI (menú por fila, pestaña Archivados, `archive:false`).
10. Visibilidad como matriz o con resumen por rol, acciones por grupo y "copiar de otro rol"; vista "Ver ficha como…".
11. Duplicados: modal de fusión con resumen, "No son la misma persona", pestañas Seguras/Por revisar, "Deshacer fusión".
12. Reagrupar el índice según §5 con buscador de ajustes.

**Rediseño**
13. Pantalla única "Campos de la ficha": estándar + propios, con visibilidad por rol en el mismo lugar (absorbe §2 y §3 y los "Permisos por rol" que hoy solo existen en API).
14. Fusión de duplicados con comparación campo por campo.

---

## 7. Archivos involucrados

- `src/components/config/config-center.tsx` — grupos, títulos, subtítulos, chip Admin, filtro por rol, estado de sección.
- `src/components/config/fields-section.tsx` — alta/archivo de campos custom; `src/app/api/admin/metadata/fields/route.ts` (mensajes 400/403/409/422, PATCH sin restaurar); `src/lib/metadata/governance.ts` (reglas de `apiName`, detector de similares).
- `src/components/config/core-fields-section.tsx` — visibilidad por rol; `src/app/api/admin/metadata/core-fields/route.ts`; `src/lib/metadata/core-fields-catalogo.ts` (catálogo y acoplamientos por campo); `src/lib/metadata/core-fields.ts` (enforcement).
- `src/app/(dashboard)/duplicados/page.tsx`, `src/components/contacts/duplicados-client.tsx`, `src/app/api/contacts/duplicates/route.ts`, `src/app/api/contacts/merge/route.ts`, `src/server/contacts-dedup.ts` (reglas de coincidencia, enriquecimiento, `mergedIntoId`).
