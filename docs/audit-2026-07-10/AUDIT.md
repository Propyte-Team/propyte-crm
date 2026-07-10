# Auditoría CRM — 2026-07-10 (smoke Asesor + corrida completa 5 roles)

- **Entorno:** crm.propyte.com (prod)
- **Roles corridos:** Asesor (`ASESOR_SR`), Gerente (`GERENTE`), Director (`DIRECTOR`), Marketing (`MARKETING`), Sistemas/QA (`MANTENIMIENTO` + ADMIN)
- **Datos QA:** email `l.angelflores.23@gmail.com`, tel `+525500000710` (tel de Luis `+525576330809` colisionó con contacto existente — ver Nota de datos)
- **Alcance:** Asesor = journey de alta (lead → detalle → origen). Resto = matriz de permisos (positive+negative), acceso a módulos, observabilidad de automatizaciones. Sin outbound real.
- **Resumen:** 6 tickets — alta 3 / media 2 / baja 1
- **Residuo QA:** ninguno (verificado en BD: 0 contactos QA, 0 usuarios `qa-*`, `audit-temp` inactivo)

## Tabla resumen

| ID | Rol | Categoría | Severidad | Título |
|---|---|---|---|---|
| AUD-20260710-01 | Sistemas | bug / security | **alta** | Login de prod pre-llena credenciales de ADMIN |
| AUD-20260710-02 | Asesor | missing-feature | **alta** | El alta de contacto no permite registrar el origen real (12/21 fuentes) |
| AUD-20260710-05 | Sistemas | permiso-gap | **alta** | Rol `MANTENIMIENTO` con sidebar completamente vacío |
| AUD-20260710-03 | Asesor | ux / consistencia | media | "Tipo de contacto" incompleto en el alta (5/9) vs detalle (9/9) |
| AUD-20260710-06 | Sistemas | automation-gap | media | Motor de automatización dormido en prod (8 WF inactivas, 0 procesados 24h) |
| AUD-20260710-04 | Asesor | mejora | baja | Fuente del lead no editable desde el detalle (a verificar con lead de conector) |

---

## Tickets

### [ALTA] Login de producción pre-llena credenciales de ADMIN
- ID:        AUD-20260710-01
- Rol:       Sistemas (pre-login)
- Flujo:     Login
- Categoría: bug / security
- Severidad: alta
- Ruta:      /login
- Pasos:     1. Abrir crm.propyte.com/login en un navegador limpio (sin autofill). 2. Observar los campos.
- Esperado:  Campos vacíos en producción; jamás una contraseña pre-cargada.
- Actual:    Email y contraseña vienen rellenos con `audit-temp@propyte.local` / `Aud1t-Tmp_2026!` (cuenta rol ADMIN). Es un default de dev que llegó a prod. Aunque hoy esa clave no funcione (la cuenta estaba inactiva/rota), expone un correo ADMIN y una contraseña plausible en el DOM público.
- Evidencia: screenshots/AUD-20260710-01-login-prefill-admin.png
- Prior-art: relacionado a task_manager.md BUG-01 (audit-temp desactivado), pero el pre-fill del login en sí es nuevo.
- Estado:    abierto

### [ALTA] El alta de contacto no permite registrar el origen real del lead
- ID:        AUD-20260710-02
- Rol:       Asesor
- Flujo:     Nuevo Contacto → Fuente del lead
- Categoría: missing-feature
- Severidad: alta
- Ruta:      /contacts (dialog "Nuevo Contacto")
- Pasos:     1. /contacts → "Nuevo Contacto". 2. Abrir el dropdown "Fuente del lead *".
- Esperado:  Poder elegir cualquiera de los 21 valores de `LeadSource`, incluidos TikTok, Meta, Messenger, LinkedIn.
- Actual:    Solo lista 12/21: Walk-in, Facebook Ads, Google Ads, Instagram, Portal inmobiliario, Referido por cliente, Referido por broker, Llamada en frío, Evento, Sitio web, WhatsApp, Otro. **Faltan:** TIKTOK_ADS, META_ADS, MESSENGER, LINKEDIN, WEBINAR, LLAMADA_ENTRANTE, BASE_DE_DATOS, SELF_GEN, REGISTRO_BROKER. Un asesor no puede registrar que un lead vino de TikTok/Meta/LinkedIn → contradice directamente el objetivo "identificar de dónde proviene el cliente para darle la mejor info".
- Evidencia: screenshots/AUD-20260710-02-nuevo-contacto-form.png
- Prior-art: recon-notes §3 (los mapas de labels ES también cubren solo 12/21, triplicados y desincronizados). Ticket de UI de alta = nuevo.
- Estado:    abierto

