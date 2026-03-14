// Layout de autenticación: sin sidebar, contenido centrado con fondo claro
import { Providers } from "@/components/layout/providers"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <Providers>{children}</Providers>
    </div>
  )
}
