// Landing page pre-login — CRM Propyte (ES/EN)
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"

// ─── Translations ────────────────────────────────────────────────────────────
type Lang = "es" | "en"

const translations = {
  es: {
    navFeatures: "Features",
    navResults: "Resultados",
    navLogin: "Iniciar Sesion",
    eyebrow: "Propyte CRM — Plataforma Comercial Interna",
    heroTitle1: "El centro de ",
    heroHighlight: "operaciones",
    heroTitle2: " de tu equipo comercial.",
    heroSub: "Gestiona leads, propiedades y citas desde un solo lugar. Diseñado para el equipo Propyte.",
    ctaLogin: "Iniciar Sesion",
    ctaAccess: "Solicitar Acceso",
    trustAccess: "Acceso solo para equipo Propyte",
    trustVersion: "Version 1.0",
    trustLocation: "Playa del Carmen, MX",
    featTitle: "Todo lo que necesita tu equipo, en un solo lugar.",
    featSub: "Construido sobre las mejores practicas de CRMs para real estate.",
    feat1Title: "Gestion de Leads",
    feat1Desc: "Centraliza y sigue cada prospecto desde el primer contacto hasta el cierre.",
    feat2Title: "Pipeline Visual",
    feat2Desc: "Visualiza el embudo comercial en tiempo real con tablero de etapas.",
    feat3Title: "Portafolio de Propiedades",
    feat3Desc: "Vincula propiedades a leads y asesores de forma instantanea.",
    feat4Title: "Agenda y Citas",
    feat4Desc: "Sincroniza reuniones, seguimientos y recordatorios del equipo.",
    feat5Title: "Reportes y KPIs",
    feat5Desc: "Mide conversion, velocidad de respuesta y performance por asesor.",
    feat6Title: "Speed-to-Lead",
    feat6Desc: "Notificaciones instantaneas al equipo cuando llega un nuevo lead.",
    stat1Label: "Tiempo de respuesta a lead",
    stat2Label: "Cierres con el primer asesor",
    stat3Label: "Meta de conversion visitante a lead",
    stat4Label: "Equipo Propyte conectado",
    ctaFinalTitle: "Listo para empezar?",
    ctaFinalSub: "Accede con tu cuenta de Propyte para gestionar tu pipeline.",
    ctaFinalBtn: "Iniciar Sesion en el CRM",
    ctaFinalHelp: "No tienes acceso? Contacta a tu lider de equipo.",
    footerPrivacy: "Aviso de Privacidad",
    footerTerms: "Terminos de Uso",
    footerSupport: "Soporte",
    footerRights: "Todos los derechos reservados.",
    mockupPipeline: "Pipeline de Ventas",
    mockupSearch: "Buscar...",
    mockupCol1: "Nuevo Lead",
    mockupCol2: "Contactado",
    mockupCol3: "Propuesta",
  },
  en: {
    navFeatures: "Features",
    navResults: "Results",
    navLogin: "Sign In",
    eyebrow: "Propyte CRM — Internal Sales Platform",
    heroTitle1: "The ",
    heroHighlight: "operations",
    heroTitle2: " center for your sales team.",
    heroSub: "Manage leads, properties and appointments from a single place. Built for the Propyte team.",
    ctaLogin: "Sign In",
    ctaAccess: "Request Access",
    trustAccess: "Propyte team access only",
    trustVersion: "Version 1.0",
    trustLocation: "Playa del Carmen, MX",
    featTitle: "Everything your team needs, in one place.",
    featSub: "Built on best practices from top real estate CRMs.",
    feat1Title: "Lead Management",
    feat1Desc: "Centralize and track every prospect from first contact to closing.",
    feat2Title: "Visual Pipeline",
    feat2Desc: "See your sales funnel in real time with a stage-based board.",
    feat3Title: "Property Portfolio",
    feat3Desc: "Link properties to leads and advisors instantly.",
    feat4Title: "Calendar & Meetings",
    feat4Desc: "Sync meetings, follow-ups and team reminders.",
    feat5Title: "Reports & KPIs",
    feat5Desc: "Measure conversion, response time and advisor performance.",
    feat6Title: "Speed-to-Lead",
    feat6Desc: "Instant notifications to your team when a new lead arrives.",
    stat1Label: "Lead response time",
    stat2Label: "Closings with the first responder",
    stat3Label: "Visitor to lead conversion goal",
    stat4Label: "Propyte team connected",
    ctaFinalTitle: "Ready to get started?",
    ctaFinalSub: "Sign in with your Propyte account to manage your pipeline.",
    ctaFinalBtn: "Sign In to the CRM",
    ctaFinalHelp: "Don't have access? Contact your team leader.",
    footerPrivacy: "Privacy Policy",
    footerTerms: "Terms of Use",
    footerSupport: "Support",
    footerRights: "All rights reserved.",
    mockupPipeline: "Sales Pipeline",
    mockupSearch: "Search...",
    mockupCol1: "New Lead",
    mockupCol2: "Contacted",
    mockupCol3: "Proposal",
  },
} as const

