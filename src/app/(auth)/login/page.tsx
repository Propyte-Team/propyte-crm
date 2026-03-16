// Página de inicio de sesión del CRM Propyte — Contraseña + OTP
"use client"

import { useState, FormEvent } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type LoginMode = "password" | "otp-request" | "otp-verify"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<LoginMode>("password")

  // Login con contraseña
  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault()
    setError("")

    if (!email.trim() || !password.trim()) {
      setError("Correo y contraseña son requeridos")
      return
    }

    setLoading(true)
    try {
      const result = await signIn("credentials", {
        email,
        password,
        loginMethod: "password",
        redirect: false,
      })

      if (result?.error) {
        setError("Credenciales inválidas")
      } else {
        router.push("/dashboard")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  // Solicitar código OTP
  async function handleRequestCode(e?: FormEvent) {
    e?.preventDefault()
    setError("")
    setSuccess("")

    if (!email.trim()) {
      setError("Ingresa tu correo electrónico")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setMode("otp-verify")
        setSuccess("Código enviado. Revisa tu bandeja de entrada.")
      } else {
        const data = await res.json()
        setError(data.error || "Error al solicitar el código")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  // Login con código OTP
  async function handleCodeLogin(e: FormEvent) {
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
        loginMethod: "otp",
        redirect: false,
      })

      if (result?.error) {
        setError("Código inválido o expirado")
      } else {
        router.push("/dashboard")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
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
            <Badge variant="secondary" className="text-sm">CRM</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Inicia sesión para acceder al sistema
          </p>
        </CardHeader>

        <CardContent>
          {/* === MODO CONTRASEÑA === */}
          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline"
                  onClick={() => {
                    setMode("otp-request")
                    setError("")
                    setPassword("")
                  }}
                >
                  Acceder con código por correo
                </button>
              </div>
            </form>
          )}

          {/* === MODO OTP: SOLICITAR CÓDIGO === */}
          {mode === "otp-request" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-otp">Correo electrónico</Label>
                <Input
                  id="email-otp"
                  type="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Enviando código..." : "Enviar código de acceso"}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline"
                  onClick={() => {
                    setMode("password")
                    setError("")
                    setCode("")
                  }}
                >
                  Volver a inicio con contraseña
                </button>
              </div>
            </form>
          )}

          {/* === MODO OTP: VERIFICAR CÓDIGO === */}
          {mode === "otp-verify" && (
            <form onSubmit={handleCodeLogin} className="space-y-4">
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
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline"
                  onClick={() => {
                    setMode("password")
                    setCode("")
                    setError("")
                    setSuccess("")
                  }}
                >
                  Usar contraseña
                </button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline"
                  onClick={() => handleRequestCode()}
                  disabled={loading}
                >
                  Reenviar código
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
