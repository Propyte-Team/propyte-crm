// Webhook web v2 — intake único de leads del sitio (Anexo B §H.5, OQ1 del consolidado).
// Auth: header X-Webhook-Secret contra el conector WEBSITE activo (o LEADS_WEBHOOK_SECRET env).
// Payload: ver incomingLeadSchema. Respuesta: { contactId, isNew, assignedTo }.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readCredentials } from "@/lib/intake/connectors";
import { captureLead } from "@/lib/intake/capture-lead";
import { processIncomingLead } from "@/lib/intake/connectors";
import { buscarPorSecreto, secretosIgualesRecortados } from "@/lib/crypto/secretos";

export const dynamic = "force-dynamic";

async function resolveConnector(secret: string | null) {
  if (!secret) return null;
  const connectors = await prisma.leadConnector.findMany({
    where: { provider: "WEBSITE", status: "ACTIVE", deletedAt: null },
  });
  // #736: se recorren TODOS los conectores, sin corte temprano, y cada comparación es en
  // tiempo constante. El `.find(... === ...)` anterior filtraba el prefijo del secreto y
  // además cuántos conectores se revisaron antes de acertar.
  return buscarPorSecreto<(typeof connectors)[number]>(
    connectors,
    secret,
    (c) => readCredentials<{ webhookSecret?: string }>(c)?.webhookSecret
  );
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  const connector = await resolveConnector(secret);
  // #736: en tiempo constante, ver src/lib/crypto/secretos.ts.
  const envOk = secretosIgualesRecortados(secret, process.env.LEADS_WEBHOOK_SECRET);

  if (!connector && !envOk) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // source default WEBSITE si no viene
  if (!body.source) body.source = "WEBSITE";

  if (connector) {
    // Vía conector: log idempotente por externalId (o hash simple del payload)
    const externalId =
      (typeof body.externalId === "string" && body.externalId) ||
      `${body.email ?? body.phone ?? "x"}:${new Date().toISOString().slice(0, 10)}`;
    const result = await processIncomingLead(connector.id, externalId, { external: body }, body);
    return NextResponse.json(result, { status: result.status === "ERROR" ? 422 : 200 });
  }

  // Vía secreto de entorno (sin conector configurado aún)
  const result = await captureLead(body);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json({
    contactId: result.contactId,
    isNew: result.isNew,
    assignedTo: result.assignedToId,
  });
}
