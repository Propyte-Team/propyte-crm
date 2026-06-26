# Métricas por nodo en Journey — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar sobre el canvas Dirigida de `/journey`, por regla, el **volumen de contactos por nodo** y el **% de reparto por rama**, con selector de ventana (7/30/90/todo), derivado de `ActionQueue` sin instrumentación nueva ni migración.

**Architecture:** Un endpoint de solo-lectura agrega `action_queue` (la ruta del nodo vive en el `dedupeKey`) y devuelve `{counts, total}`. Un helper PURO mapea esas rutas a los nodeIds del canvas y computa volúmenes (acción=conteo exacto; decisión=suma recursiva de las entradas de sus ramas; trigger/condition=total) y % de reparto por rama. La vista Dirigida superpone badges y etiquetas de arista cuando el toggle "Métricas" está activo.

**Tech Stack:** TypeScript, Next.js 14 (App Router), Prisma `$queryRaw` sobre Postgres (Supabase), Zod, React Flow (`@xyflow/react` v12), Vitest.

**Convenciones (leer antes):**
- Worktree `.claude/worktrees/crm-journey-metrics` (rama `feat/crm-journey-metrics` desde `origin/main` `3555bf5`). Rutas relativas a la raíz del repo.
- Vitest: `npx vitest run <ruta>`. Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- **GOTCHA:** tras cualquier `npm install` correr `npx prisma generate` (cliente stale → errores falsos). Este plan NO instala deps. El worktree puede no tener `node_modules`/cliente Prisma propios: si `tsc`/tests fallan por módulos ausentes, correr `npm install` + `npx prisma generate` una vez en el worktree.
- Autor de commits ya configurado (`Propyte-Luis` / `webkoi@webkoi-ai.com`). Verificar con `git config user.name` antes de cada commit; NO cambiar config.
- El scheme de rutas viene del walker (`src/lib/workflows/walk-nodes.ts`): raíz numérica `"0"`,`"1"`; rama `"1.b0.0"`; else `"1.else.0"`. Los nodeId del canvas (de `ruleToDraft` en `src/lib/journey/rule-draft.ts`) son iguales pero con la raíz prefijada con `a`: `"a0"`, `"a1.b0.0"`. El mapeo ruta→nodeId es por tanto `"a" + path`.

---

## File Structure

**Crear:**
- `src/app/api/admin/journey/metrics/route.ts` — endpoint GET de agregación (RBAC, zod, `$queryRaw`).
- `src/lib/journey/node-metrics.ts` — helper PURO `computeNodeMetrics(draft, raw) → {nodeVolumes, branchSplits}`.
- `src/lib/journey/node-metrics.test.ts` — tests del helper.
- `src/app/api/admin/journey/metrics/route.window.test.ts` — test del cálculo de ventana→corte.

**Modificar:**
- `src/components/journey/journey-map-view.tsx` — toggle "Métricas", selector de ventana, fetch, overlay de badges + etiquetas de arista de rama, subtítulo "N contactos · ventana".

---

## Task 1: Helper puro `computeNodeMetrics`

**Files:**
- Create: `src/lib/journey/node-metrics.ts`
- Test: `src/lib/journey/node-metrics.test.ts`

