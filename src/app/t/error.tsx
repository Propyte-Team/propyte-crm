"use client";

// Frontera de error de la ficha pública del asesor (#716).
import { PublicError } from "@/components/shared/public-error";

export default function ProfileError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PublicError {...props} queNoCargo="esta ficha" />;
}
