"use client";

// Frontera de error del portal de desarrolladores (#716).
// Aquí sí hay una persona con cuenta del otro lado, así que la salida es volver al inicio
// del portal en vez de escribirle a un asesor.
import { PublicError } from "@/components/shared/public-error";

export default function PortalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicError
      {...props}
      queNoCargo="esta sección del portal"
      salida="Si vuelve a fallar, vuelve al inicio del portal y entra de nuevo."
    />
  );
}
