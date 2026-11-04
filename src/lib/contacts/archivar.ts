// Archivar un contacto (borrado lógico) — #903.
//
// Los identificadores de canal (`instagramId`, `messengerPsid`, `whatsappUserId`) son @unique en
// la base, pero el intake y el inbox solo buscan contactos VIVOS (`deletedAt: null`). Si un
// contacto se archivaba conservándolos, cuando esa persona volvía a escribir nadie la encontraba,
// el alta nueva chocaba con el identificador que seguía ocupado por la archivada (P2002) y el
// prospecto se perdía: el mensaje entraba, el contacto no.
//
// Por eso archivar los LIBERA. No se pierden: el disparador de la cronología
// (record_field_changes) guarda el valor anterior de cada campo en el mismo UPDATE, con quién lo
// hizo y desde dónde. Es lo mismo que ya hace lib/moderation/block-sender.ts al bloquear, y lo
// que se hizo a mano en la limpieza del 16-oct.
//
// El teléfono y el correo NO se tocan: no son únicos en `contacts`, así que no bloquean un alta
// nueva, y son lo que alguien buscaría en un archivado. `zohoId` (también único) se conserva: no
// es un canal por el que la persona escriba, es el enlace con su registro de Zoho.

/** Columnas únicas de canal que un contacto archivado no debe retener. */
export const IDS_DE_CANAL = ["instagramId", "messengerPsid", "whatsappUserId"] as const;
export type IdDeCanal = (typeof IDS_DE_CANAL)[number];

/** `data` del UPDATE que archiva un contacto: lo marca borrado y suelta sus ids de canal. */
export function datosDeArchivado(ahora: Date = new Date()) {
  return { deletedAt: ahora, instagramId: null, messengerPsid: null, whatsappUserId: null };
}

/**
 * Al fusionar: qué ids de canal del contacto que se archiva pasan al que queda. Solo los que el
 * que queda NO tiene; si ya tiene uno de ese canal, gana el suyo y el del archivado se suelta.
 */
export function idsQuePasanAlQueQueda(
  queQueda: Partial<Record<IdDeCanal, string | null>>,
  seArchiva: Partial<Record<IdDeCanal, string | null>>,
): Partial<Record<IdDeCanal, string>> {
  const pasan: Partial<Record<IdDeCanal, string>> = {};
  for (const campo of IDS_DE_CANAL) {
    const suyo = seArchiva[campo];
    if (suyo && !queQueda[campo]) pasan[campo] = suyo;
  }
  return pasan;
}
