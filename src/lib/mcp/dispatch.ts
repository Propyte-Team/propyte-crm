// src/lib/mcp/dispatch.ts
import * as intro from "./handlers/introspection";
import * as wf from "./handlers/automation";
import * as conn from "./handlers/connectors";

type Ctx = { userId: string };
export type Handler = (args: { body: unknown; params: Record<string, string>; query?: Record<string, string>; ctx: Ctx }) => Promise<unknown>;

// Patrones de ruta: ":id" matchea cualquier segmento.
const ROUTES: Record<string, Handler> = {
  "GET /health": async () => intro.health(),
  "GET /schema": async () => intro.schema(),
  "GET /users": async () => intro.listUsers(),
  "GET /teams": async () => intro.listTeams(),

  "GET /automation/rules": async () => wf.listRules(),
  "POST /automation/rules": async ({ body, ctx }) => wf.createRule(body, ctx.userId),
  "GET /automation/rules/:id": async ({ params }) => wf.getRule(params.id),
  "PATCH /automation/rules/:id": async ({ body, params, ctx }) => wf.updateRule(params.id, body, ctx.userId),

  "GET /automation/plans": async () => wf.listPlans(),
  "POST /automation/plans": async ({ body, ctx }) => wf.createPlan(body, ctx.userId),
  "GET /automation/plans/:id": async ({ params }) => wf.getPlan(params.id),
  "PATCH /automation/plans/:id": async ({ body, params, ctx }) => wf.updatePlan(params.id, body, ctx.userId),

  "GET /automation/routing": async () => wf.listRouting(),
  "POST /automation/routing": async ({ body, ctx }) => wf.createRouting(body, ctx.userId),
  "PATCH /automation/routing/:id": async ({ body, params, ctx }) => wf.updateRouting(params.id, body, ctx.userId),

  "GET /automation/sla": async () => wf.listSla(),
  "POST /automation/sla": async ({ body, ctx }) => wf.createSla(body, ctx.userId),
  "PATCH /automation/sla/:id": async ({ body, params, ctx }) => wf.updateSla(params.id, body, ctx.userId),

  "GET /automation/queue": async () => wf.listQueue(),
  "POST /automation/queue/:id/retry": async ({ params, ctx }) => wf.retryQueue(params.id, ctx.userId),

  // F2 — Conectores
  "GET /connectors": async () => conn.listConnectors(),
  "POST /connectors": async ({ body, ctx }) => conn.createConnector(body, ctx.userId),
  "GET /connectors/:id": async ({ params }) => conn.getConnector(params.id),
  "PATCH /connectors/:id": async ({ body, params, ctx }) => conn.updateConnector(params.id, body, ctx.userId),
};

export function resolveRoute(method: string, segments: string[]) {
  for (const key of Object.keys(ROUTES)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const pSegs = pattern.slice(1).split("/");
    if (pSegs.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(":")) params[pSegs[i].slice(1)] = segments[i];
      else if (pSegs[i] !== segments[i]) { match = false; break; }
    }
    if (match) return { key, handler: ROUTES[key], params };
  }
  return null;
}
