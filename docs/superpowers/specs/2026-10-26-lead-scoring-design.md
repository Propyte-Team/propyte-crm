# Lead scoring — diseño

**Fecha:** 2026-10-26 · **Estado:** F1 + F2 implementadas (modo sombra) y F3 lista detrás de bandera
apagada; F4 con acciones de servidor, sin pantalla · **Base:** `origin/main` @ `9b041ef0`
**Referencia externa:** `server/services/lead-scoring.ts` de GoHyperLevel (AGPL-3.0 — se toma la idea,
no el código): reglas de propiedad y de evento, topes por regla, decaimiento por inactividad, umbrales
con etiqueta y un desglose que explica cada punto.

**Decisiones ya tomadas (Luis, 2026-10-26):** spec antes que código · las cuatro familias de señales
(perfil, fuente/campaña, conversación, web y citas) · arranque en **modo sombra**.

## 1. Lo que ya existe: el score se lee en todos lados y nadie lo escribe

`Contact.score Int @default(0)` existe desde el inicio y ya tiene **cuatro consumidores**:

| Consumidor | Dónde | Qué hace con el score |
|---|---|---|
| Meta CAPI | `lib/capi/events.ts` | Manda `leadQualityTier` (`≥80 high · ≥50 medium · low`) en **cada** evento, y dispara `QUALIFIED` si `score ≥ capi.qualified_score_threshold` (default 70) |
| Ciclo de vida | `lib/lifecycle/transitions.ts` | Con la señal `contact.scored`: `≥ umbral → SQL`, `≥ umbral/2 → MQL` |
| Workflows | `lib/workflows/engine.ts` | Trigger `SCORE_THRESHOLD` escucha `contact.scored` |
| Ruteo / territorios | `lib/teams/territory.ts`, reglas de ruteo | El score es una condición disponible |

**Pero no hay ningún código que calcule `score` ni que emita `contact.scored`** (buscado en
`origin/main`: solo lecturas, selects y exports). Consecuencias hoy:

- A Meta le llega `leadQualityTier: "low"` para **todos** los leads → la señal de calidad no aporta nada a
  la optimización.
- `QUALIFIED` solo sale por `DISCOVERY_DONE`, nunca por score.
- MQL/SQL por score y los workflows `SCORE_THRESHOLD` están muertos.

**Por eso el modo sombra no es opcional:** en cuanto `score` deje de ser 0, los cuatro consumidores
cambian de comportamiento a la vez, incluida la señal que recibe Meta para optimizar las campañas.

## 2. Modelo

Escala **0–100** (la que ya asumen los umbrales de CAPI: 50 / 70 / 80).

```ts
interface ReglaScore {
  id: string;
  familia: "perfil" | "fuente" | "conversacion" | "web_citas";
  tipo: "propiedad" | "evento";
  etiqueta: string;              // «Compra inmediata», «Respondió por WhatsApp»
  puntos: number;                // puede ser negativo
  campo?: string; op?: Op; valor?: string;   // tipo "propiedad"
  evento?: SeñalEvento; dentroDeDias?: number; // tipo "evento"
  maxPuntos?: number;            // tope de la regla (eventos repetidos)
}
interface ModeloScore {
  version: number;
  reglas: ReglaScore[];
  topesPorFamilia: Record<Familia, number>;
  decaimiento: { porcentaje: number; cadaDias: number; soloFamilias: Familia[] };
  umbrales: { etiqueta: string; min: number }[];   // informativo en sombra
}
```

`calcularScore(contacto, señales, modelo) → { score, desglose: { regla, etiqueta, puntos, veces? }[] }`
es una **función pura** (sin Prisma), igual que en GoHyperLevel: se prueba con datos en memoria y el
mismo código sirve para el cálculo en vivo y para el backtest. La recolección de `señales` va aparte.

El modelo vive en `SystemConfig` (`scoring.modelo`, JSON con `version`); si no existe, se usa el default
del código. Cada contacto guarda con qué `version` se calculó.

## 3. Reglas iniciales (punto de partida; los pesos se calibran en §5)

**Exclusiones — score `null`, no se calcula:** `contactType ∈ {BROKER_EXTERNO, EMPLEO, PROVEEDOR, OTRO}`,
`mergedIntoId` presente, `deletedAt` presente. Un broker o un candidato a empleo no es un comprador y
no debe contaminar CAPI ni el ruteo.

**Anulaciones — score `0`:** `contactStatus ∈ {DESCARTADO, PERDIDO, CONTACTADO_PERDIDO}` o `doNotContact`.

