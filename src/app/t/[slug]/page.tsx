// Tarjeta de presentación digital pública — /t/{cardSlug} (Anexo B §J.4).
// SSR sin auth. Diseño minimalista B/N Propyte; CTA WhatsApp + vCard + agenda.
import prisma from "@/lib/db";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

async function getProfile(slug: string) {
  return prisma.userProfile.findUnique({
    where: { cardSlug: slug },
    include: { user: { select: { name: true, email: true, isActive: true } } },
  });
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const profile = await getProfile(params.slug);
  if (!profile || !profile.user.isActive) return { title: "Propyte" };
  return {
    title: `${profile.user.name} — Propyte`,
    description: profile.jobTitle ?? "Asesor inmobiliario Propyte · Riviera Maya",
    openGraph: {
      title: `${profile.user.name} — Propyte`,
      description: profile.jobTitle ?? "Asesor inmobiliario Propyte",
      images: profile.photoUrl ? [{ url: profile.photoUrl }] : undefined,
    },
  };
}

export default async function CardPage({ params }: { params: { slug: string } }) {
  const profile = await getProfile(params.slug);
  if (!profile || !profile.user.isActive) notFound();

  const social = (profile.socialLinks ?? {}) as Record<string, string>;
  const waNumber = profile.whatsappNumber?.replace("+", "");
  const waText = encodeURIComponent(`Hola ${profile.user.name.split(" ")[0]}, vi tu tarjeta Propyte y me interesa información.`);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm">
          {/* Foto / inicial */}
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt={profile.user.name}
              className="mx-auto h-24 w-24 rounded-full object-cover"
            />
          ) : (
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#111] text-3xl font-bold text-white">
              {profile.user.name.charAt(0)}
            </div>
          )}

          <h1 className="mt-4 text-xl font-bold text-[#111]">{profile.user.name}</h1>
          {profile.jobTitle && <p className="mt-0.5 text-sm text-[#555]">{profile.jobTitle}</p>}
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#999]">Propyte · Riviera Maya</p>

          {profile.bioEs && (
            <p className="mt-4 text-[13px] leading-relaxed text-[#555]">{profile.bioEs}</p>
          )}

          {/* CTAs */}
          <div className="mt-6 space-y-2">
            {waNumber && (
              <a
                href={`https://wa.me/${waNumber}?text=${waText}`}
                className="block w-full rounded-lg bg-[#111] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85"
              >
                WhatsApp
              </a>
            )}
            {profile.phoneDirect && (
              <a
                href={`tel:${profile.phoneDirect}`}
                className="block w-full rounded-lg border border-black/15 px-4 py-3 text-sm font-semibold text-[#111] hover:bg-black/5"
              >
                Llamar
              </a>
            )}
            <a
              href={`mailto:${profile.emailFromAlias ?? profile.user.email}`}
              className="block w-full rounded-lg border border-black/15 px-4 py-3 text-sm font-semibold text-[#111] hover:bg-black/5"
            >
              Email
            </a>
            {profile.calendarUrl && (
              <a
                href={profile.calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg border border-black/15 px-4 py-3 text-sm font-semibold text-[#111] hover:bg-black/5"
              >
                Agendar una llamada
              </a>
            )}
            <a
              href={`/t/${params.slug}/vcard`}
              className="block w-full rounded-lg border border-dashed border-black/20 px-4 py-3 text-sm font-medium text-[#555] hover:bg-black/5"
            >
              Guardar contacto (.vcf)
            </a>
          </div>

          {/* Social */}
          {Object.keys(social).length > 0 && (
            <div className="mt-5 flex items-center justify-center gap-4 text-[12px] font-medium">
              {Object.entries(social).map(([network, url]) => (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="text-[#555] capitalize hover:text-[#111] hover:underline">
                  {network}
                </a>
              ))}
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-[#999]">propyte.com</p>
      </div>
    </div>
  );
}
