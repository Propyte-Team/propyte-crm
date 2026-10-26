# Lead scoring — diseño

**Fecha:** 2026-10-26 · **Estado:** propuesta, sin implementar · **Base:** `origin/main` @ `9b041ef0`
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
| REFERIDO_CLIENTE, REFERIDO_BROKER, WALK_IN, LLAMADA_ENTRANTE | 12 |
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
| Respondió en < 1 h al primer contacto saliente | 4 |
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

## 4. Cálculo y almacenamiento

### Columnas nuevas en `contacts` (migración manual en `prisma/migrations-manual/`)

| Columna | Tipo | Para qué |
|---|---|---|
| `scoreSombra` | `INT` null | El score calculado. En sombra **no** se copia a `score` |
| `scoreDesglose` | `JSONB` null | `[{ regla, etiqueta, puntos, veces }]` — para mostrar el porqué |
| `scoreCalculadoAt` | `TIMESTAMPTZ` null | Frescura |
| `scoreModeloVersion` | `INT` null | Con qué versión del modelo |

`score` (el que leen CAPI, ciclo de vida y ruteo) **no se toca** hasta la activación.

### Cuándo se recalcula

1. **Por evento:** al capturar un lead (`captureLead`), al crear una `Activity` de los tipos de §3, al
   editar campos de perfil y al cambiar `contactStatus`. Se encola el `contactId` en la cola de eventos
   que ya procesa el cron de workflows (no se calcula dentro de la petición del usuario).
2. **Barrido nocturno** para el decaimiento: contactos con `scoreCalculadoAt` > 24 h y actividad en los
   últimos 180 días. Por lotes, como el replay de leads (keyset sobre `(id)`, tope por corrida).

### Desde la activación (§6, F3) además

- Se escribe `score = scoreSombra`.
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

| Fase | Qué | Toca CAPI / etapas / ruteo |
|---|---|---|
| **F1** | `calcularScore` puro + modelo default + pruebas + script de backtest (solo lectura) | No |
| **F2** | Migración + recálculo por evento y nocturno en `scoreSombra` + UI: chip en ficha y lista, panel «¿Por qué este score?» con el desglose, filtro y orden por score | No |
| **F3** | Bandera `scoring.activo` en `SystemConfig`: copia a `score` y emite `contact.scored` al cruzar umbrales | **Sí** — ver §7 antes |
| **F4** | Editor de reglas en admin (pesos, topes, umbrales) con vista previa del efecto sobre N contactos | — |

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

## 8. Decisiones abiertas (Luis)

1. **Pesos iniciales de §3:** ¿algo que de entrada esté mal? (p. ej. ¿el referido de broker vale lo
   mismo que el de cliente?).
2. **Umbrales:** MQL 35 / SQL 70 (los actuales del ciclo de vida con `capi.qualified_score_threshold =
   70`). ¿Se quedan?
3. **¿Mandar el score a Zoho?** (campo nuevo en Leads) para que los asesores lo vean donde trabajan.
4. **`temperature`:** ¿se deja manual (propuesta) o el score la sugiere / la pone?
