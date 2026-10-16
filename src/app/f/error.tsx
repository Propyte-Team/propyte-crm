"use client";

// Frontera de error de la ficha técnica pública (#887, mismo patrón que #716).
import { PublicError } from "@/components/shared/public-error";

export default function FichaError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicError
      {...props}
      queNoCargo="esta ficha"
      salida="Si vuelve a fallar, escríbele a quien te la compartió y te la reenvía."
    />
  );
}
