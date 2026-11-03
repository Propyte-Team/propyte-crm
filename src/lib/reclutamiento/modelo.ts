// Modelo de criterios del bot de reclutamiento (spec §3). Es DATO, no código: vive en
// SystemConfig bajo `reclutamiento.modelo` y se edita sin deploy (F2 le pone pantalla).
// Inválido o ausente → MODELO_DEFAULT, igual que scoring.modelo.
import { z } from "zod";
import prisma from "@/lib/db";

export const CLAVE_MODELO = "reclutamiento.modelo";
export const CLAVE_FICHA = "reclutamiento.ficha";
export const CLAVE_RESPONSABLES = "reclutamiento.responsables";

/** Claves de respuesta que el playbook captura en custom.reclutamiento_<clave>. */
export const CLAVES_FILTRO = ["mayor_edad", "acepta_comision", "disponibilidad", "colchon_meses", "plaza", "movilidad"] as const;
export const CLAVES_PUNTUABLE = [
  "experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital",
] as const;
export type ClaveFiltro = (typeof CLAVES_FILTRO)[number];
export type ClavePuntuable = (typeof CLAVES_PUNTUABLE)[number];

/** Un filtro eliminatorio: qué valores PASAN y cuáles son AMBIGUOS (ni pasa ni falla claro). */
const filtroSchema = z
  .object({
    activo: z.boolean().default(true),
    pasa: z.array(z.string().min(1)).min(1),
    ambiguo: z.array(z.string()).default([]),
  })
  .refine((f) => !f.pasa.some((v) => f.ambiguo.includes(v)), {
    message: "un valor no puede estar en `pasa` y en `ambiguo` a la vez",
    path: ["ambiguo"],
  });

/** Un puntuable: puntos por valor de la opción. */
const puntuableSchema = z.object({
  puntos: z.record(z.string(), z.number().min(0)),
});

/** Umbrales del score: REVISAR debe quedar por debajo de APTO para que las bandas no se crucen. */
const umbralesSchema = z
  .object({ apto: z.number().min(0).max(100), revisar: z.number().min(0).max(100) })
  .refine((u) => u.revisar < u.apto, { message: "`revisar` debe ser menor que `apto`", path: ["revisar"] });

export const modeloSchema = z
  .object({
    version: z.number().int().positive(),
    filtros: z.record(z.enum(CLAVES_FILTRO), filtroSchema),
    puntuables: z.record(z.enum(CLAVES_PUNTUABLE), puntuableSchema),
    /** Puntos máximos de la rúbrica de actitud (3 preguntas situacionales). */
    actitudMax: z.number().min(0),
    /** Puntos por haber mandado CV. */
    cvPuntos: z.number().min(0),
    umbrales: umbralesSchema,
  })
  .strict();
export type ModeloReclutamiento = z.infer<typeof modeloSchema>;

export const MODELO_DEFAULT: ModeloReclutamiento = {
  version: 1,
  filtros: {
    mayor_edad:      { activo: true, pasa: ["SI"], ambiguo: [] },
    acepta_comision: { activo: true, pasa: ["SI"], ambiguo: ["NO_SE"] },
    disponibilidad:  { activo: true, pasa: ["TIEMPO_COMPLETO", "MEDIO_TIEMPO"], ambiguo: ["NO_SE"] },
    colchon_meses:   { activo: true, pasa: ["TRES_A_SEIS", "MAS_DE_SEIS", "OTRO_INGRESO"], ambiguo: ["NO_SE"] },
    plaza:           { activo: true, pasa: ["PDC", "MERIDA", "OTRA_CON_MUDANZA"], ambiguo: [] },
    movilidad:       { activo: true, pasa: ["SI"], ambiguo: ["SOLO_DISPOSICION"] },
  },
  puntuables: {
    experiencia_inmobiliaria: { puntos: { SIN_EXPERIENCIA: 0, MENOS_1_ANO: 10, DE_1_A_3_ANOS: 18, MAS_DE_3_ANOS: 25 } },
    cartera_clientes:         { puntos: { NO: 0, MENOS_10: 8, DE_10_A_50: 14, MAS_50_O_INVERSIONISTAS: 20 } },
    experiencia_ventas:       { puntos: { NINGUNA: 0, OTRO_GIRO: 8, CONSULTIVA_ALTO_VALOR: 15 } },
    ingles:                   { puntos: { NO: 0, BASICO: 4, CONVERSACIONAL: 10 } },
    prospeccion_digital:      { puntos: { NO: 0, SI: 5 } },
  },
  actitudMax: 20,
  cvPuntos: 5,
  umbrales: { apto: 65, revisar: 40 },
};

export function resolverModelo(valor: unknown): { modelo: ModeloReclutamiento; error?: string } {
  if (valor === undefined || valor === null) return { modelo: MODELO_DEFAULT };
  const r = modeloSchema.safeParse(valor);
  if (r.success) return { modelo: r.data };
  return { modelo: MODELO_DEFAULT, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

// Texto oficial (2026-11-03). Oficinas y desarrollos del Hub se le suman en `ficha.ts` (construirFicha).
export const FICHA_DEFAULT =
  "Propyte es una comercializadora inmobiliaria con producto en Tulum, Playa del Carmen, Cancún, Mérida y Telchac. " +
  "Buscamos asesores inmobiliarios para Playa del Carmen y Mérida. Esquema 100 % comisión (sin sueldo base), " +
  "comisiones competitivas por venta, capacitación continua, inventario propio y de co-broker, y acompañamiento del equipo. " +
  "Necesitas vehículo propio y disponibilidad para moverte por la zona. El proceso: una charla aquí, tu CV y una entrevista con el Gerente de Ventas.";

/** Ids de usuario responsables por plaza; `default` aplica cuando la plaza no tiene lista propia. */
export const responsablesSchema = z
  .object({
    PDC: z.array(z.string()).optional(),
    MERIDA: z.array(z.string()).optional(),
    default: z.array(z.string()).optional(),
  })
  .strict();
export type ResponsablesReclutamiento = z.infer<typeof responsablesSchema>;

/** Inválido o ausente → {} (sin responsables), igual que el modelo cae al default. */
export function resolverResponsables(valor: unknown): ResponsablesReclutamiento {
  const r = responsablesSchema.safeParse(valor);
  return r.success ? r.data : {};
}

export async function cargarConfigReclutamiento(): Promise<{
  modelo: ModeloReclutamiento;
  ficha: string;
  responsables: ResponsablesReclutamiento;
  errorModelo?: string;
}> {
  const filas = await prisma.systemConfig.findMany({
    where: { key: { in: [CLAVE_MODELO, CLAVE_FICHA, CLAVE_RESPONSABLES] } },
  });
  const valor = (k: string) => filas.find((f) => f.key === k)?.value;
  const { modelo, error } = resolverModelo(valor(CLAVE_MODELO));
  const fichaGuardada = valor(CLAVE_FICHA);
  const ficha = typeof fichaGuardada === "string" && fichaGuardada.trim() ? fichaGuardada : FICHA_DEFAULT;
  const responsables = resolverResponsables(valor(CLAVE_RESPONSABLES));
  return { modelo, ficha, responsables, ...(error ? { errorModelo: error } : {}) };
}