// ─── SVG Icons ───────────────────────────────────────────────────────────────
function IconPerson() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}
function IconKanban() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M15 3v18" />
    </svg>
  )
}
function IconBuilding() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M8 10h.01" /><path d="M16 10h.01" /><path d="M8 14h.01" /><path d="M16 14h.01" />
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
    </svg>
  )
}
function IconChart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
  )
}
function IconBolt() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}
function IconLock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

// ─── Animated Counter ────────────────────────────────────────────────────────
function AnimatedStat({ value, label, isVisible }: { value: string; label: string; isVisible: boolean }) {
  const [display, setDisplay] = useState(value)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!isVisible || hasAnimated.current) return
    hasAnimated.current = true

    const numericMatch = value.match(/(\d+)/)
    if (!numericMatch) { setDisplay(value); return }

    const target = parseInt(numericMatch[1])
    const prefix = value.slice(0, numericMatch.index)
    const suffix = value.slice((numericMatch.index ?? 0) + numericMatch[1].length)
    const duration = 1500
    const start = performance.now()

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(target * eased)
      setDisplay(`${prefix}${current}${suffix}`)
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [isVisible, value])

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-4 min-w-[140px]">
      <span className="text-[40px] font-bold" style={{ color: "var(--color-teal)" }}>{display}</span>
      <span className="text-sm text-center" style={{ color: "rgba(255,255,255,0.65)" }}>{label}</span>
    </div>
  )
}

