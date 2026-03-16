// ============================================================
// Drive Price List Analyzer
// Descarga PDFs/Excel de Drive, parsea listas de precios,
// y escribe a inventario.csv — replicando la lógica del
// skill analista-inventario pero integrado en el pipeline
// ============================================================

import path from "path";
import type { ParsedUnit } from "../types";

const INVENTORY_CSV = path.resolve(process.cwd(), "../inventario.csv");
const PROJECTS_CSV = path.resolve(process.cwd(), "../proyectos.csv");
const TEMP_DIR = "/tmp/propyte-sync-pdfs";

interface AnalysisResult {
  units: ParsedUnit[];
  totalReal: number;
  disponibles: number;
  apartadas: number;
  vendidas: number;
  pdfFiles: string[];
  errors: string[];
}

/**
 * Pipeline completo: descarga PDFs del Drive → parsea → escribe inventario.csv
 */
export async function analyzeDrivePriceList(config: {
  projectName: string;
  developerName: string;
  city: string;
  driveFolderUrl: string;
  totalUnits?: number;
}): Promise<AnalysisResult> {
  const fs = await import("fs/promises");
  const { execSync } = await import("child_process");
  const errors: string[] = [];

  // 1. Asegurar que el proyecto está en proyectos.csv
  await ensureProjectInCSV(config, fs);

  // 2. Listar archivos del Drive y descargar PDFs/Excel
  console.log(`[ANALISTA] Listando archivos de Drive para ${config.projectName}...`);
  const downloadDir = path.join(TEMP_DIR, slugify(config.projectName));
  await fs.mkdir(downloadDir, { recursive: true });

  // 2a. Listar archivos con gdown (solo listar, no descargar)
  let gdownOutput = "";
  try {
    gdownOutput = execSync(
      `python3 -m gdown --folder "${config.driveFolderUrl}" --remaining-ok 2>&1`,
      { timeout: 60000, encoding: "utf-8", cwd: downloadDir }
    );
  } catch (e: any) {
    gdownOutput = e.stdout || e.stderr || "";
  }

  // 2b. Extraer IDs de PDFs y Excel del output de gdown
  const filesToDownload: Array<{ id: string; name: string }> = [];
  for (const line of gdownOutput.split("\n")) {
    const match = line.match(/Processing file\s+(\S+)\s+(.+)/);
    if (!match) continue;
    const [, fileId, fileName] = match;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["pdf", "xlsx", "xls", "csv"].includes(ext)) {
      // Solo descargar archivos que parecen listas de precios (no legales/escrituras)
      const nameLower = fileName.toLowerCase();
      if (nameLower.includes("precio") || nameLower.includes("lista") || nameLower.includes("inventario") ||
          nameLower.includes("disponibilidad") || nameLower.includes("brochure") || nameLower.includes("price")) {
        filesToDownload.push({ id: fileId, name: fileName });
      }
    }
  }

  console.log(`[ANALISTA] Archivos a descargar: ${filesToDownload.length}`);

  // 2c. Descargar cada archivo con curl (más confiable que gdown para archivos individuales)
  for (const file of filesToDownload) {
    const destPath = path.join(downloadDir, file.name);
    try {
      execSync(
        `curl -sL "https://drive.google.com/uc?export=download&id=${file.id}" -o "${destPath}"`,
        { timeout: 60000, cwd: downloadDir }
      );
      console.log(`[ANALISTA] Descargado: ${file.name}`);
    } catch (e) {
      console.error(`[ANALISTA] Error descargando ${file.name}: ${(e as Error).message}`);
    }
  }

  // 3. Buscar PDFs y Excel descargados
  const allFiles = await listFilesRecursive(downloadDir, fs);
  const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const excelFiles = allFiles.filter((f) => /\.(xlsx?|csv)$/i.test(f));

  console.log(`[ANALISTA] Encontrados: ${pdfFiles.length} PDFs, ${excelFiles.length} Excel`);

  if (pdfFiles.length === 0 && excelFiles.length === 0) {
    errors.push("No se encontraron PDFs ni Excel en la carpeta de Drive");
    return { units: [], totalReal: 0, disponibles: 0, apartadas: 0, vendidas: 0, pdfFiles: [], errors };
  }

  // 4. Parsear archivos (usa child_process para evitar problemas de webpack con pdf-parse)
  let allUnits: ParsedUnit[] = [];

  for (const file of [...pdfFiles, ...excelFiles]) {
    try {
      const units = await parseFileInSubprocess(file, execSync);
      if (units.length > 0) {
        console.log(`[ANALISTA] ${path.basename(file)}: ${units.length} unidades`);
        allUnits.push(...units);
      }
    } catch (e) {
      errors.push(`Error parseando ${path.basename(file)}: ${(e as Error).message}`);
    }
  }

  // 5. Deduplicar unidades por número
  const unitMap = new Map<string, ParsedUnit>();
  for (const unit of allUnits) {
    if (unit.unitNumber) {
      const existing = unitMap.get(unit.unitNumber);
      if (!existing || (unit.price && !existing.price)) {
        unitMap.set(unit.unitNumber, unit);
      }
    }
  }
  const uniqueUnits = Array.from(unitMap.values());

  // 6. Calcular total real y vendidas
  const listedUnits = uniqueUnits.length;
  const totalReal = config.totalUnits || listedUnits;
  const disponibles = uniqueUnits.filter((u) => u.status === "DISPONIBLE").length;
  const apartadas = uniqueUnits.filter((u) => u.status === "APARTADA").length;
  const vendidas = totalReal - listedUnits + uniqueUnits.filter((u) => u.status === "VENDIDA").length;

  // Si el total real es mayor que las listadas, las faltantes son vendidas
  if (totalReal > listedUnits) {
    const missingCount = totalReal - listedUnits;
    for (let i = 1; i <= missingCount; i++) {
      uniqueUnits.push({
        unitNumber: `VENDIDA-${i}`,
        unitType: "NO LISTADA",
        status: "VENDIDA",
        currency: "MXN",
      });
    }
  }

  // 7. Escribir a inventario.csv
  await writeToInventoryCSV(config.projectName, uniqueUnits, fs);

  console.log(`[ANALISTA] Resultado: ${totalReal} total, ${disponibles} disp, ${apartadas} apart, ${vendidas} vendidas`);

  // 8. Limpiar archivos temporales
  try {
    await fs.rm(downloadDir, { recursive: true });
  } catch { /* ok */ }

  return {
    units: uniqueUnits,
    totalReal,
    disponibles,
    apartadas,
    vendidas,
    pdfFiles: [...pdfFiles, ...excelFiles].map((f) => path.basename(f)),
    errors,
  };
}

