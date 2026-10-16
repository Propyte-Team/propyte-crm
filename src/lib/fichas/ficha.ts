// Fichas técnicas compartibles (#887) — la parte pura: qué se muestra y de quién es el contacto.
//
// Una sola plantilla para todos los asesores. Lo que cambia de un asesor a otro (nombre, foto,
// WhatsApp…) sale de su perfil al abrir la ficha, no de una plantilla por persona: así un asesor
// nuevo ya la tiene y un cambio de diseño se hace una sola vez.
//
// LO QUE ESTE MÓDULO NO HACE, a propósito:
//   - No copia campos del catálogo "por si acaso". Cada dato de la ficha pública se elige aquí,
//     uno por uno. El detalle del Hub trae la comisión (`commissionRate`), la relación comercial
//     (`crmRelationship`) y el contacto del DESARROLLADOR (`contactName`/`contactPhone`); nada de
//     eso puede llegar a un cliente o a otro broker. Si agregas un dato, agrégalo aquí a mano.
//   - No decide quién es el asesor. Ese es siempre el que creó el enlace (`createdBy` de la ficha),
//     aunque quien la abra sea el reenvío del reenvío.
import { randomBytes } from "crypto";
import { formatCurrency } from "@/lib/constants";
import { formatFinancingMonths } from "@/lib/format-financing";
import { formatPriceRange } from "@/lib/format-price";
import { normalizePhoneE164 } from "@/lib/phone";
import type { PublishedDevelopmentDetail, PublishedUnit } from "@/lib/hub/catalog-types";
import type { TipoFicha } from "./compartir";

export type { TipoFicha };
export { textoParaCompartir, enlaceParaReenviar } from "./compartir";

/** Token público de la ficha (URL /f/[token]). 16 bytes → base64url, igual que las propuestas. */
export function generarTokenFicha(): string {
  return randomBytes(16).toString("base64url");
}

/** Una ficha por asesor y por desarrollo/unidad: compartir lo mismo dos veces da el mismo enlace. */
export function claveFicha(userId: string, developmentId: string, unitId: string | null): string {
  return `${userId}:${developmentId}:${unitId ?? "-"}`;
}

export function rutaFicha(token: string): string {
  return `/f/${token}`;
}

// ───────────────────────────── Asesor ─────────────────────────────

export interface AsesorFuente {
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  profile: {
    jobTitle: string | null;
    photoUrl: string | null;
    phoneDirect: string | null;
    whatsappNumber: string | null;
    emailFromAlias: string | null;
  } | null;
}

export interface ContactoAsesor {
  nombre: string;
  puesto: string | null;
  foto: string | null;
  /** E.164 con "+", para mostrar y para `tel:`. */
  telefono: string | null;
  /** Solo dígitos, para `wa.me/`. */
  whatsapp: string | null;
  correo: string;
}

/**
 * El contacto que va impreso en la ficha. `null` si el asesor ya no está activo: un enlace viejo
 * no debe seguir mandando clientes al teléfono de alguien que ya no trabaja aquí.
 */
export function contactoDelAsesor(a: AsesorFuente): ContactoAsesor | null {
  if (!a.isActive || a.deletedAt) return null;
  const p = a.profile;
  const telefono = normalizePhoneE164(p?.phoneDirect) ?? normalizePhoneE164(a.phone);
  // Sin WhatsApp propio, el teléfono directo casi siempre es el mismo celular.
  const wa = normalizePhoneE164(p?.whatsappNumber) ?? telefono;
  return {
    nombre: a.name,
    puesto: p?.jobTitle?.trim() || null,
    foto: p?.photoUrl || a.avatarUrl || null,
    telefono,
    whatsapp: wa ? wa.replace(/\D/g, "") : null,
    correo: p?.emailFromAlias?.trim() || a.email,
  };
}

/** Lo que le falta al perfil del asesor para que su ficha tenga con qué contactarlo además del correo. */
export function faltantesDelPerfil(c: ContactoAsesor): string[] {
  const faltan: string[] = [];
  if (!c.whatsapp) faltan.push("WhatsApp o teléfono");
  if (!c.puesto) faltan.push("puesto");
  return faltan;
}

// ───────────────────────────── Ficha ─────────────────────────────

export interface DatoFicha {
  etiqueta: string;
  valor: string;
}

