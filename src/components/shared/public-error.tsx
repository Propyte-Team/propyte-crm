"use client";

// Pantalla de error de las páginas que ve el CLIENTE (#716).
//
// Antes solo había dos fronteras de error en toda la aplicación, las dos del lado interno.
// En /q (su cotización), /p (la propuesta de unidades), /t (la ficha del asesor) y /portal,
// un parpadeo de la base —que en este proyecto pasa: el pooler de Supabase se reinicia—
// dejaba al cliente delante de la pantalla blanca de Next, en inglés y con la traza.
//
// El texto es para un cliente, no para el equipo: sin jerga, sin "avisa al equipo", sin
// pedirle que reporte nada. Y sin exponer el mensaje del error, que puede llevar dentro
// nombres de tablas o de columnas.

import { useEffect } from "react";

export interface PublicErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Qué no se pudo cargar, en las palabras del cliente. */
  queNoCargo: string;
  /** Qué puede hacer si vuelve a fallar. */
  salida?: string;
}

export function PublicError({ error, reset, queNoCargo, salida }: PublicErrorProps) {
  useEffect(() => {
    // Al servidor sí le interesa el detalle; a la pantalla no.
    console.error("[público] error boundary:", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "48px 24px",
        textAlign: "center",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: "#1a1a1a",
        background: "#ffffff",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
        No pudimos mostrar {queNoCargo}
      </h1>
      <p style={{ margin: 0, maxWidth: "44ch", fontSize: 15, lineHeight: 1.6, color: "#5a5a5a" }}>
        Casi siempre es algo pasajero. Vuelve a intentarlo en unos segundos: tu enlace sigue
        siendo válido.
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: 8,
          borderRadius: 8,
          border: "none",
          padding: "10px 20px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          background: "#1a1a1a",
          color: "#ffffff",
        }}
      >
        Reintentar
      </button>
      {salida && (
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#5a5a5a", maxWidth: "44ch" }}>
          {salida}
        </p>
      )}
      {error.digest && (
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "#9a9a9a" }}>
          Referencia: {error.digest}
        </p>
      )}
    </main>
  );
}
