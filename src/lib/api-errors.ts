// ============================================================
// Errores de API legibles para la UI (E1 #962)
//
// Por qué: las rutas devuelven `{ error: "texto" }` o `{ error: zod.flatten() }`
// (`{ formErrors, fieldErrors }`) y la UI mostraba "Error" o "[object Object]".
//
// API pública (estable):
//   - NOMBRES_DE_CAMPO: Record<string,string>  nombre técnico → etiqueta en español
//   - mensajeDeError(data: unknown, fallback = "No se pudo guardar"): string
//       string → tal cual; flatten → "Campo: mensaje · Campo: mensaje"; otro → fallback
//   - erroresPorCampo(data: unknown): Record<string, string>
//       primer mensaje (traducido) por campo, para pintar bajo cada input
//   - leerError(res: Response, fallback?): Promise<string>
//       res.json() tolerante a cuerpo vacío/no JSON + mensajeDeError
// ============================================================

export const NOMBRES_DE_CAMPO: Record<string, string> = {
  name: "Nombre",
  firstName: "Nombre",
  lastName: "Apellido",
  email: "Correo",
  phone: "Teléfono",
  plaza: "Plaza",
  priority: "Prioridad",
  leaderId: "Líder",
  userId: "Usuario",
  conditions: "Condiciones",
  targets: "Destino",
  strategy: "Estrategia",
  zones: "Zonas",
  password: "Contraseña",
  role: "Rol",
  apiName: "Nombre técnico",
  label: "Etiqueta",
  type: "Tipo",
  description: "Descripción",
  title: "Título",
  status: "Estado",
  source: "Fuente",
  active: "Activo",
  isActive: "Activo",
  teamId: "Equipo",
  territoryId: "Territorio",
  autonomyLevel: "Autonomía",
  language: "Idioma",
  currency: "Moneda",
}

// Mensajes típicos de zod 4 (en inglés) → español. Se prueban en orden.
const TRADUCCIONES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Too small: expected string to have >=?\s*(\d+) characters?/i, (m) => `Debe tener al menos ${m[1]} caracteres`],
  [/^Too big: expected string to have <=?\s*(\d+) characters?/i, (m) => `Debe tener máximo ${m[1]} caracteres`],
  [/^Too small: expected number to be >=?\s*(-?[\d.]+)/i, (m) => `Debe ser mayor o igual a ${m[1]}`],
  [/^Too big: expected number to be <=?\s*(-?[\d.]+)/i, (m) => `Debe ser menor o igual a ${m[1]}`],
  [/^Too small: expected array to have >=?\s*(\d+) items?/i, (m) => `Agrega al menos ${m[1]} elemento(s)`],
  [/^Too big: expected array to have <=?\s*(\d+) items?/i, (m) => `Máximo ${m[1]} elemento(s)`],
  [/^Invalid UUID/i, () => "Identificador no válido"],
  [/^Invalid email/i, () => "Correo no válido"],
  [/^Invalid URL/i, () => "Enlace no válido"],
  [/^Invalid option/i, () => "Opción no válida"],
  [/^Invalid input: expected \w+, received undefined/i, () => "Campo obligatorio"],
  [/^Invalid input: expected number, received (string|NaN)/i, () => "Debe ser un número"],
  [/^Invalid input: expected string, received (number|boolean|object|null)/i, () => "Debe ser texto"],
  [/^Invalid input: expected boolean/i, () => "Debe ser Sí o No"],
  [/^Invalid input: expected array/i, () => "Debe ser una lista"],
  [/^Invalid input: expected .*received null/i, () => "Campo obligatorio"],
  [/expected \w+, received undefined/i, () => "Campo obligatorio"],
  [/^Required$/i, () => "Campo obligatorio"],
  [/^Invalid string: must match pattern/i, () => "Formato no válido"],
  [/^Invalid input$/i, () => "Valor no válido"],
]

function traducirMensaje(msg: string): string {
  for (const [re, fn] of TRADUCCIONES) {
    const m = msg.match(re)
    if (m) return fn(m)
  }
  return msg
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function aListaDeStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []
}

function nombreDeCampo(campo: string): string {
  return NOMBRES_DE_CAMPO[campo] ?? campo
}

export function erroresPorCampo(data: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!esObjeto(data) || !esObjeto(data.error)) return out
  const fe = data.error.fieldErrors
  if (!esObjeto(fe)) return out
  for (const [campo, msgs] of Object.entries(fe)) {
    const primero = aListaDeStrings(msgs)[0]
    if (primero) out[campo] = traducirMensaje(primero)
  }
  return out
}

export function mensajeDeError(data: unknown, fallback = "No se pudo guardar"): string {
  if (typeof data === "string") return data.trim() || fallback
  if (!esObjeto(data)) return fallback
  const err = data.error
  if (typeof err === "string") return err.trim() ? traducirMensaje(err) : fallback
  if (esObjeto(err)) {
    const partes = Object.entries(erroresPorCampo(data)).map(([c, m]) => `${nombreDeCampo(c)}: ${m}`)
    // Errores a nivel de formulario (sin campo) van al final, traducidos
    for (const f of aListaDeStrings(err.formErrors)) partes.push(traducirMensaje(f))
    if (partes.length) return partes.join(" · ")
  }
  if (typeof data.message === "string" && data.message.trim()) return data.message
  return fallback
}

export async function leerError(res: Response, fallback?: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return mensajeDeError(data, fallback)
}
