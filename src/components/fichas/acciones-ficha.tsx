"use client";

// Botones de la ficha pública (#887). Los usa cualquiera que la abra: el cliente, el broker o
// quien recibió un reenvío. Todos comparten EL MISMO enlace, así que la ficha llega con el
// contacto del asesor que la creó.
import { useState } from "react";
import { enlaceParaReenviar, textoParaCompartir, type TipoFicha } from "@/lib/fichas/compartir";

interface Props {
  url: string;
  vista: { titulo: string; subtitulo: string | null; tipo: TipoFicha };
  imagenUrl: string;
}

const boton =
  "inline-flex items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-85";

export function AccionesFicha({ url, vista, imagenUrl }: Props) {
  const [copiado, setCopiado] = useState(false);
  const puedeCompartirNativo = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function compartir() {
    if (puedeCompartirNativo) {
      try {
        await navigator.share({ title: vista.titulo, text: textoParaCompartir(vista), url });
        return;
      } catch (err) {
        // Cerrar la hoja de compartir lanza AbortError: no es un fallo.
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    window.open(enlaceParaReenviar(url, vista), "_blank", "noopener");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt("Copia el enlace:", url);
    }
  }

  return (
    <div className="no-print grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <button type="button" onClick={compartir} className={`${boton} col-span-2 bg-[#111] text-white sm:col-span-1`}>
        Compartir ficha
      </button>
      <button type="button" onClick={copiar} className={`${boton} border border-black/15 bg-white text-[#111]`}>
        {copiado ? "¡Enlace copiado!" : "Copiar enlace"}
      </button>
      <a href={`${imagenUrl}?descargar=1`} className={`${boton} border border-black/15 bg-white text-[#111]`}>
        Descargar imagen
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className={`${boton} col-span-2 border border-black/15 bg-white text-[#111] sm:col-span-1`}
      >
        Guardar PDF
      </button>
    </div>
  );
}
