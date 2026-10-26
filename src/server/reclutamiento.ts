// ============================================================
// #926 — Reclutamiento: acceso a datos (servidor).
//
// CAMINO PARA LOS CV QUE LLEGUEN POR LOS CHATS (futuro; hoy la subida es manual):
//   1. El inbox detecta (o alguien marca) un adjunto PDF/Word de un candidato.
//   2. Si la persona aún no está en Reclutamiento: `crearCandidato({ fullName, phone, … },
//      null, { source: "CHAT", sourceRef: <conversationId> })`.
//   3. Copiar el objeto del bucket del chat a `rutaCvCandidato(id, fileName)` en crm-attachments.
//   4. `registrarCvDeCandidato({ …, source: "CHAT", sourceRef: <messageId>, uploadedById: null })`.
//      Es la MISMA función que usa la subida manual, y el índice único (source, sourceRef) hace
//      que reintentar el mismo mensaje no duplique el CV (devuelve { duplicado: true }).
// ============================================================
import prisma from "@/lib/db";
import { ETAPA_INICIAL, nombreLimpio, type CandidatoEntrada, type CandidatoFila, type Origen } from "@/lib/reclutamiento/shared";

const SELECT_CANDIDATO = {
  id: true,
  fullName: true,
  age: true,
  email: true,
  phone: true,
  area: true,
  plaza: true,
  portfolioUrl: true,
  notes: true,
  stage: true,
  source: true,
  createdAt: true,
  files: {
    where: { kind: "CV", deletedAt: null },
    orderBy: { createdAt: "desc" as const },
    select: { id: true, fileName: true, createdAt: true },
  },
} as const;

type FilaDb = {
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
  createdAt: Date;
  files: Array<{ id: string; fileName: string; createdAt: Date }>;
};

export function aFila(c: FilaDb): CandidatoFila {
  return {
    id: c.id,
    fullName: c.fullName,
    age: c.age,
    email: c.email,
    phone: c.phone,
    area: c.area,
    plaza: c.plaza,
    portfolioUrl: c.portfolioUrl,
    notes: c.notes,
    stage: c.stage,
    source: c.source,
    createdAt: c.createdAt.toISOString(),
    cvs: c.files.map((f) => ({ id: f.id, fileName: f.fileName, createdAt: f.createdAt.toISOString() })),
  };
}

/** Candidatos vigentes, el más reciente primero. */
export async function listarCandidatos(): Promise<CandidatoFila[]> {
  const filas = (await prisma.recruitCandidate.findMany({
    where: { deletedAt: null },
    select: SELECT_CANDIDATO,
    orderBy: { createdAt: "desc" },
  })) as FilaDb[];
  return filas.map(aFila);
}

export async function obtenerCandidato(id: string): Promise<CandidatoFila | null> {
  const c = (await prisma.recruitCandidate.findFirst({
    where: { id, deletedAt: null },
    select: SELECT_CANDIDATO,
  })) as FilaDb | null;
  return c ? aFila(c) : null;
}

export async function crearCandidato(
  datos: CandidatoEntrada,
  createdById: string | null,
  origen: { source: Origen; sourceRef?: string | null } = { source: "MANUAL" }
): Promise<CandidatoFila> {
  const c = (await prisma.recruitCandidate.create({
    data: {
      fullName: datos.fullName,
      age: datos.age ?? null,
      email: datos.email ?? null,
      phone: datos.phone ?? null,
      area: datos.area ?? null,
      plaza: datos.plaza ?? null,
      portfolioUrl: datos.portfolioUrl ?? null,
      notes: datos.notes ?? null,
      stage: datos.stage ?? ETAPA_INICIAL,
      source: origen.source,
      sourceRef: origen.sourceRef ?? null,
      createdById,
    },
    select: SELECT_CANDIDATO,
  })) as FilaDb;
  return aFila(c);
}

/** Corrige campos. null si el candidato no existe o está eliminado. */
export async function editarCandidato(
  id: string,
  cambios: Partial<CandidatoEntrada>
): Promise<CandidatoFila | null> {
  const actual = await prisma.recruitCandidate.findFirst({ where: { id, deletedAt: null }, select: { stage: true } });
  if (!actual) return null;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cambios)) if (v !== undefined) data[k] = v;
  if (cambios.stage && cambios.stage !== actual.stage) data.stageChangedAt = new Date();
  const c = (await prisma.recruitCandidate.update({ where: { id }, data, select: SELECT_CANDIDATO })) as FilaDb;
  return aFila(c);
}

/** Borrado lógico (los datos quedan para auditoría; los CV se marcan borrados también). */
export async function eliminarCandidato(id: string, deletedById: string): Promise<{ storagePaths: string[] } | null> {
  const actual = await prisma.recruitCandidate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, files: { where: { deletedAt: null }, select: { storagePath: true } } },
  });
  if (!actual) return null;
  const ahora = new Date();
  await prisma.$transaction([
    prisma.recruitCandidateFile.updateMany({
      where: { candidateId: id, deletedAt: null },
      data: { deletedAt: ahora, deletedById },
    }),
    prisma.recruitCandidate.update({ where: { id }, data: { deletedAt: ahora, deletedById } }),
  ]);
  return { storagePaths: actual.files.map((f: { storagePath: string }) => f.storagePath) };
}

export type RegistroCv = {
  candidateId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: Origen;
  /** Con CHAT: id del mensaje con el adjunto. Hace idempotente la ingesta automática. */
  sourceRef?: string | null;
  /** null cuando lo registra un proceso automático. */
  uploadedById: string | null;
};

/**
 * Registra un CV ya subido al bucket. Punto de entrada ÚNICO: lo usa la subida manual y lo
 * usará la ingesta desde chats. Quien llama ya validó acceso, tipo y que el objeto exista.
 */
export async function registrarCvDeCandidato(
  r: RegistroCv
): Promise<{ id: string; duplicado: false } | { duplicado: true }> {
  try {
    const fila = await prisma.recruitCandidateFile.create({
      data: {
        candidateId: r.candidateId,
        kind: "CV",
        fileName: nombreLimpio(r.fileName),
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        storagePath: r.storagePath,
        source: r.source,
        sourceRef: r.sourceRef ?? null,
        uploadedById: r.uploadedById,
      },
      select: { id: true },
    });
    return { id: fila.id, duplicado: false };
  } catch (err) {
    // P2002: misma ruta (confirmar dos veces) o mismo mensaje del chat ya registrado.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return { duplicado: true };
    }
    throw err;
  }
}
