// ============================================================
// POST /api/sync/publish-all
// Bulk-publishes developments from redsearch_marketplace.csv
// directly to Supabase `developments` table.
// This populates the website without needing Drive sync.
// ============================================================

import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import fs from "fs/promises";
import path from "path";

const CSV_PATH = path.resolve(process.cwd(), "../outputs/redsearch_marketplace.csv");

export async function POST() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const content = await fs.readFile(CSV_PATH, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV vacío" }, { status: 400 });
    }

    const headers = parseCSVLine(lines[0]);
    let published = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Group by development (many rows are individual units, not distinct developments)
    const devMap = new Map<string, Record<string, string>>();
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] || ""; });

      const name = row.desarrollo?.trim();
      if (!name || !row.ciudad?.trim()) { skipped++; continue; }

      // Use first occurrence (most complete data tends to be the project-level row)
      const key = `${name}|${row.ciudad}`.toLowerCase();
      if (!devMap.has(key)) {
        devMap.set(key, row);
      } else {
        // Merge: pick non-empty values
        const existing = devMap.get(key)!;
        for (const [k, v] of Object.entries(row)) {
          if (v && !existing[k]) existing[k] = v;
        }
      }
    }

    console.log(`[PUBLISH-ALL] ${devMap.size} desarrollos únicos encontrados`);

    for (const [, row] of devMap) {
      try {
        const name = row.desarrollo.trim();
        const city = row.ciudad.trim();
        const slug = slugify(name);

        if (!slug) { skipped++; continue; }

        // Parse commission rate
        const commissionStr = (row.comision || "").replace("%", "").trim();
        const commissionRate = parseFloat(commissionStr) || null;

        // Parse total units
        const totalUnits = parseInt(row.unidades_totales, 10) || null;
        const availableUnits = parseInt(row.unidades_disponibles, 10) || null;

        // Parse delivery
        const deliveryText = row.fecha_entrega || null;
        let stage = "construccion";
        if (deliveryText?.toLowerCase().includes("inmediata")) {
          stage = "entrega_inmediata";
        } else if (row.inicio_ventas) {
          const startDate = new Date(row.inicio_ventas);
          const now = new Date();
          if (startDate > now) stage = "preventa";
        }

        // Build development record
        const devData: Record<string, unknown> = {
          slug,
          name,
          city,
          zone: row.barrio_colonia || null,
          state: "Quintana Roo",
          stage,
          property_types: ["departamento"],
          total_units: totalUnits,
          available_units: availableUnits,
          sold_units: totalUnits && availableUnits ? totalUnits - availableUnits : null,
          commission_rate: commissionRate,
          drive_url: row.url_drive || null,
          source_url: row.url_listing || null,
          contact_name: row.contacto || null,
          contact_phone: row.numero_contacto || null,
          detection_source: "redsearch",
          description_es: `${name} — Desarrollo inmobiliario en ${row.barrio_colonia || ""}, ${city}.${totalUnits ? ` ${totalUnits} unidades.` : ""}${deliveryText ? ` Entrega: ${deliveryText}.` : ""}`,
          description_en: `${name} — Real estate development in ${row.barrio_colonia || ""}, ${city}.${totalUnits ? ` ${totalUnits} units.` : ""}${deliveryText ? ` Delivery: ${deliveryText}.` : ""}`,
          amenities: [],
          images: [
            "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=450&fit=crop",
            "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=450&fit=crop",
          ],
          usage: ["vacacional", "renta"],
          featured: false,
          published: true,
          updated_at: new Date().toISOString(),
        };

        if (row.inicio_ventas) {
          try {
            const d = new Date(row.inicio_ventas);
            if (!isNaN(d.getTime())) devData.sales_start_date = d.toISOString().split("T")[0];
          } catch { /* ignore */ }
        }

        if (deliveryText && !deliveryText.toLowerCase().includes("inmediata")) {
          try {
            const d = new Date(deliveryText);
            if (!isNaN(d.getTime())) devData.estimated_delivery = d.toISOString().split("T")[0];
          } catch { /* ignore */ }
        }
        devData.delivery_text = deliveryText;

        // Developer name from CSV
        const developerName = row.desarrollador?.trim() || null;

        // Try to find/create developer
        if (developerName) {
          const devSlug = slugify(developerName);
          const { data: existingDev } = await supabase
            .from("developers")
            .select("id")
            .eq("slug", devSlug)
            .maybeSingle();

          if (existingDev) {
            devData.developer_id = existingDev.id;
          } else {
            const { data: newDev } = await supabase
              .from("developers")
              .insert({ name: developerName, slug: devSlug })
              .select("id")
              .single();
            if (newDev) devData.developer_id = newDev.id;
          }
        }

        // Upsert
        const { data: existing } = await supabase
          .from("developments")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase.from("developments").update(devData).eq("id", existing.id);
          if (error) { errors.push(`${name}: ${error.message}`); } else { updated++; }
        } else {
          const { error } = await supabase.from("developments").insert(devData);
          if (error) { errors.push(`${name}: ${error.message}`); } else { published++; }
        }
      } catch (e) {
        errors.push(`Error: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      data: { published, updated, skipped, total: devMap.size, errors: errors.slice(0, 20) },
    });
  } catch (error) {
    console.error("Error en publish-all:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
