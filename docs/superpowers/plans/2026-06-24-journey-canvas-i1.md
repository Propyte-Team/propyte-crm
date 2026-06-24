# Canvas de Journey React Flow + Layout Persistente (C.2-i1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el render custom del mapa de journey por un lienzo React Flow con nodos movibles y posiciones persistentes (tabla `journey_layouts`), manteniéndolo read-only en lógica.

**Architecture:** La derivación pura de C.1 (`journey-map.ts`) se adapta a `{nodes,edges}` de React Flow (`flow-adapter.ts`). Una tabla ligera `journey_layouts` guarda solo posiciones por nodo, vía API `/api/admin/journey/layout`. El componente cliente usa `@xyflow/react`, aplica el layout guardado sobre un auto-layout determinístico, y guarda al arrastrar (debounce).

**Tech Stack:** Next.js 14, Prisma, TypeScript, vitest, React, `@xyflow/react` (dep nueva).

**Reglas del repo:** worktree aislado `feat/crm-journey-canvas` (desde `origin/main` `c0c82cf`). Autor git `Propyte-Luis <webkoi@webkoi-ai.com>` (cada commit termina con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). Test `npx vitest run <ruta>`. Typecheck `npx tsc --noEmit -p tsconfig.json` (IGNORAR los 2 errores PRE-EXISTENTES en `src/lib/workflows/builder-model.test.ts`). Si prisma pide DATABASE_URL: `export DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder'`. **La migración NO se aplica** sin la frase de Luis; se deja preparada.

---

## File Structure

- `prisma/schema.prisma` — MODIFY: modelo `JourneyLayout`.
- `prisma/migrations-manual/2026-06-24-journey-layout.sql` — CREATE: CREATE TABLE aditivo (no aplicar).
- `src/lib/journey/flow-adapter.ts` — CREATE: derivación → `{nodes,edges}` + auto-layout + applyPositions (puro).
- `src/lib/journey/flow-adapter.test.ts` — CREATE.
- `src/app/api/admin/journey/layout/route.ts` — CREATE: GET/PUT posiciones por scope.
- `src/app/api/admin/journey/layout/route.test.ts` — CREATE.
- `src/components/journey/journey-map-view.tsx` — MODIFY (reescritura a React Flow).
- `package.json` — MODIFY: dep `@xyflow/react` (vía `npm i`).

---

## Task 1: Modelo `JourneyLayout` + SQL de migración (sin aplicar)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-06-24-journey-layout.sql`

- [ ] **Step 1: Agregar el modelo** (junto a otros modelos del schema `propyte_crm`)

