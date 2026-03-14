// Componente Skeleton para estados de carga del CRM
import { cn } from "@/lib/utils"

// Placeholder animado que se muestra mientras carga el contenido real
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
