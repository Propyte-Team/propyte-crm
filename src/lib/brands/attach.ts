// Atribución contacto ↔ marca (2026-10-09, spec marcas-agente §2.3).
// Regla de pertenencia: un contacto pertenece a las marcas de sus filas en contact_brands;
// SIN filas pertenece a la predeterminada. Por eso, si un contacto que YA existía (y no
// tenía filas, o sea era de Propyte) llega por otra marca, primero se registra la
// predeterminada: queda en AMBAS y no "desaparece" de Propyte cuando la entrega 2 filtre
// la visibilidad por marca.
//
// Best-effort: corre FUERA de la transacción del alta (un error dentro de una transacción
// de Postgres la aborta) y nunca lanza — la atribución jamás debe romper la entrada de un lead.
import prisma from "@/lib/db";
import { getDefaultBrandId } from "./resolve";

export async function attachBrand(args: {
  contactId: string;
  brandId: string;
  connectorId?: string | null;
  contactIsNew: boolean;
}): Promise<void> {
  const { contactId, brandId, connectorId, contactIsNew } = args;
  try {
    if (!contactIsNew) {
      const defaultId = await getDefaultBrandId();
      if (defaultId && defaultId !== brandId) {
        const existing = await prisma.contactBrand.count({ where: { contactId } });
        if (existing === 0) {
          await prisma.contactBrand.upsert({
            where: { contactId_brandId: { contactId, brandId: defaultId } },
            create: { contactId, brandId: defaultId, firstConnectorId: null },
            update: {},
          });
        }
      }
    }
    await prisma.contactBrand.upsert({
      where: { contactId_brandId: { contactId, brandId } },
      create: { contactId, brandId, firstConnectorId: connectorId ?? null },
      update: {},
    });
  } catch (err) {
    console.error("[brands] no se pudo registrar la marca del contacto", contactId, brandId, err);
  }
}