/**
 * Agrega el proyecto a proyectos.csv si no existe.
 */
async function ensureProjectInCSV(
  config: { projectName: string; developerName: string; city: string; driveFolderUrl: string; totalUnits?: number },
  fs: typeof import("fs/promises"),
) {
  try {
    let content = "";
    try {
      content = await fs.readFile(PROJECTS_CSV, "utf-8");
    } catch {
      // Archivo no existe, crear con headers
      content = "nombre_proyecto,desarrolladora,ciudad,url_carpeta_drive,notas,total_unidades,inicio_ventas,urls_imagenes\n";
    }

    // Verificar si ya existe
    if (content.toLowerCase().includes(config.projectName.toLowerCase())) {
      return; // Ya existe
    }

    // Agregar nueva línea
    const cleanUrl = config.driveFolderUrl.split("?")[0];
    const totalUnits = config.totalUnits || "";
    const newLine = `${config.projectName},${config.developerName},${config.city},${cleanUrl},,${totalUnits},,${cleanUrl}\n`;
    await fs.appendFile(PROJECTS_CSV, newLine);
    console.log(`[ANALISTA] Proyecto ${config.projectName} agregado a proyectos.csv`);
  } catch (e) {
    console.error(`[ANALISTA] Error actualizando proyectos.csv:`, (e as Error).message);
  }
}

/**
 * Escribe unidades al inventario.csv (append, no sobrescribe).
 */
