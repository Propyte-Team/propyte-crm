// #917 — Reglas de los archivos de la ficha (CV). Puras: las usan la API y la sección de la ficha.
// Decisiones de sistemas@ (2026-10-21):
//   · La sección aparece en todos los contactos; subir es opcional.
//   · PDF, DOC y DOCX hasta 10 MB; varios por contacto, el más nuevo primero.
//   · Puede borrar quien lo subió o un Admin/Director. Los demás solo ven y descargan.

export const CV_MAX_BYTES = 10 * 1024 * 1024;

/** Extensión → tipos MIME que la acompañan (los navegadores mandan a veces octet-stream en .doc). */
export const CV_TIPOS: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
};

/** Para el `accept` del input de archivo. */
export const CV_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Roles que pueden ver la ficha pero no modificarla (mismo criterio que los negocios). */
const SOLO_LECTURA = ["MARKETING", "DEVELOPER_EXT"];
/** Pueden borrar cualquier CV (además de quien lo subió). */
const BORRAN_CUALQUIERA = ["ADMIN", "DIRECTOR"];

export function extension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : "";
}

export type ArchivoPropuesto = { fileName: string; mimeType: string; sizeBytes: number };

/** null si el archivo se puede subir; si no, el motivo en palabras para la persona. */
export function motivoRechazo(a: ArchivoPropuesto): string | null {
  const ext = extension(a.fileName);
  const mimes = CV_TIPOS[ext];
  if (!mimes) return "Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx).";
  const mime = (a.mimeType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!mimes.includes(mime)) return "El archivo no parece ser un PDF o Word válido.";
  if (!Number.isFinite(a.sizeBytes) || a.sizeBytes <= 0) return "El archivo está vacío.";
  if (a.sizeBytes > CV_MAX_BYTES) return "El archivo pesa más de 10 MB.";
  return null;
}

/** Ruta en el bucket. El nombre original NO va en la ruta (acentos, espacios, datos personales). */
export function rutaCv(contactId: string, fileName: string): string {
  return `contacts/${contactId}/cv/${globalThis.crypto.randomUUID()}.${extension(fileName)}`;
}

/** La confirmación solo acepta rutas que ESTA ficha generó: nadie registra el archivo de otro contacto. */
export function rutaEsDelContacto(path: string, contactId: string): boolean {
  return new RegExp(`^contacts/${escapar(contactId)}/cv/[0-9a-f-]{36}\\.(pdf|docx?)$`).test(path);
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function puedeSubir(role: string): boolean {
  return !SOLO_LECTURA.includes(role);
}

export function puedeBorrar(user: { id: string; role: string }, archivo: { uploadedById: string }): boolean {
  if (SOLO_LECTURA.includes(user.role)) return false;
  return archivo.uploadedById === user.id || BORRAN_CUALQUIERA.includes(user.role);
}

/** Nombre que se guarda y se muestra: sin rutas ni caracteres de control, máximo 200. */
export function nombreLimpio(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-200) || "CV";
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
