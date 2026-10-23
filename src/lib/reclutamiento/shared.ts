// #926 — Reclutamiento: reglas compartidas entre servidor y pantalla. Módulo PURO (sin Prisma,
// sin sesión, sin React) para probarlo en node e importarlo desde el cliente.
import { z } from "zod";
import { extension } from "@/lib/contacts/archivos";
import { hrefSitio } from "@/lib/developer-partners/shared";

export { CELDA_VACIA, celda, hrefSitio } from "@/lib/developer-partners/shared";

// --------------- etapas ---------------
// Las mismas de la base de Notion «Candidatos · Marketing», en su orden. El `code` es lo que se
// guarda: cambiar una etiqueta (p. ej. «Entrevista Luis») no toca los datos.

export const ETAPAS = [
  { code: "RECIBIDO", label: "1 · Recibido", color: "#6B7280" },
  { code: "FILTRO_CV", label: "2 · Filtro CV", color: "#8B6B4A" },
  { code: "CONTACTO_INICIAL", label: "3 · Contacto inicial", color: "#B45309" },
  { code: "ENTREVISTA", label: "4 · Entrevista Luis", color: "#A16207" },
  { code: "PRUEBA_TECNICA", label: "5 · Prueba técnica", color: "#2563EB" },
  { code: "ENTREVISTA_DIRECCION", label: "6 · Entrevista Dirección/RH", color: "#7C3AED" },
  { code: "OFERTA", label: "7 · Oferta", color: "#A21CAF" },
  { code: "CONTRATADO", label: "8 · Contratado", color: "#15803D" },
  { code: "DESCARTADO", label: "X · Descartado", color: "#DC2626" },
  { code: "BANCO_TALENTO", label: "P · Banco de talento", color: "#475569" },
] as const;

export type EtapaCode = (typeof ETAPAS)[number]["code"];
export const ETAPA_INICIAL: EtapaCode = "RECIBIDO";
const CODIGOS_ETAPA = ETAPAS.map((e) => e.code) as [EtapaCode, ...EtapaCode[]];

/** Etapas que cierran el proceso (no cuentan como «en proceso»). */
export const ETAPAS_CERRADAS: readonly EtapaCode[] = ["CONTRATADO", "DESCARTADO", "BANCO_TALENTO"];

export function etapa(code: string | null | undefined) {
  return ETAPAS.find((e) => e.code === code) ?? null;
}

// --------------- ubicación y área ---------------

/** Ubicación = plaza del CRM (enum Plaza), en el orden en que la pidió sistemas@. */
export const UBICACIONES = [
  { code: "TULUM", label: "Tulum" },
  { code: "PDC", label: "Playa del Carmen" },
  { code: "MERIDA", label: "Mérida" },
] as const;
export type UbicacionCode = (typeof UBICACIONES)[number]["code"];

export function ubicacionLabel(code: string | null | undefined): string | null {
  return UBICACIONES.find((u) => u.code === code)?.label ?? null;
}

/** Sugerencias del campo Área/Puesto. Es texto libre: se puede escribir cualquier otro. */
export const AREAS_SUGERIDAS = ["Marketing", "Asesor / Ventas", "Sistemas", "Administración", "Recepción / Hostess"] as const;

// --------------- origen (camino para los CV que lleguen por chat) ---------------

/** MANUAL = capturado en la pantalla. CHAT = llegó por el inbox (aún no conectado). */
export const ORIGENES = ["MANUAL", "CHAT"] as const;
export type Origen = (typeof ORIGENES)[number];

// --------------- validación ---------------

/** Cadena opcional: recorta, y vacía → null (así la celda muestra «-» y no un hueco). */
const opcional = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v?.trim() ?? "";
      return t === "" ? null : t;
    })
    .refine((v) => v == null || v.length <= max, `Máximo ${max} caracteres`);

/** Edad: acepta número o texto del formulario; vacío → null. */
const edad = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = String(v).trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 14 || n > 99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La edad debe ser un número entre 14 y 99" });
      return z.NEVER;
    }
    return n;
  });

const campos = {
  fullName: z
    .string({ required_error: "El nombre completo es obligatorio" })
    .trim()
    .min(1, "El nombre completo es obligatorio")
    .max(200, "Máximo 200 caracteres"),
  age: edad,
  email: opcional(254).refine((v) => v == null || z.string().email().safeParse(v).success, "Correo no válido"),
  phone: opcional(40),
  area: opcional(120),
  plaza: z
    .union([z.enum(["TULUM", "PDC", "MERIDA"]), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  portfolioUrl: opcional(500).refine((v) => v == null || hrefSitio(v) !== null, "Portafolio: enlace no válido"),
  notes: opcional(5000),
  stage: z.enum(CODIGOS_ETAPA, { errorMap: () => ({ message: "Etapa no válida" }) }).optional(),
};

export const candidatoCrearSchema = z.object(campos).strict();

export const candidatoEditarSchema = z
  .object({ ...campos, fullName: campos.fullName.optional() })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), "No hay cambios");

export type CandidatoEntrada = z.infer<typeof candidatoCrearSchema>;

// --------------- forma de la fila ---------------

export type CvResumen = { id: string; fileName: string; createdAt: string };

export type CandidatoFila = {
  id: string;
  fullName: string;
  age: number | null;
  email: string | null;
  phone: string | null;
  area: string | null;
  plaza: string | null;
  portfolioUrl: string | null;
  notes: string | null;
  stage: string;
  source: string;
  createdAt: string;
  /** CV vigentes, el más nuevo primero. */
  cvs: CvResumen[];
};

/** Filtro de la tabla: texto libre (nombre, correo, teléfono, área), etapa y ubicación. */
export function filtrarCandidatos(
  filas: CandidatoFila[],
  f: { texto?: string; etapa?: string; ubicacion?: string }
): CandidatoFila[] {
  const q = normalizar(f.texto ?? "");
  return filas.filter((c) => {
    if (f.etapa && c.stage !== f.etapa) return false;
    if (f.ubicacion && c.plaza !== f.ubicacion) return false;
    if (!q) return true;
    return [c.fullName, c.email, c.phone, c.area].some((v) => v && normalizar(v).includes(q));
  });
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// --------------- CV ---------------
// Mismas reglas de archivo que el CV de contactos (#917): PDF, DOC, DOCX hasta 10 MB.
export { CV_ACCEPT, CV_MAX_BYTES, motivoRechazo, nombreLimpio, tamanoLegible } from "@/lib/contacts/archivos";

/** Ruta en el bucket. El nombre original NO va en la ruta (acentos, espacios, datos personales). */
export function rutaCvCandidato(candidateId: string, fileName: string): string {
  return `candidates/${candidateId}/cv/${globalThis.crypto.randomUUID()}.${extension(fileName)}`;
}

/** La confirmación solo acepta rutas generadas para ESTE candidato. */
export function rutaEsDelCandidato(path: string, candidateId: string): boolean {
  const id = candidateId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^candidates/${id}/cv/[0-9a-f-]{36}\\.(pdf|docx?)$`).test(path);
}

/** P2021 = la tabla no existe (código desplegado antes que la migración). */
export function esTablaFaltante(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

export const SIN_MIGRACION = "Falta aplicar la migración de Reclutamiento. Avisa a sistemas.";
