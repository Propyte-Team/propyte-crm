// src/app/api/mcp/[...path]/route.ts
import { NextRequest } from "next/server";
import { checkBearer, getMcpUserId } from "@/lib/mcp/auth";
import { resolveRoute } from "@/lib/mcp/dispatch";
import { ok, fail } from "@/lib/mcp/respond";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, segments: string[]) {
  const token = process.env.CRM_MCP_API_TOKEN ?? "";
  if (!checkBearer(req.headers.get("authorization"), token)) return fail("unauthorized", 401);

  const route = resolveRoute(req.method, segments);
  if (!route) return fail(`no_route: ${req.method} /${segments.join("/")}`, 404);

  let body: unknown = undefined;
  if (req.method !== "GET") body = await req.json().catch(() => ({}));

  try {
    const userId = await getMcpUserId();
    const data = await route.handler({ body, params: route.params, ctx: { userId } });
    return ok(data, req.method === "POST" ? 201 : 200);
  } catch (e) {
    const msg = (e as Error).message ?? "error";
    const status = msg.includes("not found") || msg.includes("no encontrad") ? 404 : 400;
    return fail(msg, status);
  }
}

// Next.js 14: params is a plain object (not Promise)
type P = { params: { path: string[] } };
export async function GET(req: NextRequest, { params }: P) { return handle(req, params.path); }
export async function POST(req: NextRequest, { params }: P) { return handle(req, params.path); }
export async function PATCH(req: NextRequest, { params }: P) { return handle(req, params.path); }
// Sin DELETE: el route no lo exporta → 405 automático.
