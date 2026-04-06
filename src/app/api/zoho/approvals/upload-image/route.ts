// ============================================================
// API Route: /api/zoho/approvals/upload-image
// POST: Sube imágenes optimizadas a Supabase Storage
// y actualiza el campo correspondiente en real_estate_hub
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getSupabaseServiceClient } from "@/lib/supabase";
import sharp from "sharp";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const BUCKET_NAME = "property-images";

const TABLE_MAP: Record<string, string> = {
  developer: "Propyte_desarrolladores",
  development: "Propyte_desarrollos",
  unit: "Propyte_unidades",
};

// Fields that accept images
const IMAGE_FIELD_CONFIG: Record<string, { isArray: boolean; maxWidth: number; maxHeight: number | null; quality: number }> = {
  fotos_desarrollo: { isArray: true, maxWidth: 1920, maxHeight: null, quality: 80 },
  fotos_unidad: { isArray: true, maxWidth: 1920, maxHeight: null, quality: 80 },
  logo: { isArray: false, maxWidth: 400, maxHeight: 400, quality: 85 },
  plano_unidad: { isArray: false, maxWidth: 1920, maxHeight: null, quality: 85 },
};

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const entityType = formData.get("entity_type") as string;
  const entityId = formData.get("entity_id") as string;
  const fieldName = formData.get("field_name") as string;

  if (!entityType || !entityId || !fieldName) {
    return NextResponse.json({ error: "entity_type, entity_id y field_name requeridos" }, { status: 400 });
  }

  if (!TABLE_MAP[entityType]) {
    return NextResponse.json({ error: `entity_type inválido: ${entityType}` }, { status: 400 });
  }

  const fieldConfig = IMAGE_FIELD_CONFIG[fieldName];
  if (!fieldConfig) {
    return NextResponse.json({ error: `field_name no es un campo de imagen: ${fieldName}` }, { status: 400 });
  }

  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No se enviaron archivos" }, { status: 400 });
  }

  if (!fieldConfig.isArray && files.length > 1) {
    return NextResponse.json({ error: `${fieldName} solo acepta una imagen` }, { status: 400 });
  }

  // Validate all files before processing
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Tipo no permitido: ${file.type}. Acepta: JPEG, PNG, WebP, HEIC` }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Archivo demasiado grande: ${(file.size / 1024 / 1024).toFixed(1)}MB. Máx: 10MB` }, { status: 400 });
    }
  }

  const uploadedUrls: string[] = [];

  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Optimize with sharp
      let sharpInstance = sharp(buffer);

      if (fieldConfig.maxHeight) {
        sharpInstance = sharpInstance.resize(fieldConfig.maxWidth, fieldConfig.maxHeight, {
          withoutEnlargement: true,
          fit: "inside",
        });
      } else {
        sharpInstance = sharpInstance.resize(fieldConfig.maxWidth, undefined, {
          withoutEnlargement: true,
          fit: "inside",
        });
      }

      const optimized = await sharpInstance.webp({ quality: fieldConfig.quality }).toBuffer();

      // Upload to Supabase Storage
      const fileName = `${entityType}/${entityId}/${randomUUID()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, optimized, {
          contentType: "image/webp",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

      uploadedUrls.push(urlData.publicUrl);
    }

    // Update the field in real_estate_hub
    const table = TABLE_MAP[entityType];

    if (fieldConfig.isArray) {
      // Fetch current array and append new URLs
      const { data: current } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .select(fieldName)
        .eq("id", entityId)
        .single();

      const existingUrls: string[] = Array.isArray(current?.[fieldName]) ? current[fieldName] : [];
      const updatedUrls = [...existingUrls, ...uploadedUrls];

      const { error: updateError } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .update({ [fieldName]: updatedUrls, updated_at: new Date().toISOString() })
        .eq("id", entityId);

      if (updateError) {
        throw new Error(`DB update failed: ${updateError.message}`);
      }
    } else {
      // Single image: replace
      const { error: updateError } = await supabase
        .schema("real_estate_hub")
        .from(table)
        .update({ [fieldName]: uploadedUrls[0], updated_at: new Date().toISOString() })
        .eq("id", entityId);

      if (updateError) {
        throw new Error(`DB update failed: ${updateError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      urls: uploadedUrls,
      count: uploadedUrls.length,
    });
  } catch (err) {
    // Cleanup uploaded files on error
    if (uploadedUrls.length > 0) {
      const paths = uploadedUrls.map((url) => {
        const parts = url.split(`/${BUCKET_NAME}/`);
        return parts[1] || "";
      }).filter(Boolean);

      if (paths.length > 0) {
        await supabase.storage.from(BUCKET_NAME).remove(paths);
      }
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