// ─── CRM Mockup ──────────────────────────────────────────────────────────────
function CrmMockup({ t }: { t: typeof translations.es | typeof translations.en }) {
  const sidebarItems = ["Dashboard", "Contactos", "Pipeline", "Desarrollos", "Comisiones"]
  const columns = [
    { title: t.mockupCol1, color: "#00B4C8", cards: ["Ricardo D.", "Laura A."] },
    { title: t.mockupCol2, color: "#F5A623", cards: ["Mariana C.", "Daniel M."] },
    { title: t.mockupCol3, color: "#22C55E", cards: ["Natalia C."] },
  ]

  return (
    <div
      className="mx-auto mt-16 max-w-[900px] overflow-hidden rounded-2xl border"
      style={{
        background: "#0f1f35",
        borderColor: "rgba(255,255,255,0.1)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
        transform: "perspective(1200px) rotateX(4deg)",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full" style={{ background: "#EF4444" }} />
          <div className="h-3 w-3 rounded-full" style={{ background: "#F5A623" }} />
          <div className="h-3 w-3 rounded-full" style={{ background: "#22C55E" }} />
        </div>
        <div className="ml-4 flex-1 rounded-md px-3 py-1 text-xs" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
          crm.propyte.com/pipeline
        </div>
      </div>
      <div className="flex" style={{ minHeight: 280 }}>
        <div className="hidden w-[180px] shrink-0 sm:block" style={{ background: "rgba(255,255,255,0.03)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-3">
            <span className="text-xs font-bold" style={{ color: "#00B4C8" }}>PROPYTE</span>
            <span className="ml-1 rounded px-1 text-[9px] font-semibold" style={{ background: "rgba(0,180,200,0.15)", color: "#00B4C8" }}>CRM</span>
          </div>
          {sidebarItems.map((item) => (
            <div key={item} className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: item === "Pipeline" ? "#00B4C8" : "rgba(255,255,255,0.45)", background: item === "Pipeline" ? "rgba(0,180,200,0.08)" : "transparent" }}>
              <div className="h-1.5 w-1.5 rounded-full" style={{ background: item === "Pipeline" ? "#00B4C8" : "rgba(255,255,255,0.2)" }} />
              {item}
            </div>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{t.mockupPipeline}</span>
            <div className="flex items-center gap-2">
              <div className="rounded-md px-3 py-1 text-xs" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>{t.mockupSearch}</div>
              <div className="h-7 w-7 rounded-full" style={{ background: "rgba(0,180,200,0.2)" }}>
                <span className="flex h-full items-center justify-center text-[10px] font-bold" style={{ color: "#00B4C8" }}>LF</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {columns.map((col) => (
              <div key={col.title} className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="mb-2 flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                  <span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>{col.title}</span>
                  <span className="ml-auto text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{col.cards.length}</span>
                </div>
                {col.cards.map((card) => (
                  <div key={card} className="mb-1.5 rounded-md px-2.5 py-2" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>{card}</div>
                    <div className="mt-1 flex gap-1">
                      <span className="rounded px-1 text-[8px]" style={{ background: "rgba(0,180,200,0.15)", color: "#00B4C8" }}>Nativa</span>
                      <span className="rounded px-1 text-[8px]" style={{ background: "rgba(245,166,35,0.15)", color: "#F5A623" }}>$2.8M</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false)
  const [statsVisible, setStatsVisible] = useState(false)
  const [lang, setLang] = useState<Lang>("es")
  const statsRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<HTMLDivElement[]>([])

  const t = translations[lang]

  // Persist language preference
  useEffect(() => {
    const saved = localStorage.getItem("propyte-lang") as Lang | null
    if (saved === "es" || saved === "en") setLang(saved)
  }, [])

  const toggleLang = useCallback(() => {
    const next = lang === "es" ? "en" : "es"
    setLang(next)
    localStorage.setItem("propyte-lang", next)
  }, [lang])

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("landing-visible") }) },
      { threshold: 0.1 }
    )
    sectionsRef.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!statsRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStatsVisible(true) },
      { threshold: 0.3 }
    )
    observer.observe(statsRef.current)
    return () => observer.disconnect()
  }, [])

  const addSectionRef = (el: HTMLDivElement | null) => {
    if (el && !sectionsRef.current.includes(el)) sectionsRef.current.push(el)
  }

  const featureIcons = [<IconPerson key="1" />, <IconKanban key="2" />, <IconBuilding key="3" />, <IconCalendar key="4" />, <IconChart key="5" />, <IconBolt key="6" />]
  const featureKeys = [
    { t: t.feat1Title, d: t.feat1Desc },
    { t: t.feat2Title, d: t.feat2Desc },
    { t: t.feat3Title, d: t.feat3Desc },
    { t: t.feat4Title, d: t.feat4Desc },
    { t: t.feat5Title, d: t.feat5Desc },
    { t: t.feat6Title, d: t.feat6Desc },
  ]

  return (
    <>
      <style jsx global>{`
        :root {
          --color-navy: #1E3A5F;
          --color-teal: #00B4C8;
          --color-teal-dark: #009AB0;
          --color-amber: #F5A623;
          --color-graphite: #2C2C2C;
          --color-gray-light: #F4F6F8;
          --color-gray-medium: #E5E7EB;
          --color-gray-text: #666666;
          --color-white: #FFFFFF;
          --gradient-hero: linear-gradient(135deg, #1E3A5F 0%, #2A4A6F 60%, #1a3356 100%);
        }
        html { scroll-behavior: smooth; }
        .landing-fade { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .landing-visible { opacity: 1; transform: translateY(0); }
      `}</style>

      <div className="min-h-screen" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" }}>

        {/* ─── NAVBAR ─────────────────────────────────────────────── */}
        <nav
          className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-6 transition-all duration-300"
          style={{
            background: scrolled ? "rgba(255,255,255,0.97)" : "transparent",
            backdropFilter: scrolled ? "blur(12px)" : "none",
            borderBottom: scrolled ? "1px solid var(--color-gray-medium)" : "1px solid transparent",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold" style={{ color: scrolled ? "var(--color-navy)" : "#fff" }}>PROPYTE</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: scrolled ? "rgba(30,58,95,0.1)" : "rgba(255,255,255,0.15)", color: scrolled ? "var(--color-navy)" : "#fff" }}>CRM</span>
          </div>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: scrolled ? "var(--color-graphite)" : "rgba(255,255,255,0.8)" }}>{t.navFeatures}</a>
            <a href="#stats" className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: scrolled ? "var(--color-graphite)" : "rgba(255,255,255,0.8)" }}>{t.navResults}</a>
          </div>

          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={toggleLang}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all hover:opacity-80"
              style={{
                background: scrolled ? "rgba(30,58,95,0.08)" : "rgba(255,255,255,0.1)",
                color: scrolled ? "var(--color-navy)" : "#fff",
                border: scrolled ? "1px solid var(--color-gray-medium)" : "1px solid rgba(255,255,255,0.2)",
              }}
              title={lang === "es" ? "Switch to English" : "Cambiar a Espanol"}
            >
              <IconGlobe />
              {lang === "es" ? "EN" : "ES"}
            </button>

            <Link
              href="/login"
              className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: "var(--color-teal)", color: "#fff" }}
            >
              {t.navLogin} &rarr;
            </Link>
          </div>
        </nav>

        {/* ─── HERO ───────────────────────────────────────────────── */}
        <section
          className="relative flex min-h-[85vh] flex-col items-center justify-center px-4 pt-16 text-center"
          style={{
            background: "var(--gradient-hero)",
            backgroundImage: "var(--gradient-hero), radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 24px 24px",
          }}
        >
          <div className="mx-auto max-w-[760px]">
            <div
              className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
              style={{ background: "rgba(0,180,200,0.15)", border: "1px solid rgba(0,180,200,0.3)", color: "var(--color-teal)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-teal)" }} />
              {t.eyebrow}
            </div>

            <h1 className="mb-6 text-[32px] font-bold leading-tight text-white md:text-[48px]">
              {t.heroTitle1}
              <span style={{ color: "var(--color-teal)" }}>{t.heroHighlight}</span>
              <br />
              {t.heroTitle2}
            </h1>

            <p className="mx-auto mb-8 max-w-[560px] text-base md:text-lg" style={{ color: "rgba(255,255,255,0.75)" }}>
              {t.heroSub}
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/login" className="rounded-lg px-8 py-3.5 text-base font-semibold text-white transition-all hover:-translate-y-0.5" style={{ background: "var(--color-teal)" }}>
                {t.ctaLogin} &rarr;
              </Link>
              <button
                className="rounded-lg px-8 py-3.5 text-base font-semibold text-white transition-all hover:bg-white/[0.08]"
                style={{ border: "1px solid rgba(255,255,255,0.3)" }}
                onClick={() => window.location.href = "mailto:marketing@propyte.com?subject=Solicitar%20acceso%20CRM"}
              >
                {t.ctaAccess}
              </button>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[13px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <IconLock />
              <span>{t.trustAccess}</span>
              <span className="hidden sm:inline">&middot;</span>
              <span className="hidden sm:inline">{t.trustVersion}</span>
              <span className="hidden sm:inline">&middot;</span>
              <span className="hidden sm:inline">{t.trustLocation}</span>
            </div>
          </div>

          <div className="relative z-10">
            <CrmMockup t={t} />
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-0 h-32" style={{ background: "linear-gradient(to top, white, transparent)" }} />
        </section>

        {/* ─── FEATURES ───────────────────────────────────────────── */}
        <section id="features" className="px-4 py-20 md:py-24" style={{ background: "var(--color-white)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto max-w-[1280px]">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-2xl font-semibold md:text-[32px]" style={{ color: "var(--color-navy)" }}>{t.featTitle}</h2>
              <p className="text-base" style={{ color: "var(--color-gray-text)" }}>{t.featSub}</p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featureKeys.map((f, i) => (
                <div
                  key={i}
                  className="group cursor-default rounded-xl p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{ background: "var(--color-gray-light)", border: "1px solid transparent" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-teal)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent" }}
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[10px]" style={{ background: "rgba(0,180,200,0.1)", color: "var(--color-teal)" }}>
                    {featureIcons[i]}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-navy)" }}>{f.t}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-gray-text)" }}>{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── STATS BAR ──────────────────────────────────────────── */}
        <section id="stats" ref={statsRef} className="px-4 py-16 md:py-20" style={{ background: "var(--color-navy)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto flex max-w-[1280px] flex-wrap items-center justify-center">
            <AnimatedStat value="< 5 min" label={t.stat1Label} isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="78%" label={t.stat2Label} isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="5%+" label={t.stat3Label} isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="100%" label={t.stat4Label} isVisible={statsVisible} />
          </div>
        </section>

        {/* ─── CTA FINAL ──────────────────────────────────────────── */}
        <section className="px-4 py-24" style={{ background: "var(--color-gray-light)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto max-w-[600px] text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl" style={{ color: "var(--color-navy)" }}>{t.ctaFinalTitle}</h2>
            <p className="mb-8 text-base" style={{ color: "var(--color-graphite)" }}>{t.ctaFinalSub}</p>
            <Link href="/login" className="inline-block rounded-lg px-10 py-4 text-lg font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg" style={{ background: "var(--color-teal)" }}>
              {t.ctaFinalBtn} &rarr;
            </Link>
            <p className="mt-6 text-[13px]" style={{ color: "var(--color-gray-text)" }}>{t.ctaFinalHelp}</p>
          </div>
        </section>

        {/* ─── FOOTER ─────────────────────────────────────────────── */}
        <footer className="px-4 py-10" style={{ background: "#162d4a" }}>
          <div className="mx-auto flex max-w-[1280px] flex-col items-center gap-4 text-center md:flex-row md:justify-between md:text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.65)" }}>PROPYTE</span>
              <span className="rounded px-1 text-[9px] font-semibold" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}>CRM</span>
            </div>
            <div className="flex flex-wrap justify-center gap-4 text-[13px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <span>{t.footerPrivacy}</span>
              <span>&middot;</span>
              <span>{t.footerTerms}</span>
              <span>&middot;</span>
              <span>{t.footerSupport}</span>
            </div>
            <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              &copy; {new Date().getFullYear()} Propyte MX. {t.footerRights}
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
