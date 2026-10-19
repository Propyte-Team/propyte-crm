// «Referido por: <broker>» en el encabezado de la ficha (#909, seguimiento de la #907).
// Va debajo del nombre y arriba de los chips (estado, temperatura, tipo…), y SOLO aparece si
// el contacto tiene broker: así se sabe que es referido sin ir a buscarlo a la ficha del broker.
import Link from "next/link";

/** Lo que getContact resuelve para la liga (#907): nunca trae datos crudos del broker. */
export interface LigaBroker {
  id: string;
  nombre: string;
  /** false si quien mira no puede abrir la ficha del broker (otro asesor, otra marca) o si se borró. */
  puedeAbrir: boolean;
}

export function ReferidoPorEncabezado({ referredBy }: { referredBy?: LigaBroker | null }) {
  if (!referredBy) return null;
  return (
    <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
      Referido por:{" "}
      {referredBy.puedeAbrir ? (
        <Link
          href={`/contacts/${referredBy.id}`}
          className="font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--color-teal, #0D9488)" }}
        >
          {referredBy.nombre}
        </Link>
      ) : (
        <span
          className="font-medium text-[color:var(--text-primary)]"
          title="No tienes acceso a la ficha de este broker"
        >
          {referredBy.nombre}
        </span>
      )}
    </p>
  );
}
