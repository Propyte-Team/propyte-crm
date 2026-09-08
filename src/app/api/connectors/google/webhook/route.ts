// Webhook de Google Ads Lead Form. Google POSTea un lead por submission.
// Seguridad: google_key debe coincidir con la webhookKey cifrada del conector.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readCredentials, mapExternalFields, processIncomingLead } from "@/lib/intake/connectors";
import { parseGoogleLeadForm, type GoogleLeadPayload } from "./parse";
import { buscarPorSecreto } from "@/lib/crypto/secretos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as GoogleLeadPayload | null;
  if (!payload?.lead_id || !payload.google_key) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Encuentra el conector GOOGLE_ADS cuya webhookKey coincide (descifrando cada uno).
  const connectors = await prisma.leadConnector.findMany({
    where: { provider: "GOOGLE_ADS", status: "ACTIVE", deletedAt: null },
  });
  // #736: en tiempo constante y sin corte temprano, ver src/lib/crypto/secretos.ts. El
  // `.find(... === ...)` filtraba el prefijo de la llave y cuántos conectores se revisaron.
  const connector = buscarPorSecreto<(typeof connectors)[number]>(
    connectors,
    payload.google_key,
    (c) => readCredentials<{ webhookKey?: string }>(c)?.webhookKey
  );
  if (!connector) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { externalLeadId, external } = parseGoogleLeadForm(payload);
  const defaultMap: Record<string, string> = {
    FULL_NAME: "fullName", FIRST_NAME: "firstName", LAST_NAME: "lastName",
    EMAIL: "email", PHONE_NUMBER: "phone",
  };
  const fieldMap = { ...defaultMap, ...((connector.fieldMap ?? {}) as Record<string, string>) };
  const mapped = mapExternalFields(fieldMap, external);
  if (!mapped.source) mapped.source = "GOOGLE_ADS";

  const result = await processIncomingLead(connector.id, externalLeadId, { external, google: payload }, mapped);
  return NextResponse.json({ ok: true, status: result.status });
}
