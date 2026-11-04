// Firma estable de un grupo de duplicados (E7 #968): mismos contactos → misma firma,
// sin importar el orden. Si el grupo crece con un contacto nuevo, la firma cambia y
// el grupo vuelve a aparecer (puede ser un duplicado real).
export function firmaDeGrupo(ids: string[]): string {
  return [...new Set(ids)].sort().join("|");
}

// Clave de SystemConfig donde se guardan los grupos marcados "No es duplicado".
export const CLAVE_REVISADOS = "contacts.duplicados_revisados";
