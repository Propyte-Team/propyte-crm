// Webhook genérico de portales inmobiliarios (speckit #4 §6.2) — Inmuebles24/Lamudi/
// Propiedades/Vivanuncios/EasyBroker entran aquí como conectores (PA4: configurar, no programar).
// Auth: ?cid=<connectorId> + X-Webhook-Secret contra credentials.webhookSecret del conector.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readCredentials, mapExternalFields, processIncomingLead } from "@/lib/intake/connectors";

export const dynamic = "force-dynamic";

const PORTAL_PROVIDERS = ["INMUEBLES24", "LAMUDI_PROPPIT", "PROPIEDADES", "VIVANUNCIOS", "EASYBROKER", "CUSTOM"];

export async function POST(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("cid");
  if (!cid) return NextResponse.json({ error: "Falta ?cid=<connectorId>" }, { status: 400 });

  const connector = await prisma.leadConnector.findUnique({ where: { id: cid } });
  if (!connector || connector.deletedAt || connector.status !== "ACTIVE" || !PORTAL_PROVIDERS.includes(connector.provider)) {
    return NextResponse.json({ error: "Conector inválido o inactivo" }, { status: 404 });
  }

  const creds = readCredentials<{ webhookSecret?: string }>(connector);
  const provided = req.headers.get("x-webhook-secret");
  if (!creds?.webhookSecret || provided !== creds.webhookSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Mapeo configurable por conector; defaults razonables de portales MX
  const defaultMap: Record<string, string> = {
    name: "fullName",
    nombre: "fullName",
    full_name: "fullName",
    phone: "phone",
    telefono: "phone",
    email: "email",
    correo: "email",
    message: "message",
    mensaje: "message",
    lead_id: "portalLeadId",
    id: "portalLeadId",
  };
  const fieldMap = { ...defaultMap, ...((connector.fieldMap ?? {}) as Record<string, string>) };
  const mapped = mapExternalFields(fieldMap, body);
  mapped.source = "PORTAL_INMOBILIARIO";
  mapped.sourceDetail = `${connector.provider.toLowerCase()}${mapped.sourceDetail ? ` · ${mapped.sourceDetail}` : ""}`.slice(0, 200);

  const externalLeadId =
    (typeof mapped.portalLeadId === "string" && mapped.portalLeadId) ||
    `${mapped.phone ?? mapped.email ?? "x"}:${new Date().toISOString().slice(0, 10)}`;

  const result = await processIncomingLead(connector.id, externalLeadId, { external: body }, mapped);
  return NextResponse.json(result, { status: result.status === "ERROR" ? 422 : 200 });
}
