// Lógica pura del «evento de prueba» de webhooks salientes (sin BD ni red).
import { createHmac } from "crypto";

export interface ResultadoPrueba {
  ok: boolean;
  /** Código HTTP si el destino respondió. */
  status: number | null;
  /** Texto en español listo para mostrar. */
  mensaje: string;
}

/** Cuerpo JSON firmado: mismo formato que un envío real, marcado como prueba. */
export function construirCuerpoPrueba(event: string, ahora: Date = new Date()): string {
  return JSON.stringify({
    event,
    timestamp: ahora.toISOString(),
    test: true,
    data: {
      id: "prueba-0000",
      mensaje: "Evento de prueba enviado desde el CRM de Propyte. Puedes ignorarlo.",
    },
  });
}

export function firmarCuerpo(cuerpo: string, secret: string): string {
  return createHmac("sha256", secret).update(cuerpo).digest("hex");
}

/** Traduce el código HTTP a un mensaje entendible. */
export function describirRespuesta(status: number): ResultadoPrueba {
  if (status >= 200 && status < 300) {
    return { ok: true, status, mensaje: `El destino respondió bien (código ${status}).` };
  }
  if (status === 401 || status === 403) {
    return { ok: false, status, mensaje: `El destino rechazó el envío (código ${status}): revisa la autorización o la clave.` };
  }
  if (status === 404) {
    return { ok: false, status, mensaje: "El destino no encontró esa dirección (código 404): revisa la URL." };
  }
  if (status >= 500) {
    return { ok: false, status, mensaje: `El servicio de destino tuvo un error (código ${status}). Intenta de nuevo más tarde.` };
  }
  return { ok: false, status, mensaje: `El destino respondió con el código ${status}.` };
}

/** Traduce un error de red/timeout a un mensaje entendible. */
export function describirFalloRed(err: unknown): ResultadoPrueba {
  const nombre = err instanceof Error ? err.name : "";
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return { ok: false, status: null, mensaje: "El destino no respondió en 10 segundos." };
  }
  return { ok: false, status: null, mensaje: "No se pudo conectar con la URL. Revisa que esté bien escrita y accesible." };
}
