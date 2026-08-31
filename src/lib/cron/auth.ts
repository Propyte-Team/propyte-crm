import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Guardia único de los endpoints de cron.
 *
 * ## Por qué el secreto ya NO se acepta por query string
 *
 * Las cuatro rutas de cron aceptaban `?key=<secreto>` además de la cabecera. Un secreto en
 * la URL queda copiado en el log de accesos del servidor, en el del proxy, en el del CDN y
 * en cualquier cosa que guarde direcciones visitadas — y el tick corre CADA MINUTO, así que
 * se reescribe 1.440 veces al día. Mientras esa vía siga abierta, rotar el secreto solo
 * reinicia el reloj: el nuevo se vuelve a escribir en los mismos registros desde el primer
 * minuto.
 *
 * Medido antes de cerrarla (crontab de root del VPS, 2026-08-31): los cuatro crons del CRM
 * —workflows, connectors/tiktok, connectors/linkedin y google/gmail-sync— mandan el secreto
 * en la cabecera `x-cron-secret`. NINGUNO usa `?key=`. Cerrar esa vía no deja fuera a ningún
 * llamador vivo.
 *
 * Aun así, un `?key=` se responde con un 401 que DICE qué pasó, en vez de con el 401 genérico:
 * si algún llamador que no está en ese crontab la usaba, el diagnóstico se lee de una vez en
 * vez de parecer una credencial vencida.
 *
 * ## Por qué comparación en tiempo constante
 *
 * `===` sobre un secreto filtra su longitud y su prefijo por el tiempo que tarda en fallar.
 * Es el mismo criterio que ya aplica `checkBearer` en la pasarela MCP; no había razón para
 * que estos endpoints fueran la excepción.
 */

export type VeredictoCron = "ok" | "sin_configurar" | "por_query_string" | "invalido";

function igualSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function veredictoCron(req: NextRequest): VeredictoCron {
  const secreto = process.env.CRON_SECRET?.trim();
  if (!secreto) return "sin_configurar";

  const cabecera = req.headers.get("x-cron-secret")?.trim();
  if (cabecera && igualSeguro(cabecera, secreto)) return "ok";

  // Se mira SOLO para poder decir «usa la cabecera». No autoriza en ningún caso, y el valor
  // no se compara ni se registra: basta con saber que venía uno.
  if (req.nextUrl.searchParams.get("key")) return "por_query_string";

  return "invalido";
}

/**
 * `null` = pasa. Cualquier otra cosa es la respuesta que el route debe devolver tal cual.
 *
 * Se devuelve la respuesta en vez de un booleano para que los cuatro routes no vuelvan a
 * escribir cada uno su propio 401 — que es exactamente cómo tres de ellos se quedaron con
 * el `?key=` cuando alguien pensó que lo estaba quitando.
 */
export function rechazoCron(req: NextRequest): NextResponse | null {
  const veredicto = veredictoCron(req);
  if (veredicto === "ok") return null;

  if (veredicto === "por_query_string") {
    console.warn(`[cron] secreto por query string rechazado en ${req.nextUrl.pathname}`);
    return NextResponse.json(
      {
        error: "No autorizado",
        detalle:
          "El secreto por query string ya no se acepta: queda escrito en los logs de acceso. " +
          "Mándalo en la cabecera `x-cron-secret`.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