async function writeToInventoryCSV(
  projectName: string,
  units: ParsedUnit[],
  fs: typeof import("fs/promises"),
) {
  const today = new Date().toISOString().split("T")[0];

  let needsHeader = false;
  try {
    const existing = await fs.readFile(INVENTORY_CSV, "utf-8");
    needsHeader = existing.trim().length === 0;
  } catch {
    needsHeader = true;
  }

  const lines: string[] = [];
  if (needsHeader) {
    lines.push("proyecto,unidad,tipo,tipologia,recamaras,alberca,superficie_m2,precio_lista_mxn,estado,piso,fecha_revision");
  }

  for (const unit of units) {
    const tipo = unit.unitType || "";
    const tipologia = tipo;
    const recamaras = unit.bedrooms || "";
    const alberca = unit.extras?.toLowerCase().includes("alberca") ? "SI" : "";
    const superficie = unit.area_m2 || "";
    const precio = unit.price || "";
    const estado = (unit.status || "disponible").toLowerCase();
    const piso = unit.floor != null ? (unit.floor === 0 ? "PB" : `NIVEL ${unit.floor}`) : "";

    lines.push(`${projectName},${unit.unitNumber},${tipo},${tipologia},${recamaras},${alberca},${superficie},${precio},${estado},${piso},${today}`);
  }

  await fs.appendFile(INVENTORY_CSV, lines.join("\n") + "\n");
  console.log(`[ANALISTA] ${units.length} unidades escritas a inventario.csv`);
}

/**
 * Parsea un PDF usando Python + pdfplumber (más robusto que pdf-parse en Node).
 * Ejecuta un script Python inline que extrae texto y parsea unidades.
 */
async function parseFileInSubprocess(
  filePath: string,
  execSync: typeof import("child_process").execSync,
): Promise<ParsedUnit[]> {
  const pythonScript = `
import pdfplumber, json, re, sys

units = []
with pdfplumber.open(sys.argv[1]) as pdf:
    for page in pdf.pages:
        text = page.extract_text() or ""
        for line in text.split("\\n"):
            line = line.strip()
            if not line:
                continue

            # Buscar patrón: #NNN o NNN seguido de tipo, m2, precio, status
            unit_match = re.search(r'#?(\\d{3,4}[A-Z]?)\\b', line)
            if not unit_match:
                continue

            # Buscar precio ($X,XXX,XXX.XX)
            price_match = re.search(r'\\$([\\d,.O]+)', line)
            if not price_match:
                continue

            price_str = price_match.group(1).replace(',', '').replace('O', '0')
            try:
                price = float(price_str)
            except:
                continue

            if price < 100000 or price > 50000000:
                continue

            # Area total (último número decimal antes del precio)
            area_matches = re.findall(r'(\\d+[,.]\\d+)', line[:line.find('$')] if '$' in line else line)
            area = float(area_matches[-1].replace(',', '.')) if area_matches else None

            # Tipo
            tipo = ""
            if "1 REC" in line.upper(): tipo = "1 REC"
            elif "2 REC" in line.upper(): tipo = "2 REC"
            elif "3 REC" in line.upper(): tipo = "3 REC"
            elif "ESTUDIO" in line.upper(): tipo = "ESTUDIO"
            elif "PH" in line.upper() or "PENTHOUSE" in line.upper(): tipo = "PENTHOUSE"

            # Status
            status = "DISPONIBLE"
            lower = line.lower()
            if "vendido" in lower or "vendida" in lower: status = "VENDIDA"
            elif "apartado" in lower or "reserv" in lower: status = "APARTADA"

            # Modelo
            model_match = re.search(r'T-[\\w-]+', line)
            model = model_match.group(0) if model_match else ""

            units.append({
                "unitNumber": unit_match.group(1),
                "unitType": tipo or model,
                "area_m2": area,
                "price": price,
                "status": status,
                "currency": "MXN",
            })

print(json.dumps(units))
`;

  const scriptPath = path.resolve(process.cwd(), "scripts/parse-pdf.py");

  try {
    const result = execSync(
      `python3 "${scriptPath}" "${filePath}"`,
      { timeout: 60000, encoding: "utf-8" }
    );

    return JSON.parse(result.trim() || "[]") as ParsedUnit[];
  } catch (e) {
    console.error(`[ANALISTA] Python parser error:`, (e as Error).message?.slice(0, 200));
    return [];
  }
}

async function listFilesRecursive(dirPath: string, fs: typeof import("fs/promises")): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listFilesRecursive(fullPath, fs));
      } else {
        results.push(fullPath);
      }
    }
  } catch { /* ok */ }
  return results;
}

function slugify(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
