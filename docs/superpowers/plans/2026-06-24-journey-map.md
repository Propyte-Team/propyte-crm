# Mapa de Journey (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/journey` read-only que dibuja la automatización existente (reglas+cadencias+lifecycle) en dos vistas: General (carriles por etapa) y Dirigida (flujo de un grupo/campaña).

**Architecture:** Una capa de derivación pura (`src/lib/journey/journey-map.ts`) transforma `rules`+`plans` (del GET `/api/admin/automation` existente) en un modelo de grafo; un componente cliente lo renderiza con switcher + filtro; una página server-component con RBAC lo monta. Sin migración, sin API nueva, sin lib de grafo.

**Tech Stack:** Next.js 14 (app router), TypeScript, vitest, React/Tailwind.

**Reglas del repo:** worktree aislado `feat/crm-journey-map` (desde `origin/main` `86e2444`). Autor git `Propyte-Luis <webkoi@webkoi-ai.com>` (cada commit termina con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). Test `npx vitest run <ruta>`. Typecheck `npx tsc --noEmit -p tsconfig.json` (IGNORAR los 2 errores PRE-EXISTENTES en `src/lib/workflows/builder-model.test.ts`). Si prisma pide DATABASE_URL: `export DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder'`. **Sin migración** → no tocar BD.

---

## File Structure

- `src/lib/journey/journey-map.ts` — CREATE: tipos + `ruleStage`, `buildGeneralView`, `extractCampaigns`, `buildTargetedView` (puro).
- `src/lib/journey/journey-map.test.ts` — CREATE.
- `src/components/journey/journey-map-view.tsx` — CREATE: cliente (fetch + switcher + render General/Dirigida + filtro).
- `src/app/(dashboard)/journey/page.tsx` — CREATE: server component, RBAC, monta la vista.
- `src/components/layout/sidebar.tsx` — MODIFY: agregar item "Journey".

---

## Task 1: Derivación — tipos, `ruleStage`, `buildGeneralView`

**Files:**
- Create: `src/lib/journey/journey-map.ts`
- Test: `src/lib/journey/journey-map.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { ruleStage, buildGeneralView, type RuleLite, type PlanLite } from "./journey-map";

const plan: PlanLite = { id: "pl1", name: "Bienvenida", isActive: true, steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: 0 }] };

function rule(p: Partial<RuleLite>): RuleLite {
  return { id: "r", name: "R", isActive: true, triggerType: "EVENT", triggerConfig: {}, conditions: {}, actions: [], ...p };
}

describe("ruleStage", () => {
  it("LIFECYCLE_CHANGE → toStage", () => {
    expect(ruleStage(rule({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" } }))).toBe("MQL");
  });
  it("acción SET_LIFECYCLE → toStage (última gana)", () => {
    expect(ruleStage(rule({ actions: [{ type: "SET_LIFECYCLE", config: { toStage: "SQL" } }] }))).toBe("SQL");
  });
  it("sin señal de etapa → GENERAL", () => {
    expect(ruleStage(rule({ actions: [{ type: "SEND_WHATSAPP", config: {} }] }))).toBe("GENERAL");
  });
  it("toStage inválido → GENERAL", () => {
    expect(ruleStage(rule({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "NOPE" } }))).toBe("GENERAL");
  });
});

describe("buildGeneralView", () => {
  it("carriles en orden LIFECYCLE_ORDER + GENERAL al final, solo no vacíos", () => {
    const rMql = rule({ id: "rMql", triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" },
      actions: [{ type: "ENROLL_PLAN", config: { planId: "pl1" } }] });
    const rGen = rule({ id: "rGen", actions: [{ type: "ADD_TAG", config: { tag: "x" } }] });
    const view = buildGeneralView([rMql, rGen], [plan]);
    const stages = view.lanes.map((l) => l.stage);
    expect(stages).toEqual(["MQL", "GENERAL"]);
    // la cadencia enrolada por rMql cae en MQL
    expect(view.lanes[0].cadences.map((c) => c.id)).toEqual(["pl1"]);
    expect(view.lanes[0].rules.map((r) => r.id)).toEqual(["rMql"]);
    expect(view.lanes[1].rules.map((r) => r.id)).toEqual(["rGen"]);
  });

  it("cadencia sin regla que la enrole → carril GENERAL", () => {
    const view = buildGeneralView([], [plan]);
    expect(view.lanes).toHaveLength(1);
    expect(view.lanes[0].stage).toBe("GENERAL");
    expect(view.lanes[0].cadences.map((c) => c.id)).toEqual(["pl1"]);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/journey/journey-map.test.ts`