/** Todo lo que la ficha pública puede mostrar. Nada más llega al navegador del cliente. */
export interface VistaFicha {
  tipo: TipoFicha;
  /** "Torre Alba" o "Depto 302". */
  titulo: string;
  /** Para la unidad, el desarrollo; para el desarrollo, el desarrollador. */
  subtitulo: string | null;
  ubicacion: string | null;
  /** Precio o rango ya formateado. */
  precio: string | null;
  /** Precio de lista tachado cuando hay descuento activo. */
  precioAntes: string | null;
  etapa: string | null;
  descripcion: string | null;
  fotos: string[];
  datos: DatoFicha[];
  amenidades: string[];
  /** Enlace a la página pública en propyte.com, si existe. */
  enlaceSitio: string | null;
}

const SITIO = "https://propyte.com/es";
const MAX_FOTOS = 8;
const MAX_AMENIDADES = 12;
const MAX_DESCRIPCION = 600;

function ubicacionDe(d: PublishedDevelopmentDetail): string | null {
  // La zona del Hub suele ser más reconocible que la colonia; la colonia solo si no hay zona.
  const partes = [d.zone || d.neighborhood, d.city, d.state].filter((x): x is string => !!x?.trim());
  return partes.length ? [...new Set(partes)].join(", ") : null;
}

function recortar(texto: string | null, max: number): string | null {
  const t = texto?.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return `${corte.slice(0, ultimoEspacio > max * 0.6 ? ultimoEspacio : max).trimEnd()}…`;
}

