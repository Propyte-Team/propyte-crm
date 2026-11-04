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

// ---------------------------------------------------------------------------------------------
// Actividad: UNA sola historia para «Funciona» y el contador (E6).
//
// Antes la fila mostraba dos datos distintos como si fueran el mismo:
//   - «Funciona» salía de `lastLeadAt`, que escribe `markConnectorLead` cuando ENTRA un prospecto
//     por cualquier vía (formulario de anuncio y también mensajes directos de IG/Messenger).
//   - «N prospectos» salía de `_count.leadLogs`, que solo cuenta las filas de
//     `connector_lead_logs`, y esas solo las crean los formularios (Lead Ads, TikTok, LinkedIn...).
//     Una cuenta de mensajes directos tiene `lastLeadAt` y 0 filas → «Funciona · 0 prospectos».
// Ahora el conteo solo se muestra donde es confiable (`CANALES_SIN_REGISTRO` no lo tiene) y se
// acota a los últimos 30 días, que es lo que sirve para saber si la cuenta sigue viva.
// ---------------------------------------------------------------------------------------------

/** Canales cuyos prospectos NO dejan fila en `connector_lead_logs`: no hay conteo confiable. */
export const CANALES_SIN_REGISTRO = new Set(["INSTAGRAM", "MESSENGER", "WHATSAPP"]);

/** «hace 3 días», «hace 2 h»… Puro: recibe `ahora` para poder probarlo. */
export function haceCuanto(fecha: string | Date | null | undefined, ahora: Date = new Date()): string | null {
  if (!fecha) return null;
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor((ahora.getTime() - t) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "hace 1 día" : `hace ${d} días`;
  const m = Math.floor(d / 30);
  if (m < 12) return m === 1 ? "hace 1 mes" : `hace ${m} meses`;
  const a = Math.floor(d / 365);
  return a <= 1 ? "hace 1 año" : `hace ${a} años`;
}

/**
 * «Funciona · último prospecto hace 3 días · 12 en 30 días».
 * `leads30d` null/undefined = no hay conteo confiable (se omite en vez de mostrar un 0 falso).
 */
export function resumenDeActividad(
  c: {
    status: string;
    provider: string;
    errorCount: number;
    lastError: string | null;
    lastLeadAt: string | null;
    leads30d?: number | null;
  },
  ahora: Date = new Date(),
): string {
  const estado = estadoDeConexion(c);
  const partes: string[] = [estado.texto];
  const hace = haceCuanto(c.lastLeadAt, ahora);
  partes.push(hace ? `último prospecto ${hace}` : "aún no recibe prospectos");
  const conConteo = !CANALES_SIN_REGISTRO.has(c.provider) && typeof c.leads30d === "number";
  if (conConteo && (c.leads30d as number) > 0) partes.push(`${c.leads30d} en 30 días`);
  else if (conConteo && hace) partes.push("ninguno en 30 días");
  return partes.join(" · ");
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
