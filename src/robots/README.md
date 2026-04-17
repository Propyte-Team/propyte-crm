# Robots de sync `public.*` → `real_estate_hub.Propyte_*`

Pipeline Node/TypeScript que lee los scrapers de Felipe (`public.*`, read-only) y escribe a nuestro schema curated `real_estate_hub.Propyte_*`.

Ver diseño completo en `~/.claude/plans/quirky-stargazing-reef.md` y contexto en `~/.claude/projects/c--Users-Luis/memory/project_supabase_new.md`.

## Robots

| # | Nombre | Cron | Función |
|---|---|---|---|
| 01 | classifier + extractor | Cada 6h | Agrupa properties por `development_name`, dedupe developers con `pg_trgm`, upsert desarrollos/unidades. Incluye amenities mapper (Robot 3 está integrado aquí). |
| 02 | image sync | Cada 6h (+30min) | Pobla `fotos_unidad[]` y `fotos_desarrollo[]` desde `public.property_images`. Solo de `status='published'` (SENSITIVE). |
| 04 | geo enrichment | Diario 3am | Nominatim OSM para desarrollos sin lat/lng. Rate limit 1 req/seg. |
| 05 | AI content fallback | Manual | Claude Haiku para llenar `metaTitle`/`metaDescription`/`hero` en unidades publicadas con content incompleto. Defensivo: nunca sobreescribe. |

## Idempotencia

Claves canónicas de dedup:

- `Propyte_desarrolladores.nombre_desarrollador` (lower, pg_trgm similarity > 0.8)
- `Propyte_desarrollos (lower(nombre_desarrollo), COALESCE(id_desarrollador, 'NULL'))`
- `Propyte_unidades.ext_legacy_property_id` (= `public.properties.id` UUID)

Re-correr cualquier robot **nunca** crea duplicados.

## Tie-breaker para campos en conflicto

Cuando varias properties del mismo desarrollo reportan datos distintos, `source-priority.ts` aplica:

1. `status = 'published'` gana sobre `'review'`
2. Whitelist de sources (goodlers > propiedadescancun > caribeluxuryhomes > plalla > luumore > noval)
3. `last_seen_at DESC`

Campos **sensibles** (título, descripción, fotos, URLs, teléfonos) **solo** se leen de `status='published'`. Si ninguna está published → queda NULL (mejor vacío que contaminado con data de rival).

Ver lista completa en `shared/field-sensitivity.ts`.

## Uso local

```bash
# Smoke test (valida shared utilities + DB)
npm run robot:smoke

# Aplicar migrations pendientes (idempotente)
npm run robot:migrate

# Dry-run (no escribe)
npm run robot:01 -- --dry-run --limit 10

# Real run
npm run robot:01 -- --limit 50
npm run robot:01           # todo el dataset

# Verificar estado post-run
npm run robot:verify
```

## Variables de entorno requeridas

| Variable | Requerido | Fuente |
|---|---|---|
| `SUPABASE_DB_PASSWORD` | Sí | Dashboard Supabase → Settings → Database |
| `BANXICO_API_TOKEN` | No (fallback=20) | https://www.banxico.org.mx/SieAPIRest/service/v1/token |
| `ANTHROPIC_API_KEY` | Solo Robot 5 | console.anthropic.com |

## Observabilidad

Cada run escribe una row a `real_estate_hub.Propyte_robot_runs` con:
- `status`: running / success / partial / failure / dry_run
- `outputs`: métricas jsonb (props_read, desarrollos_upserted, amenities_matched, etc.)
- `errors`: array jsonb con `{property_id, error, stack}` si hubo fallos
- `duration_ms`, `host` (local / github-actions), `git_sha`

Consultar:
```sql
SELECT robot_name, status, duration_ms, outputs, started_at
FROM real_estate_hub."Propyte_robot_runs"
ORDER BY started_at DESC LIMIT 10;
```

## GitHub Actions

Los workflows en `.github/workflows/robot-0*.yml` corren por cron + `workflow_dispatch`.

**Secrets requeridos en el repo**:
- `SUPABASE_DB_PASSWORD`
- `BANXICO_API_TOKEN`
- `ANTHROPIC_API_KEY`
