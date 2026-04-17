/**
 * Logger de robots: escribe a `real_estate_hub.Propyte_robot_runs` y a stdout.
 *
 * Patron inspirado en src/lib/agents/monitor/sync-logger.ts pero apunta a
 * distinta tabla (robot_runs vs SyncLog) y formato distinto de metricas.
 *
 * Uso:
 *   const log = new RobotLogger('01-classifier');
 *   const run = await log.start({ dry_run: false, limit: 100 });
 *   try {
 *     log.info('filtering 641 properties');
 *     // ... trabajo ...
 *     log.metric('desarrollos_created', 45);
 *     log.metric('unidades_updated', 580);
 *     await log.finish(run.id, 'success');
 *   } catch (err) {
 *     log.error('run failed', err);
 *     await log.finish(run.id, 'failure');
 *     throw err;
 *   }
 */

import { getDb } from "./db";
import type { RobotName, RobotRunStatus, RobotRunRecord } from "./types";

export class RobotLogger {
  private metrics: Record<string, number> = {};
  private errors: Array<Record<string, unknown>> = [];
  private startedAtMs: number | null = null;

  constructor(private readonly robotName: RobotName) {}

  info(msg: string, meta?: Record<string, unknown>): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`[${this.robotName}] ${msg}${metaStr}`);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.warn(`[${this.robotName}] WARN: ${msg}${metaStr}`);
  }

  error(msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const errStr =
      err instanceof Error ? `${err.message}\n${err.stack}` : err ? String(err) : "";
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.error(`[${this.robotName}] ERROR: ${msg}${metaStr}\n${errStr}`);

    this.errors.push({
      at: new Date().toISOString(),
      msg,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      meta,
    });
  }

  metric(name: string, value: number): void {
    this.metrics[name] = (this.metrics[name] ?? 0) + value;
  }

  setMetric(name: string, value: number): void {
    this.metrics[name] = value;
  }

  getMetrics(): Record<string, number> {
    return { ...this.metrics };
  }

  getErrors(): Array<Record<string, unknown>> {
    return [...this.errors];
  }

  async start(inputs: Record<string, unknown>): Promise<RobotRunRecord> {
    this.startedAtMs = Date.now();
    this.metrics = {};
    this.errors = [];

    const db = getDb();
    const host =
      process.env.GITHUB_ACTIONS === "true"
        ? "github-actions"
        : process.env.VERCEL === "1"
          ? "vercel"
          : "local";
    const gitSha = process.env.GITHUB_SHA ?? null;

    const rows = (await db.$queryRawUnsafe<RobotRunRecord[]>(
      `INSERT INTO real_estate_hub."Propyte_robot_runs"
         (robot_name, status, inputs, host, git_sha)
       VALUES ($1, 'running', $2::jsonb, $3, $4)
       RETURNING *`,
      this.robotName,
      JSON.stringify(inputs),
      host,
      gitSha
    )) as RobotRunRecord[];

    const run = rows[0];
    this.info(`started`, { run_id: run.id, host, dry_run: !!inputs.dry_run });
    return run;
  }

  async finish(runId: string, status: RobotRunStatus): Promise<void> {
    if (this.startedAtMs === null) {
      throw new Error("finish() called before start()");
    }
    const durationMs = Date.now() - this.startedAtMs;

    const db = getDb();
    await db.$executeRawUnsafe(
      `UPDATE real_estate_hub."Propyte_robot_runs"
       SET completed_at = now(),
           status = $1,
           outputs = $2::jsonb,
           errors = $3::jsonb,
           duration_ms = $4
       WHERE id = $5::uuid`,
      status,
      JSON.stringify(this.metrics),
      this.errors.length > 0 ? JSON.stringify(this.errors) : null,
      durationMs,
      runId
    );

    this.info(`finished`, {
      run_id: runId,
      status,
      duration_ms: durationMs,
      metrics: this.metrics,
      errors: this.errors.length,
    });
    this.startedAtMs = null;
  }
}
