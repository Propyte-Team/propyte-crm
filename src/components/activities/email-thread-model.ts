// Cómo se pinta el cuerpo HTML de un correo del hilo — #888.
//
// Antes cada correo iba en un iframe de alto fijo (h-64, 256 px): uno de una línea dejaba ~230 px
// en blanco y uno largo se cortaba. El alto era fijo a propósito (auditoría 2026-09-10, #760): con
// `sandbox=""` el CRM no puede leer el documento de dentro para saber cuánto mide.
//
// Ahora el sandbox es `allow-same-origin` SIN `allow-scripts`: el CRM puede leer el alto del
// documento al cargarse, y dentro sigue sin ejecutarse nada (ni `<script>`, ni `onerror`, ni
// `javascript:`), porque eso lo controla `allow-scripts`, que no se da. Lo peligroso es darle las
// DOS a la vez (el documento podría quitarse su propio sandbox); con una sola no.
//
// Y una tercera capa, encima del saneado del servidor (lib/email/sanitize.ts) y del sandbox: una
// política de contenido dentro del documento que no permite scripts, formularios, marcos ni
// conexiones. Las imágenes y los estilos en línea se siguen viendo como antes.

/** NUNCA agregar `allow-scripts` aquí: junto con `allow-same-origin` anula el sandbox. */
export const SANDBOX_CORREO = "allow-same-origin";

/** Política del documento del correo: nada ejecutable; imágenes, estilos y fuentes sí. */
export const CSP_CORREO =
  "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; " +
  "base-uri 'none'; img-src * data:; style-src 'unsafe-inline'; font-src * data:";

/** Alto mientras se carga (el de antes) y si no se puede medir. */
export const ALTO_INICIAL = 256;
/** Un correo de una línea no queda más chico que esto. */
export const ALTO_MIN = 40;
/** Tope: a partir de aquí el correo se desplaza dentro de su recuadro, como antes. */
export const ALTO_MAX = 400;

const ESTILOS =
  "html,body{margin:0;padding:0;font:12px system-ui,-apple-system,sans-serif;color:#404040;overflow-wrap:break-word}" +
  "img{max-width:100%;height:auto}a{color:inherit;text-decoration:underline}table{max-width:100%}";

/** El `srcDoc` del iframe: la política, el destino de los enlaces, los estilos y el cuerpo. */
export function documentoDelCorreo(bodyHtml: string): string {
  return (
    `<!doctype html><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP_CORREO}">` +
    `<base target="_blank"><style>${ESTILOS}</style>${bodyHtml}`
  );
}

/** Alto del iframe para un contenido que mide `alto` px: entre el mínimo y el tope. */
export function altoDelCorreo(alto: number | null | undefined): number {
  if (typeof alto !== "number" || !Number.isFinite(alto) || alto <= 0) return ALTO_INICIAL;
  return Math.min(ALTO_MAX, Math.max(ALTO_MIN, Math.ceil(alto)));
}

/**
 * Alto del iframe para el documento ya cargado.
 *
 * Se mide `documentElement.offsetHeight` y NO `scrollHeight`: `scrollHeight` nunca es menor que
 * el alto del propio iframe, así que un correo de una línea dentro de un iframe de 256 px reporta
 * 256 y el hueco se quedaba igual (medido en Chromium: una línea → offsetHeight 39, scrollHeight
 * 256). `offsetHeight` del `<html>` es el alto del contenido, con los márgenes de sus párrafos.
 */
export function altoDelDocumento(doc: { documentElement?: { offsetHeight?: number } | null } | null | undefined): number {
  return altoDelCorreo(doc?.documentElement?.offsetHeight);
}
