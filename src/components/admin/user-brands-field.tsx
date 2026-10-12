// «Marcas que ve» dentro del formulario de usuario (2026-10-12, spec marcas-visibilidad).
// Un interruptor por marca viva. ADMIN ve todas y no lleva interruptores. Solo un ADMIN los
// cambia (`canEdit`); DIRECTOR y GERENTE los ven de solo lectura. La ruta PUT
// /api/admin/users/[id]/brands vuelve a validar el rol.
"use client";

import { Label } from "@/components/ui/label";
import { toggleBrand, type BrandOption } from "./user-brands-helpers";

interface Props {
  /** Rol elegido en el formulario (no el guardado): si lo cambian a ADMIN, los interruptores se van. */
  role: string;
  /** Marcas vivas, o null si no se pudieron leer (p. ej. falta la migración). */
  brands: BrandOption[] | null;
  selected: string[];
  onChange: (next: string[]) => void;
  canEdit: boolean;
  isEditing: boolean;
  /** false = el usuario no tiene filas: ve solo la predeterminada. */
  hasExplicit: boolean;
  error?: string;
}

export function UserBrandsField({ role, brands, selected, onChange, canEdit, isEditing, hasExplicit, error }: Props) {
  const defaultName = brands?.find((b) => b.isDefault)?.name ?? "la marca predeterminada";

  return (
    <div className="space-y-2">
      <Label>Marcas que ve</Label>
      {role === "ADMIN" ? (
        <p className="text-sm text-muted-foreground">Ve todas las marcas (administrador)</p>
      ) : brands === null ? (
        <p className="text-sm text-muted-foreground">
          No disponible: falta aplicar la migración de marcas por usuario.
        </p>
      ) : !isEditing ? (
        <p className="text-sm text-muted-foreground">
          Al crearse ve solo {defaultName}. Edítalo después para prenderle otras marcas.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {brands.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={selected.includes(b.id)}
                  disabled={!canEdit}
                  onChange={() => onChange(toggleBrand(brands, selected, b.id))}
                />
                {b.name}
                {b.isDefault && <span className="text-xs text-muted-foreground">(predeterminada)</span>}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Siempre ve los contactos que tiene asignados, sean de la marca que sean.
            {!hasExplicit && ` Sin configurar: ve solo ${defaultName}.`}
            {!canEdit && " Solo un administrador puede cambiarlas."}
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}
