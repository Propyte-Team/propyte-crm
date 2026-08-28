"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { avisoDeOrigen, type DatosDeConexion } from "@/lib/mcp/revision/conexion";
import { rotarTokenRevision } from "@/server/revision-token";

/**
 * La entrega del secreto, y su rotación.
 *
 * POR QUÉ SE ENTREGA DESDE EL PRODUCTO. Con el token en la ruta, lo que alguien copia y
 * pega ES la credencial. Si vive en un documento de onboarding o en un mensaje de chat,
 * la rotación es teoría: nadie sabe cuántas copias hay. Que salga de aquí es lo que la
 * hace posible.
 *
 * POR QUÉ VIENE TAPADO. Esta pantalla se abre en juntas y se comparte pantalla. Un
 * secreto que se pinta solo obliga a acordarse de no proyectarlo; uno que hay que
 * destapar a propósito, no.
 */
export function PanelConexion({ datos }: { datos: DatosDeConexion }) {
  const [visible, setVisible] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, arrancar] = useTransition();

  const aviso = avisoDeOrigen(datos.origen);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles el usuario todavía puede destapar y seleccionar a
      // mano. Decírselo es más útil que un botón que no hace nada.
      setError("No se pudo copiar. Muestra la URL y cópiala a mano.");
    }
  };

  const rotar = () => {
    setError(null);
    arrancar(async () => {
      try {
        await rotarTokenRevision();
        setConfirmando(false);
        setVisible(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo rotar el token.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">URL del servidor MCP</p>
          {datos.lista && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setVisible((v) => !v)}>
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                <span className="ml-1.5">{visible ? "Ocultar" : "Mostrar"}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={copiar}>
                {copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1.5">{copiado ? "Copiada" : "Copiar"}</span>
              </Button>
            </div>
          )}
        </div>

        {datos.lista ? (
          <>
            <p className="mt-3 break-all rounded bg-muted px-3 py-2 font-mono text-xs">
              {visible
                ? datos.url
                : // Se deja ver el host y la ruta: identifican la puerta sin revelar nada.
                  datos.url.replace(/\/[^/]+$/, "/••••••••••••••••")}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {/* Un secreto sin fecha no se rota nunca. La ausencia se declara. */}
              {datos.rotadoEn
                ? `Última rotación: ${new Date(datos.rotadoEn).toLocaleString("es-MX")}.`
                : "Nunca se ha rotado desde aquí."}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{datos.motivo}</p>
        )}
      </div>

      {aviso && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p>{aviso}</p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!confirmando ? (
        <Button variant={datos.lista ? "outline" : "default"} onClick={() => setConfirmando(true)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {datos.lista ? "Generar un token nuevo" : "Generar el primer token"}
        </Button>
      ) : (
        // Confirmación en dos pasos: la rotación NO tiene ventana de convivencia y rompe
        // el conector que ya esté funcionando. Un botón de un solo clic aquí sería una
        // caída de servicio a un dedo de distancia.
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium">
            {datos.lista
              ? "El token actual dejará de servir de inmediato."
              : "Se generará el primer token de la puerta."}
          </p>
          {datos.lista && (
            <p className="mt-1 text-sm text-muted-foreground">
              La revisión diaria de Cowork va a fallar hasta que pegues la URL nueva en su
              conector. No hay periodo de gracia.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="destructive" size="sm" onClick={rotar} disabled={pendiente}>
              {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sí, generar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmando(false)}
              disabled={pendiente}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