Expected: FAIL ("Cannot find module './journey-map'").

- [ ] **Step 3: Implementar la parte 1 de `journey-map.ts`**

```ts
// Capa de derivación del mapa de journey (sub-C.1). Puro: sin React, sin BD.
import { LIFECYCLE_ORDER } from "@/lib/constants";

export interface ActionLite { type: string; config?: Record<string, unknown> }
export interface RuleLite {
  id: string; name: string; isActive: boolean;
  triggerType: string; triggerConfig: Record<string, unknown>;
  conditions: unknown; actions: ActionLite[];
}
export interface PlanLite {
  id: string; name: string; isActive: boolean;
  steps: { actionType: string; delayMinutes: number }[];
}

export type Lane = string; // LifecycleStage | "GENERAL"
export interface RuleNode { id: string; name: string; isActive: boolean; triggerType: string }
export interface CadenceNode { id: string; name: string; isActive: boolean; stepCount: number }
export interface GeneralView { lanes: { stage: Lane; rules: RuleNode[]; cadences: CadenceNode[] }[] }

const STAGES: string[] = LIFECYCLE_ORDER as unknown as string[];

/** Etapa de lifecycle a la que pertenece una regla, o "GENERAL" si no hay señal. */
export function ruleStage(rule: RuleLite): Lane {
  const t = rule.triggerConfig?.toStage;
  if (rule.triggerType === "LIFECYCLE_CHANGE" && typeof t === "string" && STAGES.includes(t)) return t;
  let fromAction: Lane = "GENERAL";
  for (const a of rule.actions ?? []) {
    if (a.type === "SET_LIFECYCLE") {
      const s = a.config?.toStage;
      if (typeof s === "string" && STAGES.includes(s)) fromAction = s; // última gana
    }
  }
  return fromAction;
}

function planIdsEnrolledBy(rule: RuleLite): string[] {
  return (rule.actions ?? [])
    .filter((a) => a.type === "ENROLL_PLAN" && typeof a.config?.planId === "string")
    .map((a) => a.config!.planId as string);
}

export function buildGeneralView(rules: RuleLite[], plans: PlanLite[]): GeneralView {
  const laneMap = new Map<Lane, { rules: RuleNode[]; cadences: CadenceNode[] }>();
  const ensure = (s: Lane) => { if (!laneMap.has(s)) laneMap.set(s, { rules: [], cadences: [] }); return laneMap.get(s)!; };

  const planById = new Map(plans.map((p) => [p.id, p]));
  const placedPlans = new Set<string>();

  for (const r of rules) {
    const stage = ruleStage(r);
    ensure(stage).rules.push({ id: r.id, name: r.name, isActive: r.isActive, triggerType: r.triggerType });
    for (const pid of planIdsEnrolledBy(r)) {
      const p = planById.get(pid);
      if (p && !placedPlans.has(pid)) {
        ensure(stage).cadences.push({ id: p.id, name: p.name, isActive: p.isActive, stepCount: p.steps.length });
        placedPlans.add(pid);
      }
    }
  }
  // Cadencias sin regla que las enrole → GENERAL
  for (const p of plans) {
    if (!placedPlans.has(p.id)) {
      ensure("GENERAL").cadences.push({ id: p.id, name: p.name, isActive: p.isActive, stepCount: p.steps.length });
    }
  }

  const order = [...STAGES, "GENERAL"];
  const lanes = order
    .filter((s) => laneMap.has(s))
    .map((s) => ({ stage: s, rules: laneMap.get(s)!.rules, cadences: laneMap.get(s)!.cadences }));
  return { lanes };
}
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/lib/journey/journey-map.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/journey-map.ts src/lib/journey/journey-map.test.ts
git commit -m "feat(journey): derivación vista General (ruleStage + buildGeneralView)"
```

---

## Task 2: Derivación — `extractCampaigns` + `buildTargetedView`

**Files:**
- Modify: `src/lib/journey/journey-map.ts`
- Modify: `src/lib/journey/journey-map.test.ts`

- [ ] **Step 1: Agregar tests que fallan** (append en el archivo de test)

