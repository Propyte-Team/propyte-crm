// Fichas técnicas compartibles (#887) — servidor: crear el enlace del asesor y armar la ficha
// pública al abrirla.
//
// El enlace es la atribución. Quien lo reenvía reenvía el mismo /f/{token}, así que el contacto
// impreso es siempre el del asesor que lo creó. Lo que este módulo NO intenta: impedir que
// alguien haga captura de pantalla y la mande sin enlace, ni identificar quién reenvió a quién.
// Las aperturas son un conteo grueso (excluye al propio asesor y a los robots de vista previa
// conocidos), no una bitácora por persona.
import prisma from "@/lib/db";
import {
  getPublishedDevelopment,
  getPublishedUnit,
  getPublishedUnitImages,
} from "@/lib/hub/catalog";
import {
  claveFicha,
  contactoDelAsesor,
  faltantesDelPerfil,
  generarTokenFicha,
  vistaDeDesarrollo,
  vistaDeUnidad,
  type ContactoAsesor,
  type VistaFicha,
} from "@/lib/fichas/ficha";

const SELECT_ASESOR = {
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  isActive: true,
  deletedAt: true,
  profile: {
    select: {
      jobTitle: true,
      photoUrl: true,
      phoneDirect: true,
      whatsappNumber: true,
      emailFromAlias: true,
    },
  },
} as const;

function codigoPrisma(err: unknown): string | null {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : null;
}

// ───────────────────────────── Crear (asesor con sesión) ─────────────────────────────

export type ErrorCrearFicha =
  | "catalogo" // la consulta al Hub falló: no es lo mismo que "no existe"
  | "desarrollo_no_publicado"
  | "unidad_no_publicada"
  | "unidad_de_otro_desarrollo"
  | "sin_migracion"; // la tabla aún no existe en la base

export type ResultadoCrearFicha =
  | {
      ok: true;
      token: string;
      vista: VistaFicha;
      contacto: ContactoAsesor | null;
      faltantes: string[];
      aperturas: number;
      ultimaApertura: Date | null;
    }
  | { ok: false; error: ErrorCrearFicha };

export async function obtenerOCrearFicha(input: {
  userId: string;
  developmentId: string;
  unitId?: string | null;
}): Promise<ResultadoCrearFicha> {
  const dev = await getPublishedDevelopment(input.developmentId);
  if (dev.error) return { ok: false, error: "catalogo" };
  if (!dev.data) return { ok: false, error: "desarrollo_no_publicado" };
  const d = dev.data;

  let vista: VistaFicha;
  let unitId: string | null = null;
  if (input.unitId) {
    const [unidad, fotos] = await Promise.all([
      getPublishedUnit(input.unitId),
      getPublishedUnitImages(input.unitId),
    ]);
    if (unidad.error) return { ok: false, error: "catalogo" };
    if (!unidad.data) return { ok: false, error: "unidad_no_publicada" };
    // Sin esto, una ficha podría pegar la unidad de un desarrollo con las fotos y amenidades de otro.
    if (unidad.data.developmentId !== d.id) return { ok: false, error: "unidad_de_otro_desarrollo" };
    unitId = unidad.data.id;
    vista = vistaDeUnidad(unidad.data, d, fotos.data);
  } else {
    vista = vistaDeDesarrollo(d);
  }

  // Siempre el id canónico, aunque haya llegado el slug: la clave tiene que ser una sola.
  const clave = claveFicha(input.userId, d.id, unitId);

  let ficha: { token: string; aperturas: number; ultimaApertura: Date | null };
  try {
    ficha = await prisma.fichaCompartida.upsert({
      where: { clave },
      update: {},
      create: {
        token: generarTokenFicha(),
        clave,
        tipo: unitId ? "UNIDAD" : "DESARROLLO",
        hubDevelopmentId: d.id,
        hubUnitId: unitId,
        createdById: input.userId,
      },
      select: { token: true, aperturas: true, ultimaApertura: true },
    });
  } catch (err) {
    const code = codigoPrisma(err);
    if (code === "P2021") return { ok: false, error: "sin_migracion" };
    // Dos clics casi simultáneos: el segundo upsert choca con la clave que el primero acaba de
    // crear. La fila ya existe y es la buena.
    if (code !== "P2002") throw err;
    const existente = await prisma.fichaCompartida.findUnique({
      where: { clave },
      select: { token: true, aperturas: true, ultimaApertura: true },
    });
    if (!existente) throw err;
    ficha = existente;
  }

  const asesor = await prisma.user.findUnique({ where: { id: input.userId }, select: SELECT_ASESOR });
  const contacto = asesor ? contactoDelAsesor(asesor) : null;

  return {
    ok: true,
    token: ficha.token,
    vista,
    contacto,
    faltantes: contacto ? faltantesDelPerfil(contacto) : [],
    aperturas: ficha.aperturas,
    ultimaApertura: ficha.ultimaApertura,
  };
}

// ───────────────────────────── Abrir (público, sin sesión) ─────────────────────────────

export interface FichaPublica {
  id: string;
  createdById: string;
  /** null = el asesor ya no está activo: la ficha se muestra sin sus datos. */
  contacto: ContactoAsesor | null;
  /** null = el desarrollo o la unidad ya no están publicados. */
  vista: VistaFicha | null;
}

/**
 * `null` solo cuando el token no existe. Si la consulta al Hub falla, LANZA: la frontera de error
 * de /f ofrece reintentar, en vez de decirle al cliente que la ficha no existe (#716).
 */
export async function cargarFichaPublica(token: string): Promise<FichaPublica | null> {
  const ficha = await prisma.fichaCompartida.findUnique({
    where: { token },
    select: {
      id: true,
      tipo: true,
      hubDevelopmentId: true,
      hubUnitId: true,
      createdById: true,
      createdBy: { select: SELECT_ASESOR },
    },
  });
  if (!ficha) return null;

  const contacto = contactoDelAsesor(ficha.createdBy);
  const base = { id: ficha.id, createdById: ficha.createdById, contacto };

  const dev = await getPublishedDevelopment(ficha.hubDevelopmentId);
  if (dev.error) throw new Error(dev.error);
  if (!dev.data) return { ...base, vista: null };

  if (ficha.tipo === "UNIDAD" && ficha.hubUnitId) {
    const [unidad, fotos] = await Promise.all([
      getPublishedUnit(ficha.hubUnitId),
      getPublishedUnitImages(ficha.hubUnitId),
    ]);
    if (unidad.error) throw new Error(unidad.error);
    if (!unidad.data || unidad.data.developmentId !== dev.data.id) return { ...base, vista: null };
    return { ...base, vista: vistaDeUnidad(unidad.data, dev.data, fotos.data) };
  }

  return { ...base, vista: vistaDeDesarrollo(dev.data) };
}

/** Robots que abren el enlace para armar la vista previa (WhatsApp, Facebook, Telegram…). */
const ROBOTS_VISTA_PREVIA = /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|googlebot|bingbot|skypeuripreview|bot\b|crawler|spider/i;

export function esAperturaDePersona(userAgent: string | null | undefined): boolean {
  return !!userAgent && !ROBOTS_VISTA_PREVIA.test(userAgent);
}

export async function registrarApertura(fichaId: string): Promise<void> {
  await prisma.fichaCompartida.update({
    where: { id: fichaId },
    data: { aperturas: { increment: 1 }, ultimaApertura: new Date() },
  });
}
