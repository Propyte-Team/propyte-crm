# Playbook — Gerente / Team Leader

## Persona
Supervisa asesores y la distribución de leads (rol de prueba `GERENTE`). Acceso a `/admin`, `/configuracion`, `/conexiones` (allowlists lo incluyen), además de Walk-ins, Reportes, Comisiones/Cobranza/Metas (sidebar).

## Precondición
Login `qa-gerente@propyte.local`. Datos QA por `safety-contract.md`.

## Journey
1. **Ver leads del equipo** — `/contacts` / `/pipeline`. Éxito: ve leads más allá de los propios (scoping de liderazgo: `FULL_ACCESS`/`PLAZA`/`TEAM`, `src/server/deals.ts:56-96`). Hallazgo si solo ve los suyos o ve de más (cross-plaza indebido).
2. **Asignar / reasignar un lead QA** — reasignar el deal QA a otro asesor desde `/pipeline` o el detalle del contacto. Éxito: cambia `assignedToId` y persiste tras recargar. Hallazgo si no puede reasignar.
3. **Reglas de ruteo (RoutingRule)** — buscar en la UI dónde se configuran (probable `/configuracion` o `/conexiones`). Éxito: existe UI para ver/crear reglas de ruteo y territorios. **Hallazgo (`missing-feature`) si el modelo existe pero no hay UI para gestionarlo.**
4. **Desempeño de asesores** — `/reports`. Éxito: métricas por asesor visibles y coherentes con los datos. Hallazgo si faltan o son incoherentes.

## Criterio de hallazgo
Igual que los demás; enfatizar ruteo/asignación y visibilidad de equipo (scoping correcto). Cruzar contra prior-art antes de ticketear.