- [ ] **Step 1: Escribir el test que falla** — `src/lib/journey/node-metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeNodeMetrics } from "./node-metrics";
import { ruleToDraft } from "./rule-draft";

// Regla: a0 acción CHANGE_STAGE; a1 decisión con 2 ramas (META=a1.b0.0 ASSIGN, WEB=a1.b1.0 NOTIFY) + else (a1.else.0 ADD_TAG)
const draft = ruleToDraft({
  id: "r1", name: "x", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
  cooldownMinutes: null, priority: 100, isActive: true,
  actions: [
    { type: "CHANGE_STAGE", config: {} },
    { kind: "decision", label: "Por origen", branches: [
      { label: "META", conditions: {}, steps: [{ type: "ASSIGN", config: {} }] },
      { label: "WEB", conditions: {}, steps: [{ type: "NOTIFY", config: {} }] },
    ], else: [{ type: "ADD_TAG", config: {} }] },
  ],
} as never);

const raw = { total: 142, counts: { "0": 142, "1.b0.0": 96, "1.b1.0": 36, "1.else.0": 10 } };

describe("computeNodeMetrics", () => {
  it("volumen por nodo: acción = conteo exacto (ruta→nodeId con prefijo 'a')", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.nodeVolumes["a0"]).toBe(142);
    expect(m.nodeVolumes["a1.b0.0"]).toBe(96);
    expect(m.nodeVolumes["a1.b1.0"]).toBe(36);
    expect(m.nodeVolumes["a1.else.0"]).toBe(10);
  });

  it("trigger y condition = total", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.nodeVolumes["trigger"]).toBe(142);
    expect(m.nodeVolumes["condition"]).toBe(142);
  });

  it("decisión = suma de las entradas de sus ramas + else", () => {
    const m = computeNodeMetrics(draft, raw);
    expect(m.nodeVolumes["a1"]).toBe(96 + 36 + 10); // 142
  });

  it("% de reparto por rama (count + pct redondeado)", () => {
    const m = computeNodeMetrics(draft, raw);
    const meta = m.branchSplits["a1.b0"];
    const web = m.branchSplits["a1.b1"];
    expect(meta).toEqual({ count: 96, pct: 68 });   // 96/142 = 67.6 → 68
    expect(web).toEqual({ count: 36, pct: 25 });     // 36/142 = 25.4 → 25
  });

  it("rama sin pasos → {count:0, pct:0} y sin división por cero", () => {
    const d2 = ruleToDraft({
      id: "r2", name: "y", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
      cooldownMinutes: null, priority: 100, isActive: true,
      actions: [{ kind: "decision", branches: [{ conditions: {}, steps: [] }] }],
    } as never);
    const m = computeNodeMetrics(d2, { total: 0, counts: {} });
    expect(m.branchSplits["a0.b0"]).toEqual({ count: 0, pct: 0 });
    expect(m.nodeVolumes["a0"]).toBe(0);
  });

  it("decisión anidada: la entrada de la rama externa = volumen de la decisión interna", () => {
    const d3 = ruleToDraft({
      id: "r3", name: "z", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
      cooldownMinutes: null, priority: 100, isActive: true,
      actions: [{ kind: "decision", branches: [
        { conditions: {}, steps: [
          { kind: "decision", branches: [
            { conditions: {}, steps: [{ type: "ASSIGN", config: {} }] },
            { conditions: {}, steps: [{ type: "NOTIFY", config: {} }] },
          ] },
        ] },
      ] }],
    } as never);
    // a0 = decisión externa; a0.b0.0 = decisión interna; a0.b0.0.b0.0 ASSIGN; a0.b0.0.b1.0 NOTIFY
    const m = computeNodeMetrics(d3, { total: 50, counts: { "0.b0.0.b0.0": 30, "0.b0.0.b1.0": 20 } });
    expect(m.nodeVolumes["a0.b0.0"]).toBe(50);  // decisión interna = 30+20
    expect(m.nodeVolumes["a0"]).toBe(50);        // externa = entrada de su única rama = decisión interna
    expect(m.branchSplits["a0.b0"]).toEqual({ count: 50, pct: 100 });
  });
});
```

- [ ] **Step 2: Correr para verlo fallar** — `npx vitest run src/lib/journey/node-metrics.test.ts` → FAIL (módulo ausente).

- [ ] **Step 3: Implementar** — `src/lib/journey/node-metrics.ts`:

