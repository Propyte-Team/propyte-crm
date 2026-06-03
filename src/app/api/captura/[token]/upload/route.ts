// ============================================================
// API Route: /api/captura/[token]/upload
// POST: Sube imágenes optimizadas a bucket de cuarentena
// gateado por token de intake (no sesión)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getUsableLink } from "@/lib/intake/get-usable-link";
import sharp from "sharp";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const BUCKET = "intake-quarantine";

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);
  if (!link) return NextResponse.json({ error: "Link inválido o expirado" }, { status: 410 });

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });

  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ error: "FormData inválido" }, { status: 400 }); }

  const files = formData.getAll("files") as File[];
  if (!files.length) return NextResponse.json({ error: "No se enviaron archivos" }, { status: 400 });

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `Tipo no permitido: ${file.type}` }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: `Archivo > 10MB` }, { status: 400 });
  }

  const paths: string[] = [];
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const optimized = await sharp(buffer)
        .resize(1920, undefined, { withoutEnlargement: true, fit: "inside" })
        .webp({ quality: 80 })
        .toBuffer();
      const path = `${params.token}/${randomUUID()}.webp`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, optimized, {
        contentType: "image/webp", upsert: false,
      });
      if (error) throw new Error(error.message);
      paths.push(path);
    }
    return NextResponse.json({ success: true, paths });
  } catch (err) {
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
