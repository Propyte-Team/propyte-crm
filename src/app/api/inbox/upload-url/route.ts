// Signed upload URL para adjuntos del inbox: el navegador sube DIRECTO a Supabase
// Storage (bucket privado chat-media) — nunca por esta API (Hostinger trunca
// multipart >1-2MB). POST { mimeType, sizeBytes, channel, filename? }.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { createChatMediaUploadUrl } from "@/lib/storage/chat-media";
import { isMediaAllowed, mediaTypeFromMime } from "@/lib/messaging/media";

export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
  channel: z.enum(["WHATSAPP", "INSTAGRAM", "MESSENGER"]),
  filename: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = uploadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { mimeType, sizeBytes, channel, filename } = parsed.data;
  const type = mediaTypeFromMime(mimeType, channel);
  if (!isMediaAllowed(channel, type, sizeBytes)) {
    return NextResponse.json(
      { error: `El canal ${channel} no acepta ${type} de ese tamaño` },
      { status: 422 }
    );
  }

  const ext = filename?.includes(".") ? filename.split(".").pop()! : mimeType.split("/")[1] ?? "bin";
  const upload = await createChatMediaUploadUrl(ext);
  if (!upload) return NextResponse.json({ error: "No se pudo crear la URL de subida" }, { status: 502 });

  return NextResponse.json({ data: { ...upload, type } });
}
