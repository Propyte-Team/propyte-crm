// Login page — CRM Propyte (ES/EN)
"use client"

import { useState, useEffect, useCallback, FormEvent } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

type Lang = "es" | "en"
type LoginMode = "password" | "otp-request" | "otp-verify" | "forgot-request" | "forgot-code" | "forgot-new-password"

const t = {
  es: {
    subtitle: "Inicia sesion en tu CRM",
    email: "Correo electronico",
    emailPlaceholder: "tu@empresa.com",
    password: "Contrasena",
    passwordPlaceholder: "••••••••",
    login: "Iniciar sesion",
    loggingIn: "Iniciando sesion...",
    otpLink: "Acceder con codigo por correo",
    backToPassword: "Volver a inicio con contrasena",
    sendCode: "Enviar codigo de acceso",
    sending: "Enviando...",
    accessCode: "Codigo de acceso",
    codePlaceholder: "000000",
    access: "Acceder",
    verifying: "Verificando...",
    usePassword: "Usar contrasena",
    resendCode: "Reenviar codigo",
    errRequired: "Correo y contrasena son requeridos",
    errInvalid: "Credenciales invalidas",
    errConnection: "Error de conexion. Intenta de nuevo.",
    errEmailRequired: "Ingresa tu correo electronico",
    errCodeRequired: "Ingresa el codigo de 6 digitos",
    errCodeInvalid: "Codigo invalido o expirado",
    errCodeRequest: "Error al solicitar el codigo",
    successCode: "Codigo enviado a tu correo",
    forgotLink: "Olvide mi contrasena",
    forgotTitle: "Restablecer contrasena",
    forgotSubtitle: "Ingresa tu correo para recibir un codigo de verificacion",
    sendResetCode: "Enviar codigo",
    resetCode: "Codigo de verificacion",
    newPassword: "Nueva contrasena",
    newPasswordPlaceholder: "Minimo 6 caracteres",
    confirmPassword: "Confirmar contrasena",
    confirmPasswordPlaceholder: "Repite la contrasena",
    changePassword: "Cambiar contrasena",
    changingPassword: "Cambiando...",
    passwordChanged: "Contrasena actualizada. Ahora puedes iniciar sesion.",
    errPasswordShort: "La contrasena debe tener al menos 6 caracteres",
    errPasswordMismatch: "Las contrasenas no coinciden",
    errResetFailed: "Error al restablecer la contrasena",
    backToLogin: "Volver a iniciar sesion",
    footer: "Propyte CRM",
  },
  en: {
    subtitle: "Sign in to your CRM",
    email: "Email address",
    emailPlaceholder: "you@company.com",
    password: "Password",
    passwordPlaceholder: "••••••••",
    login: "Sign in",
    loggingIn: "Signing in...",
    otpLink: "Sign in with email code",
    backToPassword: "Back to password login",
    sendCode: "Send access code",
    sending: "Sending...",
    accessCode: "Access code",
    codePlaceholder: "000000",
    access: "Sign in",
    verifying: "Verifying...",
    usePassword: "Use password",
    resendCode: "Resend code",
    errRequired: "Email and password are required",
    errInvalid: "Invalid credentials",
    errConnection: "Connection error. Try again.",
    errEmailRequired: "Enter your email address",
    errCodeRequired: "Enter the 6-digit code",
    errCodeInvalid: "Invalid or expired code",
    errCodeRequest: "Error requesting code",
    successCode: "Code sent to your email",
    forgotLink: "Forgot password",
    forgotTitle: "Reset password",
    forgotSubtitle: "Enter your email to receive a verification code",
    sendResetCode: "Send code",
    resetCode: "Verification code",
    newPassword: "New password",
    newPasswordPlaceholder: "At least 6 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Repeat password",
    changePassword: "Change password",
    changingPassword: "Changing...",
    passwordChanged: "Password updated. You can now sign in.",
    errPasswordShort: "Password must be at least 6 characters",
    errPasswordMismatch: "Passwords do not match",
    errResetFailed: "Error resetting password",
    backToLogin: "Back to sign in",
    footer: "Propyte CRM",
  },
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<LoginMode>("password")
  const [lang, setLang] = useState<Lang>("es")

  const l = t[lang]

  useEffect(() => {
    const saved = localStorage.getItem("propyte-lang") as Lang | null
    if (saved === "es" || saved === "en") setLang(saved)
  }, [])

  const toggleLang = useCallback(() => {
    const next = lang === "es" ? "en" : "es"
    setLang(next)
    localStorage.setItem("propyte-lang", next)
  }, [lang])

  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (!email.trim() || !password.trim()) { setError(l.errRequired); return }
    setLoading(true)
    try {
      const result = await signIn("credentials", { email, password, loginMethod: "password", redirect: false })
      if (result?.error) setError(l.errInvalid)
      else router.push("/dashboard")
    } catch { setError(l.errConnection) }
    finally { setLoading(false) }
  }

  async function handleRequestCode(e?: FormEvent) {
    e?.preventDefault()
    setError(""); setSuccess("")
    if (!email.trim()) { setError(l.errEmailRequired); return }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
      if (res.ok) { setMode("otp-verify"); setSuccess(l.successCode) }
      else { const data = await res.json(); setError(data.error || l.errCodeRequest) }
    } catch { setError(l.errConnection) }
    finally { setLoading(false) }
  }

  async function handleCodeLogin(e: FormEvent) {
    e.preventDefault()
    setError(""); setSuccess("")
    if (!code.trim()) { setError(l.errCodeRequired); return }
    setLoading(true)
    try {
      const result = await signIn("credentials", { email, password: code, loginMethod: "otp", redirect: false })
      if (result?.error) setError(l.errCodeInvalid)
      else router.push("/dashboard")
    } catch { setError(l.errConnection) }
    finally { setLoading(false) }
  }

  async function handleForgotRequest(e?: FormEvent) {
    e?.preventDefault()
    setError(""); setSuccess("")
    if (!email.trim()) { setError(l.errEmailRequired); return }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
      if (res.ok) { setMode("forgot-code"); setSuccess(l.successCode) }
      else { const data = await res.json(); setError(data.error || l.errCodeRequest) }
    } catch { setError(l.errConnection) }
    finally { setLoading(false) }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    setError(""); setSuccess("")
    if (!code.trim()) { setError(l.errCodeRequired); return }
    if (newPassword.length < 6) { setError(l.errPasswordShort); return }
    if (newPassword !== confirmPassword) { setError(l.errPasswordMismatch); return }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, newPassword }) })
      const data = await res.json()
      if (res.ok) {
        setSuccess(l.passwordChanged)
        setCode(""); setNewPassword(""); setConfirmPassword("")
        setTimeout(() => { setMode("password"); setSuccess(""); setError("") }, 3000)
      } else { setError(data.error || l.errResetFailed) }
    } catch { setError(l.errConnection) }
    finally { setLoading(false) }
  }

  const inputClass = "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20 disabled:opacity-50 dark:border-[var(--border-default)] dark:bg-[var(--bg-input)] dark:text-[var(--text-primary)] dark:placeholder:text-[var(--text-tertiary)] dark:focus:border-[var(--color-teal)] dark:focus:ring-[var(--color-teal)]/20"
  const btnClass = "w-full rounded-lg bg-[var(--color-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20 focus:ring-offset-2 disabled:opacity-50"
  const linkClass = "text-[13px] text-[var(--color-teal)] hover:underline"

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f8fa] dark:bg-[var(--bg-base)]">
      <div className="w-full max-w-[400px] px-6">
        {/* Logo + Lang Toggle */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <button
              onClick={toggleLang}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition-all hover:text-gray-700 dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-primary)]"
              style={{ border: "1px solid var(--border-default)" }}
              title={lang === "es" ? "Switch to English" : "Cambiar a Espanol"}
            >
              <GlobeIcon />
              {lang === "es" ? "EN" : "ES"}
            </button>
          </div>
          <div className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--color-teal)" }}>
              <span className="text-lg font-bold text-white">P</span>
            </div>
            <span className="text-2xl font-bold text-[#1a1d21] dark:text-[var(--text-primary)]">Propyte</span>
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-[var(--text-secondary)]">{l.subtitle}</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-[var(--border-default)] dark:bg-[var(--bg-card)]">

          {/* PASSWORD */}
          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.email}</label>
                <input id="email" type="email" placeholder={l.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} autoComplete="email" autoFocus className={inputClass} />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.password}</label>
                <input id="password" type="password" placeholder={l.passwordPlaceholder} value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} autoComplete="current-password" className={inputClass} />
              </div>
              {error && <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-[var(--color-error-bg)] dark:text-[var(--color-error)]">{error}</div>}
              <button type="submit" disabled={loading} className={btnClass}>{loading ? l.loggingIn : l.login}</button>
              <div className="flex items-center justify-between">
                <button type="button" className={linkClass} onClick={() => { setMode("forgot-request"); setError(""); setPassword("") }}>{l.forgotLink}</button>
                <button type="button" className={linkClass} onClick={() => { setMode("otp-request"); setError(""); setPassword("") }}>{l.otpLink}</button>
              </div>
            </form>
          )}

          {/* OTP REQUEST */}
          {mode === "otp-request" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="email-otp" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.email}</label>
                <input id="email-otp" type="email" placeholder={l.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} autoComplete="email" autoFocus className={inputClass} />
              </div>
              {error && <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-[var(--color-error-bg)] dark:text-[var(--color-error)]">{error}</div>}
              <button type="submit" disabled={loading} className={btnClass}>{loading ? l.sending : l.sendCode}</button>
              <div className="text-center">
                <button type="button" className={linkClass} onClick={() => { setMode("password"); setError(""); setCode("") }}>{l.backToPassword}</button>
              </div>
            </form>
          )}

          {/* OTP VERIFY */}
          {mode === "otp-verify" && (
            <form onSubmit={handleCodeLogin} className="space-y-4">
              <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600 dark:bg-white/5 dark:text-[var(--text-secondary)]">{email}</div>
              <div>
                <label htmlFor="code" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.accessCode}</label>
                <input id="code" type="text" placeholder={l.codePlaceholder} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} disabled={loading} autoComplete="one-time-code" inputMode="numeric" maxLength={6} autoFocus className={`${inputClass} text-center text-lg font-mono tracking-[0.3em]`} />
              </div>
              {success && <div className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-600 dark:bg-[var(--color-success-bg)] dark:text-[var(--color-success)]">{success}</div>}
              {error && <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-[var(--color-error-bg)] dark:text-[var(--color-error)]">{error}</div>}
              <button type="submit" disabled={loading} className={btnClass}>{loading ? l.verifying : l.access}</button>
              <div className="flex items-center justify-between">
                <button type="button" className={linkClass} onClick={() => { setMode("password"); setCode(""); setError(""); setSuccess("") }}>{l.usePassword}</button>
                <button type="button" className={linkClass} onClick={() => handleRequestCode()} disabled={loading}>{l.resendCode}</button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD — REQUEST CODE */}
          {mode === "forgot-request" && (
            <form onSubmit={handleForgotRequest} className="space-y-4">
              <div className="text-center mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-[var(--text-primary)]">{l.forgotTitle}</h3>
                <p className="text-[12px] text-gray-500 dark:text-[var(--text-tertiary)] mt-1">{l.forgotSubtitle}</p>
              </div>
              <div>
                <label htmlFor="email-forgot" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.email}</label>
                <input id="email-forgot" type="email" placeholder={l.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} autoComplete="email" autoFocus className={inputClass} />
              </div>
              {error && <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-[var(--color-error-bg)] dark:text-[var(--color-error)]">{error}</div>}
              <button type="submit" disabled={loading} className={btnClass}>{loading ? l.sending : l.sendResetCode}</button>
              <div className="text-center">
                <button type="button" className={linkClass} onClick={() => { setMode("password"); setError("") }}>{l.backToLogin}</button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD — ENTER CODE + NEW PASSWORD */}
          {mode === "forgot-code" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-center mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-[var(--text-primary)]">{l.forgotTitle}</h3>
              </div>
              <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600 dark:bg-white/5 dark:text-[var(--text-secondary)]">{email}</div>
              <div>
                <label htmlFor="reset-code" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.resetCode}</label>
                <input id="reset-code" type="text" placeholder={l.codePlaceholder} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} disabled={loading} autoComplete="one-time-code" inputMode="numeric" maxLength={6} autoFocus className={`${inputClass} text-center text-lg font-mono tracking-[0.3em]`} />
              </div>
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.newPassword}</label>
                <input id="new-password" type="password" placeholder={l.newPasswordPlaceholder} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={loading} autoComplete="new-password" className={inputClass} />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-[var(--text-secondary)]">{l.confirmPassword}</label>
                <input id="confirm-password" type="password" placeholder={l.confirmPasswordPlaceholder} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} autoComplete="new-password" className={inputClass} />
              </div>
              {success && <div className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-600 dark:bg-[var(--color-success-bg)] dark:text-[var(--color-success)]">{success}</div>}
              {error && <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600 dark:bg-[var(--color-error-bg)] dark:text-[var(--color-error)]">{error}</div>}
              <button type="submit" disabled={loading} className={btnClass}>{loading ? l.changingPassword : l.changePassword}</button>
              <div className="flex items-center justify-between">
                <button type="button" className={linkClass} onClick={() => { setMode("password"); setCode(""); setNewPassword(""); setConfirmPassword(""); setError(""); setSuccess("") }}>{l.backToLogin}</button>
                <button type="button" className={linkClass} onClick={() => handleForgotRequest()} disabled={loading}>{l.resendCode}</button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] text-gray-400 dark:text-[var(--text-tertiary)]">{l.footer} &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  )
}
