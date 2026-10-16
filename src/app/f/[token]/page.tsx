// Ficha técnica pública — /f/{token} (#887). SSR sin auth (fuera del matcher del middleware).
//
// El enlace lo crea un asesor desde el CRM y se reenvía tal cual: cliente → broker → quien sea.
// Por eso el contacto que aparece es siempre el de quien lo CREÓ, no el de quien lo reenvió.
// Los datos se leen del catálogo publicado al abrir, así que precio y disponibilidad están al día.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { cargarFichaPublica, esAperturaDePersona, registrarApertura } from "@/server/fichas";
import {
  enlaceWhatsAppAlAsesor,
  origenPublico,
  precioDestacado,
  rutaFicha,
  type ContactoAsesor,
} from "@/lib/fichas/ficha";
import { AccionesFicha } from "@/components/fichas/acciones-ficha";
import { telefonoLegible } from "@/lib/phone";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

// Los metadatos (vista previa de WhatsApp) y la página piden la misma ficha: una sola lectura
// del catálogo por petición.
const cargarFicha = cache(cargarFichaPublica);

async function origen(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return origenPublico(host ? `${proto}://${host}` : null);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { token } = await props.params;
  const ficha = await cargarFicha(token).catch(() => null);
  if (!ficha?.vista) return { title: "Ficha técnica — Propyte", robots: { index: false } };
  const v = ficha.vista;
  const base = await origen();
  const titulo = v.tipo === "UNIDAD" && v.subtitulo ? `${v.titulo} · ${v.subtitulo}` : v.titulo;
  const descripcion = [v.lema, precioDestacado(v), v.ubicacion]
    .filter(Boolean)
    .join(" · ");
  const asesor = ficha.contacto ? ` Tu asesor: ${ficha.contacto.nombre}.` : "";
  return {
    title: `${titulo} — Ficha técnica Propyte`,
    description: `${descripcion}.${asesor}`.replace(/^\.\s*/, ""),
    robots: { index: false, follow: false },
    openGraph: {
      title: `${titulo} — Ficha técnica`,
      description: `${descripcion}.${asesor}`.replace(/^\.\s*/, ""),
      type: "website",
      url: `${base}${rutaFicha(token)}`,
      images: [{ url: `${base}${rutaFicha(token)}/imagen?formato=og`, width: 1200, height: 630 }],
    },
  };
}

function TarjetaAsesor({ c, waHref }: { c: ContactoAsesor | null; waHref: string | null }) {
  if (!c) {
    return (
      <aside className="rounded-2xl bg-[#111] p-6 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Más información</p>
        <p className="mt-2 text-lg font-bold">Propyte</p>
        <a href="https://propyte.com" className="mt-1 inline-block text-sm text-white/80 underline">propyte.com</a>
      </aside>
    );
  }
  return (
    <aside className="rounded-2xl bg-[#111] p-6 text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Tu asesor</p>
      <div className="mt-4 flex items-center gap-4">
        {c.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.foto} alt={c.nombre} className="h-16 w-16 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-bold text-[#111]">
            {c.nombre.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{c.nombre}</p>
          {c.puesto && <p className="truncate text-sm text-white/70">{c.puesto}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="no-print block w-full rounded-lg bg-white px-4 py-3 text-center text-sm font-semibold text-[#111] hover:opacity-90"
          >
            Escribir por WhatsApp
          </a>
        )}
        {c.telefono && (
          <a
            href={`tel:${c.telefono}`}
            className="block w-full rounded-lg border border-white/25 px-4 py-3 text-center text-sm font-semibold hover:bg-white/10"
          >
            Llamar · {telefonoLegible(c.telefono)}
          </a>
        )}
        <a
          href={`mailto:${c.correo}`}
          className="block w-full truncate rounded-lg border border-white/25 px-4 py-3 text-center text-sm font-semibold hover:bg-white/10"
        >
          {c.correo}
        </a>
      </div>
    </aside>
  );
}

