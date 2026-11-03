// ============================================================
// #926 — Reclutamiento: acceso a datos (servidor).
//
// CAMINO PARA LOS CV QUE LLEGAN POR LOS CHATS (conectado por el bot de reclutamiento, spec 2026-11-02):
//   1. Alta: `src/lib/reclutamiento/candidato.ts` (`asegurarCandidato`) llama a
//      `crearCandidato({ fullName, phone, … }, null, { source: "CHAT", sourceRef: <conversationId>,
//      contactId, botCanal })` cuando el contacto aún no está en Reclutamiento.
//   2. CV: `src/lib/reclutamiento/cv.ts` (`ligarCv`), llamado desde `messaging/core.ts` tras guardar un
//      inbound con adjunto PDF/Word, copia el objeto del bucket del chat a
//      `rutaCvCandidato(id, fileName)` en crm-attachments y lo registra con
//      `registrarCvDeCandidato({ …, source: "CHAT", sourceRef: <messageId>, uploadedById: null })`.
//      Es la MISMA función que usa la subida manual, y el índice único (source, sourceRef) hace
//      que reintentar el mismo mensaje no duplique el CV (devuelve { duplicado: true }).
//
// #959 — RECLUTAMIENTO Y CONTACTOS LIGADOS: todo candidato tiene su contacto y todo contacto de tipo
// Empleo tiene su ficha. La mitad «contacto → ficha» la hace un disparador de la base
// (prisma/migrations-manual/2026-11-03-reclutamiento-contactos.sql); la mitad «alta manual →
// contacto» vive aquí, en `crearCandidato`.
// ============================================================
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { setChangeSource, type PrismaTx } from "@/lib/audit/change-context";
import { normalizePhoneE164 } from "@/lib/phone";
import { ETAPA_INICIAL, nombreLimpio, type CandidatoEntrada, type CandidatoFila, type Origen } from "@/lib/reclutamiento/shared";
import {
  CandidatoYaExiste,
  DETALLE_ORIGEN_RECLUTAMIENTO,
  ESTADO_CONTACTO_RECLUTAMIENTO,
  ETIQUETA_CONTACTO_RECLUTAMIENTO,
  elegirContacto,
  partirNombre,
  plazaDelCrm,
  telefonoLlave,
} from "@/lib/reclutamiento/contacto";

/**
 * Columnas de antes del bot. Si la base aún no tiene las del bot (P2022: el código se desplegó
 * antes que el SQL, p. ej. `cvUrl` de 2026-11-03-reclutamiento-bot-v2.sql) se lee con esta y la
 * pantalla sale igual, sin lo del bot.
 */
const SELECT_BASE = {
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
  contactId: true,
  files: {
    where: { kind: "CV", deletedAt: null },
    orderBy: { createdAt: "desc" as const },
    select: { id: true, fileName: true, createdAt: true },
  },
} as const;

const SELECT_CANDIDATO = {
  ...SELECT_BASE,
  sourceRef: true,
  cvUrl: true,
  botCanal: true,
  botResultado: true,
  botPuntaje: true,
  botMotivo: true,
  botResumen: true,
  botRespuestas: true,
  botDesglose: true,
  horarioEntrevista: true,
} as const;

type SelectCandidato = typeof SELECT_CANDIDATO | typeof SELECT_BASE;

const esColumnaFaltante = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2022";

/**
 * Corre la operación con todas las columnas y, si falta alguna del bot (P2022), otra vez con las
 * de base. Seguro también para escrituras: una sola sentencia (o transacción) que falló no dejó nada.
 */
async function conSelect<T>(op: (select: SelectCandidato) => Promise<T>): Promise<T> {
  try {
    return await op(SELECT_CANDIDATO);
  } catch (err) {
    if (!esColumnaFaltante(err)) throw err;
    console.warn("[reclutamiento] faltan columnas del bot en la base; se lee sin ellas");
    return op(SELECT_BASE);
  }
}

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
  contactId?: string | null;
  files: Array<{ id: string; fileName: string; createdAt: Date }>;
  // Del bot: ausentes si la base no tiene sus columnas.
  sourceRef?: string | null;
  cvUrl?: string | null;
  botCanal?: string | null;
  botResultado?: string | null;
  botPuntaje?: number | null;
  botMotivo?: string | null;
  botResumen?: string | null;
  botRespuestas?: unknown;
  botDesglose?: unknown;
  horarioEntrevista?: string | null;
};