```ts
// Cómputo PURO de métricas por nodo a partir de los conteos crudos de ActionQueue.
// Mapea ruta del dedupeKey (raíz numérica) → nodeId del canvas (raíz con prefijo "a").
import type { RuleDraft, NodeDraft } from "./rule-draft";
import { isDecisionDraft } from "./rule-draft";

export interface RawMetrics {
  counts: Record<string, number>; // ruta (scheme walker, raíz numérica) → distinct entities
  total: number;                  // distinct entities en toda la regla (ventana aplicada)
}
export interface NodeMetrics {
  nodeVolumes: Record<string, number>;                         // nodeId del canvas → volumen
  branchSplits: Record<string, { count: number; pct: number }>; // branchId → reparto
}

export function computeNodeMetrics(draft: RuleDraft, raw: RawMetrics): NodeMetrics {
  const nodeVolumes: Record<string, number> = {};
  const branchSplits: Record<string, { count: number; pct: number }> = {};

  // 1) Volumen directo de nodos-acción: ruta "1.b0.0" → nodeId "a1.b0.0".
  for (const [path, n] of Object.entries(raw.counts)) {
    nodeVolumes[`a${path}`] = n;
  }

  // 2) Volumen recursivo (post-orden) de un nodo. Acción = su conteo; decisión = suma de las
  //    entradas (primer paso) de cada rama + else, y registra branchSplits.
  function volumeOf(node: NodeDraft): number {
    if (!isDecisionDraft(node)) {
      const v = nodeVolumes[node.nodeId] ?? 0;
      nodeVolumes[node.nodeId] = v;
      return v;
    }
    const branchEntry = (steps: NodeDraft[]): number => (steps.length > 0 ? volumeOf(steps[0]) : 0);
    const branchCounts = node.branches.map((b) => ({ branchId: b.branchId, count: branchEntry(b.steps) }));
    const elseCount = node.else && node.else.length > 0 ? branchEntry(node.else) : 0;
    // recursa por TODOS los pasos (no solo el primero) para poblar volúmenes de nodos internos
    for (const b of node.branches) for (const s of b.steps) volumeOf(s);
    if (node.else) for (const s of node.else) volumeOf(s);

    const denom = branchCounts.reduce((a, b) => a + b.count, 0) + elseCount;
    for (const bc of branchCounts) {
      branchSplits[bc.branchId] = { count: bc.count, pct: denom > 0 ? Math.round((bc.count / denom) * 100) : 0 };
    }
    const total = denom;
    nodeVolumes[node.nodeId] = total;
    return total;
  }
  for (const n of draft.actions) volumeOf(n);

  // 3) Trigger y condition = total de la regla.
  nodeVolumes["trigger"] = raw.total;
  nodeVolumes["condition"] = raw.total;

  return { nodeVolumes, branchSplits };
}
```

> Nota: recorrer "todos los pasos" además de la entrada asegura que un nodo-acción que NO es el primer paso de su rama también quede en `nodeVolumes` (ya viene del paso 1, pero el recorrido lo deja idempotente). El `branchId` lo provee `ruleToDraft` (`aN.b{j}`).

- [ ] **Step 4: Correr para verlo pasar** — `npx vitest run src/lib/journey/node-metrics.test.ts` → PASS (6 casos). Luego `npx tsc --noEmit` (si hay errores por `node_modules`/cliente Prisma ausentes en el worktree, correr `npm install` + `npx prisma generate` una vez y reintentar).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/node-metrics.ts src/lib/journey/node-metrics.test.ts
git commit -m "feat(journey): helper puro computeNodeMetrics (volumen por nodo + % reparto)"
```

---

## Task 2: Endpoint de agregación

**Files:**
- Create: `src/app/api/admin/journey/metrics/route.ts`
- Test: `src/app/api/admin/journey/metrics/route.window.test.ts`

- [ ] **Step 1: Escribir el test del cálculo de ventana** — `src/app/api/admin/journey/metrics/route.window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cutoffFromWindow } from "./route";

