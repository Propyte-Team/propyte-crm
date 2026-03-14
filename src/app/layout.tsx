// Layout raíz del CRM Propyte - configura fuente, metadata y proveedores globales
import type { Metadata } from "next"
import { Inter } from "next/font/google"

import { Providers } from "@/components/layout/providers"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

// Fuente principal del CRM
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

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
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
