"use client";

// Frontera de error de la propuesta de unidades pública (#716).
import { PublicError } from "@/components/shared/public-error";

export default function ShortlistError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicError
      {...props}
      queNoCargo="esta propuesta"
      salida="Si vuelve a fallar, escríbele a tu asesor y te la reenvía."
    />
  );
}
