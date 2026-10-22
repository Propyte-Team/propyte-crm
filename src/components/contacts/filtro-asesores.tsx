// Filtro «Asesores» de la lista de Contactos (#919): un menú con buscador. Las opciones son los
// dueños de los contactos que quien mira puede ver (GET /api/contacts/asesores), más «Sin
// asignar». El valor viaja a la lista como `?assignedTo=<id>` o `?assignedTo=sin_asignar`.
"use client"

import * as React from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SIN_ASIGNAR,
  filtrarAsesores,
  mostrarFiltroAsesores,
  type OpcionAsesor,
} from "@/lib/contacts/filtro-asesores"

interface Props {
  /** `""` = todos los asesores. */
  value: string
  onChange: (value: string) => void
}

export function FiltroAsesores({ value, onChange }: Props) {
  const [asesores, setAsesores] = React.useState<OpcionAsesor[] | null>(null)
  const [sinAsignar, setSinAsignar] = React.useState(0)
  const [texto, setTexto] = React.useState("")

  React.useEffect(() => {
    let vivo = true
    fetch("/api/contacts/asesores")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d) return
        setAsesores(Array.isArray(d.data) ? d.data : [])
        setSinAsignar(typeof d.sinAsignar === "number" ? d.sinAsignar : 0)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  // Un filtro elegido desde una vista guardada se muestra aunque la lista aún no llegue.
  if (!asesores || (!value && !mostrarFiltroAsesores(asesores, sinAsignar))) return null

  const visibles = filtrarAsesores(asesores, texto)
  const etiqueta =
    value === SIN_ASIGNAR
      ? "Sin asignar"
      : value
        ? (asesores.find((a) => a.id === value)?.name ?? "Asesor")
        : "Asesores"

  const elegir = (v: string) => {
    setTexto("")
    onChange(v)
  }

  return (
    <DropdownMenu onOpenChange={(abierto) => { if (!abierto) setTexto("") }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filtrar por asesor"
          className="flex h-10 w-48 shrink-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <span className="truncate">{etiqueta}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            // El menú de Radix busca por la primera letra con cada tecla y se lleva el foco:
            // aquí se escribe un nombre, así que las teclas se quedan en el input.
            onKeyDown={(e) => {
              if (e.key !== "Escape" && e.key !== "ArrowDown") e.stopPropagation()
            }}
            placeholder="Buscar asesor…"
            aria-label="Buscar asesor"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {!texto && (
            <>
              <Opcion activa={!value} onSelect={() => elegir("")} texto="Todos los asesores" />
              {sinAsignar > 0 && (
                <Opcion
                  activa={value === SIN_ASIGNAR}
                  onSelect={() => elegir(SIN_ASIGNAR)}
                  texto="Sin asignar"
                  total={sinAsignar}
                />
              )}
              <DropdownMenuSeparator />
            </>
          )}
          {visibles.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">Ningún asesor con ese nombre</p>
          ) : (
            visibles.map((a) => (
              <Opcion
                key={a.id}
                activa={value === a.id}
                onSelect={() => elegir(a.id)}
                texto={a.isActive === false ? `${a.name} (inactivo)` : a.name}
                total={a.total}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Opcion({
  activa,
  onSelect,
  texto,
  total,
}: {
  activa: boolean
  onSelect: () => void
  texto: string
  total?: number
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="flex items-center gap-2 text-sm">
      <Check className={`h-4 w-4 shrink-0 ${activa ? "opacity-100" : "opacity-0"}`} />
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      {typeof total === "number" && <span className="num text-[11px] text-muted-foreground">{total}</span>}
    </DropdownMenuItem>
  )
}
