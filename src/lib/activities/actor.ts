import prisma from "@/lib/db";

/**
 * A quién se le atribuye una actividad cuando el contacto no tiene asesor asignado.
 *
 * `Activity.userId` es NOT NULL y es una FK a `users`. Sin asesor hay que poner a ALGUIEN,
 * y la respuesta correcta es un ADMIN activo — no el contacto.
 *
 * ## Por qué existe como función y no inline
 *
 * Este fallback ya vivía escrito a mano en el intake de mensajería, con el comentario del
 * BUG 2026-07-24: un contacto sin asignar hacía que la actividad se creara con
 * `userId = contact.id` —un contacto ocupando el lugar de un usuario—, la FK reventaba y se
 * llevaba por delante TODO el pipeline posterior: sin actividad, sin SLA, sin eventos y sin
 * bot.
 *
 * El mismo error seguía vivo en `captureLead`, en la nota de lead repetido, escrito igual
 * (`existing.assignedToId ?? existing.id`) y con el fallo tapado por un `.catch(() => {})`.
 * Dos copias del mismo fallback es exactamente cómo una se arregla y la otra no.
 *
 * Devuelve `null` cuando no hay ni asesor ni admin activo. El llamador decide qué hacer con
 * eso, pero NUNCA debe inventarse un id: un `null` cuesta una actividad, un id equivocado
 * cuesta la transacción entera.
 */
export async function actorDeActividad(
  assignedToId: string | null | undefined,
): Promise<string | null> {
  if (assignedToId) return assignedToId;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  return admin?.id ?? null;
}
