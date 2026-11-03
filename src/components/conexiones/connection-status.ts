// Estado y errores de una cuenta conectada, en lenguaje de negocio (E1 #962, reporte 06 T1).
// Puro (sin React) para poder probarlo.
//
//   - estadoDeConexion(c) → { texto, tono }: «Funciona» / «Con errores (N)» / «Sin verificar» / «En pausa».
//   - traducirErrorConexion(raw) → { mensaje, detalle }: los 5 errores frecuentes de Meta en español;
//     `detalle` es el texto crudo del proveedor (va bajo «Detalle técnico»).

export type TonoEstado = "ok" | "error" | "neutro" | "pausa";

export interface EstadoConexion {
  texto: string;
  tono: TonoEstado;
}

export function estadoDeConexion(c: {
  status: string;
  errorCount: number;
  lastError: string | null;
  lastLeadAt: string | null;
}): EstadoConexion {
  const errores = Math.max(0, c.errorCount || 0);
  if (c.status === "ERROR" || errores > 0 || (c.lastError ?? "").trim()) {
    return { texto: `Con errores (${errores})`, tono: "error" };
  }
  if (c.status === "PAUSED") return { texto: "En pausa", tono: "pausa" };
  // Activa y sin errores: «Funciona» solo si ya entró algo; si no, no hay evidencia todavía.
  if (c.lastLeadAt) return { texto: "Funciona", tono: "ok" };
  return { texto: "Sin verificar", tono: "neutro" };
}

const ERRORES_META: [RegExp, string][] = [
  [
    /\(#190\)|access token.*(expired|invalid|has been|could not be decrypted)|error validating access token|session (has )?expired|OAuthException.*\b190\b|token.*(expir|caduc)/i,
    "El acceso a la cuenta caducó o ya no es válido. Vuelve a conectar la cuenta o cambia su token.",
  ],
  [
    /\(#200\)|\(#10\)|\(#299\)|\(#3\)|permission|not authorized|insufficient|permiso/i,
    "Faltan permisos en Meta para esta cuenta. Reconecta la cuenta y acepta todos los permisos que pide.",
  ],
  [
    /\(#803\)|nonexisting|does not exist|unsupported get request|page.*not found|object with id|no existe/i,
    "No se encontró la página o cuenta en Meta. Revisa que siga existiendo y que sea la correcta.",
  ],
  [
    /signature|x-hub|firma/i,
    "Meta envió un aviso con firma inválida. Revisa que el App Secret de la cuenta sea el correcto.",
  ],
  [
    /\(#4\)|\(#17\)|\(#32\)|\(#613\)|rate limit|too many calls|request limit|límite/i,
    "Meta está limitando las consultas por exceso de uso. Se reintenta solo; si persiste, espera unos minutos.",
  ],
];

export function traducirErrorConexion(raw: string | null | undefined): { mensaje: string; detalle: string } | null {
  const detalle = (raw ?? "").trim();
  if (!detalle) return null;
  for (const [re, mensaje] of ERRORES_META) {
    if (re.test(detalle)) return { mensaje, detalle };
  }
  return { mensaje: "La cuenta reportó un error.", detalle };
}
