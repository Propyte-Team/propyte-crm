// Botón «Correo» del encabezado de la ficha de contacto (#885), entre Llamar y Crear Deal.
//
// Nunca se esconde ni se deshabilita en silencio: si no se puede escribir, al hacer clic
// dice por qué (sin email, No contactar, sin cuenta conectada). Qué hacer en cada caso lo
// decide `decidirCorreo` (lib/email/boton-correo.ts); aquí solo se pinta y se pide el estado.
"use client"

import { useState } from "react"
import { Mail } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { EmailComposerDrawer } from "@/components/activities/email-composer-drawer"
import { decidirCorreo, type DecisionCorreo, type EstadoCorreoCliente } from "@/lib/email/boton-correo"

interface BotonCorreoProps {
  contactId: string
  contactName: string
  contactEmail?: string | null
  contactFirstName?: string
  contactLastName?: string
  doNotContact?: boolean
  /** Se llama tras un envío exitoso (para refrescar el historial). */
  onSent?: () => void
}

export function BotonCorreo({
  contactId,
  contactName,
  contactEmail,
  contactFirstName,
  contactLastName,
  doNotContact,
  onSent,
}: BotonCorreoProps) {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(false)
  const [consultando, setConsultando] = useState(false)

  function avisar(d: Extract<DecisionCorreo, { tipo: "aviso" }>) {
    toast({
      title: d.titulo,
      description:
        d.descripcion || d.enlace ? (
          <span>
            {d.descripcion}
            {d.enlace && (
              <>
                {d.descripcion ? " " : null}
                <a href={d.enlace.href} className="font-medium underline">
                  {d.enlace.texto}
                </a>
              </>
            )}
          </span>
        ) : undefined,
    })
  }

  async function onClick() {
    let decision = decidirCorreo({ email: contactEmail, doNotContact })
    if (decision.tipo === "consultar") {
      // El estado se pide al hacer clic, no al cargar la ficha: así refleja una conexión
      // recién hecha en otra pestaña y no cuesta nada a quien no usa el botón.
      setConsultando(true)
      let estado: EstadoCorreoCliente | null = null
      try {
        const r = await fetch("/api/email/estado")
        if (r.ok) estado = ((await r.json()) as { data?: EstadoCorreoCliente }).data ?? null
      } catch {
        estado = null
      } finally {
        setConsultando(false)
      }
      if (!estado) {
        toast({ title: "No se pudo comprobar tu cuenta de correo", description: "Intenta de nuevo en un momento." })
        return
      }
      decision = decidirCorreo({ email: contactEmail, doNotContact, estado })
    }
    if (decision.tipo === "aviso") return avisar(decision)
    if (decision.tipo === "abrir") setAbierto(true)
  }

  const sinCorreo = !contactEmail || !contactEmail.trim()

  return (
    <>
      <button
        type="button"
        className="btn-secondary text-[13px]"
        onClick={onClick}
        disabled={consultando}
        aria-busy={consultando}
        title={sinCorreo ? "El correo no está registrado" : `Escribir a ${contactEmail}`}
      >
        <Mail className="h-4 w-4" /> Correo
      </button>
      {abierto && contactEmail && (
        <EmailComposerDrawer
          contactId={contactId}
          contactName={contactName}
          contactEmail={contactEmail}
          contactFirstName={contactFirstName}
          contactLastName={contactLastName}
          onClose={() => setAbierto(false)}
          onSent={() => {
            toast({ title: "Correo enviado", description: "Quedó registrado en el historial del contacto." })
            onSent?.()
          }}
        />
      )}
    </>
  )
}
