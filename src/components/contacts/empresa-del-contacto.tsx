// «Empresa» en la ficha del contacto (#949). Se elige de las empresas del módulo «Empresas»; si no
// está, ADMIN/DIRECTOR/GERENTE la crean ahí mismo (el selector decide si ofrecerlo). El acceso por
// rol es el de cualquier campo de la ficha: HIDDEN no se pinta, READ se ve sin editar.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { EmpresaSelect } from "@/components/developer-partners/empresa-select";
import { hrefEmpresa, type EmpresaOpcion } from "@/lib/developer-partners/shared";

type FieldAccess = "HIDDEN" | "READ" | "EDIT";

interface Props {
  empresa: EmpresaOpcion | null | undefined;
  access: FieldAccess;
  /** Guarda `developerPartnerId` (null = quitar). true si se guardó. */
  onSave: (developerPartnerId: string | null) => Promise<boolean>;
}

export function EmpresaDelContacto({ empresa, access, onSave }: Props) {
  const [actual, setActual] = useState<EmpresaOpcion | null>(empresa ?? null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Al refrescar la ficha llega el valor guardado.
  useEffect(() => setActual(empresa ?? null), [empresa?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (access === "HIDDEN") return null;

  const cambiar = async (nueva: EmpresaOpcion | null) => {
    const antes = actual;
    setActual(nueva);
    setError("");
    setGuardando(true);
    const ok = await onSave(nueva?.id ?? null);
    setGuardando(false);
    if (!ok) {
      setActual(antes);
      setError("No se pudo guardar la empresa");
    }
  };

  return (
    <div className="py-1.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-[color:var(--text-tertiary)]">Empresa</span>
        {access === "READ" ? (
          actual ? (
            <Link
              href={hrefEmpresa(actual.id)}
              className="text-right font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--color-teal, #0D9488)" }}
            >
              {actual.name}
            </Link>
          ) : (
            <span className="text-right text-[color:var(--text-tertiary)]">—</span>
          )
        ) : (
          <div className="flex min-w-0 max-w-[65%] flex-1 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <EmpresaSelect value={actual} onChange={cambiar} disabled={guardando} placeholder="Sin empresa · buscar" />
            </div>
            {actual && (
              <Link
                href={hrefEmpresa(actual.id)}
                title="Ver la empresa y sus contactos"
                aria-label="Ver la empresa y sus contactos"
                className="shrink-0 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-right text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
