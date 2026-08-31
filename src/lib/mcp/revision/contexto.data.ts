/**
 * Estado declarado del proyecto: lo que se ve como problema y NO lo es.
 *
 * POR QUÉ EXISTE. Un revisor automático mide el sistema, no la intención. Ve ocho reglas
 * de automatización con cero activas y reporta un fallo — y tiene razón en la medición y
 * está equivocado en la conclusión, porque están pausadas a propósito mientras el CRM
 * está en BETA. Sin este archivo lo propondría todos los días, y el `dedupe_hash` del
 * tablero no lo frena: pega en hallazgos idénticos, y cada día lo redacta distinto.
 *
 * 🚨 `caduca_cuando` ES OBLIGATORIO, y es lo que separa esto de una venda en los ojos.
 * Un hecho declarado sin fecha de caducidad se vuelve ceguera permanente: el día que el
 * CRM salga de BETA, «las automatizaciones están pausadas» pasa de ser una decisión a ser
 * el bug más caro del sistema, y nadie lo volvería a mirar.
 *
 * Cómo se mantiene: cuando una condición de `caduca_cuando` se cumple, se BORRA la
 * entrada. No se edita para que siga tapando.
 */

export type HechoDeclarado = {
  id: string;
  /** Qué se va a medir y va a verse mal. */
  que: string;
  /** Por qué está así, en palabras de quien lo decidió. */
  por_que: string;
  /** Qué NO debe registrarse como hallazgo mientras esto siga vigente. */
  no_reportar: string;
  /** 🚨 Cuándo deja de valer. Sin esto, la entrada no entra. */
  caduca_cuando: string;
  /** Quién lo declaró y cuándo. Un hecho sin dueño no se puede confirmar después. */
  declarado: string;
};

export const FASE_DEL_PROYECTO = {
  fase: "beta",
  /**
   * Consecuencia general para el revisor: en BETA, un módulo apagado o un volumen bajo
   * suelen ser el plan, no el síntoma. Lo que sí sigue siendo un hallazgo válido es que
   * algo ENCENDIDO se rompa.
   */
  implicacion:
    "El CRM está en BETA. Un módulo apagado o un volumen bajo suele ser deliberado. " +
    "Lo que sigue siendo un hallazgo legítimo es que algo que SÍ está encendido falle, " +
    "que se pierdan datos, o que un número que el equipo usa para decidir esté mal calculado.",
} as const;

export const HECHOS_DECLARADOS: HechoDeclarado[] = [
  {
    id: "automatizaciones-pausadas-por-beta",
    que: "`crm_pulso` reporta 0 automatizaciones activas de 8 configuradas.",
    por_que:
      "Están pausadas a propósito: el CRM está en BETA y los leads que entran son reales. " +
      "Disparar cadencias automáticas sobre gente real desde un sistema en pruebas haría " +
      "daño de verdad, y el daño no se puede deshacer.",
    no_reportar:
      "No propongas activar las automatizaciones ni lo reportes como regla dormida. " +
      "Sí es válido reportar que una regla ACTIVA falle, o que la cola de acciones acumule agotadas.",
    caduca_cuando: "El CRM salga de BETA. Ese día esto pasa de decisión a hallazgo urgente.",
    declarado: "Luis, 2026-08-31",
  },
  {
    id: "leads-de-ig-y-messenger-traen-spam",
    que:
      "El conteo crudo de leads por INSTAGRAM y MESSENGER está inflado: no todos son " +
      "personas interesadas, hay bastante spam.",
    por_que:
      "Los canales sociales reciben spam y comentarios que generan contacto sin que nadie " +
      "haya levantado la mano. El CRM ya tiene una definición propia de lead real " +
      "(`realLeadWhere` en `src/lib/leads/real-leads.ts`) que descuenta a los contactos " +
      "nacidos de un comentario que nunca contestaron, y es la que usan el tablero, las " +
      "metas, los reportes y Vista Hoy.",
    no_reportar:
      "No uses `leads.nuevos_*` (crudo) como evidencia de volumen ni de calidad de campaña: " +
      "usa `leads.reales_*`, que aplica el mismo filtro que los reportes del CRM. La brecha " +
      "entre los dos es esperada, no un hallazgo.",
    caduca_cuando:
      "El filtro de lead real cubra también el spam de DM (hoy solo descuenta los " +
      "provisionales nacidos de comentario, que es una clase distinta). Mientras no lo cubra, " +
      "incluso `reales_*` sobrecuenta.",
    declarado: "Luis, 2026-08-31",
  },
];
