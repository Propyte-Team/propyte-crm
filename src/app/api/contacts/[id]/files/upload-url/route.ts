// ============================================================
// #917 — POST /api/contacts/[id]/files/upload-url
// Da al navegador una URL firmada para subir el CV DIRECTO al bucket privado crm-attachments
// (nunca por esta API: Hostinger trunca el multipart de más de 1–2 MB). Después el navegador
// confirma con POST /api/contacts/[id]/files, que es lo que registra el archivo en la ficha.
// Body: { fileName, mimeType, sizeBytes }.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { getContactAccessInfo } from "@/server/contacts";
import { crearUrlDeSubida } from "@/lib/storage/crm-attachments";
import { motivoRechazo, puedeSubir, rutaCv } from "@/lib/contacts/archivos";

export const dynamic = "force-dynamic";

const schema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().max(150).default("application/octet-stream"),
  sizeBytes: z.number().int().nonnegative(),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const access = await getContactAccessInfo(id, session as any);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason === "not_found" ? "Contacto no encontrado" : "No tienes acceso a este contacto" },
      { status: access.reason === "not_found" ? 404 : 403 }
    );
  }
  if (!puedeSubir(session.user.role)) {
    return NextResponse.json({ error: "Tu rol puede ver los CV, pero no subirlos" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos del archivo incompletos" }, { status: 400 });
  const motivo = motivoRechazo(parsed.data);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 422 });

  const path = rutaCv(id, parsed.data.fileName);
  const subida = await crearUrlDeSubida(path);
  if (!subida) return NextResponse.json({ error: "No se pudo preparar la subida. Intenta de nuevo." }, { status: 502 });

  return NextResponse.json({ data: { path, signedUrl: subida.signedUrl, token: subida.token } });
}
