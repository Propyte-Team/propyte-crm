// Layout raíz del CRM Propyte - configura fuentes, metadata y proveedores globales
import type { Metadata } from "next"
import localFont from "next/font/local"

import { Providers } from "@/components/layout/providers"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

// Pareja tipográfica del speckit de diseño §2.2: grotesque con carácter para UI
// + mono tabular para cifras ("instrumento financiero", no app de IA)
//
// Auto-hospedadas (next/font/local) en vez de next/font/google: el build de hPanel
// falló con "Cannot read properties of null (reading '1')" en el font loader — ese
// error sale cuando next/font/google no logra bajar el CSS de fonts.googleapis.com
// durante el build (red restringida en el servidor de build) y el regex interno que
// lo parsea recibe una respuesta vacía/inválida. Los .woff2 vienen de @fontsource
// (mismo archivo que sirve Google Fonts, licencia OFL, ver LICENSE-OFL.txt en cada
// carpeta) así que no cambia ni la tipografía ni los pesos, solo elimina la
// dependencia de red en tiempo de build.
const spaceGrotesk = localFont({
  src: [
    { path: "../fonts/space-grotesk/space-grotesk-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/space-grotesk/space-grotesk-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/space-grotesk/space-grotesk-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/space-grotesk/space-grotesk-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
})
const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/jetbrains-mono/jetbrains-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
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
