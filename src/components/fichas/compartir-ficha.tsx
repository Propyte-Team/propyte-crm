"use client";

// Botón «Compartir ficha» del CRM (#887). Pide (o recupera) el enlace del asesor en sesión para
// un desarrollo o una unidad y ofrece mandarlo por WhatsApp, copiarlo, abrirlo o bajar la imagen.
// Si a su perfil le faltan datos de contacto, lo dice aquí: sin WhatsApp, la ficha solo lleva
// su nombre y su correo.
import { useState } from "react";
import Link from "next/link";
import { Share2, Copy, ExternalLink, Download, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enlaceParaReenviar, type TipoFicha } from "@/lib/fichas/compartir";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  developmentId: string;
  unitId?: string | null;
  /** "boton" en la cabecera del desarrollo; "enlace" compacto en la fila de una unidad. */
  variante?: "boton" | "enlace";
}

interface FichaRespuesta {
  token: string;
  url: string;
  titulo: string;
  subtitulo: string | null;
  tipo: TipoFicha;
  contacto: { nombre: string; whatsapp: string | null; telefono: string | null; correo: string } | null;
  faltantes: string[];
  aperturas: number;
  ultimaApertura: string | null;
}

function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

export function CompartirFicha({ developmentId, unitId = null, variante = "boton" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaRespuesta | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function abrir() {
    setAbierto(true);
    setError(null);
    setCargando(true);
    try {
      const res = await fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developmentId, unitId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "No se pudo preparar la ficha.");
        return;
      }
      setFicha(json.data as FichaRespuesta);
    } catch {
      setError("No se pudo preparar la ficha. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function copiar() {
    if (!ficha) return;
    try {
      await navigator.clipboard.writeText(ficha.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt("Copia el enlace:", ficha.url);
    }
  }

  const disparador =
    variante === "enlace" ? (
      <button type="button" onClick={abrir} className="inline-flex items-center gap-1 text-xs underline">
        <Share2 className="h-3 w-3" /> Ficha
      </button>
    ) : (
      <Button size="sm" onClick={abrir}>
        <Share2 className="mr-1 h-4 w-4" /> Compartir ficha
      </Button>
    );

  return (
    <>
      {disparador}
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compartir ficha técnica</DialogTitle>
            <DialogDescription>
              El enlace lleva tus datos de contacto. Si tu cliente o un broker lo reenvía, la ficha
              sigue mostrando tu contacto.
            </DialogDescription>
          </DialogHeader>

          {cargando && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparando la ficha…
            </div>
          )}

          {!cargando && error && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={abrir}>Reintentar</Button>
            </div>
          )}

          {!cargando && !error && ficha && (
            <div className="space-y-4">
              <div>
                <p className="font-medium">{ficha.titulo}</p>
                {ficha.subtitulo && <p className="text-sm text-muted-foreground">{ficha.subtitulo}</p>}
              </div>

              {ficha.faltantes.length > 0 && (
                <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    A tu perfil le falta: {ficha.faltantes.join(", ")}. Sin eso, quien reciba la ficha
                    solo verá tu nombre y tu correo.{" "}
                    <Link href="/settings" className="font-medium underline">Completar mi perfil</Link>
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{ficha.url}</span>
                <Button variant="ghost" size="sm" onClick={copiar}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> {copiado ? "Copiado" : "Copiar"}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button asChild className="col-span-2">
                  <a
                    href={enlaceParaReenviar(ficha.url, ficha)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enviar por WhatsApp
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={`/f/${ficha.token}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" /> Ver ficha
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={`/f/${ficha.token}/imagen?descargar=1`}>
                    <Download className="mr-1 h-4 w-4" /> Descargar imagen
                  </a>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {ficha.aperturas > 0 && ficha.ultimaApertura
                  ? `Abierta ${ficha.aperturas} ${ficha.aperturas === 1 ? "vez" : "veces"} · la última ${haceCuanto(ficha.ultimaApertura)}.`
                  : "Aún nadie ha abierto este enlace."}{" "}
                Es el mismo enlace cada vez que compartes esta ficha.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
