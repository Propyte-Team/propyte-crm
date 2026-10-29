// Cuadro de una empresa (#949): sus contactos, agregar uno que ya existe, o crear uno nuevo que
// nace ligado a la empresa.
//
// Lo que se ve lo decide /api/desarrolladores/[id]/contactos: todos ven a todos los contactos de la
// empresa; teléfono, email y la liga a la ficha solo de los que quien mira puede abrir.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, UserMinus, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { ContactPicker, type PickedContact } from "@/components/agenda/contact-picker";
import { ContactForm } from "@/components/contacts/contact-form";
import { CONTACT_TYPE_LABELS, CONTACT_TYPE_VACIO_LABEL } from "@/lib/constants";
import {
  etiquetaTipoEmpresa,
  type ContactoDeEmpresa,
  type EmpresaOpcion,
} from "@/lib/developer-partners/shared";

interface Props {
  empresa: EmpresaOpcion | null;
  onOpenChange: (open: boolean) => void;
}

type Estado =
  | { kind: "cargando" }
  | { kind: "error"; mensaje: string }
  | { kind: "listo"; contactos: ContactoDeEmpresa[]; noListados: number; puedeAsignar: boolean };

export function EmpresaContactosDialog({ empresa, onOpenChange }: Props) {
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado>({ kind: "cargando" });
  const [elegido, setElegido] = useState<PickedContact | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    if (!empresa) return;
    setEstado({ kind: "cargando" });
    try {
      const res = await fetch(`/api/desarrolladores/${empresa.id}/contactos`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado({ kind: "error", mensaje: json.error ?? "No se pudieron cargar los contactos" });
        return;
      }
      setEstado({
        kind: "listo",
        contactos: json.data ?? [],
        noListados: json.noListados ?? 0,
        puedeAsignar: Boolean(json.puedeAsignar),
      });
    } catch {
      setEstado({ kind: "error", mensaje: "Error de red al cargar los contactos" });
    }
  }, [empresa]);

  useEffect(() => {
    setElegido(null);
    setCreando(false);
    void cargar();
  }, [cargar]);

  const agregar = async () => {
    if (!empresa || !elegido) return;
    setTrabajando(true);
    try {
      const res = await fetch(`/api/desarrolladores/${empresa.id}/contactos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: elegido.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: json.error ?? "No se pudo agregar el contacto", variant: "destructive" });
        return;
      }
      toast({ title: `${elegido.name} se agregó a ${empresa.name}` });
      setElegido(null);
      await cargar();
    } finally {
      setTrabajando(false);
    }
  };

  const quitar = async (c: ContactoDeEmpresa) => {
    if (!empresa) return;
    setTrabajando(true);
    try {
      const res = await fetch(
        `/api/desarrolladores/${empresa.id}/contactos?contactId=${encodeURIComponent(c.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: json.error ?? "No se pudo quitar el contacto", variant: "destructive" });
      } else {
        toast({ title: `${c.nombre} ya no está en ${empresa.name}` });
      }
      await cargar();
    } finally {
      setTrabajando(false);
    }
  };

  const listo = estado.kind === "listo" ? estado : null;

  return (
    <>
      <Dialog open={!!empresa && !creando} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{empresa?.name}</DialogTitle>
            <DialogDescription>
              {etiquetaTipoEmpresa(empresa?.type)}
              {listo && ` · ${listo.contactos.length + listo.noListados} ${listo.contactos.length + listo.noListados === 1 ? "contacto" : "contactos"}`}
            </DialogDescription>
          </DialogHeader>

          {estado.kind === "cargando" && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {estado.kind === "error" && <p className="py-6 text-center text-sm text-destructive">{estado.mensaje}</p>}

          {listo && (
            <div className="space-y-5">
              {listo.contactos.length === 0 && listo.noListados === 0 ? (
                <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
                  Esta empresa todavía no tiene contactos.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border-subtle)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
                        <th className="px-3 py-2 font-medium">Contacto</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 font-medium">Teléfono / email</th>
                        <th className="px-3 py-2 font-medium">Asesor</th>
                        {listo.puedeAsignar && <th className="w-10 px-3 py-2" aria-label="Acciones" />}
                      </tr>
                    </thead>
                    <tbody>
                      {listo.contactos.map((c) => (
                        <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border-subtle)" }}>
                          <td className="px-3 py-2 font-medium">
                            {c.puedeAbrir ? (
                              <Link href={`/contacts/${c.id}`} className="hover:underline" style={{ color: "var(--color-teal, #0D9488)" }}>
                                {c.nombre}
                              </Link>
                            ) : (
                              <span title="No tienes acceso a la ficha de este contacto">{c.nombre}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {c.contactType ? CONTACT_TYPE_LABELS[c.contactType] ?? c.contactType : CONTACT_TYPE_VACIO_LABEL}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {c.puedeAbrir ? [c.phone, c.email].filter(Boolean).join(" · ") || "-" : "-"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{c.asesor ?? "Sin asignar"}</td>
                          {listo.puedeAsignar && (
                            <td className="px-3 py-2 text-right">
                              {c.puedeAbrir && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  title="Quitar de la empresa"
                                  aria-label={`Quitar a ${c.nombre} de la empresa`}
                                  disabled={trabajando}
                                  onClick={() => quitar(c)}
                                >
                                  <UserMinus className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {listo.noListados > 0 && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
                      y {listo.noListados} {listo.noListados === 1 ? "contacto más" : "contactos más"} de marcas que no ves.
                    </p>
                  )}
                </div>
              )}

              {listo.puedeAsignar && (
                <div className="space-y-2">
                  <p className="text-[13px] font-medium">Agregar contacto</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <ContactPicker
                        value={elegido}
                        onChange={setElegido}
                        disabled={trabajando}
                        placeholder="Buscar entre tus contactos"
                      />
                    </div>
                    <Button size="sm" onClick={agregar} disabled={!elegido || trabajando}>
                      <UserPlus className="mr-1 h-4 w-4" /> Agregar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Si el contacto ya tenía otra empresa, pasa a esta. ¿No existe todavía?{" "}
                    <button
                      type="button"
                      className="font-medium underline-offset-2 hover:underline"
                      style={{ color: "var(--color-teal, #0D9488)" }}
                      onClick={() => setCreando(true)}
                    >
                      <Plus className="mb-0.5 mr-0.5 inline h-3 w-3" />
                      Crear contacto
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Alta de contacto: el mismo formulario de Contactos, con la empresa ya puesta. */}
      <Dialog open={!!empresa && creando} onOpenChange={(v) => !v && setCreando(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nuevo contacto en {empresa?.name}</DialogTitle>
          </DialogHeader>
          {empresa && (
            <ContactForm
              mode="create"
              empresaFija={empresa}
              onSuccess={() => {
                toast({ title: `Contacto creado en ${empresa.name}` });
                setCreando(false);
                void cargar();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
