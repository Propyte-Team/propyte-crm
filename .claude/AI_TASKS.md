# Tablero de Mejoras IA — protocolo

El tablero vive en `real_estate_hub.ai_tasks`. **La base es la única verdad** —
no hay espejo en markdown. Se lee y escribe con el MCP `propyte-hub`.

`proyecto` de este repo: **`crm`**
Panel: https://hub.propyte.com/mejoras · detalle: `/mejoras/<id>` · feed: `/mejoras/actividad`

Spec y migración viven en el repo `Propyte_hub`: `specs/panel-mejoras-ia.md`

## Tomar una tarea

1. `list_records` sobre `ai_tasks` con `filter={"estado":"propuesta","proyecto":"crm"}`,
   `order="prioridad"`.
2. `update_record` a `estado='en_curso'`. **Si falla con `23505`, otra sesión ya
   tiene una tarea en curso en este proyecto** — no la pises, vuelve a pedir la lista.
3. **Relee la fila.** Un UPDATE plano en este proyecto ya reportó éxito
   escribiendo cero. Dentro del Hub, usa `actualizarTarea` de
   `src/lib/mejoras/store.ts`, que ya lo hace.

## Trabajar

- Rama `mejora/<id>-<slug>`, basada en `origin/main` (no en el `main` local).
- **En un `git worktree` propio.** El árbol principal lo comparten varias
  sesiones y su rama cambia sin avisar.
- Nunca mergear ni desplegar. La puerta humana está en el merge.
- `gh` no está en el PATH: `"/c/Program Files/GitHub CLI/gh.exe"`.

## Cerrar: pasar a `en_revision`

Escribir de una sola vez: `pr_url`, `verificacion`, `evidencia`, `resumen_humano`,
`impacto`, `repo_branch`, y `estado='en_revision'`.

**`resumen_humano` es obligatorio en la base.** Reglas: sin nombres de archivo,
sin nombres de función, sin jerga de framework. Dice qué cambió *para el
usuario*. Nunca incluye `nombre_desarrollo`.

**`evidencia.negativo`** — uno de:

| valor | cuándo |
|---|---|
| `probado` | corriste la verificación contra prod ANTES del arreglo y **falló en todas las corridas**, y contra la rama pasó |
| `no_aplica` | sin efecto observable: docs, tipos, refactor puro, lint |
| `inexistente` | funcionalidad nueva: el negativo sería tautológico |
| `riesgoso` | reproducirlo escribiría en producción. **Requiere `motivo`** |

Se registran `corridas` y `fallos`, no un veredicto. Un negativo que falla 1 de 5
veces no es prueba, y el panel lo rotula como no concluyente:

```jsonc
{
  "negativo": "probado",
  "prod_antes":   { "corridas": 5, "fallos": 5, "salida": "…" },
  "rama_despues": { "corridas": 5, "fallos": 0, "salida": "…" }
}
```

## Encontrar algo que no te toca

`create_record` con `origen='sesion'` y un `dedupe_hash`. **No** expandas el
alcance de tu tarea actual.

## Nunca

- Escribir `id` (columna generada; el INSERT falla con `428C9`).
- Poner `estado='desplegada'` a mano — la pone el verificador tras medir prod
  doce veces, y solo si `evidencia.negativo` lo respalda.
- `DELETE` — el MCP lo bloquea con 405.
- Copiar el `ignoreDuplicates` de `scripts/mejoras/cosechar.ts` a un auditor: la
  cosecha es un pase único y ahí saltar es correcto; un auditor recurrente debe
  **actualizar** `persistencia`. Ver `specs/puerta-mejoras-remota.md` §9.5.

## Si vienes de Cowork o claude.ai

Este protocolo asume Claude Code por stdio. Esos clientes no hablan stdio ni
pueden mandar cabeceras: su camino es `specs/puerta-mejoras-remota.md`, un
servidor MCP remoto con el secreto en la ruta.