```prisma
model JourneyLayout {
  id        String   @id            // scope: "general" | "targeted:<CAMPAIGN>"
  positions Json     @default("{}")
  updatedAt DateTime @updatedAt

  @@map("journey_layouts")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Validar + generar cliente** (sin DB)

Run: `npx prisma validate && npx prisma generate`
Expected: "valid" + "Generated Prisma Client". (Exporta DATABASE_URL dummy si lo pide.)

- [ ] **Step 3: Escribir el SQL de migración** (aditivo; tabla snake plural, columnas camelCase — ver `feedback_prisma_manual_sql_naming`)

```sql
-- Migración aditiva — tabla de layout del canvas de journey (Fase 3 C.2-i1).
-- Aplicar vía MCP Supabase en oaijxdpevakashxshhvm SOLO con autorización explícita.
-- Tabla nueva, no toca datos existentes.
CREATE TABLE IF NOT EXISTS propyte_crm."journey_layouts" (
  "id"        text PRIMARY KEY,
  "positions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Verificar SQL no destructivo**

Run: `grep -iE "drop|delete|truncate|alter table .*drop" prisma/migrations-manual/2026-06-24-journey-layout.sql`
Expected: sin resultados.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-24-journey-layout.sql
git commit -m "feat(journey): modelo JourneyLayout + SQL migración (preparada, sin aplicar)"
```

---

## Task 2: Adaptador derivación → React Flow (puro)

**Files:**
- Create: `src/lib/journey/flow-adapter.ts`
- Test: `src/lib/journey/flow-adapter.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { generalToFlow, targetedToFlow, applyPositions, type RFNode } from "./flow-adapter";
import type { GeneralView, TargetedView } from "./journey-map";

const general: GeneralView = { lanes: [
  { stage: "LEAD", rules: [{ id: "r1", name: "Speed", isActive: true, triggerType: "EVENT" }],
    cadences: [{ id: "p1", name: "Bienvenida", isActive: true, stepCount: 3 }] },
  { stage: "MQL", rules: [{ id: "r2", name: "Respondió", isActive: false, triggerType: "EVENT" }], cadences: [] },
] };

describe("generalToFlow", () => {
  it("genera nodos con IDs estables (stage/rule/plan) + aristas de avance entre etapas", () => {
    const { nodes, edges } = generalToFlow(general);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("stage:LEAD");
    expect(ids).toContain("rule:r1");
    expect(ids).toContain("plan:p1");
    expect(ids).toContain("stage:MQL");
    // arista de avance entre cabeceras de etapa consecutivas
    expect(edges.some((e) => e.source === "stage:LEAD" && e.target === "stage:MQL")).toBe(true);
    // todos los nodos tienen posición por auto-layout
    expect(nodes.every((n) => typeof n.position.x === "number" && typeof n.position.y === "number")).toBe(true);
  });
});

describe("targetedToFlow", () => {
  it("encadena nodos del flujo con aristas secuenciales", () => {
    const tv: TargetedView = { flows: [[
      { kind: "trigger", label: "⚡ Brokers" },
      { kind: "action", label: "👤 Asignar" },
      { kind: "stage", label: "MQL" },
    ]] };
    const { nodes, edges } = targetedToFlow(tv);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(edges[0].source).toBe(nodes[0].id);
    expect(edges[0].target).toBe(nodes[1].id);
  });
});

describe("applyPositions", () => {
  it("sobrescribe posición por nodo guardado y deja el resto en auto", () => {
    const nodes: RFNode[] = [
      { id: "a", type: "rule", position: { x: 0, y: 0 }, data: { label: "A" } },
      { id: "b", type: "rule", position: { x: 10, y: 10 }, data: { label: "B" } },
    ];
    const out = applyPositions(nodes, { a: { x: 500, y: 600 } });
    expect(out.find((n) => n.id === "a")!.position).toEqual({ x: 500, y: 600 });
    expect(out.find((n) => n.id === "b")!.position).toEqual({ x: 10, y: 10 });
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/journey/flow-adapter.test.ts`
Expected: FAIL ("Cannot find module './flow-adapter'").

- [ ] **Step 3: Implementar `flow-adapter.ts`**

```ts
// Adaptador puro: vistas derivadas (journey-map.ts) → {nodes,edges} de React Flow.
// Sin importar React Flow aquí (solo tipos planos) → testeable en Node.
import type { GeneralView, TargetedView } from "./journey-map";
import { LIFECYCLE_LABELS } from "@/lib/constants";

export interface RFNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
export interface RFEdge { id: string; source: string; target: string }
export interface Flow { nodes: RFNode[]; edges: RFEdge[] }
export type Positions = Record<string, { x: number; y: number }>;

const LANE_W = 240;   // ancho por carril
const ROW_H = 90;     // alto por fila dentro del carril
const HEADER_Y = 0;

export function generalToFlow(view: GeneralView): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  view.lanes.forEach((lane, li) => {
    const x = li * LANE_W;
    nodes.push({
      id: `stage:${lane.stage}`, type: "stage", position: { x, y: HEADER_Y },
      data: { label: LIFECYCLE_LABELS[lane.stage] ?? "General / Sin etapa", stage: lane.stage },
    });
    let row = 1;
    for (const r of lane.rules) {
      nodes.push({ id: `rule:${r.id}`, type: "rule", position: { x, y: row * ROW_H },
        data: { label: r.name, isActive: r.isActive, triggerType: r.triggerType } });
      row++;
    }
    for (const c of lane.cadences) {
      nodes.push({ id: `plan:${c.id}`, type: "cadence", position: { x, y: row * ROW_H },
        data: { label: c.name, isActive: c.isActive, stepCount: c.stepCount } });
      row++;
    }
    if (li > 0) {
      const prev = view.lanes[li - 1];
      edges.push({ id: `adv:${prev.stage}->${lane.stage}`, source: `stage:${prev.stage}`, target: `stage:${lane.stage}` });
    }
  });
  return { nodes, edges };
}

export function targetedToFlow(view: TargetedView): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  view.flows.forEach((flow, fi) => {
    let prevId: string | null = null;
    flow.forEach((node, ni) => {
      const id = `f${fi}:${node.kind}:${ni}`;
      nodes.push({ id, type: node.kind, position: { x: ni * LANE_W, y: fi * (ROW_H * 1.6) },
        data: { label: node.label } });
      if (prevId) edges.push({ id: `${prevId}->${id}`, source: prevId, target: id });
      prevId = id;
    });
  });
  return { nodes, edges };
}

/** Aplica posiciones guardadas por nodo; los no guardados conservan el auto-layout. */
export function applyPositions(nodes: RFNode[], positions: Positions): RFNode[] {
  return nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
}
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/lib/journey/flow-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/flow-adapter.ts src/lib/journey/flow-adapter.test.ts
git commit -m "feat(journey): adaptador derivación→React Flow + auto-layout + applyPositions"
```

---

## Task 3: API de layout — `/api/admin/journey/layout`

**Files:**
- Create: `src/app/api/admin/journey/layout/route.ts`
- Test: `src/app/api/admin/journey/layout/route.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const findUnique = vi.fn();
const upsert = vi.fn().mockResolvedValue({ id: "general", positions: {} });
vi.mock("@/lib/db", () => ({
  default: { journeyLayout: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: (...a: unknown[]) => upsert(...a) } },
}));

import { GET, PUT } from "./route";

beforeEach(() => { findUnique.mockReset(); upsert.mockClear(); session.user.role = "ADMIN"; });

describe("journey layout API", () => {
  it("GET devuelve {} si no existe el scope", async () => {
    findUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://t/api?scope=general") as never);
    expect(res.status).toBe(200);
    expect((await res.json()).positions).toEqual({});
  });

  it("PUT hace upsert de posiciones válidas", async () => {
    const body = { scope: "general", positions: { "rule:r1": { x: 10, y: 20 } } };
    const res = await PUT(new Request("http://t/api", { method: "PUT", body: JSON.stringify(body) }) as never);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
  });

  it("PUT 400 con positions malformado", async () => {
    const res = await PUT(new Request("http://t/api", { method: "PUT",
      body: JSON.stringify({ scope: "general", positions: { "x": { x: "no", y: 1 } } }) }) as never);
    expect(res.status).toBe(400);
  });

  it("PUT 403 no-admin", async () => {
    session.user.role = "ASESOR_SR";
    const res = await PUT(new Request("http://t/api", { method: "PUT",
      body: JSON.stringify({ scope: "general", positions: {} }) }) as never);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/app/api/admin/journey/layout/route.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Implementar `route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];
const posSchema = z.record(z.object({ x: z.number(), y: z.number() }));
const putSchema = z.object({ scope: z.string().min(1).max(200), positions: posSchema });

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const scope = new URL(req.url).searchParams.get("scope") || "general";
  const row = await prisma.journeyLayout.findUnique({ where: { id: scope } }).catch(() => null);
  return NextResponse.json({ positions: (row?.positions as unknown) ?? {} });
}

export async function PUT(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { scope, positions } = parsed.data;
  await prisma.journeyLayout.upsert({
    where: { id: scope },
    create: { id: scope, positions: positions as object },
    update: { positions: positions as object },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/app/api/admin/journey/layout/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/journey/layout/route.ts src/app/api/admin/journey/layout/route.test.ts
git commit -m "feat(journey): API GET/PUT de layout del canvas (RBAC + zod)"
```

---

## Task 4: UI — lienzo React Flow con persistencia

**Files:**
- Modify: `package.json` (dep)
- Modify: `src/components/journey/journey-map-view.tsx` (reescritura)

- [ ] **Step 1: Instalar React Flow**

Run: `npm i @xyflow/react`
Expected: instala sin error; aparece en `package.json` dependencies. (Si el registry está restringido, reportar BLOCKED.)

- [ ] **Step 2: Verificar API de la versión instalada** (React Flow v11 usa `reactflow`; v12 usa `@xyflow/react`). Confirmar exports:

Run: `node -e "const m=require('@xyflow/react'); console.log(['ReactFlow','Background','Controls','MiniMap','useNodesState','useEdgesState'].filter(k=>k in m))"`
Expected: imprime los nombres disponibles. Ajustar imports del componente a lo que exista (en v12 todos existen). El CSS es `@xyflow/react/dist/style.css`.

- [ ] **Step 3: Reescribir `journey-map-view.tsx`** usando React Flow. Reusa la derivación (`buildGeneralView`/`buildTargetedView`/`extractCampaigns`) + el adaptador (`generalToFlow`/`targetedToFlow`/`applyPositions`). Mantén switcher + filtro. Read-only lógico (`nodesConnectable={false}`, sin paleta). Persistencia con debounce en `onNodeDragStop`.

```tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LIFECYCLE_COLORS } from "@/lib/constants";
import { buildGeneralView, buildTargetedView, extractCampaigns, type RuleLite, type PlanLite } from "@/lib/journey/journey-map";
import { generalToFlow, targetedToFlow, applyPositions, type Positions } from "@/lib/journey/flow-adapter";

type Mode = "general" | "targeted";

function nodeStyle(type: string, data: Record<string, unknown>): React.CSSProperties {
  const dim = data.isActive === false ? 0.5 : 1;
  if (type === "stage") return { background: (LIFECYCLE_COLORS[String(data.stage)] ?? "#6B7280"), color: "#fff", border: "none", borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, opacity: dim };
  if (type === "trigger") return { background: "#2563eb", color: "#fff", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim };
  if (type === "cadence") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim };
  if (type === "condition") return { border: "1px dashed #9ca3af", borderRadius: 8, padding: 8, fontSize: 12, opacity: dim };
  return { border: "1px solid #d1d5db", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff", opacity: dim };
}

export function JourneyMapView() {
  const [rules, setRules] = useState<RuleLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = mode === "general" ? "general" : `targeted:${campaign}`;

  useEffect(() => {
    fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleLite[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const campaigns = useMemo(() => extractCampaigns(rules), [rules]);

  // Reconstruir el flujo + aplicar layout guardado cuando cambian datos/scope
  useEffect(() => {
    const flow = mode === "general"
      ? generalToFlow(buildGeneralView(rules, plans))
      : campaign ? targetedToFlow(buildTargetedView(rules, plans, { campaign })) : { nodes: [], edges: [] };
    // cargar posiciones guardadas (best-effort: si la tabla no existe aún, degrada a auto-layout)
    fetch(`/api/admin/journey/layout?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.ok ? r.json() : { positions: {} })
      .catch(() => ({ positions: {} }))
      .then((j) => {
        const positioned = applyPositions(flow.nodes, (j.positions ?? {}) as Positions);
        setNodes(positioned as unknown as Node[]);
        setEdges(flow.edges as unknown as Edge[]);
      });
  }, [rules, plans, mode, campaign, scope, setNodes, setEdges]);

  const persist = useCallback((current: Node[]) => {
    const positions: Positions = {};
    for (const n of current) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    fetch("/api/admin/journey/layout", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, positions }),
    }).catch(() => {});
  }, [scope]);

  const onNodeDragStop = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setNodes((nds) => { persist(nds); return nds; }), 600);
  }, [persist, setNodes]);

  const typedNodes = useMemo(() => nodes.map((n) => ({
    ...n, data: { label: (n.data as { label?: string }).label }, style: nodeStyle(n.type ?? "action", n.data as Record<string, unknown>),
  })), [nodes]);

  if (loading) return <div className="p-8 text-sm text-neutral-500">Cargando lienzo…</div>;
  if (!rules.length && !plans.length) return <div className="p-8 text-sm text-neutral-500">Sin reglas ni cadencias configuradas. Créalas en Configuración → Automatización.</div>;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
            <button onClick={() => setMode("general")} className={`px-3 py-1 rounded ${mode === "general" ? "bg-neutral-900 text-white" : ""}`}>General</button>
            <button onClick={() => setMode("targeted")} className={`px-3 py-1 rounded ${mode === "targeted" ? "bg-neutral-900 text-white" : ""}`}>Dirigida</button>
          </div>
          {mode === "targeted" && (
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="rounded-md border px-2 py-1">
              <option value="">— elige campaña —</option>
              {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </header>
      <div className="flex-1">
        <ReactFlow
          nodes={typedNodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false} fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <p className="border-t border-neutral-200 px-6 py-1.5 text-xs text-neutral-400 dark:border-neutral-800">Solo lectura. Mueve los nodos para acomodar; el acomodo se guarda. Edita reglas/cadencias en Configuración → Automatización.</p>
    </div>
  );
}
```

> Notas: (1) si la API de `@xyflow/react` instalada difiere (genéricos de `useNodesState`), ajustar tipos a la versión real — el objetivo es: nodos movibles, no conectables, con persistencia en drag. (2) El `persist` se dispara dentro de `setNodes` para leer el estado fresco sin agregar `nodes` a deps. (3) La carga de layout es best-effort: si `journey_layouts` aún no existe en BD, el GET puede dar 500 → el `.then(r.ok?…)`/`.catch` degrada a auto-layout, así la página NO se rompe pre-migración.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json` (ignorar los 2 errores pre-existentes) y luego `npm run build`
Expected: sin errores nuevos; build "Compiled successfully". (React Flow es client-only; el componente ya es `"use client"` y la página `/journey` lo monta.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/journey/journey-map-view.tsx
git commit -m "feat(journey): lienzo React Flow movible + persistencia de layout (read-only)"
```

---

## Task 5: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todos verdes (previos + flow-adapter 3 + layout API 4).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: "Compiled successfully", exit 0; ruta `/journey` presente.

- [ ] **Step 3: Autoría**

Run: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`
Expected: solo `Propyte-Luis <webkoi@webkoi-ai.com>`.

- [ ] **Step 4: Reporte a Luis** — resumen + **gate de migración**: "di `aplica la migración journey-layout` y la corro vía MCP (1 CREATE TABLE aditivo)". Aclarar que la página funciona pre-migración (auto-layout; solo no persiste hasta aplicar). Luego ff-merge a main.

---

## Notas de ejecución

- **Gate de migración:** `journey_layouts` es tabla nueva aditiva. La UI degrada a auto-layout si la tabla no existe (GET best-effort), así que el deploy ANTES de aplicar la migración no rompe `/journey` — solo no guarda posiciones. Aun así, aplicar la migración + merge juntos es lo limpio. NO aplicar sin la frase de Luis.
- **Dep nueva `@xyflow/react`:** queda en package.json + lock; el build de Hostinger la instala. Si el `npm i` falla por registry, reportar BLOCKED (no inventar versión).
- **Orden de dependencias:** Task 1 (modelo, tipos Prisma) → Task 3 (API usa `prisma.journeyLayout`). Task 2 (adapter) independiente. Task 4 (UI) usa adapter + API + dep.
- **Lección C.1 aplicada:** el GET `/api/admin/automation` ya incluye `conditions` (fix de C.1), así que la vista Dirigida del canvas tendrá datos.
- **React Flow versión:** confirmar exports antes de codificar imports (Task 4 Step 2). v12 = `@xyflow/react`; si el repo ya tuviera `reactflow` v11, usar ese en su lugar — verificar.
