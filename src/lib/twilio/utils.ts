// Utilidades para normalización de teléfonos y búsqueda de contactos
import { prisma } from "@/lib/db";

/**
 * Normaliza un número de teléfono mexicano a formato E.164 (+52...).
 * Maneja variantes: +521..., 521..., 52..., 1..., raw 10 dígitos.
 */
export function normalizePhone(raw: string): string {
  // Quitar espacios, guiones, paréntesis
  let digits = raw.replace(/[\s\-\(\)\+]/g, "");

  // Si empieza con 521 (formato antiguo con 1 de larga distancia), quitar el 1
  if (digits.startsWith("521") && digits.length === 13) {
    digits = "52" + digits.slice(3);
  }

  // Si son 10 dígitos (número local mexicano), agregar 52
  if (digits.length === 10) {
    digits = "52" + digits;
  }

  // Si empieza con 1 y tiene 11 dígitos (larga distancia sin código país)
  if (digits.startsWith("1") && digits.length === 11) {
    digits = "52" + digits.slice(1);
  }

  return "+" + digits;
}

/**
 * Busca un contacto por número de teléfono.
 * Prueba múltiples variantes del número para maximizar el match.
 */
export async function findContactByPhone(phone: string) {
  const normalized = normalizePhone(phone);

  // Extraer los últimos 10 dígitos para búsqueda flexible
  const last10 = normalized.slice(-10);

  // Buscar en phone y secondaryPhone con variantes
  const contact = await prisma.contact.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { phone: normalized },
        { phone: { endsWith: last10 } },
        { secondaryPhone: normalized },
        { secondaryPhone: { endsWith: last10 } },
      ],
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
    },
  });

  return contact;
}
