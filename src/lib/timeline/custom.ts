// Cambios del campo `custom` (jsonb) en la cronología (#933).
//
// Antes salía un solo renglón «Campos personalizados se actualizó de [object Object] a
// [object Object]»: `valueLabel` hacía String() de un objeto. Medido el 27-oct: de 354 cambios
// de `custom`, ~300 eran la clasificación interna del bot y ~70 datos técnicos (foto de perfil,
// rastro de Meta/Zoho). Decisión de sistemas@: mostrar SOLO los datos de negocio, cada uno en
// su renglón («Inmobiliaria se actualizó de — a Independiente»); lo interno no aparece.
//
// Puro, sin base de datos: lo usa la ruta de la cronología y lo prueban sus pruebas.

/**
 * Claves de `custom` que escribe el propio sistema para funcionar, no datos del contacto.
 * Lista de exclusión (no de inclusión) a propósito: un dato nuevo que capture el bot (un
 * `custom.<algo>` en un playbook) aparece solo, con su nombre legible; lo que hay que acordarse
 * de registrar aquí es una marca interna nueva.
 */
export const CLAVES_CUSTOM_INTERNAS: ReadonlySet<string> = new Set([
  "bot_classification", // clasificador del bot: { type, attempts, at }
  "avatarUrl", // foto de perfil de Instagram/Messenger
  "perfilMetaLeadId", // marca de «perfil copiado del formulario de Meta» (perfil-desde-hub)
  "perfilMetaVia",
  "perfilMetaAt",
  "zoho", // rastro de la migración de Zoho
  "meta_referral", // referral de anuncio de Meta (ya va en atribución)
  "hubUnitId", // estado de unidad sincronizado con el Hub
  "hubUnitStatus",
  "hubUnitStatusAt",
  "hubUnitSnapshot",
]);

export function esClaveInterna(clave: string): boolean {
  return CLAVES_CUSTOM_INTERNAS.has(clave) || clave.startsWith("_");
}

const ETIQUETAS: Record<string, string> = {
  inmobiliaria: "Inmobiliaria",
  broker_aporta: "Qué aporta el broker",
  broker_esquema: "Esquema de colaboración",
  referido_nombre: "Nombre del referido",
  ig_username: "Usuario de Instagram",
  budget_currency: "Moneda del presupuesto",
  presupuesto: "Presupuesto",
  puesto_interes: "Puesto de interés",
  experiencia_inmobiliaria: "Experiencia inmobiliaria",
  urgencia: "Urgencia",
  interes_principal: "Interés principal",
  // #955: lo que captura el Agente Lead Vendedor sobre la propiedad que quiere vender.
  propiedad_venta_tipo: "Propiedad en venta: tipo",
  propiedad_venta_ubicacion: "Propiedad en venta: ubicación",
  propiedad_venta_precio: "Propiedad en venta: precio esperado",
  propiedad_venta_moneda: "Propiedad en venta: moneda",
  propiedad_venta_situacion_legal: "Propiedad en venta: situación legal",
  propiedad_venta_plazo: "Propiedad en venta: plazo para vender",
};

// Valores de los ENUM que captura el bot (segment-playbooks.ts).
const VALORES: Record<string, Record<string, string>> = {
  broker_aporta: { CLIENTE: "Trae un cliente", PROPIEDAD: "Trae una propiedad", AMBOS: "Cliente y propiedad" },
  broker_esquema: {
    COMISION_COMPARTIDA: "Comisión compartida",
    REFERIDO: "Solo refiere",
    REPRESENTACION: "Representación",
    POR_DEFINIR: "Por definir",
  },
  puesto_interes: {
    ASESOR_VENTAS: "Asesor de ventas",
    TEAM_LEADER: "Team leader",
    MARKETING: "Marketing",
    ADMINISTRATIVO: "Administrativo",
    OTRO: "Otro",
  },
  propiedad_venta_tipo: {
    DEPARTAMENTO: "Departamento",
    CASA: "Casa",
    TERRENO: "Terreno",
    MACROLOTE: "Macrolote",
    LOCAL_COMERCIAL: "Local comercial",
    OTRO: "Otro",
  },
  propiedad_venta_moneda: { MXN: "Pesos (MXN)", USD: "Dólares (USD)" },
  propiedad_venta_situacion_legal: {
    ESCRITURADA: "Escriturada",
    CESION_DE_DERECHOS: "Cesión de derechos (preventa)",
    EN_TRAMITE: "Escrituración en trámite",
    OTRO: "Otra / no sabe",
  },
  propiedad_venta_plazo: {
    INMEDIATO: "Lo antes posible",
    UNO_A_TRES_MESES: "De 1 a 3 meses",
    TRES_A_SEIS_MESES: "De 3 a 6 meses",
    SIN_PRISA: "Sin prisa",
  },
  experiencia_inmobiliaria: {
    SIN_EXPERIENCIA: "Sin experiencia",
    MENOS_1_ANO: "Menos de 1 año",
    DE_1_A_3_ANOS: "De 1 a 3 años",
    MAS_DE_3_ANOS: "Más de 3 años",
  },
};

/** «experiencia_inmobiliaria» → «Experiencia inmobiliaria»; «budgetCurrency» → «Budget currency». */
export function etiquetaCustom(clave: string): string {
  if (ETIQUETAS[clave]) return ETIQUETAS[clave];
  const texto = clave
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : clave;
}

const MAX_VALOR = 80;

/** Un valor de `custom` para leer: vacío → «—», sí/no, listas con comas, nunca «[object Object]». */
export function valorCustom(clave: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "string") {
    const texto = VALORES[clave]?.[valor] ?? valor;
    return texto.length > MAX_VALOR ? `${texto.slice(0, MAX_VALOR)}…` : texto;
  }
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) {
    return valor.length ? valor.map((v) => valorCustom(clave, v)).join(", ") : "—";
  }
  const json = JSON.stringify(valor);
  return json.length > MAX_VALOR ? `${json.slice(0, MAX_VALOR)}…` : json;
}

export interface CambioCustom {
  clave: string;
  etiqueta: string;
  antes: string;
  despues: string;
}

function comoObjeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Las claves de negocio que cambiaron entre `antes` y `despues` (los dos jsonb completos que
 * guarda record_field_changes), una por renglón, en orden alfabético de clave para que la salida
 * sea estable. Vacío si solo cambió algo interno: ese cambio no se muestra.
 */
export function cambiosCustomVisibles(antes: unknown, despues: unknown): CambioCustom[] {
  const a = comoObjeto(antes);
  const d = comoObjeto(despues);
  const claves = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort();
  const cambios: CambioCustom[] = [];
  for (const clave of claves) {
    if (esClaveInterna(clave)) continue;
    if (JSON.stringify(a[clave]) === JSON.stringify(d[clave])) continue;
    cambios.push({
      clave,
      etiqueta: etiquetaCustom(clave),
      antes: valorCustom(clave, a[clave]),
      despues: valorCustom(clave, d[clave]),
    });
  }
  return cambios;
}
