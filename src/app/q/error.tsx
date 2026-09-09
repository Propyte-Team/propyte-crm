"use client";

// Frontera de error de la cotización pública (#716).
import { PublicError } from "@/components/shared/public-error";

export default function QuoteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicError
      {...props}
      queNoCargo="tu cotización"
      salida="Si vuelve a fallar, escríbele a tu asesor y te la reenvía."
    />
  );
}
