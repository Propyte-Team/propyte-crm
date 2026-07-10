# Playbook — Director

## Persona
Acceso total, decisiones de negocio (rol de prueba `DIRECTOR`). Está en todas las allowlists (`/admin`, `/configuracion`, `/journey`, `/duplicados`, `/conexiones`) y ve todo el sidebar.

## Precondición
Login `qa-director@propyte.local`. Datos QA por `safety-contract.md`.

## Journey
1. **Reportes / KPIs / embudos** — `/reports`. Éxito: cargan con datos coherentes; embudos y KPIs se calculan. Hallazgo si algún reporte truena, tarda de más o muestra datos incoherentes.
2. **Acceso total** — verificar que entra sin bloqueo a `/admin`, `/configuracion`, `/journey`, `/duplicados`, `/conexiones`. Hallazgo (`permiso-gap`) si alguna lo bloquea indebidamente.
3. **Journey / automatizaciones** — `/journey` (canvas + `/api/admin/journey/metrics`). Éxito: se ven las reglas y su efecto por nodo. Hallazgo si el canvas no carga o las métricas están vacías/mal.
4. **Config de negocio** — `/configuracion`. Éxito: puede ver/editar configuración org-wide (equipos, territorios, campos, cadencias). Hallazgo si falta gobernanza esperada.

## Criterio de hallazgo
Enfatizar reportes/KPIs y acceso total. Cruzar contra prior-art antes de ticketear.
