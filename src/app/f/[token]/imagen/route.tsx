// Ficha técnica como imagen (#887): /f/{token}/imagen
//   - por defecto, flyer vertical 1080×1350 (formato de WhatsApp/Instagram) con el QR del enlace;
//   - ?formato=og, 1200×630 para la vista previa del enlace en WhatsApp;
//   - ?descargar=1 agrega Content-Disposition para que el navegador lo guarde como archivo.
//
// Pública como la página: el contacto que lleva impreso es el del asesor que creó el enlace.
import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { cargarFichaPublica } from "@/server/fichas";
import { origenPublico, precioDestacado, rutaFicha, type ContactoAsesor, type VistaFicha } from "@/lib/fichas/ficha";
import { cabe, cargarFuentes, cargarSharp, fotoComoDataUri, qrComoDataUri, tituloCorto } from "@/lib/fichas/imagen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NEGRO = "#111111";
const GRIS = "#6B6B6B";
const FONDO = "#FAFAFA";

function telefonoLegible(c: ContactoAsesor): string | null {
  const n = c.telefono ?? (c.whatsapp ? `+${c.whatsapp}` : null);
  if (!n) return null;
  const m = n.match(/^\+52(\d{3})(\d{3})(\d{4})$/);
  return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : n;
}

function Marca({ claro }: { claro?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "10px 22px",
        background: claro ? "#ffffff" : NEGRO,
        color: claro ? NEGRO : "#ffffff",
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: 6,
      }}
    >
      PROPYTE
    </div>
  );
}

function BloqueAsesor({ c, foto, grande }: { c: ContactoAsesor | null; foto: string | null; grande: boolean }) {
  if (!c) {
    return (
      <div style={{ display: "flex", flexDirection: "column", color: "#ffffff" }}>
        <div style={{ fontSize: grande ? 40 : 30, fontWeight: 700 }}>Propyte</div>
        <div style={{ fontSize: grande ? 26 : 22, color: "#BDBDBD" }}>propyte.com</div>
      </div>
    );
  }
  const tel = telefonoLegible(c);
  const lado = grande ? 132 : 96;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: grande ? 32 : 22 }}>
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img src={foto} width={lado} height={lado} style={{ borderRadius: lado, objectFit: "cover" }} />
      ) : (
        <div
          style={{
            display: "flex",
            width: lado,
            height: lado,
            borderRadius: lado,
            background: "#ffffff",
            color: NEGRO,
            alignItems: "center",
            justifyContent: "center",
            fontSize: lado / 2.2,
            fontWeight: 700,
          }}
        >
          {c.nombre.charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", color: "#ffffff" }}>
        <div style={{ fontSize: grande ? 22 : 18, color: "#BDBDBD", letterSpacing: 3 }}>TU ASESOR</div>
        <div style={{ fontSize: grande ? 42 : 32, fontWeight: 700 }}>{cabe(c.nombre, 28)}</div>
        {c.puesto && <div style={{ fontSize: grande ? 24 : 20, color: "#BDBDBD" }}>{cabe(c.puesto, 40)}</div>}
        {tel && <div style={{ fontSize: grande ? 30 : 24, fontWeight: 700, marginTop: 6 }}>{`WhatsApp ${tel}`}</div>}
        <div style={{ fontSize: grande ? 22 : 18, color: "#BDBDBD" }}>{cabe(c.correo, 42)}</div>
      </div>
    </div>
  );
}

function Precio({ v, tam }: { v: VistaFicha; tam: number }) {
  const precio = precioDestacado(v);
  if (!precio) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
      <div style={{ fontSize: tam, fontWeight: 700, color: NEGRO }}>
        {precio}
      </div>
      {v.precioAntes && (
        <div style={{ fontSize: tam * 0.5, color: GRIS, textDecoration: "line-through" }}>{v.precioAntes}</div>
      )}
    </div>
  );
}