export default async function FichaPublicaPage(props: Props) {
  const { token } = await props.params;
  // Sin `.catch(() => null)` (#716): si el catálogo falla salta la frontera de error con
  // «reintentar»; notFound() queda solo para un token que no existe.
  const ficha = await cargarFicha(token);
  if (!ficha) notFound();

  // Conteo de aperturas: ni el propio asesor ni los robots de vista previa cuentan. Nunca
  // rompe la página.
  try {
    const ua = (await headers()).get("user-agent");
    if (esAperturaDePersona(ua)) {
      const session = await getServerSession().catch(() => null);
      if (session?.user?.id !== ficha.createdById) await registrarApertura(ficha.id);
    }
  } catch (err) {
    console.warn("[/f/[token]] apertura no registrada", err);
  }

  const c = ficha.contacto;
  const v = ficha.vista;

  if (!v) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10 text-[#111]">
        <div className="w-full max-w-md space-y-6">
          <div className="rounded-2xl border border-black/10 bg-white p-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#999]">Ficha técnica</p>
            <h1 className="mt-2 text-xl font-bold">Esta propiedad ya no está disponible</h1>
            <p className="mt-2 text-sm text-[#555]">
              Ya no aparece en el catálogo publicado. Escríbele a tu asesor y te comparte opciones parecidas.
            </p>
          </div>
          <TarjetaAsesor c={c} waHref={c?.whatsapp ? `https://wa.me/${c.whatsapp}` : null} />
        </div>
      </main>
    );
  }

  const base = await origen();
  const url = `${base}${rutaFicha(token)}`;
  const waAsesor = c ? enlaceWhatsAppAlAsesor(c, v) : null;
  const [portada, ...resto] = v.fotos;
  const galeria = resto.slice(0, 6);
  const precio = precioDestacado(v);

  return (
    <main className="min-h-screen bg-[#fafafa] text-[#111]">
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@media print { .no-print { display: none !important; } body, main { background: #fff !important; } @page { margin: 12mm; } .ficha-salto { break-inside: avoid; } }",
        }}
      />
      <div className="mx-auto max-w-5xl px-4 pb-12 pt-6 sm:px-6">
        <header className="flex items-center justify-between border-b border-black/10 pb-4">
          <span className="bg-[#111] px-3 py-1.5 text-sm font-bold tracking-[0.3em] text-white">PROPYTE</span>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#999]">Ficha técnica</span>
        </header>

        {portada && (
          <div className="relative mt-6 overflow-hidden rounded-2xl bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={portada} alt={v.titulo} className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]" />
            {v.etapa && (
              <span className="absolute right-4 top-4 rounded-md bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider">
                {v.etapa}
              </span>
            )}
          </div>
        )}

        {galeria.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {galeria.map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-black/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${v.titulo} ${i + 2}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              </a>
            ))}
          </div>
        )}

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-8">
            <section>
              {v.subtitulo && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#999]">{v.subtitulo}</p>}
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{v.titulo}</h1>
              {v.lema && <p className="mt-1 text-lg text-[#333]">{v.lema}</p>}
              {v.ubicacion && <p className="mt-1 text-[#555]">{v.ubicacion}</p>}
              {precio && (
                <p className="mt-4 flex flex-wrap items-baseline gap-3">
                  <span className="text-2xl font-bold sm:text-3xl">{precio}</span>
                  {v.precioAntes && <span className="text-[#999] line-through">{v.precioAntes}</span>}
                </p>
              )}
            </section>

            <div className="no-print">
              <AccionesFicha
                url={url}
                vista={{ titulo: v.titulo, subtitulo: v.subtitulo, tipo: v.tipo }}
                imagenUrl={`${rutaFicha(token)}/imagen`}
              />
            </div>

            {v.datos.length > 0 && (
              <section className="ficha-salto">
                <h2 className="border-b-2 border-[#111] pb-2 text-sm font-bold uppercase tracking-[0.15em]">Ficha técnica</h2>
                <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                  {v.datos.map((d) => (
                    <div key={d.etiqueta} className="border-b border-black/10 py-3">
                      <dt className="text-xs text-[#999]">{d.etiqueta}</dt>
                      <dd className="mt-0.5 font-semibold">{d.valor}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {v.descripcion && (
              <section className="ficha-salto">
                <h2 className="border-b-2 border-[#111] pb-2 text-sm font-bold uppercase tracking-[0.15em]">Descripción</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-[#444]">{v.descripcion}</p>
              </section>
            )}

            {v.amenidades.length > 0 && (
              <section className="ficha-salto">
                <h2 className="border-b-2 border-[#111] pb-2 text-sm font-bold uppercase tracking-[0.15em]">Amenidades</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {v.amenidades.map((a) => (
                    <li key={a} className="rounded-full border border-black/15 bg-white px-3 py-1 text-sm">{a}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="md:sticky md:top-6 md:self-start">
            <TarjetaAsesor c={c} waHref={waAsesor} />
            {v.enlaceSitio && (
              <a href={v.enlaceSitio} target="_blank" rel="noopener noreferrer" className="no-print mt-3 block text-center text-xs text-[#555] underline">
                Ver más fotos en propyte.com
              </a>
            )}
          </div>
        </div>

        {/* En el teléfono la tarjeta del asesor queda al final: esta barra lo deja a un toque. */}
        {c && waAsesor && (
          <div className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
            <a
              href={waAsesor}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg bg-[#111] px-4 py-3 text-center text-sm font-semibold text-white"
            >
              WhatsApp a {c.nombre.split(" ")[0]}
            </a>
          </div>
        )}

        <footer className="mt-12 border-t border-black/10 pb-20 pt-4 text-[11px] leading-relaxed text-[#999] md:pb-0">
          Documento informativo sin valor contractual. Precios y disponibilidad sujetos a cambio y a confirmación del
          desarrollador. <span className="whitespace-nowrap">{url}</span>
        </footer>
      </div>
    </main>
  );
}
