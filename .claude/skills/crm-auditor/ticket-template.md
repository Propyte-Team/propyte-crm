# Plantilla de ticket y de AUDIT.md

## Ticket individual

```
### [SEVERIDAD] Título corto
- ID:        AUD-YYYYMMDD-NN
- Rol:       Asesor | Gerente | Director | Marketing | Admin | Sistemas
- Flujo:     ej. Contacto → Identificar origen
- Tipo cto:  (si aplica) LEAD | PROSPECTO | INVERSIONISTA | BROKER_EXTERNO | ...
- Origen:    (si aplica) FACEBOOK_ADS | TIKTOK_ADS | WEBSITE | ...
- Categoría: bug | missing-feature | ux | permiso-gap | automation-gap | mejora
- Severidad: crítica | alta | media | baja
- Ruta:      ej. /contacts/[id]
- Pasos:     1. ... 2. ... 3. ...
- Esperado:  ...
- Actual:    ...
- Evidencia: screenshots/AUD-YYYYMMDD-NN.png
- Prior-art: nuevo | task_manager.md BUG-NN | docs/audit-2026-06-10 | GitHub #NN
- Estado:    abierto
```

**Severidad:** crítica = bloquea el proceso de venta o expone datos; alta = flujo roto con workaround; media = UX/dato incorrecto no bloqueante; baja = cosmético/mejora menor.

## Encabezado del AUDIT.md

```
# Auditoría CRM — YYYY-MM-DD
- Entorno: crm.propyte.com (prod)
- Roles corridos: ...
- Datos QA: correo `qa+...@propyte.com`, teléfono `...` (buzones del equipo)
- Resumen: N tickets — crítica X / alta Y / media Z / baja W
- Residuo QA: ninguno | <detalle explícito>
```

Luego: (1) tabla resumen tickets por rol × severidad, (2) los tickets en detalle, (3) el checklist de teardown de `safety-contract.md` marcado.

## Regla anti-duplicado (obligatoria antes de escribir un ticket)

Cruzar cada hallazgo contra el prior-art de `references/recon-notes.md §7`:
- `docs/audit-2026-06-10/AUDIT.md` (bugs ya corregidos — no re-reportar salvo regresión).
- `task_manager.md` (triage de 22 bugs BUG-01…BUG-22 — si ya está ahí, referenciarlo, no duplicar).
- GitHub Issues (`gh issue list --repo Propyte-Team/propyte-crm`) — hoy 0, pero re-verificar.

Si el hallazgo ya existe, ponerlo en `Prior-art:` y marcarlo como "confirmado/persiste" en vez de "nuevo".
