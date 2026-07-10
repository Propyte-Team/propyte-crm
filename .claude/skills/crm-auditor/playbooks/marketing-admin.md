# Playbook — Marketing / Admin

> **Dos logins distintos** — sus superficies reales difieren (recon-notes §2). `MARKETING` NO puede entrar a `/admin` ni `/configuracion` (no está en esas allowlists); sí a `/conexiones` y `/reports`. Las integraciones/API keys viven en `/admin` → esa parte va con el ADMIN temporal.

## Facet A — Marketing (login `qa-marketing@propyte.local`, rol `MARKETING`)
1. **Conectores de leads** — `/conexiones` (`LeadConnector`: META, INSTAGRAM, MESSENGER, TIKTOK, WEBSITE, ZAPIER, …). **SOLO LECTURA de credenciales** (safety-contract): revisar que la UI liste conectores, muestre estado y redacte credenciales. Hallazgo si expone secretos o la UI está rota.
2. **Reportes de marketing** — `/reports`. Éxito: KPIs de campañas/leads visibles. Hallazgo si faltan.
3. **Negative test** — intentar `/admin` y `/configuracion` por URL directa. Esperado: bloqueo/redirect. Hallazgo (`permiso-gap`) si entra.

## Facet B — Admin (login `audit-temp@propyte.local`, rol `ADMIN`)
1. **Usuarios** — `/admin`: alta/edición de usuarios (recordar el límite Zod de roles, provisioning.md). Éxito: CRUD de usuarios funciona.
2. **API keys / integraciones** — `/admin`: generar una API key QA. **Prueba de regresión (fix 2026-04-13):** al generar, la key debe mostrarse una vez en el banner sin que un reload la borre. Revocar la key QA al final. Hallazgo si la key no se muestra o el flujo se rompe.
3. **Webhooks / reglas de comisión** — `/admin`. Éxito: se ven/gestionan. Hallazgo si algo truena.
4. **Gobernanza de campos custom** — `/configuracion`: crear un campo custom QA y verificar la gobernanza anti-sprawl (`validateApiName` / `findSimilarFields`, warning ante nombres similares). Éxito: valida y advierte. Borrar/archivar el campo QA al final. Hallazgo si no valida.
5. **Plantillas / cadencias** — `/configuracion`: ver/crear plantilla y cadencia QA (inactiva por defecto). Hallazgo si falta UI o truena.

## Criterio de hallazgo
Enfatizar integraciones/API keys y gobernanza de datos. Cruzar contra prior-art antes de ticketear.
