// «Registrado por» en el cuadro «Asignación» de la ficha (#939). Antes era solo lectura y había
// que ir a «Editar todo»; ahora se elige ahí mismo con el catálogo de brokers (#935: todos los
// brokers de las marcas que el usuario ve, de 30 en 30) y se guarda al elegir. Elegir un broker
// pone la fuente en «Registro de Broker» (lo hace el servidor, #929). El acceso es el del campo:
// HIDDEN no se pinta, READ se ve sin editar.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ContactPicker, type PickedContact } from "@/components/agenda/contact-picker";

type FieldAccess = "HIDDEN" | "READ" | "EDIT";

export interface BrokerLigado {
  id: string;
  nombre: string;
  /** Si quien mira puede abrir la ficha del broker (#907). */
  puedeAbrir: boolean;
}

interface Props {
  contactId: string;
  broker: BrokerLigado | null | undefined;
  access: FieldAccess;
  /** Guarda `referredById` (null = quitar). true si se guardó. */
  onSave: (referredById: string | null) => Promise<boolean>;
}

export function BrokerDelContacto({ contactId, broker, access, onSave }: Props) {
  const inicial: PickedContact | null = broker ? { id: broker.id, name: broker.nombre } : null;
  const [actual, setActual] = useState<PickedContact | null>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Al refrescar la ficha llega el valor guardado.
  useEffect(() => setActual(broker ? { id: broker.id, name: broker.nombre } : null), [broker?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (access === "HIDDEN") return null;

  const cambiar = async (nuevo: PickedContact | null) => {
    const antes = actual;
    setActual(nuevo);
    setError("");
    setGuardando(true);
    const ok = await onSave(nuevo?.id ?? null);
    setGuardando(false);
    if (!ok) {
      setActual(antes);
      setError("No se pudo guardar el broker");
    }
  };

  // El enlace a la ficha solo si es el broker que vino del servidor y quien mira puede abrirla.
  const enlace = broker && actual?.id === broker.id && broker.puedeAbrir ? `/contacts/${broker.id}` : null;

  return (
    <div className="py-1.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-[color:var(--text-tertiary)]">Registrado por</span>
        {access === "READ" ? (
          actual ? (
            enlace ? (
              <Link
                href={enlace}
                className="text-right font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--color-teal, #0D9488)" }}
              >
                {actual.name}
              </Link>
            ) : (
              <span className="text-right font-medium text-[color:var(--text-primary)]" title="No tienes acceso a la ficha de este broker">
                {actual.name}
              </span>
            )
          ) : (
            <span className="text-right text-[color:var(--text-tertiary)]">—</span>
          )
        ) : (
          <div className="flex min-w-0 max-w-[65%] flex-1 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ContactPicker
                value={actual}
                onChange={cambiar}
                disabled={guardando}
                catalogo="brokers"
                excluirId={contactId}
                placeholder="Sin broker · buscar"
              />
            </div>
            {enlace && (
              <Link
                href={enlace}
                title="Ver la ficha del broker"
                aria-label="Ver la ficha del broker"
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
