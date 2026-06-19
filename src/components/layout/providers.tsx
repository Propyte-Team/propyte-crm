// Proveedores globales del CRM: autenticación y tema
"use client"

import * as React from "react"
import { SessionProvider, useSession } from "next-auth/react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { VoiceDeviceProvider } from "@/components/voice/voice-device-provider"

// Proveedor de tema con soporte para modo oscuro basado en clases
function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

// Lee la sesión y monta VoiceDeviceProvider con el userId del usuario autenticado
function VoiceWithSession({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  return <VoiceDeviceProvider userId={(data?.user as { id?: string })?.id}>{children}</VoiceDeviceProvider>;
}

// Wrapper principal que envuelve la app con SessionProvider y ThemeProvider
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <VoiceWithSession>
          {children}
        </VoiceWithSession>
      </ThemeProvider>
    </SessionProvider>
  )
}