/** Json de la base → objeto plano de textos (las respuestas son enums o texto). */
function aRespuestas(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "string" && x.trim()) out[k] = x;
    else if (typeof x === "number" || typeof x === "boolean") out[k] = String(x);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function aObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type ContactoDeFila = NonNullable<CandidatoFila["contacto"]>;

export function aFila(c: FilaDb, contacto: ContactoDeFila | null = null): CandidatoFila {
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
    contacto,
    cvUrl: c.cvUrl ?? null,
    botCanal: c.botCanal ?? null,
    botResultado: c.botResultado ?? null,
    botPuntaje: c.botPuntaje ?? null,
    botMotivo: c.botMotivo ?? null,
    botResumen: c.botResumen ?? null,
    botRespuestas: aRespuestas(c.botRespuestas),
    botDesglose: aObjeto(c.botDesglose),
    horarioEntrevista: c.horarioEntrevista ?? null,
    conversationId: c.source === "CHAT" ? c.sourceRef ?? null : null,
  };
}

/**
 * Filas con su contacto (#959): una sola consulta para todas. Un contacto borrado cuenta como sin
 * contacto (su ficha en Contactos ya no abre). Si la lectura falla, la tabla sale igual, sin la
 * etiqueta: el estado del contacto es un dato de apoyo, no debe tumbar Reclutamiento.
 */
async function conContacto(filas: FilaDb[]): Promise<CandidatoFila[]> {
  const ids = Array.from(new Set(filas.map((f) => f.contactId).filter((x): x is string => !!x)));
  const porId = new Map<string, ContactoDeFila>();
  if (ids.length > 0) {
    try {
      const contactos = await prisma.contact.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, estado: true },
      });
      for (const k of contactos) porId.set(k.id, { id: k.id, estado: k.estado ?? null });
    } catch (err) {
      console.warn("[reclutamiento] no se pudo leer el estado de los contactos:", err);
    }
  }
  return filas.map((f) => aFila(f, (f.contactId && porId.get(f.contactId)) || null));
}

/** Candidatos vigentes, el más reciente primero. */
export async function listarCandidatos(): Promise<CandidatoFila[]> {
  const filas = (await conSelect((select) =>
    prisma.recruitCandidate.findMany({ where: { deletedAt: null }, select, orderBy: { createdAt: "desc" } })
  )) as FilaDb[];
  return conContacto(filas);
}

export async function obtenerCandidato(id: string): Promise<CandidatoFila | null> {
  const c = (await conSelect((select) =>
    prisma.recruitCandidate.findFirst({ where: { id, deletedAt: null }, select })
  )) as FilaDb | null;
  return c ? (await conContacto([c]))[0] : null;
}

/**
 * Contacto para un candidato capturado a mano (#959). Lo busca por correo o por los 10 últimos
 * dígitos del teléfono entre los contactos vivos; si no hay, crea uno tipo Empleo en «Derivado a
 * RH», sin asesor (no entra al embudo de ventas ni dispara flujos: se escribe directo, sin pasar
 * por la API de contactos). Si el contacto encontrado ya tiene ficha viva en Reclutamiento, lanza
 * CandidatoYaExiste: sería la misma persona dos veces.
 */
