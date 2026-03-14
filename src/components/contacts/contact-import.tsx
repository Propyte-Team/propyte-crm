// Diálogo de importación de contactos desde archivo CSV
"use client";

import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { importContactsFromCSV } from "@/server/contacts";

interface ContactImportProps {
  onSuccess: () => void;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  errors: number;
  errorDetails?: string[];
}

export function ContactImport({ onSuccess }: ContactImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState("");
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manejar selección de archivo CSV
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validar extensión del archivo
    if (!selectedFile.name.endsWith(".csv")) {
      setError("Solo se permiten archivos .csv");
      return;
    }

    setFile(selectedFile);
    setError("");
    setResult(null);

    // Leer contenido del CSV para preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);

      const lines = text.trim().split("\n");
      if (lines.length < 2) {
        setError("El archivo debe tener al menos una fila de encabezados y una de datos");
        return;
      }

      // Parsear encabezados
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
      setPreviewHeaders(headers);

      // Parsear primeras 5 filas para preview
      const dataLines = lines.slice(1).filter((l) => l.trim());
      setTotalRows(dataLines.length);
      const previewData = dataLines.slice(0, 5).map((line) =>
        line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""))
      );
      setPreviewRows(previewData);
    };
    reader.readAsText(selectedFile);
  };

  // Ejecutar importación
  const handleImport = async () => {
    if (!csvContent) return;

    setImporting(true);
    setProgress(20);
    setError("");
    setResult(null);

    try {
      setProgress(50);

      // Llamar server action para importar
      const importResult = await importContactsFromCSV(csvContent);

      setProgress(100);

      if ("error" in importResult && typeof importResult.error === "string") {
        setError(importResult.error);
      } else {
        setResult(importResult as ImportResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al importar contactos");
    } finally {
      setImporting(false);
    }
  };

  // Resetear formulario
  const handleReset = () => {
    setFile(null);
    setCsvContent("");
    setPreviewHeaders([]);
    setPreviewRows([]);
    setTotalRows(0);
    setResult(null);
    setError("");
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Zona de carga de archivo */}
      {!file && !result && (
        <div
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 cursor-pointer hover:border-muted-foreground/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">Haz clic para seleccionar un archivo CSV</p>
          <p className="text-xs text-muted-foreground mt-1">
            Columnas esperadas: nombre, apellido, telefono, email, fuente
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Preview del archivo */}
      {file && previewHeaders.length > 0 && !result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {totalRows} fila{totalRows !== 1 ? "s" : ""} de datos detectada{totalRows !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Cambiar archivo
            </Button>
          </div>

          {/* Tabla de preview */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted">
                  {previewHeaders.map((header, i) => (
                    <th key={i} className="px-3 py-2 text-left font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2">
                        {cell || <span className="text-muted-foreground">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalRows > 5 && (
            <p className="text-xs text-muted-foreground text-center">
              Mostrando 5 de {totalRows} filas
            </p>
          )}

          {/* Barra de progreso durante importación */}
          {importing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">
                Importando contactos...
              </p>
            </div>
          )}

          {/* Botón de importación */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset} disabled={importing}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? "Importando..." : `Importar ${totalRows} contacto${totalRows !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      )}

      {/* Resultados de la importación */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium">Resultado de la importación</h4>

            {/* Contactos importados */}
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>
                <strong>{result.imported}</strong> contacto{result.imported !== 1 ? "s" : ""} importado{result.imported !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Duplicados */}
            {result.duplicates > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span>
                  <strong>{result.duplicates}</strong> duplicado{result.duplicates !== 1 ? "s" : ""} (ya existían por teléfono)
                </span>
              </div>
            )}

            {/* Errores */}
            {result.errors > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span>
                    <strong>{result.errors}</strong> error{result.errors !== 1 ? "es" : ""}
                  </span>
                </div>
                {result.errorDetails && result.errorDetails.length > 0 && (
                  <div className="ml-6 text-xs text-muted-foreground space-y-0.5">
                    {result.errorDetails.slice(0, 10).map((detail, i) => (
                      <p key={i}>{detail}</p>
                    ))}
                    {result.errorDetails.length > 10 && (
                      <p>... y {result.errorDetails.length - 10} más</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Acciones post-importación */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset}>
              Importar otro archivo
            </Button>
            <Button onClick={onSuccess}>Cerrar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
