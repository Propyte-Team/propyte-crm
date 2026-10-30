// «Registrar» en el cuadro «Registros de broker» de la ficha de un broker (#939): liga un contacto
// existente a este broker sin tener que ir a editar ese contacto, o da de alta uno nuevo con el
// broker ya puesto. Si el contacto ya tenía otro broker, pregunta antes de cambiarlo.
"use client";

import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactPicker, type PickedContact } from "@/components/agenda/contact-picker";
import { ContactForm } from "@/components/contacts/contact-form";

interface Props {
  broker: { id: string; nombre: string };
  /** Después de registrar o crear: refrescar la ficha. */
  onRegistrado: () => void;
}

type Paso = { tipo: "elegir" } | { tipo: "confirmar"; brokerActual: string | null } | { tipo: "crear" };

export function RegistrarEnBroker({ broker, onRegistrado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<Paso>({ tipo: "elegir" });
  const [elegido, setElegido] = useState<PickedContact | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  const reiniciar = () => {
    setPaso({ tipo: "elegir" });
    setElegido(null);
    setError("");
  };

  const registrar = async (reemplazar = false) => {
    if (!elegido) return;
    setTrabajando(true);
    setError("");
    try {
      const res = await fetch(`/api/contacts/${broker.id}/registros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reemplazar ? { contactId: elegido.id, reemplazar: true } : { contactId: elegido.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPaso({ tipo: "confirmar", brokerActual: typeof json.brokerActual === "string" ? json.brokerActual : null });
        return;
      }
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "No se pudo registrar el contacto");
        return;
      }
      setHecho(json.yaEstaba ? `${elegido.name} ya estaba registrado por este broker.` : `${elegido.name} quedó registrado.`);
      reiniciar();
      onRegistrado();
    } catch {
      setError("Error de red al registrar el contacto");
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          reiniciar();
          setHecho("");
          setAbierto(true);
        }}
      >
        <UserPlus className="mr-1 h-4 w-4" /> Registrar
      </Button>

      <Dialog
        open={abierto}
        onOpenChange={(v) => {
          setAbierto(v);
          if (!v) reiniciar();
        }}
      >
        <DialogContent className={paso.tipo === "crear" ? "max-h-[90vh] overflow-y-auto sm:max-w-3xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>
              {paso.tipo === "crear" ? `Nuevo contacto registrado por ${broker.nombre}` : `Registrar contacto a ${broker.nombre}`}
            </DialogTitle>
          </DialogHeader>

          {paso.tipo === "crear" ? (
            <ContactForm
              mode="create"
              brokerFijo={{ id: broker.id, name: broker.nombre }}
              onSuccess={() => {
                setHecho("Contacto creado y registrado.");
                reiniciar();
                onRegistrado();
              }}
            />
          ) : paso.tipo === "confirmar" ? (
            <div className="space-y-3 text-[13px]">
              <p>
                <span className="font-medium">{elegido?.name}</span> ya está registrado por{" "}
                <span className="font-medium">{paso.brokerActual ?? "otro broker"}</span>. ¿Cambiarlo a{" "}
                <span className="font-medium">{broker.nombre}</span>?
              </p>
              {error && <p className="text-[12px] text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reiniciar} disabled={trabajando}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => void registrar(true)} disabled={trabajando}>
                  {trabajando ? "Cambiando…" : "Sí, cambiar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <ContactPicker
                    value={elegido}
                    onChange={(c) => {
                      setElegido(c);
                      setError("");
                    }}
                    disabled={trabajando}
                    excluirId={broker.id}
                    placeholder="Buscar entre tus contactos"
                  />
                </div>
                <Button size="sm" onClick={() => void registrar()} disabled={!elegido || trabajando}>
                  {trabajando ? "Registrando…" : "Registrar"}
                </Button>
              </div>
              {error && <p className="text-[12px] text-destructive">{error}</p>}
              {hecho && <p className="text-[12px] text-[color:var(--text-tertiary)]">{hecho}</p>}
              <p className="text-xs text-muted-foreground">
                La fuente del contacto pasa a «Registro de Broker». ¿No existe todavía?{" "}
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  style={{ color: "var(--color-teal, #0D9488)" }}
                  onClick={() => setPaso({ tipo: "crear" })}
                >
                  <Plus className="mb-0.5 mr-0.5 inline h-3 w-3" />
                  Agregar contacto
                </button>
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
