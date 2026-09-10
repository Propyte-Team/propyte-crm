// ============================================================
// Saneado del HTML de correo ENTRANTE antes de pintarlo en el CRM
// ============================================================
//
// Auditoría 2026-09-10. `components/activities/email-thread.tsx` pintaba el cuerpo de los
// correos con `dangerouslySetInnerHTML` sobre el HTML tal como venía de Gmail, y en todo
// el repositorio no había un solo saneador. La cadena completa era:
//
//   lib/google/gmail.ts   extractBody() decodifica el text/html del mensaje
//        ↓                getThreadMessages() lo devuelve como `bodyHtml`
//   api/google/gmail/threads/[threadId]  lo sirve al navegador
//        ↓
//   email-thread.tsx      dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
//
// El ataque no necesita ninguna credencial del CRM: basta MANDARLE UN CORREO a un asesor.
// React no ejecuta un `<script>` inyectado por innerHTML, pero sí corre `<img src=x
// onerror=…>`, `<svg onload=…>`, un `<iframe src=javascript:…>` y cualquier otro
// manejador en atributo. Ese código corre en el origen del CRM, con la sesión del asesor:
// desde ahí se llama a cualquier API del CRM como él.
//
// Dos capas, y las dos importan:
//
//  1. ESTA. Se sanea en el SERVIDOR, en `getThreadMessages`, así que el HTML peligroso no
//     llega nunca al navegador. Es la que de verdad cierra el agujero.
//  2. El `<iframe sandbox>` de email-thread.tsx. Aunque un día alguien pinte HTML sin
//     pasar por aquí, el sandbox impide que se ejecute.
//
// Por qué NO se sanea también `emailSignatureHtml` (el otro
// `dangerouslySetInnerHTML` del repo, en settings-view.tsx): esa firma la escribe el
// propio usuario, se le muestra a sí mismo, y `lib/workflows/actions.ts` la concatena
// CRUDA en los correos que salen. Es su propio HTML, con otro modelo de amenaza, y
// sanearlo en la vista rompería firmas legítimas sin cerrar nada.

import sanitizeHtml from "sanitize-html";

/**
 * Etiquetas que un correo legítimo usa para maquetar. Lo que no esté aquí se descarta.
 *
 * Fuera a propósito: `script`, `iframe`, `object`, `embed`, `link`, `meta`, `base`,
 * `form`, `input`, `button`, `style`. Las tres últimas porque un formulario dentro del
 * hilo puede imitar la interfaz del CRM y pedir credenciales, y un `<style>` global puede
 * repintar la página entera desde el cuerpo de un correo.
 */
const ETIQUETAS_PERMITIDAS = [
  "p", "div", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "strike", "sub", "sup", "small",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code",
  "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
];

/**
 * Propiedades CSS admitidas en un atributo `style`.
 *
 * Se permite un subconjunto y no `style` entero porque `position`, `z-index` y compañía
 * permiten tapar la interfaz del CRM con contenido del correo (clickjacking dentro del
 * propio hilo). Los valores van con patrón: `sanitize-html` descarta la propiedad si no
 * encaja, así que un `url(javascript:…)` no pasa.
 */
const CSS_PERMITIDO: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
    "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
    "text-align": [/^(left|right|center|justify)$/],
    "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
    "font-style": [/^(normal|italic|oblique)$/],
    "font-size": [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/],
    "font-family": [/^[\w\s,'"-]{1,120}$/],
    "text-decoration": [/^(none|underline|line-through|overline)$/],
    "padding": [/^[\d\s.]{1,20}(px|pt|em|rem|%)?$/],
    "margin": [/^[\d\s.]{1,20}(px|pt|em|rem|%)?$/],
    "border": [/^[\w\s#().,%-]{1,60}$/],
    "border-color": [/^#[0-9a-f]{3,8}$/i, /^[a-z]{3,20}$/i],
    "width": [/^\d{1,4}(\.\d+)?(px|pt|em|rem|%)$/],
    "max-width": [/^\d{1,4}(\.\d+)?(px|pt|em|rem|%)$/],
    "height": [/^\d{1,4}(\.\d+)?(px|pt|em|rem|%)$/],
    "line-height": [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)?$/],
  },
};

const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: ETIQUETAS_PERMITIDAS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan", "align", "valign"],
    th: ["colspan", "rowspan", "align", "valign"],
    table: ["border", "cellpadding", "cellspacing", "align"],
    col: ["span", "width"],
    colgroup: ["span"],
    "*": ["style"],
  },
  allowedStyles: CSS_PERMITIDO,
  // Esquemas de URL. Sin `javascript:`, obviamente, pero tampoco `data:` en `href`:
  // un `data:text/html` en un enlace abre una página con contenido del atacante.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // En `img` sí se admite `data:` y `cid:`: son las imágenes incrustadas del propio
  // correo, y una imagen no ejecuta nada.
  allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
  allowProtocolRelative: false,
  // Un atributo o etiqueta que no esté en las listas se ELIMINA con su contenido cuando
  // es de los peligrosos, en vez de dejar el texto suelto del script a la vista.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    // Los enlaces del correo salen del CRM: nueva pestaña y sin pasarle el `window.opener`
    // (con `noopener` la página destino no puede reescribir la del CRM).
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
  },
};

/**
 * El HTML de un correo entrante, listo para pintar.
 *
 * Devuelve `""` para una entrada vacía o que no es una cadena, para que quien llama pueda
 * caer al `bodyText` con un simple falsy — que es lo que ya hacía `email-thread.tsx`.
 */
export function sanitizeEmailHtml(html: unknown): string {
  if (typeof html !== "string" || html.trim() === "") return "";
  try {
    return sanitizeHtml(html, OPCIONES);
  } catch (err) {
    // Un fallo del saneador NO puede terminar en «pintamos el original»: eso es
    // exactamente el agujero que esto cierra. Sin HTML, la vista usa el texto plano.
    console.error("[email/sanitize] falló el saneado; se descarta el HTML:", err);
    return "";
  }
}