### Perfil (tope 40)

| Señal | Puntos |
|---|---|
| `purchaseTimeline` IMMEDIATE / 1–3 meses / 3–6 meses / 6+ | 14 / 9 / 4 / 0 |
| `urgency` ALTA / MEDIA | 6 / 3 |
| `paymentMethod` CONTADO / MIXTO / FINANCIAMIENTO_DIRECTO / CREDITO_HIPOTECARIO | 8 / 6 / 5 / 3 |
| Presupuesto (`budgetMax`, si no `budgetMin`, normalizado a MXN) ≥ 6 M / ≥ 3 M / ≥ 1.5 M | 10 / 7 / 4 |
| `investmentProfile` capturado (cualquiera) | 2 |
| Teléfono válido **y** correo | 2 |

### Fuente y campaña (tope 15)

| `leadSource` | Puntos |
|---|---|
| REFERIDO_CLIENTE, WALK_IN, LLAMADA_ENTRANTE | 12 |
| REGISTRO_BROKER (y REFERIDO_BROKER histórico) | 10 |
| WEBSITE, WHATSAPP | 8 |
| PORTAL_INMOBILIARIO, EVENTO, WEBINAR | 6 |
| FACEBOOK_ADS, META_ADS, INSTAGRAM, GOOGLE_ADS, TIKTOK_ADS, LINKEDIN, MESSENGER | 5 |
| BASE_DE_DATOS, LLAMADA_FRIA, SELF_GEN, OTRO | 0 |

Ajuste por campaña/formulario: **fase posterior**, cuando el backtest diga qué campañas convierten (§5).

### Conversación (tope 25)

| Señal (de `Activity` / `Message`) | Puntos |
|---|---|
| Primer mensaje entrante (`WHATSAPP_IN`, `INSTAGRAM_IN`, `MESSENGER_IN`, `SMS_IN`, `EMAIL_RECEIVED`, `CALL_INBOUND`) en 30 días | 10 |
| Cada entrante adicional en 30 días | +2, tope 6 |
| Respondió en < 1 h al primer contacto saliente | 4 — **no implementada**: pide emparejar cada saliente con su respuesta; queda para una versión 2 del modelo |
| Playbook del bot completado (discovery hecho) | 8 |
| `DISCOVERY_CALL` registrada | 6 |

### Web y citas (tope 20)

| Señal | Puntos |
|---|---|
| Cita agendada o realizada (`MEETING_VIRTUAL`, `MEETING_PRESENTIAL`, `MEETING_SHOWROOM`, `WALK_IN`) en 60 días | 15 |
| `PROPOSAL_DELIVERY` en 60 días | 5 |
| `WebBehavior.daysVisited ≥ 2` | 3 |
| `WebBehavior.chatCount ≥ 1` | 2 |

**Decaimiento:** −25 % de los puntos de *conversación* y *web y citas* por cada 30 días sin
`lastActivityAt`. El perfil y la fuente no decaen: un comprador de contado sigue siéndolo.

**Topes:** la suma por familia se recorta a su tope y el total a 100. Así ninguna familia sola (p. ej.
alguien que escribe 20 veces sin perfil) llega a SQL.

## 4. Cálculo y almacenamiento (implementado)

### Tabla aparte `contact_scores`, no columnas en `contacts`

Cambio respecto a la primera versión de este spec: en vez de cuatro columnas en `contacts` hay una
tabla nueva, **sin relación Prisma con `Contact`**. Motivo: Prisma selecciona todas las columnas
escalares en cada consulta de contactos; si el código se desplegara antes de correr la migración, la
ficha, la lista y el intake darían 500 (la misma clase de caída del 11–14 sep). Con tabla aparte, sin
migrar solo falla —con guarda P2021— la etapa del cron y la ficha muestra la celda de siempre.

| Columna | Tipo | Para qué |
|---|---|---|
| `contactId` | `TEXT` PK | |
| `score` | `INT` null | El score calculado; `null` = excluido (broker, empleo…) |
| `desglose` | `JSONB` | `[{ regla, etiqueta, familia, puntos, veces }]` — el porqué |
| `motivo` | `TEXT` null | Por qué es null o 0 (tipo excluido, descartado, no contactar) |
| `modeloVersion` | `INT` | Con qué versión del modelo |
| `calculadoAt` | `TIMESTAMP(3)` | Frescura |