async function contactoParaCandidato(tx: PrismaTx, datos: CandidatoEntrada): Promise<string> {
  const email = datos.email?.trim().toLowerCase() || null;
  const llave = telefonoLlave(datos.phone);
  const coincide: Prisma.ContactWhereInput[] = [];
  if (email) coincide.push({ email: { equals: email, mode: "insensitive" } });
  if (llave) coincide.push({ phone: { endsWith: llave } });

  if (coincide.length > 0) {
    const candidatos = await tx.contact.findMany({
      where: { deletedAt: null, mergedIntoId: null, OR: coincide },
      select: { id: true, contactType: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    const elegido = elegirContacto(candidatos);
    if (elegido) {
      // Si CUALQUIERA de los contactos que coinciden ya tiene ficha viva, es la misma persona.
      const ficha = await tx.recruitCandidate.findFirst({
        where: { contactId: { in: candidatos.map((k) => k.id) }, deletedAt: null },
        select: { fullName: true },
      });
      if (ficha) throw new CandidatoYaExiste(ficha.fullName);
      // Sin tipo → Empleo. Un tipo que alguien eligió no se cambia: solo se liga.
      if (elegido.contactType === null) {
        await tx.contact.update({ where: { id: elegido.id }, data: { contactType: "EMPLEO" } });
      }
      return elegido.id;
    }
  }

  const { firstName, lastName } = partirNombre(datos.fullName);
  const nuevo = await tx.contact.create({
    data: {
      firstName,
      lastName,
      email: datos.email ?? null,
      phone: normalizePhoneE164(datos.phone) ?? datos.phone ?? "",
      contactType: "EMPLEO",
      leadSource: "OTRO",
      leadSourceDetail: DETALLE_ORIGEN_RECLUTAMIENTO,
      appliedPosition: datos.area ?? null,
      targetPlaza: plazaDelCrm(datos.plaza),
      estado: ESTADO_CONTACTO_RECLUTAMIENTO,
      tags: [ETIQUETA_CONTACTO_RECLUTAMIENTO],
    },
    select: { id: true },
  });
  return nuevo.id;
}

export async function crearCandidato(
  datos: CandidatoEntrada,
  createdById: string | null,
  origen: { source: Origen; sourceRef?: string | null; contactId?: string | null; botCanal?: string | null } = {
    source: "MANUAL",
  }
): Promise<CandidatoFila> {
  // Alta manual (#959): primero su contacto. El disparador de la base ya le crea la ficha al
  // contacto Empleo, así que aquí se hace upsert por contactId: con disparador, se llena esa ficha
  // con lo capturado; sin él (migración sin aplicar), se crea. Todo en una transacción: si algo
  // falla no queda un contacto suelto.
  if (!origen.contactId) {
    const c = await conSelect((select) => prisma.$transaction(async (tx) => {
      await setChangeSource(tx, { source: "reclutamiento_alta", actorId: createdById });
      const contactId = await contactoParaCandidato(tx, datos);
      const campos = {
        fullName: datos.fullName,
        age: datos.age ?? null,
        email: datos.email ?? null,
        phone: datos.phone ?? null,
        area: datos.area ?? null,
        plaza: datos.plaza ?? null,
        portfolioUrl: datos.portfolioUrl ?? null,
        notes: datos.notes ?? null,
        stage: datos.stage ?? ETAPA_INICIAL,
        stageChangedAt: new Date(),
        source: origen.source,
        sourceRef: origen.sourceRef ?? null,
        createdById,
      };
      return (await tx.recruitCandidate.upsert({
        where: { contactId },
        create: { ...campos, contactId },
        // Una ficha que RH había borrado vuelve: la persona se está registrando de nuevo.
        update: { ...campos, deletedAt: null, deletedById: null, stagePrevia: null },
        select,
      })) as FilaDb;
    }));
    // Fuera de la transacción: si leer el estado del contacto fallara dentro, abortaría el alta.
    return (await conContacto([c]))[0];
  }

  const c = (await conSelect((select) => prisma.recruitCandidate.create({
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
      // Solo se mandan cuando vienen: así el alta manual sigue funcionando si el código se
      // despliega antes que el SQL que agrega estas columnas (2026-11-02-reclutamiento-bot.sql).
      ...(origen.contactId ? { contactId: origen.contactId } : {}),
      ...(origen.botCanal ? { botCanal: origen.botCanal } : {}),
      createdById,
    },
    select,
  }))) as FilaDb;
  return (await conContacto([c]))[0];
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
  if (cambios.stage && cambios.stage !== actual.stage) {
    data.stageChangedAt = new Date();
    // #959: quien mueve la etapa a mano decide; el descarte automático ya no se revierte solo.
    data.stagePrevia = null;
  }
  const c = (await conSelect((select) => prisma.recruitCandidate.update({ where: { id }, data, select }))) as FilaDb;
  return (await conContacto([c]))[0];
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
