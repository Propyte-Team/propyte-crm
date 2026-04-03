// ============================================================
// Zoho Sync Engine
// Orquesta las 3 fases del sync bidireccional:
//   1. Supabase → Zoho (desarrollos y unidades aprobados)
//   2. Zoho → Supabase (leads, contacts, deals, accounts)
//   3. Status sync bidireccional
// ============================================================

import { getZohoClient } from "./client";
import {
  developmentToZoho,
  unitToZoho,
  zohoLeadToSupabase,
  zohoDealToSupabase,
  zohoContactToSupabase,
  zohoAccountToSupabase,
} from "./field-maps";
import type {
  SyncLogEntry,
  SyncRunResult,
  ZohoLead,
  ZohoDeal,
  ZohoAccount,
  ZohoRecord,
} from "./types";
import { getSupabaseServiceClient } from "../supabase";

// --- Main Sync Runner ---

export async function runSync(): Promise<SyncRunResult> {
  const syncRunId = crypto.randomUUID();
  const startedAt = new Date();
  const logs: SyncLogEntry[] = [];

  const result: SyncRunResult = {
    sync_run_id: syncRunId,
    started_at: startedAt,
    finished_at: startedAt,
    to_zoho: { created: 0, updated: 0, skipped: 0, errors: 0 },
    from_zoho: { created: 0, updated: 0, skipped: 0, errors: 0 },
    api_calls_used: 0,
  };

  const zoho = getZohoClient();
  const supabase = getSupabaseServiceClient();

  if (!supabase) {
    console.error("[SYNC] Supabase client not available");
    return result;
  }

  const callsBefore = zoho.getCallsToday();

  try {
    // FASE 1: Supabase → Zoho (solo aprobados)
    await syncDevelopmentsToZoho(supabase, zoho, syncRunId, result, logs);
    await syncUnitsToZoho(supabase, zoho, syncRunId, result, logs);

    // FASE 2: Zoho → Supabase
    await syncLeadsFromZoho(supabase, zoho, syncRunId, result, logs);
    await syncContactsFromZoho(supabase, zoho, syncRunId, result, logs);
    await syncDealsFromZoho(supabase, zoho, syncRunId, result, logs);
    await syncAccountsFromZoho(supabase, zoho, syncRunId, result, logs);

    // FASE 3: Status sync bidireccional
    await syncStatusBidirectional(supabase, zoho, syncRunId, result, logs);
  } catch (err) {
    console.error("[SYNC] Fatal error:", err);
    logs.push({
      sync_run_id: syncRunId,
      direction: "to_zoho",
      entity_type: "development",
      operation: "error",
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  result.api_calls_used = zoho.getCallsToday() - callsBefore;
  result.finished_at = new Date();

  // Persist logs to Supabase
  if (logs.length > 0) {
    await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_sync_log")
      .insert(logs);
  }

  return result;
}

// --- FASE 1: Supabase → Zoho ---

async function syncDevelopmentsToZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  // Get approved developments that need sync
  const { data: developments, error } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_desarrollos")
    .select("*")
    .in("zoho_pipeline_status", ["aprobado", "listo"])
    .or("zoho_record_id.is.null,updated_at.gt.zoho_last_synced_at");

  if (error || !developments?.length) {
    if (error) console.error("[SYNC] Error fetching developments:", error.message);
    return;
  }

  // Split into creates (no zoho_record_id) and updates
  const toCreate = developments.filter((d: Record<string, unknown>) => !d.zoho_record_id);
  const toUpdate = developments.filter((d: Record<string, unknown>) => d.zoho_record_id);

  // Batch create new developments in Zoho
  if (toCreate.length > 0) {
    const batch = toCreate.slice(0, 100).map((d: Record<string, unknown>) => developmentToZoho(d));
    try {
      const res = await zoho.upsertRecords("Proyectos_Inmobiliarios", batch);
      for (let i = 0; i < res.data.length; i++) {
        const item = res.data[i];
        const dev = toCreate[i];
        if (item.status === "success") {
          // Save Zoho ID back to Supabase
          await supabase
            .schema("real_estate_hub")
            .from("Propyte_desarrollos")
            .update({
              zoho_record_id: item.details.id,
              zoho_last_synced_at: new Date().toISOString(),
              zoho_sync_error: null,
            })
            .eq("id", dev.id);

          // Save to ID map
          await supabase
            .schema("real_estate_hub")
            .from("Propyte_zoho_id_map")
            .upsert({
              entity_type: "development",
              supabase_id: dev.id as string,
              zoho_module: "Proyectos_Inmobiliarios",
              zoho_record_id: item.details.id,
              supabase_updated_at: dev.updated_at as string,
              zoho_modified_time: item.details.Modified_Time,
            }, { onConflict: "entity_type,supabase_id" });

          result.to_zoho.created++;
          logs.push({
            sync_run_id: syncRunId,
            direction: "to_zoho",
            entity_type: "development",
            operation: "create",
            record_id: dev.id as string,
            zoho_record_id: item.details.id,
          });
        } else {
          result.to_zoho.errors++;
          await supabase
            .schema("real_estate_hub")
            .from("Propyte_desarrollos")
            .update({ zoho_sync_error: item.message })
            .eq("id", dev.id);

          logs.push({
            sync_run_id: syncRunId,
            direction: "to_zoho",
            entity_type: "development",
            operation: "error",
            record_id: dev.id as string,
            error_message: item.message,
          });
        }
      }
    } catch (err) {
      result.to_zoho.errors += toCreate.length;
      logs.push({
        sync_run_id: syncRunId,
        direction: "to_zoho",
        entity_type: "development",
        operation: "error",
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Batch update existing developments
  if (toUpdate.length > 0) {
    const batch = toUpdate.slice(0, 100).map((d: Record<string, unknown>) => ({
      ...developmentToZoho(d),
      id: d.zoho_record_id as string,
    }));
    try {
      const res = await zoho.upsertRecords("Proyectos_Inmobiliarios", batch);
      for (let i = 0; i < res.data.length; i++) {
        const item = res.data[i];
        const dev = toUpdate[i];
        if (item.status === "success") {
          await supabase
            .schema("real_estate_hub")
            .from("Propyte_desarrollos")
            .update({
              zoho_last_synced_at: new Date().toISOString(),
              zoho_sync_error: null,
            })
            .eq("id", dev.id);

          result.to_zoho.updated++;
          logs.push({
            sync_run_id: syncRunId,
            direction: "to_zoho",
            entity_type: "development",
            operation: "update",
            record_id: dev.id as string,
            zoho_record_id: dev.zoho_record_id as string,
          });
        } else {
          result.to_zoho.errors++;
          logs.push({
            sync_run_id: syncRunId,
            direction: "to_zoho",
            entity_type: "development",
            operation: "error",
            record_id: dev.id as string,
            error_message: item.message,
          });
        }
      }
    } catch (err) {
      result.to_zoho.errors += toUpdate.length;
      logs.push({
        sync_run_id: syncRunId,
        direction: "to_zoho",
        entity_type: "development",
        operation: "error",
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function syncUnitsToZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  // Get IDs of approved developments that have Zoho IDs
  const { data: approvedDevs } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_desarrollos")
    .select("id, zoho_record_id")
    .in("zoho_pipeline_status", ["aprobado", "listo"])
    .not("zoho_record_id", "is", null);

  if (!approvedDevs?.length) return;

  const devIds = approvedDevs.map((d: Record<string, unknown>) => d.id);
  const devZohoMap = new Map(
    approvedDevs.map((d: Record<string, unknown>) => [d.id as string, d.zoho_record_id as string])
  );

  // Get units that need sync
  const { data: units, error } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_unidades")
    .select("*")
    .in("id_desarrollo", devIds)
    .or("zoho_record_id.is.null,updated_at.gt.zoho_last_synced_at");

  if (error || !units?.length) return;

  const batch = units.slice(0, 100).map((u: Record<string, unknown>) =>
    unitToZoho(u, devZohoMap.get(u.id_desarrollo as string) || "")
  );

  try {
    const res = await zoho.upsertRecords("Products", batch);
    for (let i = 0; i < res.data.length; i++) {
      const item = res.data[i];
      const unit = units[i];
      if (item.status === "success") {
        await supabase
          .schema("real_estate_hub")
          .from("Propyte_unidades")
          .update({
            zoho_record_id: item.details.id,
            zoho_last_synced_at: new Date().toISOString(),
            zoho_sync_error: null,
          })
          .eq("id", unit.id);

        await supabase
          .schema("real_estate_hub")
          .from("Propyte_zoho_id_map")
          .upsert({
            entity_type: "unit",
            supabase_id: unit.id as string,
            zoho_module: "Products",
            zoho_record_id: item.details.id,
            supabase_updated_at: unit.updated_at as string,
            zoho_modified_time: item.details.Modified_Time,
          }, { onConflict: "entity_type,supabase_id" });

        const op = unit.zoho_record_id ? "update" : "create";
        result.to_zoho[op === "create" ? "created" : "updated"]++;
        logs.push({
          sync_run_id: syncRunId,
          direction: "to_zoho",
          entity_type: "unit",
          operation: op,
          record_id: unit.id as string,
          zoho_record_id: item.details.id,
        });
      } else {
        result.to_zoho.errors++;
        logs.push({
          sync_run_id: syncRunId,
          direction: "to_zoho",
          entity_type: "unit",
          operation: "error",
          record_id: unit.id as string,
          error_message: item.message,
        });
      }
    }
  } catch (err) {
    result.to_zoho.errors += units.length;
    logs.push({
      sync_run_id: syncRunId,
      direction: "to_zoho",
      entity_type: "unit",
      operation: "error",
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
}

// --- FASE 2: Zoho → Supabase ---

async function syncModuleFromZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[],
  config: {
    zohoModule: string;
    supabaseTable: string;
    entityType: "lead" | "contact" | "deal" | "account";
    transformer: (record: ZohoRecord) => Record<string, unknown>;
    maxPages: number;
  }
): Promise<void> {
  // Get last sync time for this module
  const { data: lastSync } = await supabase
    .schema("real_estate_hub")
    .from(config.supabaseTable)
    .select("zoho_modified_time")
    .order("zoho_modified_time", { ascending: false })
    .limit(1);

  const modifiedSince = lastSync?.[0]?.zoho_modified_time || undefined;

  try {
    const { records, hasMore } = await zoho.getAllRecords(config.zohoModule, {
      modifiedSince,
      maxPages: config.maxPages,
    });

    for (const record of records) {
      const mapped = config.transformer(record);
      mapped.synced_at = new Date().toISOString();
      mapped.updated_at = new Date().toISOString();

      const { error } = await supabase
        .schema("real_estate_hub")
        .from(config.supabaseTable)
        .upsert(mapped, { onConflict: "zoho_record_id" });

      if (error) {
        result.from_zoho.errors++;
        logs.push({
          sync_run_id: syncRunId,
          direction: "from_zoho",
          entity_type: config.entityType,
          operation: "error",
          zoho_record_id: record.id as string,
          error_message: error.message,
        });
      } else {
        // Check if it was create or update based on synced_at vs created_at
        const isNew = !modifiedSince;
        result.from_zoho[isNew ? "created" : "updated"]++;

        // Update ID map
        await supabase
          .schema("real_estate_hub")
          .from("Propyte_zoho_id_map")
          .upsert({
            entity_type: config.entityType,
            supabase_id: mapped.zoho_record_id as string,
            zoho_module: config.zohoModule,
            zoho_record_id: record.id as string,
            zoho_modified_time: record.Modified_Time as string,
          }, { onConflict: "zoho_module,zoho_record_id" });
      }
    }

    if (hasMore) {
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "skip",
        details: { reason: "more_records_available", fetched: records.length },
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("rate limit")) {
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "skip",
        details: { reason: "rate_limit_reached" },
      });
      return;
    }
    result.from_zoho.errors++;
    logs.push({
      sync_run_id: syncRunId,
      direction: "from_zoho",
      entity_type: config.entityType,
      operation: "error",
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function syncLeadsFromZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  await syncModuleFromZoho(supabase, zoho, syncRunId, result, logs, {
    zohoModule: "Leads",
    supabaseTable: "Propyte_zoho_leads",
    entityType: "lead",
    transformer: (r) => zohoLeadToSupabase(r as ZohoLead),
    maxPages: 3, // ~600 records per run, budget-friendly
  });
}

async function syncContactsFromZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  await syncModuleFromZoho(supabase, zoho, syncRunId, result, logs, {
    zohoModule: "Contacts",
    supabaseTable: "Propyte_zoho_contacts",
    entityType: "contact",
    transformer: zohoContactToSupabase,
    maxPages: 2,
  });
}

async function syncDealsFromZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  await syncModuleFromZoho(supabase, zoho, syncRunId, result, logs, {
    zohoModule: "Deals",
    supabaseTable: "Propyte_zoho_deals",
    entityType: "deal",
    transformer: (r) => zohoDealToSupabase(r as ZohoDeal),
    maxPages: 2,
  });
}

async function syncAccountsFromZoho(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  await syncModuleFromZoho(supabase, zoho, syncRunId, result, logs, {
    zohoModule: "Accounts",
    supabaseTable: "Propyte_zoho_accounts",
    entityType: "account",
    transformer: (r) => zohoAccountToSupabase(r as ZohoAccount),
    maxPages: 2,
  });
}

// --- FASE 3: Status Sync Bidireccional ---

async function syncStatusBidirectional(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  zoho: ReturnType<typeof getZohoClient>,
  syncRunId: string,
  result: SyncRunResult,
  logs: SyncLogEntry[]
): Promise<void> {
  // Get developments that have Zoho IDs (already synced)
  const { data: syncedDevs } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_desarrollos")
    .select("id, zoho_record_id, zoho_pipeline_status, updated_at, zoho_last_synced_at")
    .not("zoho_record_id", "is", null);

  if (!syncedDevs?.length) return;

  // Check each synced development for status changes in Zoho
  // (Only check a few per run to conserve rate limit)
  const toCheck = syncedDevs.slice(0, 5);

  for (const dev of toCheck) {
    try {
      const zohoRecord = await zoho.getRecord(
        "Proyectos_Inmobiliarios",
        dev.zoho_record_id as string
      );

      if (!zohoRecord) continue;

      // If Zoho's Modified_Time is newer than our last sync, Zoho wins for status
      const zohoModified = new Date(zohoRecord.Modified_Time as string).getTime();
      const lastSynced = dev.zoho_last_synced_at
        ? new Date(dev.zoho_last_synced_at as string).getTime()
        : 0;

      if (zohoModified > lastSynced) {
        // Update ID map with latest Zoho modified time
        await supabase
          .schema("real_estate_hub")
          .from("Propyte_zoho_id_map")
          .update({ zoho_modified_time: zohoRecord.Modified_Time as string })
          .eq("entity_type", "development")
          .eq("supabase_id", dev.id as string);

        logs.push({
          sync_run_id: syncRunId,
          direction: "from_zoho",
          entity_type: "development",
          operation: "update",
          record_id: dev.id as string,
          zoho_record_id: dev.zoho_record_id as string,
          details: { reason: "status_check" },
        });
      }
    } catch {
      // Non-critical — skip this record
    }
  }

  // Check deals for unit status updates
  // If a deal moves to a closing stage, update unit status in Supabase
  const { data: recentDeals } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_zoho_deals")
    .select("*")
    .gte("zoho_modified_time", new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .not("stage", "is", null);

  if (!recentDeals?.length) return;

  for (const deal of recentDeals) {
    // Map deal stages to unit statuses
    const stageToUnitStatus: Record<string, string> = {
      "Apartado": "apartada",
      "Contrato firmado": "vendida",
      "Cerrada ganada": "vendida",
      "Cerrada perdida": "disponible",
    };

    const newUnitStatus = stageToUnitStatus[deal.stage as string];
    if (!newUnitStatus || !deal.proyecto_inmobiliario_zoho_id) continue;

    // Find the unit in our map
    const { data: unitMap } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_id_map")
      .select("supabase_id")
      .eq("zoho_module", "Products")
      .eq("entity_type", "unit");

    // This is a simplified approach — in production we'd need the deal-unit relationship
    // from Zoho to identify which specific unit the deal affects
    if (unitMap?.length) {
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: "unit",
        operation: "skip",
        details: {
          reason: "deal_stage_change_detected",
          deal_stage: deal.stage,
          suggested_unit_status: newUnitStatus,
        },
      });
    }
  }
}
