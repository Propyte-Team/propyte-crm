// Piezas compartidas por las rutas /api/admin/brands y /api/admin/brands/[id] (2026-10-09).
// Un archivo route.ts de Next solo puede exportar handlers, así que lo común vive aquí en vez de
// copiarse en cada ruta (la copia en dos sitios es como se desalinean las validaciones).
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import type { BrandPatchInput } from "@/lib/validations/brand";

/** P2021 = la tabla no existe: la migración manual de marcas aún no se aplicó. */
export function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

/**
 * P2002 = choque de índice único. `name` y `slug` son únicos SIN considerar deletedAt, así que
 * una marca borrada (soft delete) sigue "ocupando" su nombre y su slug.
 */
export function isUniqueClash(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Campos que el cliente puede escribir. Se declara a partir del input de CREATE (scalars simples,
 * sin operadores `{ set: ... }`) para que el mismo objeto sirva tanto en `create` como en `update`.
 */
type BrandWritable = Partial<
  Pick<
    Prisma.BrandUncheckedCreateInput,
    | "name"
    | "slug"
    | "persona"
    | "knowledge"
    | "developmentIds"
    | "defaultPlaza"
    | "enabledChannels"
    | "tonePreset"
    | "playbookId"
    | "marketingOwnerUserId"
    | "botEnabled"
  >
>;

/**
 * Pasa el cuerpo ya validado a datos de Prisma. Solo lleva las claves que vinieron: en un PATCH,
 * lo que no se mandó no se toca. `enabledChannels: null` ("hereda la config global") se guarda como
 * Prisma.DbNull — un `null` a secas en una columna Json? es ambiguo para Prisma y no compila.
 * `isDefault` no pasa por aquí: el esquema estricto ya lo rechazó y el POST lo fija en false.
 */
export function brandWriteData(input: BrandPatchInput): BrandWritable {
  const { enabledChannels, ...rest } = input;
  const data: BrandWritable = { ...rest };
  if (enabledChannels !== undefined) {
    data.enabledChannels = enabledChannels === null ? Prisma.DbNull : enabledChannels;
  }
  return data;
}

/**
 * Verifica que el playbook y el responsable de marketing existan y estén vivos. Devuelve el mensaje
 * del 400 o null si todo está bien. Un null explícito (quitar la referencia) no consulta nada.
 *
 * `current` (solo en el PATCH) trae los valores que la marca ya tiene guardados. Un valor enviado
 * IGUAL al actual no se valida: el formulario de edición reenvía siempre ambos campos, y si el
 * responsable se dio de baja o el playbook se borró, validarlos de nuevo bloquearía cualquier guardado
 * (incluso apagar el agente). Solo se exige que esté vivo lo que el cliente CAMBIA (2026-10-09). Un
 * valor viejo no daña: bot-respond ya ignora un playbook inactivo y cae al global si el responsable
 * está inactivo. El POST no pasa `current`, así que sigue validando todo.
 */
export async function brandRefsError(
  input: {
    playbookId?: string | null;
    marketingOwnerUserId?: string | null;
  },
  current?: {
    playbookId?: string | null;
    marketingOwnerUserId?: string | null;
  }
): Promise<string | null> {
  if (typeof input.playbookId === "string" && input.playbookId !== current?.playbookId) {
    const playbook = await prisma.botPlaybook.findFirst({
      where: { id: input.playbookId, deletedAt: null },
      select: { id: true },
    });
    if (!playbook) return "Playbook no encontrado";
  }
  if (
    typeof input.marketingOwnerUserId === "string" &&
    input.marketingOwnerUserId !== current?.marketingOwnerUserId
  ) {
    const owner = await prisma.user.findFirst({
      where: { id: input.marketingOwnerUserId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!owner) return "Responsable de marketing no encontrado o inactivo";
  }
  return null;
}