### [MEDIA] "Tipo de contacto" incompleto en el alta (inconsistente con el detalle)
- ID:        AUD-20260710-03
- Rol:       Asesor
- Flujo:     Nuevo Contacto → Tipo de contacto
- Categoría: ux / consistencia
- Severidad: media
- Ruta:      /contacts (dialog "Nuevo Contacto") vs /contacts/[id]
- Pasos:     1. En "Nuevo Contacto" abrir "Tipo de contacto". 2. Comparar con el combo "Tipo" del detalle del contacto.
- Esperado:  Mismos 9 valores de `ContactType` en ambos lugares.
- Actual:    El alta ofrece 5/9 (Comprador, Inversionista, Broker externo, Referidor, Empleo) — faltan Lead, Prospecto, Cliente, Referido. El detalle del contacto SÍ ofrece los 9. No se puede tipificar un contacto como Lead/Prospecto/Cliente/Referido al crearlo.
- Evidencia: screenshots/AUD-20260710-02-nuevo-contacto-form.png, screenshots/AUD-20260710-03-detalle-contacto-origen.png
- Prior-art: nuevo
- Estado:    abierto

### [BAJA] Fuente del lead no editable desde el detalle del contacto
- ID:        AUD-20260710-04
- Rol:       Asesor
- Flujo:     Detalle de contacto → Origen
- Categoría: mejora
- Severidad: baja
- Ruta:      /contacts/[id]
- Pasos:     1. Abrir el detalle de un contacto. 2. Buscar cómo editar la "Fuente del lead".
- Esperado:  Poder corregir el origen si el conector lo asignó mal.
- Actual:    La fuente se muestra como texto de solo lectura (no hay combo de edición). Combinado con AUD-20260710-02, un lead de conector con origen `TIKTOK_ADS` no puede corregirse ni (probablemente) mostrar su label. **Por verificar en la corrida completa** con un lead real de conector TikTok (no exercitable en el smoke porque la UI no permite seleccionar ese origen).
- Evidencia: screenshots/AUD-20260710-03-detalle-contacto-origen.png
- Prior-art: relacionado AUD-20260710-02 + recon-notes §3
- Estado:    abierto (a verificar)

### [ALTA] Rol `MANTENIMIENTO` con sidebar completamente vacío
- ID:        AUD-20260710-05
- Rol:       Sistemas
- Flujo:     Login → navegación
- Categoría: permiso-gap / navigation
- Severidad: alta
- Ruta:      /dashboard (cualquier ruta)
- Pasos:     1. Login como usuario rol `MANTENIMIENTO`. 2. Observar el sidebar.
- Esperado:  El rol ve al menos las secciones que le corresponden.
- Actual:    El `<nav>` del sidebar sale **vacío** (ningún `navGroup` de `sidebar.tsx` incluye `MANTENIMIENTO`). El usuario entra a `/dashboard` pero no tiene ningún link para navegar. Mismo bug de clase que TEAM_LEADER (corregido en 2026-06-10) — sigue abierto para `MANTENIMIENTO` (rol canónico activo). Nota: por URL directa sí puede entrar a `/duplicados` (está en esa allowlist) pero no lo ve en el menú.
- Evidencia: screenshots/AUD-20260710-05-mantenimiento-sidebar-vacio.png
- Prior-art: recon-notes §2 (predicho); clase de bug de docs/audit-2026-06-10 (TEAM_LEADER). Nuevo para MANTENIMIENTO.
- Estado:    abierto

