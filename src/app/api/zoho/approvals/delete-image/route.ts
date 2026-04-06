// ============================================================
// API Route: /api/zoho/approvals/delete-image
// DELETE: Elimina una imagen de Supabase Storage
// y actualiza el campo correspondiente en real_estate_hub
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";

const BUCKET_NAME = "property-images";

const TABLE_MAP: Record<string, string> = {
  developer: "Propyte_desarrolladores",
  development: "Propyte_desarrollos",
  unit: "Propyte_unidades",
};

const ARRAY_FIELDS = new Set(["fotos_desarrollo", "fotos_unidad"]);

export async function DELETE(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let body: { entity_type: string; entity_id: string; field_name: string; image_url: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { entity_type, entity_id, field_name, image_url } = body;

  if (!entity_type || !entity_id || !field_name || !image_url) {
    return NextResponse.json({ error: "entity_type, entity_id, field_name e image_url requeridos" }, { status: 400 });
  }

  if (!TABLE_MAP[entity_type]) {
    return NextResponse.json({ error: `entity_type inválido: ${entity_type}` }, { status: 400 });
  }

  const table = TABLE_MAP[entity_type];

  try {
    // Try to extract storage path from the URL and delete from storage
    const bucketPath = extractStoragePath(image_url);
    if (bucketPath) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([bucketPath]);

      if (removeError) {
        console.warn(`[DELETE-IMAGE] Storage remove warning: ${removeError.message}`);
      }
    }

    // Update the database field
    if (ARRAY_FIELDS.has(field_name)) {
      // Fetch current array and remove the URL
      const { data: current } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .select(field_name)
        .eq("id", entity_id)
        .single();

      const existingUrls: string[] = Array.isArray(current?.[field_name]) ? current[field_name] : [];
      const updatedUrls = existingUrls.filter((url: string) => url !== image_url);

      const { error: updateError } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .update({ [field_name]: updatedUrls, updated_at: new Date().toISOString() })
        .eq("id", entity_id);

      if (updateError) {
        throw new Error(`DB update failed: ${updateError.message}`);
      }
    } else {
      // Single image field: set to null
      const { error: updateError } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .update({ [field_name]: null, updated_at: new Date().toISOString() })
        .eq("id", entity_id);

      if (updateError) {
        throw new Error(`DB update failed: ${updateError.message}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function extractStoragePath(url: string): string | null {
  // Extract path after /storage/v1/object/public/property-images/
  const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(url.substring(idx + marker.length));
  }

  // Fallback: try to extract path after /property-images/
  const fallbackMarker = `/${BUCKET_NAME}/`;
  const fallbackIdx = url.lastIndexOf(fallbackMarker);
  if (fallbackIdx !== -1) {
    return decodeURIComponent(url.substring(fallbackIdx + fallbackMarker.length));
  }

  return null;
}
