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
    // Seguimiento (2026-10-09): handleInboundMessage llama a attachBrand en CADA mensaje de un
    // contacto existente. Si la fila contacto ↔ marca ya está no hay nada que registrar: se
    // termina con UNA consulta por la clave única, sin leer la predeterminada, sin contar filas
    // ni hacer upserts por mensaje entrante. Va dentro del try: un fallo de lectura aquí tampoco
    // debe romper la entrada del mensaje.
    const already = await prisma.contactBrand.findUnique({
      where: { contactId_brandId: { contactId, brandId } },
      select: { id: true },
    });
    if (already) return;

    if (!contactIsNew) {
      const defaultId = await getDefaultBrandId();
      // Sin el id de la predeterminada (no se pudo leer o no existe) NO se escribe nada
      // (2026-10-09, revisión final I1): registrar solo la fila de la otra marca sacaría para
      // siempre de Propyte a un contacto que ya era suyo. Sin filas sigue siendo de la
      // predeterminada, y su siguiente entrada por esa cuenta lo vuelve a intentar.
      if (!defaultId) {
        console.error(
          "[brands] sin la marca predeterminada no se registra la marca de un contacto existente; se reintenta en su siguiente entrada",
          contactId,
          brandId,
        );
        return;
      }
      if (defaultId !== brandId) {
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
