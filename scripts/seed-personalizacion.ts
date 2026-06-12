// Seeds Personalización & Equipos — idempotente. CORRER tras aplicar
// prisma/migrations-manual/2026-06-11-p123-personalizacion.sql:
//   npx tsx scripts/seed-personalizacion.ts
//
// Registra: objetos núcleo (isSystem) + objetos externos del Hub (OQ5) +
// relaciones físicas existentes descritas en el registro (speckit §4.4).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OBJECTS = [
  { apiName: "contact", label: "Contacto", pluralLabel: "Contactos", isSystem: true, recordNameField: "firstName" },
  { apiName: "deal", label: "Deal", pluralLabel: "Deals", isSystem: true, recordNameField: "id" },
  { apiName: "activity", label: "Actividad", pluralLabel: "Actividades", isSystem: true, recordNameField: "subject" },
  { apiName: "quote", label: "Cotización", pluralLabel: "Cotizaciones", isSystem: true, recordNameField: "id" },
  { apiName: "user", label: "Usuario", pluralLabel: "Usuarios", isSystem: true, recordNameField: "name" },
  // Externos del Hub: visibles en relaciones, NUNCA editables (OQ5)
  { apiName: "hub_development", label: "Desarrollo (Hub)", pluralLabel: "Desarrollos (Hub)", isSystem: false, isExternal: true, recordNameField: "nombre" },
  { apiName: "hub_unit", label: "Unidad (Hub)", pluralLabel: "Unidades (Hub)", isSystem: false, isExternal: true, recordNameField: "unitNumber" },
];

// Relaciones núcleo YA físicas en Prisma — el registro las DESCRIBE (no recrea)
const SYSTEM_RELATIONSHIPS = [
  {
    name: "contact_deals",
    fromObject: "deal",
    toObject: "contact",
    kind: "MASTER_DETAIL" as const,
    onDelete: "RESTRICT" as const,
    relatedListLabel: "Deals del contacto",
    isSystem: true,
    labels: [
      { label: "titular", toRole: "Titular" },
      { label: "co_inversionista", toRole: "Co-inversionista" },
      { label: "broker", toRole: "Broker externo" },
    ],
  },
  {
    name: "deal_hub_development",
    fromObject: "deal",
    toObject: "hub_development",
    kind: "LOOKUP" as const,
    onDelete: "SET_NULL" as const,
    relatedListLabel: "Desarrollo de interés",
    isSystem: true,
    projections: [
      { sourceFieldApiName: "ext_precio_min_mxn", displayLabel: "Precio desde" },
      { sourceFieldApiName: "zona", displayLabel: "Zona" },
      { sourceFieldApiName: "pipeline_status", displayLabel: "Estatus" },
    ],
  },
  {
    name: "contact_assigned_user",
    fromObject: "contact",
    toObject: "user",
    kind: "LOOKUP" as const,
    onDelete: "SET_NULL" as const,
    relatedListLabel: "Asesor asignado",
    isSystem: true,
  },
  {
    name: "deal_activities",
    fromObject: "activity",
    toObject: "deal",
    kind: "LOOKUP" as const,
    onDelete: "SET_NULL" as const,
    relatedListLabel: "Actividades del deal",
    isSystem: true,
  },
];

async function main() {
  for (const obj of OBJECTS) {
    await prisma.customObjectDef.upsert({
      where: { apiName: obj.apiName },
      update: { label: obj.label, pluralLabel: obj.pluralLabel },
      create: obj,
    });
    console.log("Objeto:", obj.apiName);
  }

  for (const rel of SYSTEM_RELATIONSHIPS) {
    const { labels, projections, ...data } = rel as typeof rel & {
      labels?: Array<{ label: string; fromRole?: string; toRole?: string }>;
      projections?: Array<{ sourceFieldApiName: string; displayLabel: string }>;
    };
    const created = await prisma.relationshipDef.upsert({
      where: { name: data.name },
      update: { relatedListLabel: data.relatedListLabel },
      create: data,
    });
    if (labels) {
      for (const l of labels) {
        await prisma.relationshipLabel.upsert({
          where: { relationshipId_label: { relationshipId: created.id, label: l.label } },
          update: l,
          create: { relationshipId: created.id, ...l },
        });
      }
    }
    if (projections) {
      for (const [i, p] of projections.entries()) {
        const existing = await prisma.lookupProjection.findFirst({
          where: { relationshipId: created.id, sourceFieldApiName: p.sourceFieldApiName },
        });
        if (!existing) {
          await prisma.lookupProjection.create({
            data: { relationshipId: created.id, ...p, order: (i + 1) * 10 },
          });
        }
      }
    }
    console.log("Relación:", data.name);
  }

  console.log("\nSeeds Personalización completos.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
