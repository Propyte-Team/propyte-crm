// Dispatcher de webhooks salientes (CRM → Zapier/otros)
// Fire-and-forget: no bloquea la operación principal
import { prisma } from "@/lib/db";
import { createHmac } from "crypto";
import {
  construirCuerpoPrueba,
  describirFalloRed,
  describirRespuesta,
  firmarCuerpo,
  type ResultadoPrueba,
} from "./prueba";

/**
 * Despacha un webhook a todos los endpoints configurados para el evento.
 * Firma el payload con HMAC-SHA256 usando el secret del webhook.
 */
export async function dispatchWebhook(
  event: string,
  payload: Record<string, unknown>
) {
  try {
    const configs = await prisma.webhookConfig.findMany({
      where: { event, isActive: true },
    });

    if (configs.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    // Fire-and-forget — enviar a todos los endpoints en paralelo
    await Promise.allSettled(
      configs.map(async (config) => {
        const signature = createHmac("sha256", config.secret)
          .update(body)
          .digest("hex");

        try {
          await fetch(config.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Signature": signature,
              "X-Webhook-Event": event,
            },
            body,
            signal: AbortSignal.timeout(10000), // 10s timeout
          });
        } catch (err) {
          console.error(`Webhook fallo para ${config.url}:`, err);
        }
      })
    );
  } catch (err) {
    // No propagar errores de webhooks — son fire-and-forget
    console.error("Error despachando webhooks:", err);
  }
}

/**
 * Envía un evento de ejemplo (marcado `test: true`) firmado con el secret del webhook
 * y devuelve el resultado. No registra nada; el destino decide qué hacer con él.
 */
export async function enviarWebhookPrueba(config: {
  url: string;
  event: string;
  secret: string;
}): Promise<ResultadoPrueba> {
  const body = construirCuerpoPrueba(config.event);
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": firmarCuerpo(body, config.secret),
        "X-Webhook-Event": config.event,
        "X-Webhook-Test": "true",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return describirRespuesta(res.status);
  } catch (err) {
    return describirFalloRed(err);
  }
}
