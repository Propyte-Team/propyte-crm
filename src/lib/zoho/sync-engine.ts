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
  // Get approved developments — filter sync-needed in JS
  // (PostgREST can't compare column vs column in .or())
  const { data: allApproved, error } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_desarrollos")
    .select("*")
    .in("zoho_pipeline_status", ["aprobado", "listo"]);

  if (error || !allApproved?.length) {
    if (error) console.error("[SYNC] Error fetching developments:", error.message);
    return;
  }

  // Filter: needs sync if no zoho_record_id OR updated after last sync
  const developments = allApproved.filter((d: Record<string, unknown>) => {
    if (!d.zoho_record_id) return true;
    if (!d.zoho_last_synced_at) return true;
    return new Date(d.updated_at as string) > new Date(d.zoho_last_synced_at as string);
  });

  if (!developments.length) return;

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

  // Get units from approved developments — filter sync-needed in JS
  const { data: allUnits, error } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_unidades")
    .select("*")
    .in("id_desarrollo", devIds);

  if (error || !allUnits?.length) return;

  const units = allUnits.filter((u: Record<string, unknown>) => {
    if (!u.zoho_record_id) return true;
    if (!u.zoho_last_synced_at) return true;
    return new Date(u.updated_at as string) > new Date(u.zoho_last_synced_at as string);
  });

  if (!units.length) return;

  // Filtrar unidades cuyo desarrollo padre tiene Zoho ID
  const unitsWithParent = units
    .filter((u: Record<string, unknown>) => devZohoMap.has(u.id_desarrollo as string))
    .slice(0, 100);

  if (unitsWithParent.length === 0) return;

  const batch = unitsWithParent.map((u: Record<string, unknown>) => {
    const parentId = devZohoMap.get(u.id_desarrollo as string) as string;
    return unitToZoho(u, parentId);
  });

  try {
    const res = await zoho.upsertRecords("Products", batch);
    for (let i = 0; i < res.data.length; i++) {
      const item = res.data[i];
      const unit = unitsWithParent[i];
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
    result.to_zoho.errors += unitsWithParent.length;
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

// Helper: check if initial bulk sync is complete for a module
async function getInitialSyncState(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  entityType: string
): Promise<{ complete: boolean; lastPage: number }> {
  // Check for "initial_sync_complete" marker
  const { data: completeMarker } = await supabase
    .schema("real_estate_hub")
    .from("Propyte_zoho_sync_log")
    .select("details")
    .eq("entity_type", entityType)
    .eq("direction", "from_zoho")
    .eq("operation", "skip")
    .order("created_at", { ascending: false })
    .limit(50);

  if (completeMarker?.length) {
    for (const entry of completeMarker) {
      const details = entry.details as Record<string, unknown> | null;
      if (details?.initial_sync_complete) {
        return { complete: true, lastPage: 0 };
      }
      if (typeof details?.last_page === "number") {
        return { complete: false, lastPage: details.last_page as number };
      }
    }
  }

  return { complete: false, lastPage: 0 };
}

// Helper: batch upsert records to Supabase in chunks
async function batchUpsertToSupabase(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  table: string,
  records: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 500
): Promise<{ succeeded: number; errors: string[] }> {
  let succeeded = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await supabase
      .schema("real_estate_hub")
      .from(table)
      .upsert(chunk, { onConflict });

    if (error) {
      errors.push(`Chunk ${i}-${i + chunk.length}: ${error.message}`);
    } else {
      succeeded += chunk.length;
    }
  }

  return { succeeded, errors };
}

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
  // Determine sync mode: initial bulk vs incremental
  const syncState = await getInitialSyncState(supabase, config.entityType);

  let modifiedSince: string | undefined;
  let startPage = 1;

  if (syncState.complete) {
    // Incremental mode: only fetch records modified since last sync
    const { data: lastSync } = await supabase
      .schema("real_estate_hub")
      .from(config.supabaseTable)
      .select("zoho_modified_time")
      .order("zoho_modified_time", { ascending: false })
      .limit(1);

    modifiedSince = lastSync?.[0]?.zoho_modified_time || undefined;
  } else {
    // Initial bulk sync: continue from where we left off
    startPage = syncState.lastPage > 0 ? syncState.lastPage + 1 : 1;
    console.log(
      `[SYNC] ${config.entityType}: initial sync mode, starting page ${startPage}`
    );
  }

  try {
    const { records, hasMore, lastPage } = await zoho.getAllRecords(
      config.zohoModule,
      {
        modifiedSince,
        maxPages: config.maxPages,
        startPage,
      }
    );

    if (records.length === 0) {
      // No new records — if we're in initial mode and no more pages, mark complete
      if (!syncState.complete && !hasMore) {
        logs.push({
          sync_run_id: syncRunId,
          direction: "from_zoho",
          entity_type: config.entityType,
          operation: "skip",
          details: { initial_sync_complete: true, total_pages: lastPage },
        });
      }
      return;
    }

    // Transform all records
    const now = new Date().toISOString();
    const mapped = records.map((record) => {
      const row = config.transformer(record);
      row.synced_at = now;
      row.updated_at = now;
      return row;
    });

    // Batch upsert to main table
    const { succeeded, errors } = await batchUpsertToSupabase(
      supabase,
      config.supabaseTable,
      mapped,
      "zoho_record_id"
    );

    result.from_zoho.created += succeeded;
    for (const errMsg of errors) {
      result.from_zoho.errors++;
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "error",
        error_message: errMsg,
      });
    }

    // Batch upsert to ID map
    const idMapRows = records.map((record) => ({
      entity_type: config.entityType,
      supabase_id: record.id as string,
      zoho_module: config.zohoModule,
      zoho_record_id: record.id as string,
      zoho_modified_time: record.Modified_Time as string,
    }));

    await batchUpsertToSupabase(
      supabase,
      "Propyte_zoho_id_map",
      idMapRows,
      "zoho_module,zoho_record_id"
    );

    // Track continuation state
    if (hasMore && !syncState.complete) {
      // Still more pages to fetch — save progress for next run
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "skip",
        details: {
          reason: "continuation",
          last_page: lastPage,
          fetched_this_run: records.length,
        },
      });
    } else if (!hasMore && !syncState.complete) {
      // Initial sync finished for this module
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "skip",
        details: {
          initial_sync_complete: true,
          total_pages: lastPage,
          total_fetched: records.length,
        },
      });
      console.log(
        `[SYNC] ${config.entityType}: initial sync COMPLETE (${lastPage} pages)`
      );
    } else if (hasMore && syncState.complete) {
      // Incremental sync has more — unusual but possible with large batch of changes
      logs.push({
        sync_run_id: syncRunId,
        direction: "from_zoho",
        entity_type: config.entityType,
        operation: "skip",
        details: { reason: "more_incremental_records", fetched: records.length },
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
    maxPages: 25, // ~5,000 records per run — 20K leads in ~4 runs
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
    maxPages: 25, // 4,032 contacts — completa en 1 run
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
    maxPages: 5, // 225 deals — completa en 1 run
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
    maxPages: 10, // 1,340 accounts — completa en 1 run
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