```ts
import { extractCampaigns, buildTargetedView } from "./journey-map";

describe("extractCampaigns", () => {
  it("junta valores distintos de adAttribution.campaignName en árbol anidado", () => {
    const rules = [
      rule({ conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] } }),
      rule({ conditions: { any: [
        { field: "adAttribution.campaignName", op: "contains", value: "EMPLEO" },
        { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
      ] } }),
    ];
    expect(extractCampaigns(rules).sort()).toEqual(["BROKERS", "EMPLEO"]);
  });
});

describe("buildTargetedView", () => {
  it("selecciona solo reglas cuyas condiciones referencian la campaña y arma el flujo", () => {
    const rBroker = rule({ id: "rB", name: "Brokers",
      triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKERS" }] },
      actions: [
        { type: "UPDATE_FIELD", config: { field: "contactType", value: "BROKER_EXTERNO" } },
        { type: "ENROLL_PLAN", config: { planId: "pl1" } },
        { type: "SET_LIFECYCLE", config: { toStage: "MQL" } },
      ] });
    const rOther = rule({ id: "rO", conditions: { all: [{ field: "contact.score", op: "gte", value: "70" }] } });
    const view = buildTargetedView([rBroker, rOther], [plan], { campaign: "BROKERS" });
    expect(view.flows).toHaveLength(1);
    const flow = view.flows[0];
    expect(flow[0].kind).toBe("trigger");
    expect(flow.some((n) => n.kind === "cadence" && n.label.includes("Bienvenida"))).toBe(true);
    expect(flow[flow.length - 1]).toMatchObject({ kind: "stage", label: "MQL" });
  });

  it("filtro por contactType selecciona reglas que lo referencian", () => {
    const r = rule({ id: "rE", conditions: { all: [{ field: "contact.contactType", op: "eq", value: "EMPLEO" }] } });
    const view = buildTargetedView([r], [], { contactType: "EMPLEO" });
    expect(view.flows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/journey/journey-map.test.ts`
Expected: FAIL (extractCampaigns/buildTargetedView no existen).

- [ ] **Step 3: Implementar la parte 2 en `journey-map.ts`** (agregar al final)

