// src/lib/mcp/handlers/connectors.ts
import { z } from "zod";
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { writeCredentials } from "@/lib/intake/connectors";
import { writeAudit } from "../respond";

// ── helpers ──────────────────────────────────────────────────────────────────

type RedactedConnector = Omit<LeadConnector, "credentials"> & { hasCredentials: boolean };

function redact(c: LeadConnector): RedactedConnector {
  const { credentials, ...rest } = c;
  return { ...rest, hasCredentials: !!credentials };
}

// ── schemas ───────────────────────────────────────────────────────────────────

const PROVIDERS = [
  "META","INSTAGRAM","MESSENGER","TIKTOK","WEBSITE","ZAPIER","MANUAL","GOOGLE",
  "LINKEDIN","INMUEBLES24","LAMUDI_PROPPIT","PROPIEDADES","VIVANUNCIOS","EASYBROKER",
  "GOOGLE_ADS","YOUTUBE","PINTEREST","CUSTOM",
] as const;

const DIRECTIONS = ["INBOUND","OUTBOUND","BOTH"] as const;
const STATUSES   = ["ACTIVE","PAUSED","ERROR"] as const;

const createSchema = z.object({
  name:       z.string().min(2).max(120).trim(),
  provider:   z.enum(PROVIDERS),
  direction:  z.enum(DIRECTIONS).default("INBOUND"),
  credentials: z.record(z.unknown()).optional(),
  config:     z.record(z.unknown()).default({}),
  fieldMap:   z.record(z.unknown()).default({}),
});

const updateSchema = z.object({
  name:        z.string().min(2).max(120).trim().optional(),
  status:      z.enum(STATUSES).optional(),
  credentials: z.record(z.unknown()).optional(),
  config:      z.record(z.unknown()).optional(),
  fieldMap:    z.record(z.unknown()).optional(),
});

// ── handlers ──────────────────────────────────────────────────────────────────

export async function listConnectors(): Promise<RedactedConnector[]> {
  const rows = await prisma.leadConnector.findMany({ where: { deletedAt: null } });
  return rows.map(redact);
}

export async function getConnector(id: string): Promise<RedactedConnector> {
  const c = await prisma.leadConnector.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new Error("Conector no encontrado");
  return redact(c);
}

export async function createConnector(body: unknown, userId: string): Promise<RedactedConnector> {
  const d = createSchema.parse(body);
  const encryptedCreds = d.credentials ? writeCredentials(d.credentials) : null;

  const created = await prisma.leadConnector.create({
    data: {
      name:        d.name,
      provider:    d.provider,
      direction:   d.direction,
      status:      "PAUSED", // siempre nace PAUSED
      credentials: encryptedCreds,
      config:      d.config as never,
      fieldMap:    d.fieldMap as never,
    },
  });

  await writeAudit(userId, "CREATE", "LeadConnector", created.id, { name: d.name });
  return redact(created);
}

export async function updateConnector(id: string, body: unknown, userId: string): Promise<RedactedConnector> {
  const existing = await prisma.leadConnector.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Conector no encontrado");

  const d = updateSchema.parse(body);

  const data: Record<string, unknown> = {};
  if (d.name      !== undefined) data.name      = d.name;
  if (d.status    !== undefined) data.status    = d.status;
  if (d.config    !== undefined) data.config    = d.config;
  if (d.fieldMap  !== undefined) data.fieldMap  = d.fieldMap;

  // Re-cifrar credentials si vienen; reset de errores
  if (d.credentials !== undefined) {
    data.credentials = writeCredentials(d.credentials);
    data.errorCount  = 0;
    data.lastError   = null;
  }

  const updated = await prisma.leadConnector.update({ where: { id }, data: data as never });
  await writeAudit(userId, "UPDATE", "LeadConnector", id, { changed: Object.keys(d) });
  return redact(updated);
}
