// vCard (.vcf) de la tarjeta digital — descarga pública (Anexo B §J.4).
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const profile = await prisma.userProfile.findUnique({
    where: { cardSlug: params.slug },
    include: { user: { select: { name: true, email: true, isActive: true } } },
  });
  if (!profile || !profile.user.isActive) {
    return NextResponse.json({ error: "No existe" }, { status: 404 });
  }

  const [firstName, ...rest] = profile.user.name.split(" ");
  const lastName = rest.join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${lastName};${firstName};;;`,
    `FN:${profile.user.name}`,
    `ORG:Propyte`,
    profile.jobTitle ? `TITLE:${profile.jobTitle}` : null,
    `EMAIL;TYPE=WORK:${profile.emailFromAlias ?? profile.user.email}`,
    profile.phoneDirect ? `TEL;TYPE=WORK,VOICE:${profile.phoneDirect}` : null,
    profile.whatsappNumber ? `TEL;TYPE=CELL:${profile.whatsappNumber}` : null,
    `URL:https://crm.propyte.com/t/${params.slug}`,
    "END:VCARD",
  ].filter(Boolean);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${profile.user.name.replace(/\s+/g, "-")}.vcf"`,
    },
  });
}
