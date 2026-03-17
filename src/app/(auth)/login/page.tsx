// Página de inicio de sesión del CRM Propyte — Estilo HubSpot
"use client"

import { useState, FormEvent } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

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
        setSuccess("Código enviado a tu correo")
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
    <div className="flex min-h-screen items-center justify-center bg-[#f5f8fa] dark:bg-[#0a0a0a]">
      <div className="w-full max-w-[400px] px-6">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-propyte-aqua">
              <span className="text-lg font-bold text-white">P</span>
            </div>
            <span className="text-2xl font-bold text-[#1a1d21] dark:text-white">Propyte</span>
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Inicia sesión en tu CRM
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-[#1a1d21]">

          {/* === CONTRASEÑA === */}
          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-propyte-teal dark:focus:border-propyte-aqua focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d0f11] dark:text-white dark:placeholder:text-gray-500 dark:focus:border-propyte-teal dark:focus:border-propyte-aqua"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-propyte-teal dark:focus:border-propyte-aqua focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d0f11] dark:text-white dark:placeholder:text-gray-500 dark:focus:border-propyte-teal dark:focus:border-propyte-aqua"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-propyte-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-propyte-teal/90 dark:bg-propyte-aqua dark:text-propyte-aztec dark:hover:bg-propyte-aqua/90 focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? "Iniciando sesión..." : "Iniciar sesión"}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-[13px] text-propyte-teal dark:text-propyte-aqua hover:underline"
                  onClick={() => { setMode("otp-request"); setError(""); setPassword(""); }}
                >
                  Acceder con código por correo
                </button>
              </div>
            </form>
          )}

          {/* === OTP: SOLICITAR === */}
          {mode === "otp-request" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="email-otp" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Correo electrónico
                </label>
                <input
                  id="email-otp"
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-propyte-teal dark:focus:border-propyte-aqua focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d0f11] dark:text-white dark:placeholder:text-gray-500 dark:focus:border-propyte-teal dark:focus:border-propyte-aqua"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-propyte-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-propyte-teal/90 dark:bg-propyte-aqua dark:text-propyte-aztec dark:hover:bg-propyte-aqua/90 focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? "Enviando..." : "Enviar código de acceso"}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-[13px] text-propyte-teal dark:text-propyte-aqua hover:underline"
                  onClick={() => { setMode("password"); setError(""); setCode(""); }}
                >
                  Volver a inicio con contraseña
                </button>
              </div>
            </form>
          )}

          {/* === OTP: VERIFICAR === */}
          {mode === "otp-verify" && (
            <form onSubmit={handleCodeLogin} className="space-y-4">
              <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600 dark:bg-white/5 dark:text-gray-400">
                {email}
              </div>

              <div>
                <label htmlFor="code" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Código de acceso
                </label>
                <input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={loading}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-center text-lg font-mono tracking-[0.3em] text-gray-900 placeholder:text-gray-400 focus:border-propyte-teal dark:focus:border-propyte-aqua focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 disabled:opacity-50 dark:border-gray-700 dark:bg-[#0d0f11] dark:text-white dark:placeholder:text-gray-500 dark:focus:border-propyte-teal dark:focus:border-propyte-aqua"
                />
              </div>

              {success && (
                <div className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                  {success}
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-propyte-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-propyte-teal/90 dark:bg-propyte-aqua dark:text-propyte-aztec dark:hover:bg-propyte-aqua/90 focus:outline-none focus:ring-2 focus:ring-propyte-teal/20 dark:focus:ring-propyte-aqua/20 focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? "Verificando..." : "Acceder"}
              </button>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-[13px] text-propyte-teal dark:text-propyte-aqua hover:underline"
                  onClick={() => { setMode("password"); setCode(""); setError(""); setSuccess(""); }}
                >
                  Usar contraseña
                </button>
                <button
                  type="button"
                  className="text-[13px] text-propyte-teal dark:text-propyte-aqua hover:underline"
                  onClick={() => handleRequestCode()}
                  disabled={loading}
                >
                  Reenviar código
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[12px] text-gray-400 dark:text-gray-600">
          Propyte CRM &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