describe("cutoffFromWindow", () => {
  it("'all' → null", () => {
    expect(cutoffFromWindow("all", 1_000_000)).toBeNull();
  });
  it("'30' → now - 30 días", () => {
    const now = 1_000_000_000_000;
    const c = cutoffFromWindow("30", now);
    expect(c?.getTime()).toBe(now - 30 * 86_400_000);
  });
  it("'7' y '90' calculan el offset correcto", () => {
    const now = 2_000_000_000_000;
    expect(cutoffFromWindow("7", now)?.getTime()).toBe(now - 7 * 86_400_000);
    expect(cutoffFromWindow("90", now)?.getTime()).toBe(now - 90 * 86_400_000);
  });
});
```

- [ ] **Step 2: Correr para verlo fallar** — `npx vitest run src/app/api/admin/journey/metrics/route.window.test.ts` → FAIL (módulo/symbol ausente).

- [ ] **Step 3: Implementar** — `src/app/api/admin/journey/metrics/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];
const windowSchema = z.enum(["7", "30", "90", "all"]);

// PURA y exportada para test: ventana → fecha de corte (null = todo).
export function cutoffFromWindow(window: z.infer<typeof windowSchema>, nowMs: number): Date | null {
  if (window === "all") return null;
  return new Date(nowMs - Number(window) * 86_400_000);
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  const windowParsed = windowSchema.safeParse(url.searchParams.get("window") ?? "30");
  if (!ruleId || !windowParsed.success) {
    return NextResponse.json({ error: "ruleId y window requeridos" }, { status: 400 });
  }
  const cutoff = cutoffFromWindow(windowParsed.data, Date.now());

  // counts por ruta (4º segmento del dedupeKey) y total distinct de la regla, con corte por ventana.
  const rows = await prisma.$queryRaw<{ path: string; n: number }[]>`
    select split_part("dedupeKey", ':', 4) as path, count(distinct "entityId")::int as n
    from propyte_crm.action_queue
    where "ruleId" = ${ruleId}
      and (${cutoff}::timestamptz is null or "createdAt" >= ${cutoff})
    group by 1`;
  const totalRows = await prisma.$queryRaw<{ total: number }[]>`
    select count(distinct "entityId")::int as total
    from propyte_crm.action_queue
    where "ruleId" = ${ruleId}
      and (${cutoff}::timestamptz is null or "createdAt" >= ${cutoff})`;

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.path] = r.n;
  return NextResponse.json({ counts, total: totalRows[0]?.total ?? 0, window: windowParsed.data });
}
```

> El `Prisma` import puede no ser necesario (no se usa `Prisma.sql` aquí porque el template tag `$queryRaw` parametriza solo). Quitarlo si `tsc`/eslint lo marca sin uso. El `${cutoff}::timestamptz is null` funciona: cuando `cutoff` es `null`, Prisma lo pasa como NULL y `NULL::timestamptz is null` = true (trae todo); cuando es Date, el OR cae en `"createdAt" >= cutoff`.

- [ ] **Step 4: Correr para verlo pasar** — `npx vitest run src/app/api/admin/journey/metrics/route.window.test.ts` → PASS (3 casos). `npx tsc --noEmit` limpio.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/journey/metrics/route.ts src/app/api/admin/journey/metrics/route.window.test.ts
git commit -m "feat(api): endpoint de métricas de journey (agrega action_queue por ruta de nodo)"
```

---

## Task 3: Overlay en el canvas Dirigida

**Files:**
- Modify: `src/components/journey/journey-map-view.tsx`

- [ ] **Step 1: READ `src/components/journey/journey-map-view.tsx` completo.** Localizar:
  - La barra de la vista **Dirigida** (donde están los botones General/Dirigida, el `combobox` "editar regla", "+ Crear regla", y en edición "Guardar"/"Descartar").
  - Cómo se obtiene el `draft` actual y el `ruleId` (la regla guardada cargada tiene `draft.id`; una recién creada NO).
  - El `DecisionNode` (module scope) y `NODE_TYPES`.
  - El armado de `nodes`/`edges` que se pasa a `<ReactFlow>` (`typedNodes` con `nodeStyle`, `editEdges` que mapea `data.label`→`label`).

- [ ] **Step 2: Estado + fetch.** Añadir en el componente de la vista Dirigida:

