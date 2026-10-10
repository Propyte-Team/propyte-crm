// Alta conjunta «Meta DMs»: la cuenta de Messenger y, si se quiere, la de Instagram de UNA
// Página, en un solo formulario (2026-10-10).
//
// Por qué existe: cada marca tiene dos cuentas sociales — «Messenger | DM X» e «IG - X» —
// que usan la MISMA Página, el MISMO Page Access Token, App Secret, Verify Token y marca;
// la de Instagram solo añade su igBusinessId. Darlas de alta con dos asistentes obligaba a
// teclear todo dos veces, y cada copia es una oportunidad de pegar el token o el App Secret
// de otra marca.
//
// Aquí van las piezas puras (sin red ni base) que comparten el asistente y la ruta
// /api/admin/connectors/meta-dms: los nombres, el reparto config/credentials según el
// registro de proveedores y los choques con cuentas que ya existen.
import { providerById, splitConnectorFields } from "./registry";

export type MetaDmProvider = "MESSENGER" | "INSTAGRAM";

const PROVIDER_LABEL: Record<MetaDmProvider, string> = { MESSENGER: "Messenger", INSTAGRAM: "Instagram" };

/**
 * Lo que escribe el admin es el nombre de la marca/Página ("Nativa Tulum"); los prefijos los
 * pone el sistema. Si pega uno ya con prefijo ("IG - Nativa") se le quita para no acabar con
 * "Messenger | DM IG - Nativa". El nombre importa más allá de la etiqueta: campaign-plaza.ts
 * busca "Nativa"/"Yaxnah" en él para decidir la plaza del lead.
 */
export function metaDmBaseName(nombre: string): string {
  return nombre
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(messenger\s*\|\s*dm|ig\s*-)\s+/i, "")
    .trim();
}

/** Nombres con la convención que ya tienen las cuentas en la base. */
export function metaDmNames(nombre: string): { messenger: string; instagram: string } {
  const base = metaDmBaseName(nombre);
  return { messenger: `Messenger | DM ${base}`, instagram: `IG - ${base}` };
}

export interface MetaDmDraft {
  provider: MetaDmProvider;
  name: string;
  config: Record<string, string>;
  credentials: Record<string, string>;
}

/**
 * Solo los campos que el proveedor declara en el registro. Sin este filtro el igBusinessId
 * acabaría DENTRO de las credenciales cifradas de Messenger: splitConnectorFields manda a
 * credentials todo lo que no está marcado como config, incluidas las claves que no conoce.
 */
function declaredFields(provider: MetaDmProvider, values: Record<string, string>): Record<string, string> {
  const keys = new Set((providerById(provider)?.credFields ?? []).map((f) => f.key));
  return Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k)));
}

/**
 * Las cuentas a crear: siempre la de Messenger y, si `includeInstagram`, la de Instagram, con
 * los mismos valores compartidos. config/credentials salen de las reglas del registro, igual
 * que en el asistente por proveedor.
 */
export function buildMetaDmDrafts(input: {
  name: string;
  fields: Record<string, string>;
  includeInstagram: boolean;
}): MetaDmDraft[] {
  const names = metaDmNames(input.name);
  const providers: MetaDmProvider[] = input.includeInstagram ? ["MESSENGER", "INSTAGRAM"] : ["MESSENGER"];
  return providers.map((provider) => ({
    provider,
    name: provider === "MESSENGER" ? names.messenger : names.instagram,
    ...splitConnectorFields(provider, declaredFields(provider, input.fields)),
  }));
}

export interface ExistingSocialConnector {
  id: string;
  name: string;
  provider: string;
  config: unknown;
}

export interface MetaDmConflict {
  id: string;
  name: string;
  provider: MetaDmProvider;
  by: "pageId" | "igBusinessId";
}

// String() + trim(): hay cuentas viejas con el pageId guardado como número.
function configValue(config: unknown, key: string): string {
  return String((config as Record<string, unknown> | null)?.[key] ?? "").trim();
}

/**
 * Cuentas vivas que ya cubren lo que se quiere crear. Un duplicado no es inofensivo: el
 * webhook resuelve la cuenta con findFirst por pageId (Messenger) o igBusinessId (Instagram),
 * así que con dos iguales los mensajes caen en una cualquiera. En Instagram se mira también
 * el igBusinessId por eso mismo. `existing` debe venir ya filtrado a deletedAt null.
 */
export function findMetaDmConflicts(
  existing: ExistingSocialConnector[],
  target: { pageId: string; includeInstagram: boolean; igBusinessId?: string }
): MetaDmConflict[] {
  const conflicts: MetaDmConflict[] = [];
  for (const c of existing) {
    const base = { id: c.id, name: c.name };
    if (c.provider === "MESSENGER") {
      if (configValue(c.config, "pageId") === target.pageId) conflicts.push({ ...base, provider: "MESSENGER", by: "pageId" });
    } else if (c.provider === "INSTAGRAM" && target.includeInstagram) {
      if (configValue(c.config, "pageId") === target.pageId) {
        conflicts.push({ ...base, provider: "INSTAGRAM", by: "pageId" });
      } else if (target.igBusinessId && configValue(c.config, "igBusinessId") === target.igBusinessId) {
        conflicts.push({ ...base, provider: "INSTAGRAM", by: "igBusinessId" });
      }
    }
  }
  return conflicts;
}

/** Texto del rechazo por duplicado: nombra la cuenta que ya existe y qué hacer. */
export function conflictMessage(
  conflicts: MetaDmConflict[],
  target: { pageId: string; igBusinessId?: string }
): string {
  const list = conflicts
    .map((c) =>
      c.by === "pageId"
        ? `«${c.name}» (${PROVIDER_LABEL[c.provider]}) para la Página ${target.pageId}`
        : `«${c.name}» (${PROVIDER_LABEL[c.provider]}) para el Instagram ${target.igBusinessId}`
    )
    .join(" y ");
  const onlyInstagram = conflicts.every((c) => c.provider === "INSTAGRAM");
  return (
    `Ya existe ${list}; no se creó nada. ` +
    (onlyInstagram
      ? "Desmarca «Incluir Instagram» para crear solo la de Messenger."
      : "Si es esa misma Página, cámbiale el token con «Token» en esa cuenta; para reemplazarla, elimínala primero.")
  );
}

export function noLinkedInstagramMessage(pageName: string): string {
  return (
    `La Página «${pageName || "sin nombre"}» no tiene una cuenta de Instagram Business vinculada. ` +
    "Desmarca «Incluir Instagram» para crear solo la de Messenger, o vincúlala en Meta y vuelve a probar."
  );
}

export function igMismatchMessage(
  linked: { id: string; username: string },
  given: string,
  pageName: string
): string {
  const who = linked.username ? `@${linked.username} (${linked.id})` : linked.id;
  return (
    `El Instagram Business ID ${given} no es el de la Página «${pageName || "sin nombre"}»: ` +
    `su cuenta vinculada es ${who}.`
  );
}