Más un índice `activities("contactId","createdAt")` (`CONCURRENTLY`). Migración:
`prisma/migrations-manual/2026-10-26-lead-scoring.sql`. `Contact.score` **no se toca** hasta la activación.

### Cuándo se recalcula (etapa `leadScoring` del cron de workflows, cada minuto, 200 por tick)

1. **Sucios (hasta 150):** sin fila, `contacts.updatedAt > calculadoAt`, o calculados con otra versión
   del modelo. Subir la `version` del modelo recalcula a todos en las siguientes horas.
2. **Viejos (el resto):** filas con más de 24 h. Cubre el decaimiento y las actividades/mensajes nuevos,
   que no tocan `contacts.updatedAt`.

Se descartó encolar por evento (`captureLead`, cada alta de `Activity`…): hay demasiados puntos de
escritura y uno olvidado deja scores viejos sin que nadie lo note. El barrido es más simple y en sombra
la latencia (≤ 1 min para ediciones, ≤ 24 h para actividad) sobra. **Para F3 no basta** (ver §7).

Primera corrida: todos los contactos están «sucios». Medido 2026-10-26: 763 contactos vivos → a
150/min, ~6 min.

**Migración aplicada en producción el 2026-10-26** (tabla, 2 índices de `contact_scores` e índice de
`activities`, todos válidos; sin privilegios para `anon`/`authenticated`). `contacts.score` medido:
0 en los 763 contactos, así que activar F3 no pisa ningún valor previo.

### Desde la activación (§6, F3) además

- Se escribe `contacts.score` con SQL directo (no mueve `updatedAt`, así el contacto no vuelve a quedar
  sucio). Los excluidos (`null`) conservan su `score`.
- Se emite `contact.scored` **solo al cruzar un umbral** (35 MQL / 70 SQL / 50 y 80 de CAPI), no en
  cada recálculo: así no se inunda la cola de workflows ni se re-dispara CAPI por un cambio de 1 punto.

## 5. Calibración (antes de activar)

1. **Backtest con historia:** script que corre `calcularScore` sobre los contactos de los últimos 12
   meses **con las señales que tenían a los 7 días de creados** y compara contra el resultado real
   (`contactStatus = REUNION`, deal creado, deal ganado). Métrica principal: **tasa de reunión del
   decil superior vs. el promedio**. Si el decil superior no convierte claramente más, los pesos están
   mal y no se activa.
2. **Sombra 2–4 semanas en vivo:** se muestra en la ficha y en la lista. Se compara contra la
   `temperature` que ponen los asesores y contra lo que pasa después.
3. Ajustar pesos → subir `version` → recalcular todo.

## 6. Fases

| Fase | Qué | Toca CAPI / etapas / ruteo | Estado |
|---|---|---|---|
| **F1** | `calcularScore` puro (`lib/scoring/calcular.ts`) + modelo default validado con zod (`lib/scoring/modelo.ts`) + pruebas + `scripts/scoring-backtest.ts` | No | ✅ |
| **F2** | `contact_scores` + etapa `leadScoring` del cron + celda «Score (sombra)» en la ficha con el desglose «¿Por qué este score?» | No | ✅ (sin columna/filtro en la lista todavía) |
| **F3** | Bandera `scoring.activo`: copia a `contacts.score` y emite `contact.scored` al cruzar umbrales | **Sí** — ver §7 antes | Código listo, **bandera apagada** |
| **F4** | Configuración manual: `src/server/scoring.ts` (`getScoringConfig`, `saveScoringModelo`, `resetScoringModelo`, `setScoringActivo`, solo ADMIN/DIRECTOR). Falta la pantalla en admin | — | Acciones ✅, pantalla pendiente |

### Cómo se configura a mano (hoy, sin pantalla)

El modelo completo (reglas, pesos, topes, decaimiento, exclusiones y umbrales) es un JSON en
`SystemConfig` → `scoring.modelo`. Para cambiarlo: tomar el vigente con `getScoringConfig()`, editarlo,
**subir `version`** y guardarlo con `saveScoringModelo()`, que lo valida antes de escribir. Si alguien lo
escribe directo en la base y queda inválido, el cron usa el default y deja el motivo en el log
(`[scoring] scoring.modelo inválido…`). La pantalla de F4 solo tiene que envolver esas acciones.

## 7. Riesgos y cosas por verificar

- **CAPI (el más serio):** activar cambia la señal de calidad que recibe Meta de «todos low» a una
  distribución real, y puede empezar a mandar `QUALIFIED` por score. Eso mueve la optimización de las
  campañas. Activar en un momento acordado con quien lleva Meta Ads y vigilar el CPL 1–2 semanas.