```ts
export interface FlowNode { kind: "trigger" | "condition" | "action" | "cadence" | "stage"; label: string }
export interface TargetedView { flows: FlowNode[][] }
export interface TargetedFilter { campaign?: string; contactType?: string }

// Recorre el árbol de condiciones (all/any/leaf) aplicando fn a cada hoja {field,op,value}.
function walkConditions(node: unknown, fn: (leaf: { field?: string; op?: string; value?: unknown }) => void): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.all)) { n.all.forEach((c) => walkConditions(c, fn)); return; }
  if (Array.isArray(n.any)) { n.any.forEach((c) => walkConditions(c, fn)); return; }
  if (typeof n.field === "string") fn(n as { field?: string; op?: string; value?: unknown });
}

export function extractCampaigns(rules: RuleLite[]): string[] {
  const set = new Set<string>();
  for (const r of rules) {
    walkConditions(r.conditions, (leaf) => {
      if (leaf.field === "adAttribution.campaignName" && typeof leaf.value === "string" && leaf.value) set.add(leaf.value);
    });
  }
  return [...set];
}

function ruleMatchesFilter(rule: RuleLite, filter: TargetedFilter): boolean {
  let match = false;
  walkConditions(rule.conditions, (leaf) => {
    if (filter.campaign && leaf.field === "adAttribution.campaignName" && String(leaf.value) === filter.campaign) match = true;
    if (filter.contactType && leaf.field === "contact.contactType" && String(leaf.value) === filter.contactType) match = true;
  });
  return match;
}

const ACTION_LABELS: Record<string, string> = {
  SEND_WHATSAPP: "💬 WhatsApp", SEND_EMAIL: "✉️ Email", CREATE_TASK: "📋 Tarea", NOTIFY: "🔔 Notificar",
  ASSIGN: "👤 Asignar", REASSIGN: "👤 Reasignar", ADD_TAG: "🏷️ Tag", UPDATE_FIELD: "✎ Campo",
  MAKE_CALL: "📞 Llamada", ESCALATE: "⚠️ Escalar", WEBHOOK: "🔗 Webhook",
};

export function buildTargetedView(rules: RuleLite[], plans: PlanLite[], filter: TargetedFilter): TargetedView {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const flows: FlowNode[][] = [];

  for (const r of rules) {
    if (!ruleMatchesFilter(r, filter)) continue;
    const flow: FlowNode[] = [];
    const trigVal = (r.triggerConfig?.eventType ?? r.triggerConfig?.toStage ?? r.triggerType) as string;
    flow.push({ kind: "trigger", label: `⚡ ${r.name} (${trigVal})` });
    flow.push({ kind: "condition", label: filter.campaign ?? filter.contactType ?? "condición" });

    let stageEffect: string | null =
      r.triggerType === "LIFECYCLE_CHANGE" && typeof r.triggerConfig?.toStage === "string"
        ? (r.triggerConfig.toStage as string) : null;

    for (const a of r.actions ?? []) {
      if (a.type === "ENROLL_PLAN") {
        const p = planById.get(String(a.config?.planId));
        flow.push({ kind: "cadence", label: `⟳ ${p ? p.name : "cadencia"}${p ? ` (${p.steps.length} pasos)` : ""}` });
      } else if (a.type === "SET_LIFECYCLE") {
        if (typeof a.config?.toStage === "string") stageEffect = a.config.toStage as string;
      } else {
        flow.push({ kind: "action", label: ACTION_LABELS[a.type] ?? a.type });
      }
    }
    if (stageEffect) flow.push({ kind: "stage", label: stageEffect });
    flows.push(flow);
  }
  return { flows };
}
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/lib/journey/journey-map.test.ts`
Expected: PASS (todos: 6 + 3 nuevos = 9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/journey-map.ts src/lib/journey/journey-map.test.ts
git commit -m "feat(journey): derivación vista Dirigida (extractCampaigns + buildTargetedView)"
```

---

## Task 3: UI — `journey-map-view.tsx`

**Files:**
- Create: `src/components/journey/journey-map-view.tsx`

- [ ] **Step 1: Implementar el componente cliente** (fetch del GET existente + switcher + render)

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "@/lib/constants";
import {
  buildGeneralView, buildTargetedView, extractCampaigns,
  type RuleLite, type PlanLite,
} from "@/lib/journey/journey-map";

type Mode = "general" | "targeted";

export function JourneyMapView() {
  const [rules, setRules] = useState<RuleLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("general");
  const [campaign, setCampaign] = useState<string>("");

  useEffect(() => {
    fetch("/api/admin/automation").then((r) => r.json()).then((j) => {
      const d = j.data ?? j;
      setRules((d.rules ?? []) as RuleLite[]);
      setPlans((d.plans ?? []) as PlanLite[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const campaigns = useMemo(() => extractCampaigns(rules), [rules]);
  const general = useMemo(() => buildGeneralView(rules, plans), [rules, plans]);
  const targeted = useMemo(() => buildTargetedView(rules, plans, { campaign: campaign || undefined }), [rules, plans, campaign]);

  function drillTo(c: string) { setCampaign(c); setMode("targeted"); }

  if (loading) return <div className="p-8 text-sm text-neutral-500">Cargando mapa…</div>;
  if (!rules.length && !plans.length) {
    return <div className="p-8 text-sm text-neutral-500">Sin reglas ni cadencias configuradas todavía. Créalas en Configuración → Automatización.</div>;
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight">Mapa de Journey</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
            <button onClick={() => setMode("general")}
              className={`px-3 py-1 rounded ${mode === "general" ? "bg-neutral-900 text-white" : ""}`}>General</button>
            <button onClick={() => setMode("targeted")}
              className={`px-3 py-1 rounded ${mode === "targeted" ? "bg-neutral-900 text-white" : ""}`}>Dirigida</button>
          </div>
          {mode === "targeted" && (
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)}
              className="rounded-md border px-2 py-1">
              <option value="">— elige campaña —</option>
              {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </header>

      {mode === "general" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {general.lanes.map((lane) => (
            <div key={lane.stage} className="min-w-[180px] flex-shrink-0 rounded-lg border border-neutral-200 dark:border-neutral-800">
              <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: LIFECYCLE_COLORS[lane.stage] ?? "#6B7280" }}>
                {LIFECYCLE_LABELS[lane.stage] ?? "General / Sin etapa"}
              </div>
              <div className="space-y-2 p-2">
                {lane.rules.map((r) => (
                  <button key={r.id} onClick={() => setMode("targeted")}
                    className={`block w-full rounded-md border px-2 py-1.5 text-left text-xs ${r.isActive ? "" : "opacity-50"}`}>
                    ⚡ {r.name}{!r.isActive && " · pausada"}
                  </button>
                ))}
                {lane.cadences.map((c) => (
                  <div key={c.id} className={`rounded-md border border-dashed px-2 py-1.5 text-xs ${c.isActive ? "" : "opacity-50"}`}>
                    ⟳ {c.name} · {c.stepCount} pasos{!c.isActive && " · pausada"}
                  </div>
                ))}
                {!lane.rules.length && !lane.cadences.length && (
                  <p className="px-1 text-[11px] text-neutral-400">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!campaign && <p className="text-sm text-neutral-500">Elige una campaña arriba para ver su flujo.</p>}
          {campaign && !targeted.flows.length && <p className="text-sm text-neutral-500">Ninguna regla referencia “{campaign}”.</p>}
          {targeted.flows.map((flow, i) => (
            <div key={i} className="flex items-center gap-2 overflow-x-auto rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              {flow.map((node, j) => (
                <div key={j} className="flex items-center gap-2">
                  <span className={[
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
                    node.kind === "trigger" ? "bg-blue-600 text-white" :
                    node.kind === "stage" ? "bg-teal-600 text-white" :
                    node.kind === "condition" ? "border border-dashed border-neutral-400" :
                    node.kind === "cadence" ? "border border-dashed border-neutral-300" :
                    "border border-neutral-300",
                  ].join(" ")}>{node.label}</span>
                  {j < flow.length - 1 && <span className="text-neutral-400">→</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-400">Vista de solo lectura. Edita reglas y cadencias en Configuración → Automatización.</p>
    </div>
  );
}
```

> Nota: el botón de regla en General hace `setMode("targeted")` (drill simple). Si quieres que drille por campaña, usar `drillTo(campaña-de-la-regla)`; en v1 basta cambiar a Dirigida y que el usuario elija campaña. `drillTo` queda disponible para clic en chips de campaña si se agregan.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos (solo los 2 pre-existentes de builder-model.test.ts).

- [ ] **Step 3: Commit**

```bash
git add src/components/journey/journey-map-view.tsx
git commit -m "feat(journey): vista cliente (switcher General/Dirigida + filtro)"
```

---

## Task 4: Página `/journey` + link en sidebar

**Files:**
- Create: `src/app/(dashboard)/journey/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Crear la página** (patrón idéntico a `configuracion/page.tsx`)

```tsx
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { JourneyMapView } from "@/components/journey/journey-map-view";

export const dynamic = "force-dynamic";

const ALLOWED = ["ADMIN", "DIRECTOR"];

export default async function JourneyPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard");
  return <JourneyMapView />;
}
```

- [ ] **Step 2: Agregar item al sidebar** — en `src/components/layout/sidebar.tsx`, junto al item "Configuracion" (mismo grupo), agregar (importar un icono de lucide ya usado en el archivo o `GitBranch`):

```tsx
{ label: "Journey", href: "/journey", icon: GitBranch, roles: ["ADMIN", "DIRECTOR"] },
```

Asegurar el import de `GitBranch` desde `lucide-react` en la lista de imports de iconos del archivo (si no está ya).

- [ ] **Step 3: Typecheck + verificar import del icono**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos. (Si `GitBranch` no existe en la versión de lucide, usar `Workflow` o `Share2`, que sí; verificar con `grep -r "GitBranch\|Workflow\|Share2" node_modules/lucide-react/dist/lucide-react.d.ts | head`.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/journey/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(journey): página /journey + link en sidebar (ADMIN/DIRECTOR)"
```

---

## Task 5: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todos verdes (previos + 9 nuevos de journey).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: "Compiled successfully", exit 0. La ruta `/journey` aparece en la tabla de rutas.

- [ ] **Step 3: Autoría**

Run: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`
Expected: solo `Propyte-Luis <webkoi@webkoi-ai.com>`.

- [ ] **Step 4: Reporte a Luis** — resumen + recordar: **sin migración** (sin gate de infra); pedir OK para ff-merge a main (auto-deploy). El mapa queda visible en /journey apenas deploye. C.2 (edición en el lienzo) queda para sesión futura.

---

## Notas de ejecución

- **Sin migración / sin API nueva:** reusa el GET `/api/admin/automation` (devuelve `{ data: { rules, plans } }`). El cliente deriva el mapa con la función pura.
- **Orden de dependencias:** Task 1 → 2 (misma lib) → 3 (UI usa la lib) → 4 (página usa la UI).
- **Heurística aproximada (documentada en el spec):** reglas sin SET_LIFECYCLE/LIFECYCLE_CHANGE caen en el carril "GENERAL". Es esperado en v1.
- **Reuso del DSL de condiciones:** `walkConditions` recorre el árbol `all/any/leaf` — misma forma que el motor; no parsear divergente.
