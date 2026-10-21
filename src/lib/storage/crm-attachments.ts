// #917 — Bucket privado `crm-attachments` (Supabase Storage): archivos de las fichas (CV).
// Sin policies — todo acceso pasa por service role o signed URLs (mismo patrón que chat-media).
// Subida desde el navegador SIEMPRE con signed upload URL directa a Supabase: Hostinger trunca
// el multipart de más de 1–2 MB si pasa por la API del CRM.
import { getSupabaseServiceClient } from "@/lib/supabase";

export const CRM_ATTACHMENTS_BUCKET = "crm-attachments";

/** Las URLs de lectura duran poco: la ficha las vuelve a pedir cada vez que se abre. */
const LECTURA_SEGUNDOS = 10 * 60;

/** URL firmada para que el NAVEGADOR suba directo (PUT/uploadToSignedUrl). null si falla. */
export async function crearUrlDeSubida(path: string): Promise<{ signedUrl: string; token: string } | null> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return null;
    const { data, error } = await supabase.storage.from(CRM_ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return null;
    return { signedUrl: data.signedUrl, token: data.token };
  } catch {
    return null;
  }
}

/** ¿Ya está el objeto en el bucket? (se confirma la subida antes de registrarla). */
export async function existeArchivo(path: string): Promise<boolean> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return false;
    const corte = path.lastIndexOf("/");
    const { data, error } = await supabase.storage
      .from(CRM_ATTACHMENTS_BUCKET)
      .list(path.slice(0, corte), { search: path.slice(corte + 1), limit: 1 });
    return !error && Array.isArray(data) && data.some((o: { name: string }) => o.name === path.slice(corte + 1));
  } catch {
    return false;
  }
}

/**
 * URLs firmadas de lectura: `ver` abre en el navegador y `descargar` baja el archivo con su
 * nombre original. Devuelve map path → {ver, descargar}; las que fallen no aparecen.
 */
export async function firmarLectura(
  archivos: Array<{ path: string; fileName: string }>
): Promise<Record<string, { ver: string; descargar: string }>> {
  if (!archivos.length) return {};
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return {};
    const bucket = supabase.storage.from(CRM_ATTACHMENTS_BUCKET);
    const out: Record<string, { ver: string; descargar: string }> = {};
    await Promise.all(
      archivos.map(async ({ path, fileName }) => {
        const [ver, descargar] = await Promise.all([
          bucket.createSignedUrl(path, LECTURA_SEGUNDOS),
          bucket.createSignedUrl(path, LECTURA_SEGUNDOS, { download: fileName }),
        ]);
        if (ver.data?.signedUrl && descargar.data?.signedUrl) {
          out[path] = { ver: ver.data.signedUrl, descargar: descargar.data.signedUrl };
        }
      })
    );
    return out;
  } catch {
    return {};
  }
}

/** Borra el objeto del bucket. Best-effort: el registro ya quedó marcado como borrado. */
export async function borrarArchivo(path: string): Promise<boolean> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return false;
    const { error } = await supabase.storage.from(CRM_ATTACHMENTS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}