async function flyer(v: VistaFicha, c: ContactoAsesor | null, url: string) {
  const conMiniaturas = v.fotos.length >= 4;
  const altoPortada = conMiniaturas ? 520 : 700;
  const [portada, m1, m2, m3, fotoAsesor, qr] = await Promise.all([
    v.fotos[0] ? fotoComoDataUri(v.fotos[0], 1080, altoPortada) : null,
    conMiniaturas ? fotoComoDataUri(v.fotos[1], 348, 160) : null,
    conMiniaturas ? fotoComoDataUri(v.fotos[2], 348, 160) : null,
    conMiniaturas ? fotoComoDataUri(v.fotos[3], 348, 160) : null,
    c?.foto ? fotoComoDataUri(c.foto, 264, 264) : null,
    qrComoDataUri(url),
  ]);
  const miniaturas = [m1, m2, m3].filter((x): x is string => !!x);
  const datos = v.datos.filter((d) => d.etiqueta !== "Financiamiento").slice(0, 6);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1080, height: 1350, background: FONDO, fontFamily: "Space Grotesk" }}>
      <div style={{ display: "flex", position: "relative", width: 1080, height: altoPortada, background: "#DDDDDD" }}>
        {portada && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={portada} width={1080} height={altoPortada} style={{ objectFit: "cover" }} />
        )}
        <div style={{ display: "flex", position: "absolute", top: 40, left: 40 }}>
          <Marca />
        </div>
        {v.etapa && (
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: 40,
              right: 40,
              padding: "10px 22px",
              background: "#ffffff",
              color: NEGRO,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            {cabe(v.etapa.toUpperCase(), 24)}
          </div>
        )}
      </div>

      {miniaturas.length > 0 && (
        <div style={{ display: "flex", gap: 9, marginTop: 9, paddingLeft: 9, paddingRight: 9 }}>
          {miniaturas.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img key={i} src={src} width={348} height={160} style={{ objectFit: "cover" }} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, overflow: "hidden", padding: "30px 56px 0 56px" }}>
        <div style={{ fontSize: 22, color: GRIS, letterSpacing: 4 }}>
          {cabe(`FICHA TÉCNICA${v.subtitulo ? ` · ${tituloCorto(v.subtitulo).toUpperCase()}` : ""}`, 60)}
        </div>
        <div style={{ fontSize: 54, fontWeight: 700, color: NEGRO, marginTop: 4 }}>{cabe(tituloCorto(v.titulo), 32)}</div>
        {v.ubicacion && <div style={{ fontSize: 26, color: GRIS }}>{cabe(v.ubicacion, 62)}</div>}
        <div style={{ display: "flex", marginTop: 14 }}>
          <Precio v={v} tam={48} />
        </div>
        {datos.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 18, borderTop: `2px solid ${NEGRO}` }}>
            {datos.map((d) => (
              <div key={d.etiqueta} style={{ display: "flex", flexDirection: "column", width: 322, paddingTop: 14 }}>
                <div style={{ fontSize: 19, color: GRIS }}>{d.etiqueta}</div>
                <div style={{ fontSize: 27, fontWeight: 700, color: NEGRO }}>{cabe(d.valor, 20)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 230,
          flexShrink: 0,
          padding: "0 56px",
          background: NEGRO,
        }}
      >
        <BloqueAsesor c={c} foto={fotoAsesor} grande />
        {qr && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={qr} width={140} height={140} />
            <div style={{ fontSize: 16, color: "#BDBDBD" }}>Ver ficha completa</div>
          </div>
        )}
      </div>
    </div>
  );
}

async function vistaPrevia(v: VistaFicha, c: ContactoAsesor | null) {
  const [portada, fotoAsesor] = await Promise.all([
    v.fotos[0] ? fotoComoDataUri(v.fotos[0], 640, 630) : null,
    c?.foto ? fotoComoDataUri(c.foto, 192, 192) : null,
  ]);
  return (
    <div style={{ display: "flex", width: 1200, height: 630, background: FONDO, fontFamily: "Space Grotesk" }}>
      <div style={{ display: "flex", width: 640, height: 630, background: "#DDDDDD" }}>
        {portada && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={portada} width={640} height={630} style={{ objectFit: "cover" }} />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: 560, height: 630 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "40px 40px 0 40px" }}>
          <div style={{ display: "flex" }}>
            <Marca />
          </div>
          <div style={{ fontSize: 18, color: GRIS, letterSpacing: 3, marginTop: 26 }}>
            {cabe(`FICHA TÉCNICA${v.subtitulo ? ` · ${tituloCorto(v.subtitulo).toUpperCase()}` : ""}`, 34)}
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: NEGRO, marginTop: 4, lineHeight: 1.1 }}>{cabe(tituloCorto(v.titulo), 40)}</div>
          {v.ubicacion && <div style={{ fontSize: 22, color: GRIS, marginTop: 6 }}>{cabe(v.ubicacion, 40)}</div>}
          <div style={{ display: "flex", marginTop: 16 }}>
            <Precio v={v} tam={38} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", height: 180, padding: "0 40px", background: NEGRO }}>
          <BloqueAsesor c={c} foto={fotoAsesor} grande={false} />
        </div>
      </div>
    </div>
  );
}

function nombreArchivo(v: VistaFicha): string {
  const base = v.titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `ficha-${base || "propyte"}`;
}

export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const ficha = await cargarFichaPublica(token).catch((err) => {
    console.error("[GET /f/[token]/imagen]", err);
    return undefined;
  });
  if (ficha === undefined) return NextResponse.json({ error: "Intenta de nuevo" }, { status: 503 });
  if (!ficha || !ficha.vista) return NextResponse.json({ error: "No existe" }, { status: 404 });

  const og = req.nextUrl.searchParams.get("formato") === "og";
  const url = `${origenPublico(req.nextUrl.origin)}${rutaFicha(token)}`;
  const [fuentes, cuerpo] = await Promise.all([
    cargarFuentes(),
    og ? vistaPrevia(ficha.vista, ficha.contacto) : flyer(ficha.vista, ficha.contacto, url),
  ]);

  const imagen = new ImageResponse(cuerpo, {
    width: og ? 1200 : 1080,
    height: og ? 630 : 1350,
    ...(fuentes.length ? { fonts: fuentes } : {}),
  });

  // PNG → JPEG: la foto de portada hace que el PNG pese varios MB; WhatsApp descarta vistas
  // previas pesadas y el asesor la manda por datos móviles.
  let cuerpoRespuesta: ArrayBuffer | Buffer = await imagen.arrayBuffer();
  let tipo = "image/png";
  let extension = "png";
  const sharp = await cargarSharp();
  if (sharp) {
    try {
      cuerpoRespuesta = await sharp(Buffer.from(cuerpoRespuesta)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      tipo = "image/jpeg";
      extension = "jpg";
    } catch (err) {
      console.warn("[GET /f/[token]/imagen] se sirve en PNG", err);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": tipo,
    // Corto: el precio y la disponibilidad cambian en el Hub.
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
  if (req.nextUrl.searchParams.get("descargar") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${nombreArchivo(ficha.vista)}.${extension}"`;
  }
  return new NextResponse(cuerpoRespuesta as BodyInit, { headers });
}