```tsx
const [metricsOn, setMetricsOn] = useState(false);
const [metricsWindow, setMetricsWindow] = useState<"7" | "30" | "90" | "all">("30");
const [metrics, setMetrics] = useState<import("@/lib/journey/node-metrics").NodeMetrics | null>(null);
const [metricsTotal, setMetricsTotal] = useState(0);

useEffect(() => {
  const ruleId = draft?.id;
  if (!metricsOn || !ruleId) { setMetrics(null); return; }
  let cancel = false;
  fetch(`/api/admin/journey/metrics?ruleId=${encodeURIComponent(ruleId)}&window=${metricsWindow}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => {
      if (cancel || !raw) return;
      setMetricsTotal(raw.total ?? 0);
      setMetrics(computeNodeMetrics(draft, raw)); // import { computeNodeMetrics } from "@/lib/journey/node-metrics"
    })
    .catch(() => { if (!cancel) setMetrics(null); });
  return () => { cancel = true; };
}, [metricsOn, metricsWindow, draft?.id, draft]);
```
(Importar `useState`/`useEffect` si faltan, y `computeNodeMetrics`.)

- [ ] **Step 3: Toggle + selector en la barra Dirigida.** Junto a los controles de edición, renderizar (solo cuando hay regla guardada cargada, `draft?.id`):

```tsx
{draft?.id && (
  <div className="flex items-center gap-2">
    <button
      type="button"
      className={metricsOn ? "btn-primary" : "btn-secondary"}
      onClick={() => setMetricsOn((v) => !v)}
    >● Métricas</button>
    {metricsOn && (
      <>
        <select className="form-input" value={metricsWindow}
          onChange={(e) => setMetricsWindow(e.target.value as "7" | "30" | "90" | "all")}>
          <option value="7">7d</option>
          <option value="30">30d</option>
          <option value="90">90d</option>
          <option value="all">Todo</option>
        </select>
        <span className="label">{metricsTotal} contactos · {metricsWindow === "all" ? "histórico" : `${metricsWindow}d`}</span>
      </>
    )}
  </div>
)}
```
(Usar las clases reales del archivo si difieren; respetar el diseño B/N existente.)

- [ ] **Step 4: Inyectar volumen en los nodos.** Donde se construyen los nodes para `<ReactFlow>` (el `typedNodes`/equivalente), cuando `metricsOn && metrics`, añadir a `data` el volumen del nodo:

```tsx
const withMetrics = baseNodes.map((n) =>
  metricsOn && metrics
    ? { ...n, data: { ...n.data, metricVolume: metrics.nodeVolumes[n.id] ?? 0 } }
    : n,
);
```
y pasar `withMetrics` a `<ReactFlow nodes={...}>`. En `DecisionNode` (y para los demás tipos, vía un pequeño badge en el render del nodo o en `nodeStyle`), mostrar el badge cuando `data.metricVolume !== undefined`:

```tsx
{typeof data.metricVolume === "number" && (
  <span style={{ position: "absolute", top: -8, right: -8, background: "#0a0a0a", color: "#fff",
    borderRadius: 10, fontSize: 11, padding: "1px 7px" }}>{data.metricVolume}</span>
)}
```
Para los nodos NO custom (action/stage/trigger/condition que hoy se dibujan con `nodeStyle` + label de texto), la forma más simple es **anteponer el volumen al label** cuando `metricsOn` (p. ej. `data.label = `${vol} · ${label}``) en la construcción de `withMetrics`, o registrar un wrapper de nodo. Elegir lo que encaje con cómo se renderizan hoy esos nodos (si ya son nodos custom con componente, añadir el badge ahí; si son default, anteponer al label). Mantener consistencia visual.

- [ ] **Step 5: Etiquetas de arista de rama.** Donde se mapea `data.label`→`label` de las edges (`editEdges`), cuando `metricsOn && metrics` y la arista corresponde a una rama (su `id`/`data` referencia un `branchId`), combinar:

```tsx
const split = metrics?.branchSplits[branchIdDeLaArista];
const label = metricsOn && split
  ? `${baseLabel} · ${split.pct}% · ${split.count}`
  : baseLabel;
