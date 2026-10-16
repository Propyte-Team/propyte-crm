// Fichas técnicas (#887) — piezas de servidor para dibujar la ficha como imagen.
//
// El dibujo (next/og → satori) solo entiende PNG y JPEG, y 1,600 de las ~2,100 fotos del Hub son
// WebP. Por eso cada foto se baja, se recorta al tamaño del hueco y se convierte a JPEG con sharp
// ANTES de dibujar. Una foto que no baja o no se puede convertir se omite: la ficha sale con
// menos fotos, no con un error.
//
// LÍMITE: sharp nunca se había usado en producción antes de esto. Si no carga en el servidor,
// las fotos WebP se omiten (el flyer sale con el recuadro gris) y la imagen se sirve en PNG.
// El log «[fichas/imagen] sharp no cargó» es la señal.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import QRCode from "qrcode";

const TIMEOUT_MS = 6000;
const MAX_BYTES = 12 * 1024 * 1024;

// `default` existe tanto en sharp 0.34 (`export =`, el que resuelve pnpm-lock en el servidor) como
// en 0.35 (ESM, el de package-lock): así el tipo vale para los dos.
type Sharp = (typeof import("sharp"))["default"];
let sharpCargado: Promise<Sharp | null> | null = null;

/** sharp es nativo: si en algún servidor no carga, la imagen se sirve en PNG sin recomprimir. */
export function cargarSharp(): Promise<Sharp | null> {
  sharpCargado ??= import("sharp")
    .then((m) => (m as { default?: Sharp }).default ?? (m as unknown as Sharp))
    .catch((err) => {
      console.error("[fichas/imagen] sharp no cargó", err);
      return null;
    });
  return sharpCargado;
}

/** Solo fotos servidas por https: la URL viene del Hub, pero el servidor no debe ir a cualquier lado. */
export function urlDeFotoPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Lo que satori sabe dibujar tal cual, sin pasar por sharp. */
function tipoNativo(original: Buffer): "image/jpeg" | "image/png" | null {
  if (original[0] === 0xff && original[1] === 0xd8) return "image/jpeg";
  if (original.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

export async function fotoComoDataUri(url: string, ancho: number, alto: number): Promise<string | null> {
  if (!urlDeFotoPermitida(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const largo = Number(res.headers.get("content-length") ?? 0);
    if (largo > MAX_BYTES) return null;
    const original = Buffer.from(await res.arrayBuffer());
    if (original.byteLength > MAX_BYTES) return null;

    const sharp = await cargarSharp();
    if (!sharp) {
      // Sin sharp, las JPEG/PNG (unas 500 del Hub) todavía se pueden dibujar tal cual; las WebP no.
      const tipo = tipoNativo(original);
      return tipo ? `data:${tipo};base64,${original.toString("base64")}` : null;
    }
    const jpeg = await sharp(original)
      .rotate()
      .resize(ancho, alto, { fit: "cover", position: "attention" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    console.warn("[fichas/imagen] foto omitida", { url, err: String(err) });
    return null;
  }
}

export async function qrComoDataUri(texto: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(texto, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#111111", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

export interface FuenteOg {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}

let fuentesCargadas: Promise<FuenteOg[]> | null = null;

/**
 * Space Grotesk, la misma del CRM, en TTF (satori no lee woff2). Si no se encuentra, la imagen
 * se dibuja con la fuente por defecto de next/og: se ve más plana, pero sale.
 */
export function cargarFuentes(): Promise<FuenteOg[]> {
  fuentesCargadas ??= (async () => {
    const dir = join(process.cwd(), "src", "fonts", "space-grotesk");
    try {
      const [regular, negrita] = await Promise.all([
        readFile(join(dir, "space-grotesk-latin-400-normal.ttf")),
        readFile(join(dir, "space-grotesk-latin-700-normal.ttf")),
      ]);
      const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      return [
        { name: "Space Grotesk", data: ab(regular), weight: 400, style: "normal" },
        { name: "Space Grotesk", data: ab(negrita), weight: 700, style: "normal" },
      ];
    } catch (err) {
      console.error("[fichas/imagen] no se cargó Space Grotesk", err);
      return [];
    }
  })();
  return fuentesCargadas;
}

/** Recorta un texto para que quepa en una línea de la imagen (satori no hace elipsis fiable). */
export function cabe(texto: string | null | undefined, max: number): string {
  const t = (texto ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * El título publicado a veces trae un remate comercial tras " | " («The Landmark | Torre frente a
 * la Quinta»). En la imagen no cabe: se queda la parte de antes. La página muestra el completo.
 */
export function tituloCorto(titulo: string): string {
  const [antes] = titulo.split(/\s+[|·–—]\s+/);
  return antes?.trim() || titulo;
}
