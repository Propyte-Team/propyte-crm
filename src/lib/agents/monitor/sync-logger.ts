// ============================================================
// Sync Logger — Logging estructurado para el pipeline de sync
// ============================================================

import prisma from "@/lib/db";

type LogLevel = "INFO" | "WARN" | "ERROR";
type LogStep = "CRAWL" | "PARSE" | "MAP" | "UPLOAD" | "ORCHESTRATOR";

export class SyncLogger {
  constructor(private syncJobId: string) {}

  async info(step: LogStep, message: string, data?: Record<string, unknown>) {
    await this.log(step, "INFO", message, data);
  }

  async warn(step: LogStep, message: string, data?: Record<string, unknown>) {
    await this.log(step, "WARN", message, data);
  }

  async error(step: LogStep, message: string, data?: Record<string, unknown>) {
    await this.log(step, "ERROR", message, data);
  }

  private async log(step: LogStep, level: LogLevel, message: string, data?: Record<string, unknown>) {
    const prefix = `[${step}]`;
    const logMessage = `${prefix} ${message}`;

    // Log a consola
    if (level === "ERROR") {
      console.error(logMessage, data || "");
    } else if (level === "WARN") {
      console.warn(logMessage, data || "");
    } else {
      console.log(logMessage, data || "");
    }

    // Persistir en DB
    await prisma.syncLog.create({
      data: {
        syncJobId: this.syncJobId,
        step,
        level,
        message,
        data: data ? (data as any) : undefined,
      },
    });
  }
}