function fotosUnicas(...listas: (string | null | undefined)[][]): string[] {
  const vistas = new Set<string>();
  for (const lista of listas) {
    for (const f of lista) {
      if (f && /^https:\/\//i.test(f) && !vistas.has(f)) vistas.add(f);
    }
  }
  return [...vistas].slice(0, MAX_FOTOS);
}

function entregaDe(d: PublishedDevelopmentDetail): string | null {
  return d.deliveryText?.trim() || d.estimatedDelivery || null;
}

function financiamientoDe(d: PublishedDevelopmentDetail): string | null {
  const partes = [
    d.financingDownPayment != null ? `${d.financingDownPayment}% de enganche` : null,
    formatFinancingMonths(d.financingMonths),
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

function m2(n: number | null): string | null {
  return n != null && n > 0 ? `${Number.isInteger(n) ? n : n.toFixed(1)} m²` : null;
}

function agregar(datos: DatoFicha[], etiqueta: string, valor: string | number | null | undefined) {
  if (valor == null) return;
  const v = String(valor).trim();
  if (v) datos.push({ etiqueta, valor: v });
}

export function vistaDeDesarrollo(d: PublishedDevelopmentDetail): VistaFicha {
  const datos: DatoFicha[] = [];
  agregar(datos, "Tipo", d.propertyTypes.length ? d.propertyTypes.join(", ") : d.developmentType);
  agregar(datos, "Entrega", entregaDe(d));
  agregar(datos, "Avance de obra", d.constructionProgress != null ? `${d.constructionProgress}%` : null);
  agregar(datos, "Unidades disponibles", d.availableUnits);
  agregar(datos, "Financiamiento", financiamientoDe(d));
  agregar(datos, "Distancia a la playa", d.beachDistance);

  return {
    tipo: "DESARROLLO",
    titulo: d.name,
    subtitulo: d.developerName,
    ubicacion: ubicacionDe(d),
    precio: formatPriceRange(d.priceMinMxn, d.priceMaxMxn),
    precioAntes: null,
    etapa: d.stage,
    descripcion: recortar(d.descriptionShortEs || d.descriptionEs, MAX_DESCRIPCION),
    fotos: fotosUnicas(d.images),
    datos,
    amenidades: d.amenities.slice(0, MAX_AMENIDADES),
    enlaceSitio: d.slug ? `${SITIO}/desarrollos/${d.slug}` : null,
  };
}

function precioUnidad(u: PublishedUnit): { precio: string | null; precioAntes: string | null } {
  if (u.isDiscountActive && u.discountPriceMxn != null) {
    return {
      precio: formatCurrency(u.discountPriceMxn, "MXN"),
      precioAntes: u.priceMxn != null && u.priceMxn !== u.discountPriceMxn ? formatCurrency(u.priceMxn, "MXN") : null,
    };
  }
  if (u.priceMxn != null) return { precio: formatCurrency(u.priceMxn, "MXN"), precioAntes: null };
  if (u.priceUsd != null) return { precio: formatCurrency(u.priceUsd, "USD"), precioAntes: null };
  return { precio: null, precioAntes: null };
}

function financiamientoUnidad(u: PublishedUnit, d: PublishedDevelopmentDetail): string | null {
  const tipos = [u.finDirecto ? "directo" : null, u.finHipotecario ? "hipotecario" : null].filter(Boolean);
  const partes = [
    tipos.length ? `Crédito ${tipos.join(" y ")}` : null,
    u.finEnganchePct != null ? `${u.finEnganchePct}% de enganche` : null,
    formatFinancingMonths(u.finMesesOpciones),
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : financiamientoDe(d);
}

export function vistaDeUnidad(
  u: PublishedUnit,
  d: PublishedDevelopmentDetail,
  fotosUnidad: string[]
): VistaFicha {
  const { precio, precioAntes } = precioUnidad(u);
  const banos =
    u.bathrooms != null
      ? `${u.bathrooms}${u.halfBaths ? ` y ${u.halfBaths} medio${u.halfBaths > 1 ? "s" : ""}` : ""}`
      : null;

  const datos: DatoFicha[] = [];
  // La tipología del Hub casi siempre repite las recámaras («1 recámara»): solo si no hay tipo.
  agregar(datos, "Tipo", u.unitType || u.typology);
  agregar(datos, "Recámaras", u.bedrooms);
  agregar(datos, "Baños", banos);
  agregar(datos, "Construcción", m2(u.builtAreaM2));
  agregar(datos, "Superficie total", u.areaM2 != null && u.areaM2 !== u.builtAreaM2 ? m2(u.areaM2) : null);
  agregar(datos, "Estado", u.status);
  agregar(datos, "Entrega", entregaDe(d));
  agregar(datos, "Financiamiento", financiamientoUnidad(u, d));

  return {
    tipo: "UNIDAD",
    titulo: u.title?.trim() || (u.unitNumber ? `Unidad ${u.unitNumber}` : "Unidad"),
    subtitulo: d.name,
    ubicacion: ubicacionDe(d),
    precio,
    precioAntes,
    etapa: u.isPresale ? "Preventa" : d.stage,
    descripcion: recortar(d.descriptionShortEs || d.descriptionEs, MAX_DESCRIPCION),
    // Primero las de la unidad; las del desarrollo completan la galería (amenidades, fachada).
    fotos: fotosUnicas([u.coverImage], fotosUnidad, d.images),
    datos,
    amenidades: d.amenities.slice(0, MAX_AMENIDADES),
    enlaceSitio: u.slug ? `${SITIO}/propiedades/${u.slug}` : null,
  };
}

// ───────────────────────────── Compartir ─────────────────────────────

/** Mensaje con el que el interesado le escribe al asesor desde la ficha. */
export function enlaceWhatsAppAlAsesor(c: ContactoAsesor, v: Pick<VistaFicha, "titulo" | "subtitulo" | "tipo">): string | null {
  if (!c.whatsapp) return null;
  const nombre = v.tipo === "UNIDAD" && v.subtitulo ? `${v.titulo} de ${v.subtitulo}` : v.titulo;
  const texto = `Hola ${c.nombre.split(" ")[0]}, vi la ficha de ${nombre} y me interesa recibir más información.`;
  return `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(texto)}`;
}

/**
 * Origen público del CRM para armar enlaces absolutos (el que se copia y la imagen de vista previa
 * de WhatsApp, que exige URL absoluta). En producción NEXT_PUBLIC_APP_URL es https://crm.propyte.com.
 */
export function origenPublico(origenDeLaPeticion?: string | null): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || origenDeLaPeticion || "";
  return env.replace(/\/+$/, "");
}

/** El precio grande de la ficha: el de la unidad, o "Desde <mínimo>" para un desarrollo. */
export function precioDestacado(v: Pick<VistaFicha, "tipo" | "precio">): string | null {
  if (!v.precio) return null;
  return v.tipo === "DESARROLLO" ? `Desde ${v.precio.split(" – ")[0]}` : v.precio;
}
