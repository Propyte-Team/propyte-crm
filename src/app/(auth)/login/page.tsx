// Página de inicio de sesión del CRM Propyte
"use client"

import { useState, FormEvent } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [requestingCode, setRequestingCode] = useState(false)

  // Solicitar código de acceso por email
  async function handleRequestCode() {
    setError("")
    setSuccess("")

    if (!email.trim()) {
      setError("Ingresa tu correo electrónico primero")
      return
    }

    setRequestingCode(true)

    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setCodeSent(true)
        setSuccess("Código enviado. Revisa tu bandeja de entrada.")
      } else {
        const data = await res.json()
        setError(data.error || "Error al solicitar el código")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo más tarde.")
    } finally {
      setRequestingCode(false)
    }
  }

  // Validación y envío del formulario de login
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setSuccess("")

    // Validación básica de campos
    if (!email.trim()) {
      setError("El correo electrónico es obligatorio")
      return
    }
    if (!password.trim()) {
      setError("La contraseña es obligatoria")
      return
    }

    setLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Credenciales inválidas. Verifica tu correo y contraseña.")
      } else {
        // Redirección al dashboard tras inicio exitoso
        router.push("/dashboard")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo más tarde.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center space-y-2">
          {/* Logo y marca Propyte */}
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-primary">PROPYTE</h1>
            <Badge variant="secondary" className="text-sm">
              CRM
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Inicia sesión para acceder al sistema
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Campo de correo electrónico */}
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || requestingCode}
                autoComplete="email"
              />
            </div>

            {/* Campo de contraseña / código */}
            <div className="space-y-2">
              <Label htmlFor="password">
                {codeSent ? "Código de acceso" : "Contraseña"}
              </Label>
              <Input
                id="password"
                type={codeSent ? "text" : "password"}
                placeholder={codeSent ? "123456" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete={codeSent ? "one-time-code" : "current-password"}
                inputMode={codeSent ? "numeric" : undefined}
                maxLength={codeSent ? 6 : undefined}
              />
            </div>

            {/* Mensaje de éxito */}
            {success && (
              <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">
                {success}
              </div>
            )}

            {/* Mensaje de error si existe */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Botón de inicio de sesión */}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
            </Button>

            {/* Separador */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  o
                </span>
              </div>
            </div>

            {/* Botón de solicitar código */}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleRequestCode}
              disabled={requestingCode || loading}
            >
              {requestingCode
                ? "Enviando código..."
                : codeSent
                  ? "Reenviar código"
                  : "Solicitar código por correo"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
