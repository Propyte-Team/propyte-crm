// ============================================================
// Drive Image URLs — Extrae URLs de imágenes desde carpetas
// de Drive SIN descargar archivos. Usa Google thumbnail API.
// ============================================================

// Nombres de subcarpetas donde buscar imágenes (case insensitive)
const IMAGE_FOLDER_KEYWORDS = [
  "imagen", "imágenes", "imagenes", "images",
  "foto", "fotos", "photos",
  "render", "renders",
  "avance", "avance de obra",
  "amenidad", "amenidades", "amenities",
  "interior", "interiores",
  "exterior", "exteriores",
  "galeria", "galería", "gallery",
];

/**
 * Busca imágenes en carpetas de Drive de forma inteligente:
 * 1. Si se pasan URLs específicas de imágenes → busca ahí directo
 * 2. Si no, busca en la carpeta raíz del proyecto por subcarpetas
 *    con nombres como "imágenes", "fotos", "renders", etc.
 * 3. Entra recursivamente y extrae IDs de archivos de imagen
 */
export async function getDriveImageUrls(folderUrls: string[]): Promise<string[]> {
  const allIds: string[] = [];

  for (const folderUrl of folderUrls) {
    const folderId = extractFolderId(folderUrl);
    if (!folderId) continue;

    try {
      const output = await runGdown(folderId);
      const { imageIds, subfolders } = parseGdownOutput(output);

      // Agregar imágenes encontradas directamente
      allIds.push(...imageIds);

      // Buscar en subcarpetas que parecen contener imágenes
      for (const sub of subfolders) {
        if (isImageFolder(sub.name)) {
          console.log(`[DRIVE] Entrando a subcarpeta: ${sub.name}`);
          const subOutput = await runGdown(sub.id);
          const subResult = parseGdownOutput(subOutput);
          allIds.push(...subResult.imageIds);

          // Un nivel más profundo (ej: "4. Imágenes" → "Renders" → archivos)
          for (const subsub of subResult.subfolders) {
            console.log(`[DRIVE]   Entrando a: ${sub.name}/${subsub.name}`);
            const subsubOutput = await runGdown(subsub.id);
            const subsubResult = parseGdownOutput(subsubOutput);
            allIds.push(...subsubResult.imageIds);
          }
        }
      }
    } catch (e) {
      console.error(`[DRIVE] Error listing folder ${folderId}:`, (e as Error).message);
    }
  }

  // Deduplicate y limitar a 10 imágenes
  const unique = allIds.filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
  return unique.map((id) => `https://lh3.googleusercontent.com/d/${id}=w800`);
}

/**
 * Ejecuta gdown --folder y retorna el output sin descargar archivos.
 */
async function runGdown(folderId: string): Promise<string> {
  const { execSync } = await import("child_process");
  try {
    return execSync(
      `python3 -m gdown --folder "https://drive.google.com/drive/folders/${folderId}" --remaining-ok 2>&1`,
      { timeout: 30000, encoding: "utf-8", cwd: "/tmp" }
    );
  } catch (e: any) {
    return e.stdout || e.stderr || "";
  }
}

/**
 * Parsea el output de gdown para extraer IDs de archivos de imagen
 * y subcarpetas encontradas.
 */
function parseGdownOutput(output: string): {
  imageIds: string[];
  subfolders: Array<{ id: string; name: string }>;
} {
  const imageExts = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  const imageIds: string[] = [];
  const subfolders: Array<{ id: string; name: string }> = [];

  for (const line of output.split("\n")) {
    // Archivos: "Processing file FILE_ID FILENAME"
    const fileMatch = line.match(/Processing file\s+(\S+)\s+(.+)/);
    if (fileMatch) {
      const [, fileId, fileName] = fileMatch;
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      if (imageExts.has(ext)) {
        imageIds.push(fileId);
      }
      continue;
    }

    // Subcarpetas: "Retrieving folder FOLDER_ID FOLDER_NAME"
    const folderMatch = line.match(/Retrieving folder\s+(\S+)\s+(.+)/);
    if (folderMatch) {
      subfolders.push({ id: folderMatch[1], name: folderMatch[2].trim() });
    }
  }

  return { imageIds, subfolders };
}

/**
 * Determina si una carpeta probablemente contiene imágenes
 * basándose en su nombre.
 */
function isImageFolder(name: string): boolean {
  const lower = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return IMAGE_FOLDER_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractFolderId(url: string): string | null {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
