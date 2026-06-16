"use client";

// Último recurso: captura errores del layout raíz (donde el error boundary del
// dashboard ya no aplica). Debe renderizar su propio <html>/<body> y no hereda estilos.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary:", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#f5f5f5",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Algo salió mal</h1>
        <p style={{ color: "#a3a3a3", marginTop: 8, maxWidth: 420 }}>
          Ocurrió un error inesperado. Intenta recargar; si persiste, avisa al equipo.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            borderRadius: 8,
            border: 0,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            background: "#f5f5f5",
            color: "#0a0a0a",
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
        {error.digest && (
          <p style={{ color: "#a3a3a3", marginTop: 16, fontSize: 11 }}>Ref: {error.digest}</p>
        )}
      </body>
    </html>
  );
}
