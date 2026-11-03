// CV que llega por chat (spec §6): se copia del bucket del chat al bucket de adjuntos del módulo
// Reclutamiento y se registra con la MISMA función que la subida manual (registrarCvDeCandidato),
// con origen CHAT y el id del mensaje como referencia (idempotente por el índice único).
// Se llama desde la ingesta (messaging/core.ts) tras guardar el mensaje. Nunca lanza.
import prisma from "@/lib/db";
import { CV_TIPOS, extension } from "@/lib/contacts/archivos";
import { isStoragePath } from "@/lib/storage/chat-media";
import { copiarDeChatMedia } from "@/lib/storage/crm-attachments";
import { registrarCvDeCandidato } from "@/server/reclutamiento";
import { rutaCvCandidato } from "./shared";

const SIN_MIGRAR = new Set(["P2021", "P2022"]);

/**
 * MIME canónico → extensión, derivado de CV_TIPOS (que va extensión → MIMEs). Solo se toma el
 * primer MIME de cada extensión: por chat no se acepta octet-stream ni zip, porque sin el nombre
 * del archivo no hay forma de saber si de verdad es un Word.
 */
const EXT_POR_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(CV_TIPOS).map(([ext, mimes]) => [mimes[0], ext])
);

/** `Application/PDF; charset=binary` → `application/pdf` (mismo criterio que `motivoRechazo`). */
function mimeNormalizado(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/** Mismos tipos que la subida manual (#917/#926): PDF, DOC y DOCX. */
export function esMimeDeCv(mime: string | null | undefined): boolean {
  return mimeNormalizado(mime) in EXT_POR_MIME;
}

/**
 * Nombre con la extensión que corresponde al MIME. Los canales de chat a veces mandan el nombre
 * sin extensión ("CV Ana") o con una ajena ("cv.bin"); como `rutaCvCandidato` toma la extensión
 * del nombre, aquí se garantiza que nombre y ruta terminen en .pdf/.doc/.docx según el MIME.
 */
function nombreConExtension(fileName: string | null | undefined, mime: string): string {
  const ext = EXT_POR_MIME[mime];
  const base = fileName?.trim() || "cv";
  if (extension(base) === ext) return base;
  const i = base.lastIndexOf(".");
  const sinExt = i > 0 ? base.slice(0, i) : base;
  return `${sinExt}.${ext}`;
}

export async function ligarCv(msg: {
  id: string;
  contactId: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}): Promise<boolean> {
  const mime = mimeNormalizado(msg.mediaMimeType);
  if (!msg.mediaUrl || !isStoragePath(msg.mediaUrl) || !esMimeDeCv(mime)) return false;
  try {
    const cand = await prisma.recruitCandidate.findFirst({
      where: { contactId: msg.contactId, deletedAt: null },
      select: { id: true },
    });
    if (!cand) return false;
    const yaRegistrado = await prisma.recruitCandidateFile.findFirst({
      where: { source: "CHAT", sourceRef: msg.id },
      select: { id: true },
    });
    if (yaRegistrado) return false;

    const fileName = nombreConExtension(msg.mediaFilename, mime);
    const destino = rutaCvCandidato(cand.id, fileName);
    const sizeBytes = await copiarDeChatMedia(msg.mediaUrl, destino, mime);
    if (sizeBytes == null) return false;

    const r = await registrarCvDeCandidato({
      candidateId: cand.id,
      storagePath: destino,
      fileName,
      mimeType: mime,
      sizeBytes,
      source: "CHAT",
      sourceRef: msg.id,
      uploadedById: null,
    });
    return !r.duplicado;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (!code || !SIN_MIGRAR.has(code)) console.warn("[reclutamiento] ligarCv falló:", err);
    return false;
  }
}
