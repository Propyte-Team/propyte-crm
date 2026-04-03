// ============================================================
// API Route: /api/zoho/approvals
// GET: lista desarrollos con su zoho_pipeline_status
// PATCH: actualiza zoho_pipeline_status en bulk
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Paginar para traer todos los registros (Supabase limit default = 1000)
  const allData: Record<string, unknown>[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error: pageError } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_desarrollos")
      .select(
        "id, nombre_desarrollo, ciudad, estado, tipo_desarrollo, " +
          "ext_precio_min_mxn, fotos_desarrollo, unidades_disponibles, " +
          "zoho_pipeline_status, zoho_record_id, zoho_last_synced_at, updated_at"
      )
      .is("deleted_at", null)
      .order("nombre_desarrollo", { ascending: true })
      .range(from, from + pageSize - 1);

    if (pageError) {
      return NextResponse.json({ error: pageError.message }, { status: 500 });
    }

    allData.push(...(page || []));
    hasMore = (page?.length || 0) === pageSize;
    from += pageSize;
  }

  return NextResponse.json({ developments: allData });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const { ids, zoho_pipeline_status } = body;

  if (!ids?.length || !zoho_pipeline_status) {
    return NextResponse.json(
      { error: "ids y zoho_pipeline_status son requeridos" },
      { status: 400 }
    );
  }

  const validStatuses = [
    "discovery", "analisis", "presentacion",
    "aprobado", "listo", "pausa", "descartado",
  ];

  if (!validStatuses.includes(zoho_pipeline_status)) {
    return NextResponse.json(
      { error: `Status inválido. Válidos: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const updateData: Record<string, unknown> = {
    zoho_pipeline_status,
  };

  // Set approved_at/approved_by when moving to aprobado or listo
  if (zoho_pipeline_status === "aprobado" || zoho_pipeline_status === "listo") {
    updateData.approved_at = new Date().toISOString();
    updateData.approved_by = session.user.name || session.user.email || "unknown";
  }

  const { error } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_desarrollos")
    .update(updateData)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    updated: ids.length,
    new_status: zoho_pipeline_status,
  });
}
