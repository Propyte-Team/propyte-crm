// QR SVG de la tarjeta digital — para imprimir en tarjetas físicas (Anexo B §J.4).
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const profile = await prisma.userProfile.findUnique({
    where: { cardSlug: params.slug },
    select: { id: true, user: { select: { isActive: true } } },
  });
  if (!profile || !profile.user.isActive) {
    return NextResponse.json({ error: "No existe" }, { status: 404 });
  }

  const url = `https://crm.propyte.com/t/${params.slug}`;
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#111111", light: "#ffffff" },
  });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
