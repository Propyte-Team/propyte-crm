// Página de inicio de sesión del CRM Propyte — Flujo OTP por email
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
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<"email" | "code">("email")
  const [requestingCode, setRequestingCode] = useState(false)

  // Paso 1: Solicitar código de acceso
  async function handleRequestCode(e?: FormEvent) {
    e?.preventDefault()
    setError("")
    setSuccess("")

    if (!email.trim()) {
      setError("Ingresa tu correo electrónico")
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
        setStep("code")
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

  // Paso 2: Iniciar sesión con el código
  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!code.trim()) {
      setError("Ingresa el código de 6 dígitos")
      return
    }

    setLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password: code,
        redirect: false,
      })

      if (result?.error) {
        setError("Código inválido o expirado. Solicita uno nuevo.")
      } else {
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
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-primary">PROPYTE</h1>
            <Badge variant="secondary" className="text-sm">
              CRM
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {step === "email"
              ? "Ingresa tu correo para recibir un código de acceso"
              : "Ingresa el código que enviamos a tu correo"}
          </p>
        </CardHeader>

        <CardContent>
          {step === "email" ? (
            // Paso 1: Solicitar código
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={requestingCode}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={requestingCode}
              >
                {requestingCode ? "Enviando código..." : "Solicitar código de acceso"}
              </Button>
            </form>
          ) : (
            // Paso 2: Ingresar código
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {email}
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Código de acceso</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={loading}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                />
              </div>

              {success && (
                <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">
                  {success}
                </div>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verificando..." : "Acceder"}
              </Button>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("email")
                    setCode("")
                    setError("")
                    setSuccess("")
                  }}
                >
                  Cambiar correo
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRequestCode()}
                  disabled={requestingCode}
                >
                  {requestingCode ? "Enviando..." : "Reenviar código"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
