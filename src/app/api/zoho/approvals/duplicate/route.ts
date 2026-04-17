// ============================================================
// API Route: POST /api/zoho/approvals/duplicate
// Duplica un registro en real_estate_hub (developer, development, o unit)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { id, entity_type } = await request.json();
  if (!id || !entity_type) {
    return NextResponse.json({ error: "id y entity_type requeridos" }, { status: 400 });
  }

  const tableMap: Record<string, string> = {
    developer: "Propyte_desarrolladores",
    development: "Propyte_desarrollos",
    unit: "Propyte_unidades",
  };

  const table = tableMap[entity_type];
  if (!table) {
    return NextResponse.json({ error: "entity_type inválido" }, { status: 400 });
  }

  try {
    // 1. Fetch original record
    const { data: original, error: fetchErr } = await supabase
      .schema("real_estate_hub")
      .from(table)
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !original) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }

    // 2. Prepare duplicate — remove unique fields, reset sync state
    const duplicate = { ...original };
    delete duplicate.id;
    delete duplicate.created_at;
    delete duplicate.updated_at;
    delete duplicate.deleted_at;
    delete duplicate.zoho_record_id;
    delete duplicate.zoho_last_synced_at;
    delete duplicate.zoho_sync_error;
    delete duplicate.approved_at;
    delete duplicate.approved_by;
    duplicate.zoho_pipeline_status = "discovery";
    duplicate.ext_publicado = false;

    // Add "(Copia)" suffix to name field
    if (entity_type === "developer" && duplicate.nombre_desarrollador) {
      duplicate.nombre_desarrollador += " (Copia)";
      duplicate.ext_slug_desarrollador = null;
    } else if (entity_type === "development" && duplicate.nombre_desarrollo) {
      duplicate.nombre_desarrollo += " (Copia)";
      duplicate.ext_slug_desarrollo = null;
    } else if (entity_type === "unit") {
      if (duplicate.ext_numero_unidad) duplicate.ext_numero_unidad += " (Copia)";
      duplicate.slug_unidad = null;
      delete duplicate.ext_legacy_property_id;
    }

    // 3. Insert duplicate
    const { data: newRecord, error: insertErr } = await supabase
      .schema("real_estate_hub")
      .from(table)
      .insert(duplicate)
      .select("id")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      new_id: newRecord.id,
      entity_type,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
