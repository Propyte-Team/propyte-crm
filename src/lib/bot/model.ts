// ============================================================
// Qué modelo de Claude usa el bot — UNA sola resolución
// ============================================================
//
// Auditoría 2026-09-10. Antes había tres resoluciones distintas de la misma pregunta:
//
//   lib/bot/claude.ts     process.env.BOT_MODEL?.trim() || "claude-sonnet-5"
//   lib/bot/config.ts     process.env.BOT_MODEL?.trim() || "claude-sonnet-5"
//   lib/agents/runner.ts  process.env.BOT_MODEL ?? "claude-sonnet-4-6"     ← el raro
//
// La tercera tenía tres defectos, y ninguno se nota hasta que pasa:
//
//  1. `??` en vez de `||`. La cadena vacía NO es nullish, así que un `BOT_MODEL=` en el
//     entorno —una variable declarada y sin valor, que es lo que queda cuando alguien la
//     comenta a medias— se propagaba como `model: ""` y la API devolvía 400 en CADA
//     corrida de agente. Los otros dos sitios ya usaban `||` y no tenían el problema.
//
//  2. Sin `.trim()`. Un `\n` pegado al final del valor da un modelo que no existe. Está
//     anotado como el error de configuración más común de este repositorio en
//     lib/crypto/secretos.ts, donde costó lo mismo arreglarlo.
//
//  3. Default desalineado. `claude-sonnet-4-6` es la generación anterior y además cuesta
//     más ($3/$15 por millón de tokens frente a $2/$10 de Sonnet 5), así que la ruta que
//     se quedó atrás era la más cara de las tres. El default vivo es `claude-sonnet-5`.
//
// Y las tres leían la variable en crudo, sin pasar por el allowlist que la configuración
// del bot SÍ aplica: por la UI no se podía elegir un modelo fuera de la lista, pero por
// la variable de entorno sí. Ahora la lista vive aquí y la resolución la respeta.

/**
 * Modelos que este CRM admite para el bot y los agentes.
 *
 * Vive aquí y no en `server/bot-config.schema.ts` (que es quien la usaba) porque también
 * la necesitan `lib/bot/*` y `lib/agents/*`, y `lib/` no importa de `server/` en ningún
 * otro sitio del repositorio. El esquema de validación la importa de aquí.
 */
export const ALLOWED_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

export type AllowedModel = (typeof ALLOWED_MODELS)[number];

/** El default cuando no hay nada configurado. Generación vigente y la más barata de la lista. */
export const DEFAULT_BOT_MODEL: AllowedModel = "claude-sonnet-5";

export function esModeloPermitido(valor: string): valor is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(valor);
}

/**
 * El modelo a usar, en este orden: el que pida quien llama → `BOT_MODEL` → el default.
 *
 * Un valor que no esté en el allowlist se DESCARTA con un aviso y se sigue con el
 * default, en vez de mandarlo a la API para que devuelva un 400. La dirección del fallo
 * importa: el bot contesta a clientes reales, así que un modelo mal escrito en el entorno
 * debe degradar a uno que funciona y dejar rastro, no tumbar la respuesta.
 */
export function resolveBotModel(preferido?: string | null): AllowedModel {
  const candidatos = [preferido, process.env.BOT_MODEL];

  for (const crudo of candidatos) {
    const valor = crudo?.trim();
    if (!valor) continue; // ausente, vacío, o sólo espacios → siguiente
    if (esModeloPermitido(valor)) return valor;
    console.warn(
      `[bot/model] "${valor}" no está en la lista de modelos admitidos ` +
        `(${ALLOWED_MODELS.join(", ")}); se usa ${DEFAULT_BOT_MODEL}.`,
    );
  }

  return DEFAULT_BOT_MODEL;
}