```
Para saber el `branchId` de una arista: en `draftToFlow` las aristas de rama se crean desde la decisión hacia el primer paso de la rama; el `branchId` es `${decisionNodeId}.b${j}` y el primer paso tiene nodeId `${decisionNodeId}.b${j}.0`. Derivar `branchId` del `target` de la arista quitando el último segmento `.0`… **mejor**: en `draftToFlow` (rule-draft.ts) añadir `data.branchId` a la arista de rama al crearla (un campo extra, ya que `RFEdge.data` existe). Si se toca `draftToFlow`, agregar `data: { label: b.label ?? "rama", branchId: \`${n.nodeId}.b${bi}\` }` (y para else `branchId: \`${n.nodeId}.else\``). Luego en la vista usar `e.data.branchId`. **Decisión:** hacer este pequeño cambio en `draftToFlow` para tener el `branchId` explícito en la arista (más robusto que parsear el target).

- [ ] **Step 6: Toggle OFF = sin cambios.** Verificar que con `metricsOn=false` los nodes/edges se construyen exactamente como hoy (sin `metricVolume`, sin sufijo en labels) → canvas idéntico para edición.

- [ ] **Step 7: Verificar** — `npx tsc --noEmit` (limpio salvo los 2 errores pre-existentes de `builder-model.test.ts`), `npx vitest run` (todo verde), `npm run build` (verde — compila la vista). Pegar el estado del build.

- [ ] **Step 8: Commit**

```bash
git add src/components/journey/journey-map-view.tsx src/lib/journey/rule-draft.ts
git commit -m "feat(journey): overlay de métricas en Dirigida (toggle, ventana, badges, % por rama)"
```

> Si en Step 5 se añadió `branchId` en `draftToFlow`, incluir `rule-draft.ts` en el commit y verificar que el test de `draftToFlow` (en `rule-draft.test.ts`) sigue verde (el campo extra en `data` no rompe el conteo de aristas; si un test asersa la forma exacta de `data`, ajustarlo para incluir `branchId`).

---

## Verificación final (antes de merge)
- [ ] `npx vitest run` — suite verde (incluye node-metrics + window tests).
- [ ] `npx tsc --noEmit` — solo los 2 errores pre-existentes de `builder-model.test.ts`.
- [ ] `npm run build` — verde.
- [ ] **Smoke en vivo Playwright (pedir autorización):** login ADMIN → `/journey` Dirigida → "editar regla" una con historia (p. ej. WF1) → toggle "● Métricas" → ver badges en nodos + `%·count` en aristas → cambiar ventana 7/30/90/todo → apagar toggle = canvas limpio. Si la regla no tiene filas en `action_queue`, verificar el endpoint con MCP Supabase (que el SQL agrega bien). GOTCHA worktree: `.env` ausente + `NEXTAUTH_URL` de prod → arrancar dev con `NEXTAUTH_URL=http://localhost:<port>` + `AUTH_TRUST_HOST=true`; `@xyflow` requiere `npm install`+`prisma generate` en el worktree. Apagar el dev server por PID al terminar.
- [ ] Review final (Opus) del diff.
- [ ] ff-push `feat/crm-journey-metrics` → `main` (autor Propyte-Luis) → auto-deploy Hostinger.

## Notas / caveats
- **Volumen de decisión = suma de entradas de ramas+else**: un mismo contacto que tomó 2 ramas en distintos días/eventos cuenta en ambas (distinct es por-ruta, no cross-ruta). Aceptable para A+B; documentado en el spec.
- **Mapeo ruta↔nodeId** (`"a"+path`) depende de que el scheme del walker (raíz numérica) y el de `ruleToDraft`/`rebuildBranchIds` (raíz `aN`) sigan alineados salvo el prefijo. Si cambia, actualizar `node-metrics.ts`.
- **Fuera de alcance:** General (lifecycle), conversión (D), heatmap (C), export, drill-down.
