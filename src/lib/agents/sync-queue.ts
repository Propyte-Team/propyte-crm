// ============================================================
// Sync Queue — Procesa syncs secuencialmente (1 a la vez)
// Batch el deploy de Vercel (1 deploy al final de la cola)
// ============================================================

import { runFullSync } from "./run-full-sync";

interface QueueItem {
  folderId: string;
  triggeredBy: "CRON" | "WEBHOOK" | "MANUAL";
  addedAt: Date;
}

class SyncQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private pendingDeploy = false;
  private results: Array<{ folderId: string; status: "ok" | "error"; jobId?: string; error?: string }> = [];

  /**
   * Agrega un sync a la cola. Si la cola no está procesando, arranca.
   */
  enqueue(folderId: string, triggeredBy: "CRON" | "WEBHOOK" | "MANUAL" = "MANUAL") {
    // Evitar duplicados en la cola
    if (this.queue.some((q) => q.folderId === folderId)) {
      console.log(`[QUEUE] ${folderId} ya está en la cola, ignorando`);
      return { queued: false, position: -1, reason: "already_queued" };
    }

    this.queue.push({ folderId, triggeredBy, addedAt: new Date() });
    const position = this.queue.length;
    console.log(`[QUEUE] Agregado ${folderId} (posición ${position}, ${this.queue.length} en cola)`);

    // Iniciar procesamiento si no está corriendo
    if (!this.processing) {
      this.processQueue();
    }

    return { queued: true, position, queueLength: this.queue.length };
  }

  /**
   * Agrega múltiples syncs a la cola (bulk).
   */
  enqueueBulk(items: Array<{ folderId: string; triggeredBy?: "CRON" | "WEBHOOK" | "MANUAL" }>) {
    const added: string[] = [];
    for (const item of items) {
      const result = this.enqueue(item.folderId, item.triggeredBy || "MANUAL");
      if (result.queued) added.push(item.folderId);
    }
    return { added: added.length, total: this.queue.length };
  }

  /**
   * Estado actual de la cola.
   */
  getStatus() {
    return {
      processing: this.processing,
      queueLength: this.queue.length,
      pendingDeploy: this.pendingDeploy,
      queue: this.queue.map((q, i) => ({
        position: i + 1,
        folderId: q.folderId,
        addedAt: q.addedAt.toISOString(),
      })),
      results: this.results.slice(-20), // Últimos 20 resultados
    };
  }

  /**
   * Procesa la cola secuencialmente.
   */
  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    this.results = [];

    console.log(`[QUEUE] Iniciando procesamiento (${this.queue.length} en cola)`);

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      console.log(`[QUEUE] Procesando ${item.folderId} (quedan ${this.queue.length})`);

      try {
        const jobId = await runFullSync(item.folderId, item.triggeredBy);
        this.results.push({ folderId: item.folderId, status: "ok", jobId });
        this.pendingDeploy = true;
        console.log(`[QUEUE] ${item.folderId} completado (job: ${jobId})`);
      } catch (e) {
        const error = e instanceof Error ? e.message : "Error desconocido";
        this.results.push({ folderId: item.folderId, status: "error", error });
        console.error(`[QUEUE] ${item.folderId} falló: ${error}`);
      }
    }

    // Deploy a Vercel una sola vez al final
    if (this.pendingDeploy) {
      await this.deployToVercel();
      this.pendingDeploy = false;
    }

    this.processing = false;
    console.log(`[QUEUE] Cola vacía. ${this.results.length} procesados.`);
  }

  /**
   * Deploy a Vercel (1 sola vez al final de la cola).
   */
  private async deployToVercel() {
    try {
      const { execSync } = await import("child_process");
      const path = await import("path");
      const webDir = path.resolve(process.cwd(), "../propyte-web");

      console.log("[QUEUE] Deploying to Vercel (batch)...");
      execSync(`npx vercel --prod --yes`, {
        cwd: webDir,
        stdio: "pipe",
        timeout: 180000,
      });
      console.log("[QUEUE] Vercel deploy completado");
    } catch (e) {
      console.error("[QUEUE] Vercel deploy falló:", (e as Error).message?.slice(0, 100));
    }
  }
}

// Singleton — una sola instancia global
export const syncQueue = new SyncQueue();
