// ============================================================
// POST /api/sync/publish-existing
// Sets published=true on all existing developments in Supabase
// that have a slug and are not deleted.
// ============================================================

import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";

export async function POST() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    // Count unpublished
    const { count: unpublished } = await supabase
      .from("developments")
      .select("id", { count: "exact", head: true })
      .eq("published", false)
      .is("deleted_at", null);

    // Update all to published
    const { error } = await supabase
      .from("developments")
      .update({ published: true, updated_at: new Date().toISOString() })
      .eq("published", false)
      .is("deleted_at", null)
      .not("slug", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: { updated: unpublished || 0, message: `${unpublished} desarrollos marcados como publicados` },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
