// ============================================================
// API Route: /api/zoho/approvals
// GET: lista desarrollos y unidades con su status de sync
// PATCH: actualiza zoho_pipeline_status (desarrollos) o zoho status (unidades)
// Query param: ?tab=developments | ?tab=units
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";

async function fetchAllPages(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  schema: string,
  table: string,
  select: string,
  orderBy: string
) {
  const allData: Record<string, unknown>[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error } = await supabase!
      .schema(schema)
      .from(table)
      .select(select)
      .is("deleted_at", null)
      .order(orderBy, { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    allData.push(...(page || []));
    hasMore = (page?.length || 0) === pageSize;
    from += pageSize;
  }

  return allData;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const tab = request.nextUrl.searchParams.get("tab") || "developments";

  try {
    if (tab === "units") {
      // Fetch units with parent development name
      const units = await fetchAllPages(
        supabase,
        "real_estate_hub",
        "Propyte_unidades",
        "id, slug_unidad, ext_numero_unidad, tipo_unidad, ext_tipologia, " +
          "recamaras, banos_completos, superficie_total_m2, piso_numero, " +
          "precio_mxn, precio_usd, estado_unidad, fotos_unidad, ext_publicado, " +
          "id_desarrollo, zoho_record_id, zoho_last_synced_at, updated_at",
        "slug_unidad"
      );

      // Fetch development names and zoho IDs for the lookup
      const devIds = [...new Set(units.map((u) => u.id_desarrollo).filter(Boolean))];
      const devMap: Record<string, { nombre: string; zoho_id: string | null; status: string }> = {};

      if (devIds.length > 0) {
        // Fetch in batches of 500 (Supabase .in() limit)
        for (let i = 0; i < devIds.length; i += 500) {
          const batch = devIds.slice(i, i + 500) as string[];
          const { data: devs } = await supabase
            .schema("real_estate_hub")
            .from("Propyte_desarrollos")
            .select("id, nombre_desarrollo, zoho_record_id, zoho_pipeline_status")
            .in("id", batch);

          for (const d of devs || []) {
            devMap[d.id as string] = {
              nombre: d.nombre_desarrollo as string,
              zoho_id: d.zoho_record_id as string | null,
              status: d.zoho_pipeline_status as string,
            };
          }
        }
      }

      // Attach development info to each unit
      const unitsWithDev = units.map((u) => {
        const dev = devMap[u.id_desarrollo as string];
        return {
          ...u,
          desarrollo_nombre: dev?.nombre || "Sin desarrollo",
          desarrollo_zoho_id: dev?.zoho_id || null,
          desarrollo_pipeline_status: dev?.status || "discovery",
        };
      });

      return NextResponse.json({ units: unitsWithDev });
    }

    // Default: developments
    const developments = await fetchAllPages(
      supabase,
      "real_estate_hub",
      "Propyte_desarrollos",
      "id, nombre_desarrollo, ciudad, estado, tipo_desarrollo, " +
        "ext_precio_min_mxn, fotos_desarrollo, unidades_disponibles, " +
        "zoho_pipeline_status, zoho_record_id, zoho_last_synced_at, updated_at",
      "nombre_desarrollo"
    );

    return NextResponse.json({ developments });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
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
  const { ids, zoho_pipeline_status, entity_type } = body;

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Units: toggle sync (mark for sync / unmark)
  if (entity_type === "unit") {
    if (!ids?.length) {
      return NextResponse.json({ error: "ids requeridos" }, { status: 400 });
    }
    // For units, we don't have pipeline status — we just ensure they're linked to an approved development
    // The sync engine handles this automatically
    return NextResponse.json({ success: true, message: "Units sync is automatic when parent development is approved" });
  }

  // Developments: update pipeline status
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

  const updateData: Record<string, unknown> = {
    zoho_pipeline_status,
  };

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