### [MEDIA] Motor de automatización dormido en producción
- ID:        AUD-20260710-06
- Rol:       Sistemas
- Flujo:     Configuración → Flujos de trabajo y SLA
- Categoría: automation-gap
- Severidad: media
- Ruta:      /configuracion → "Flujos de trabajo y SLA"
- Pasos:     1. Login ADMIN/DIRECTOR/GERENTE. 2. /configuracion → "Flujos de trabajo y SLA". 3. Ver Observabilidad + reglas.
- Esperado:  Las automatizaciones núcleo (speed-to-lead SLA 5min, anti-huérfano, pago vencido, etc.) operando.
- Actual:    Las **8 reglas canónicas WF1–WF8 están INACTIVAS** ("última: nunca"), **Procesados (24h) = 0**, cola vacía. La UI misma advierte "Requiere el cron `/api/cron/workflows` activo en Hostinger". La política SLA "Default Propyte" está activa con 160 timers históricos (el motor corrió antes) pero hoy nada se procesa → o el cron no está agendado (BUG-19) o las reglas nunca se activaron. El valor de automatización del CRM no está vivo en prod. (Puede ser intencional pre-go-live — confirmar con Luis.)
- Evidencia: screenshots/AUD-20260710-07-automatizaciones-inactivas.png
- Prior-art: recon-notes §6 + task_manager.md BUG-19 (cron no agendado al 2026-06-15). Confirmado persiste.
- Estado:    abierto

---

## Matriz de permisos por rol (verificada en vivo)

| Rol | Acceso positivo verificado | Bloqueo (negative) verificado | Notas |
|---|---|---|---|
| ASESOR_SR | sidebar poblado; `/contacts` scope "own" (ve solo lo propio) | — | correcto |
| GERENTE | sidebar amplio; `/pipeline`, `/configuracion`, `/admin` | `/journey` → redirect a /dashboard | botón activar workflow **disabled** (toggle = ADMIN/DIRECTOR) = correcto |
| DIRECTOR | acceso total: `/journey`, `/reports`, `/configuracion`; puede **activar** workflows / crear reglas/cadencias/políticas | — | correcto |
| MARKETING | `/conexiones` (conectores Meta/TikTok/Google/LinkedIn/Pinterest), `/reports` | `/admin` → redirect; `/configuracion` → redirect | correcto |
| MANTENIMIENTO | entra a `/dashboard` | `/admin` → redirect | **BUG AUD-05**: sidebar vacío |

**Conclusión permisos:** las 5 páginas con allowlist server-side (`/admin`, `/configuracion`, `/journey`, `/duplicados`, `/conexiones`) **bloquean correctamente** por URL directa a roles no permitidos. El gating de allowlist funciona; el problema es de **navegación/visibilidad** (MANTENIMIENTO) no de seguridad.

## Pendiente de verificar (no cubierto en esta corrida)
- **Scoping de datos por rol en `/reports`·`/commissions`·`/cobranza`** (páginas que solo checan sesión, sin allowlist): no se pudo confirmar si un rol de ventas bajo ve datos de otros asesores, porque no había datos visibles y `qa-asesor` se borró tras el smoke. Recomendación: re-correr con un asesor QA + datos sembrados en su plaza.

---

## Comportamiento correcto observado (no son hallazgos)

- **Dedup por teléfono:** el alta rechaza con 409 "Ya existe un contacto con este número de teléfono". Correcto.
- **Scoping del asesor:** `qa-asesor` (ASESOR_SR) ve 0 contactos al inicio y solo el propio tras crearlo (scoping "own" de `deals.ts`). Correcto.
- **Sidebar poblado** para `ASESOR_SR` (Hoy, Dashboard, Inbox, Contactos, Pipeline, Cotizaciones, Desarrollos, Comisiones, Cobranza, Metas, Mi Carrera, Mi Config). Sin menú vacío.

## Nota de datos (relevante para la corrida completa)

El correo/teléfono que Luis dio para QA **son sus datos reales y ya existen en el CRM**: el tel `+525576330809` pertenece al contacto de prueba previo **"Luis (prueba WhatsApp)"** (tag `prueba-wa`, creado 2026-06-11, `marketing@propyte.com`). Para futuras corridas: usar un teléfono/correo QA que NO exista ya en el CRM (o reusar ese contacto de prueba explícitamente). En este smoke se usó `+525500000710` para no tocar el contacto existente.

## Checklist de teardown (safety-contract) — ejecutado

- [x] Contacts con tag `QA_AUDIT` borrados — verificado 0 en BD
- [x] Deals QA borrados — no se crearon
- [x] Quotes/cotizaciones QA borradas — no se crearon
- [x] Activities/tasks QA borradas — no se crearon
- [x] Mensajes/hilos QA del inbox — no se crearon
- [x] Reglas/planes de automatización QA — no se crearon
- [x] Usuarios efímeros `qa-*@propyte.local` borrados — verificado 0 en BD
- [x] ADMIN temporal (`audit-temp@propyte.local`) devuelto a `isActive=false` — verificado
- [x] Residuo reportado — ninguno