- **Valores actuales de `score`:** verificar en la base que estén todos en 0. Si el corte de Zoho
  importó algún score, F3 los pisaría.
- **Reglas de ruteo y workflows que ya usan score:** listar en la base las que tengan condición sobre
  `score` o trigger `SCORE_THRESHOLD` antes de F3. Hoy no se disparan nunca; al activar, sí.
- **`WebBehavior` puede estar vacía:** si nadie la llena, sus 5 puntos no aportan. Medir antes de F2.
- **Zoho sigue siendo el sistema operativo de los asesores:** si el score solo vive en el CRM, quien
  trabaja en Zoho no lo ve. Ver decisión 3 de §8.
- **Ética y sesgo:** las reglas no usan nacionalidad, ciudad ni idioma como señal de calidad.
- **Cronología (prerrequisito de F3):** el disparador `trg_contacts_field_changes` registra todo cambio
  de columna salvo `updatedAt` y `lastActivityAt`. Al activar, cada cambio de score saldría en la
  cronología de la ficha. Antes de F3: agregar `'score'` a `excluded_keys` o aceptarlo.
- **Frescura (prerrequisito de F3):** el ruteo y CAPI leen el score al capturar el lead, antes de que
  el cron lo calcule (≤ 1 min). Antes de F3: calcular el score dentro de `captureLead`
  (`calcularYGuardar([id], cfg)` ya existe) y recalcular al crear actividades de §3.
- **Prueba preexistente en Windows:** `referido-por.test.tsx` busca texto con `\n` dentro de
  `contact-detail.tsx`; en un checkout con `core.autocrlf=true` el archivo trae `\r\n` y falla. No es de
  este cambio; en Linux/CI pasa.

## 8. Decisiones (tomadas 2026-10-26 con la mejor opción por defecto; todas configurables)

1. **Pesos de §3:** se quedan como punto de partida, con un ajuste: `REGISTRO_BROKER` vale 10 (no 0),
   porque desde #929 un lead ligado a un broker entra con esa fuente; `REFERIDO_BROKER` (retirado)
   también 10. Se calibran con el backtest antes de activar.
2. **Umbrales:** MQL 35 / SQL 70 (coinciden con `capi.qualified_score_threshold = 70` y con la mitad
   que usa el ciclo de vida), más 50 y 80 de los tiers de CAPI.
3. **Zoho:** **no** en esta entrega. Escribir en Leads de Zoho dispara sus workflows (ver
   `feedback_lo_que_escribes_en_zoho_puede_pisarlo_un_workflow`) y no tiene sentido mandar un score sin
   calibrar. Se revisa después del backtest.
4. **`temperature`:** se queda **manual**. La pone el asesor con lo que sabe de la conversación; el score
   se muestra al lado para contrastar. Si en sombra coinciden, se puede derivar después.

## 9. Preparación de F3 (2026-10-27)

- **Frescura — hecho en código:** `captureLead` llama `calcularYGuardar([id], cfg)` en el alta (no
  provisional) antes de `lead.captured`, CAPI y ruteo. Con la bandera encendida relee `score` para que
  el `ConversionEvent` LEAD lleve el valor fresco. Best effort: si falla, la captura sigue y el cron lo
  recalcula. Pruebas: `capture-lead.scoring.test.ts`. **No cubierto:** recalcular al crear actividades
  (el cron las recoge en ≤ 24 h) ni en el lead repetido, que solo mueve `lastActivityAt` (no
  `updatedAt`), así que también espera al barrido de 24 h.
- **Cronología — SQL listo, SIN APLICAR:** `prisma/migrations-manual/2026-10-27-cronologia-sin-score.sql`
  excluye `score` solo para contactos (la función es compartida con deals).
- **Backtest — no pasa el criterio, no activar.** Corrido 2026-10-27 (`scoring-backtest.ts 12 7`, modelo v1):
  205 contactos en 12 meses, 145 excluidos por tipo → **60 evaluables, 4 con reunión (6.7 %), 0 ganados**.
  Decil superior (34–44): **0 % reunión**; las reuniones caen en los deciles 2, 4 y 10. Con n=6 por decil
  la muestra no distingue nada: el problema es volumen y perfil vacío (el score topa ~25 por falta de
  datos), no los pesos. Volver a correr cuando el CRM tenga más historia propia o el perfil llegue
  desde el Hub/Zoho.
