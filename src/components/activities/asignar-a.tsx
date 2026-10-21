// Selector «Asignar a» de las tareas (#915). Solo aparece si quien está en sesión puede asignar a
// alguien más que a sí mismo (ADMIN y DIRECTOR a cualquier asesor, GERENTE a los de su plaza,
// TEAM_LEADER a los de su equipo). Para el resto no se pinta nada y la tarea queda a su nombre,
// como siempre. La lista viene del servidor, que vuelve a validar al guardar.
"use client"

import React from "react"

interface Asignable {
  id: string
  name: string
}

/** Los asignables, o `null` mientras cargan o si no puede asignar a nadie más. */
export function useAsignables(): Asignable[] | null {
  const [lista, setLista] = React.useState<Asignable[] | null>(null)
  React.useEffect(() => {
    let vivo = true
    fetch("/api/activities/asignables")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.puedeAsignar && Array.isArray(d.data)) setLista(d.data)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [])
  return lista
}

interface Props {
  /** El id elegido. `""` se muestra como «A mí» (quien está en sesión), el valor por defecto. */
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  /** Etiqueta visible encima del selector. Sin ella, solo `aria-label`. */
  label?: string
}

export function AsignarA({ value, onChange, disabled, className, style, label }: Props) {
  const asignables = useAsignables()
  if (!asignables) return null
  const [yo, ...otros] = asignables

  const select = (
    <select
      aria-label="Asignar a"
      className={className}
      style={style}
      value={value || yo.id}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value={yo.id}>{`A mí (${yo.name})`}</option>
      {otros.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  )

  if (!label) return select
  return (
    <div className="space-y-1">
      <label className="text-[12px] text-[color:var(--text-secondary)]">{label}</label>
      {select}
    </div>
  )
}
