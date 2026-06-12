// Layout raíz del CRM Propyte - configura fuentes, metadata y proveedores globales
import type { Metadata } from "next"
import { Space_Grotesk, JetBrains_Mono } from "next/font/google"

import { Providers } from "@/components/layout/providers"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

// Pareja tipográfica del speckit de diseño §2.2: grotesque con carácter para UI
// + mono tabular para cifras ("instrumento financiero", no app de IA)
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
})

// Metadata de la aplicación
export const metadata: Metadata = {
  title: "Propyte CRM",
  description: "CRM interno de Propyte",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
