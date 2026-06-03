import { getSupabaseServiceClient } from "@/lib/supabase";
import { mapPayloadToDevelopment, mapTypologyToUnit, mergeFillGaps } from "./map-to-catalog";
import type { IntakePayload } from "./schema";

const HUB = "real_estate_hub";
const PROD_BUCKET = "property-images";
const QUARANTINE_BUCKET = "intake-quarantine";

/** Crea o actualiza (merge fill-gaps) el desarrollo. Devuelve su id. */
export async function upsertDevelopment(
  payload: IntakePayload,
  targetDevId: string | null
): Promise<string> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const incoming = mapPayloadToDevelopment(payload);

  if (targetDevId) {
    const { data: existing, error: selErr } = await supabase
      .schema(HUB)
      .from("Propyte_desarrollos")
      .select("*")
      .eq("id", targetDevId)
      .single();
    if (selErr) throw new Error(`No se encontró el desarrollo destino: ${selErr.message}`);

    const merged = mergeFillGaps(existing, incoming);
    const { error } = await supabase
      .schema(HUB)
      .from("Propyte_desarrollos")
      .update(merged)
      .eq("id", targetDevId);
    if (error) throw new Error(`Update dev falló: ${error.message}`);
    return targetDevId;
  }

  const { data, error } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .insert(incoming)
    .select("id")
    .single();
  if (error) throw new Error(`Insert dev falló: ${error.message}`);
  return (data as { id: string }).id;
}

/** Inserta las unidades-tipología del desarrollo. */
export async function insertTypologies(
  payload: IntakePayload,
  devId: string
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const rows = payload.tipologias.map((t) =>
    mapTypologyToUnit(t, devId, payload.generales.nombre.trim())
  );
  const { error } = await supabase.schema(HUB).from("Propyte_unidades").insert(rows);
  if (error) throw new Error(`Insert unidades falló: ${error.message}`);
  return rows.length;
}

/** Copia imágenes de cuarentena al bucket de producción y devuelve las URLs públicas. */
export async function promoteQuarantineImages(
  quarantinePaths: string[],
  devId: string
): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const out: string[] = [];
  for (const path of quarantinePaths) {
    const { data: file, error: dlErr } = await supabase.storage
      .from(QUARANTINE_BUCKET)
      .download(path);
    if (dlErr || !file) throw new Error(`Descarga cuarentena falló (${path}): ${dlErr?.message}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `development/${devId}/${path.split("/").pop()}`;
    const { error: upErr } = await supabase.storage
      .from(PROD_BUCKET)
      .upload(fileName, buffer, { contentType: "image/webp", upsert: false });
    if (upErr) throw new Error(`Subida a producción falló: ${upErr.message}`);

    const { data: urlData } = supabase.storage.from(PROD_BUCKET).getPublicUrl(fileName);
    out.push(urlData.publicUrl);
  }
  return out;
}

/** Setea fotos_desarrollo (append) y foto_portada (si está vacía) en el desarrollo. */
export async function attachDevelopmentImages(devId: string, urls: string[]): Promise<void> {
  if (!urls.length) return;
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const { data: current } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .select("fotos_desarrollo, foto_portada")
    .eq("id", devId)
    .single();

  const existing: string[] = Array.isArray(current?.fotos_desarrollo) ? current.fotos_desarrollo : [];
  const update: Record<string, unknown> = { fotos_desarrollo: [...existing, ...urls] };
  if (!current?.foto_portada) update.foto_portada = urls[0];

  const { error } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .update(update)
    .eq("id", devId);
  if (error) throw new Error(`Attach imágenes falló: ${error.message}`);
}
