// Landing page pre-login — CRM Propyte
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

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
    <div className="flex flex-col items-center gap-2 px-6 py-4">
      <span className="text-[40px] font-bold" style={{ color: "var(--color-teal)" }}>{display}</span>
      <span className="text-sm text-center" style={{ color: "rgba(255,255,255,0.65)" }}>{label}</span>
    </div>
  )
}

// ─── CRM Mockup ──────────────────────────────────────────────────────────────
function CrmMockup() {
  const sidebarItems = ["Dashboard", "Contactos", "Pipeline", "Desarrollos", "Comisiones"]
  const columns = [
    { title: "Nuevo Lead", color: "#00B4C8", cards: ["Ricardo D.", "Laura A."] },
    { title: "Contactado", color: "#F5A623", cards: ["Mariana C.", "Daniel M."] },
    { title: "Propuesta", color: "#22C55E", cards: ["Natalia C."] },
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
      {/* Title bar */}
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
        {/* Sidebar */}
        <div className="hidden w-[180px] shrink-0 sm:block" style={{ background: "rgba(255,255,255,0.03)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-3">
            <span className="text-xs font-bold" style={{ color: "#00B4C8" }}>PROPYTE</span>
            <span className="ml-1 rounded px-1 text-[9px] font-semibold" style={{ background: "rgba(0,180,200,0.15)", color: "#00B4C8" }}>CRM</span>
          </div>
          {sidebarItems.map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 px-4 py-2 text-xs"
              style={{ color: item === "Pipeline" ? "#00B4C8" : "rgba(255,255,255,0.45)", background: item === "Pipeline" ? "rgba(0,180,200,0.08)" : "transparent" }}
            >
              <div className="h-1.5 w-1.5 rounded-full" style={{ background: item === "Pipeline" ? "#00B4C8" : "rgba(255,255,255,0.2)" }} />
              {item}
            </div>
          ))}
        </div>

        {/* Main area */}
        <div className="flex-1 p-4">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Pipeline de Ventas</span>
            <div className="flex items-center gap-2">
              <div className="rounded-md px-3 py-1 text-xs" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>Buscar...</div>
              <div className="h-7 w-7 rounded-full" style={{ background: "rgba(0,180,200,0.2)" }}>
                <span className="flex h-full items-center justify-center text-[10px] font-bold" style={{ color: "#00B4C8" }}>LF</span>
              </div>
            </div>
          </div>

          {/* Kanban columns */}
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

// ─── Features Data ───────────────────────────────────────────────────────────
const features = [
  { icon: <IconPerson />, title: "Gestion de Leads", desc: "Centraliza y sigue cada prospecto desde el primer contacto hasta el cierre." },
  { icon: <IconKanban />, title: "Pipeline Visual", desc: "Visualiza el embudo comercial en tiempo real con tablero de etapas." },
  { icon: <IconBuilding />, title: "Portafolio de Propiedades", desc: "Vincula propiedades a leads y asesores de forma instantanea." },
  { icon: <IconCalendar />, title: "Agenda y Citas", desc: "Sincroniza reuniones, seguimientos y recordatorios del equipo." },
  { icon: <IconChart />, title: "Reportes y KPIs", desc: "Mide conversion, velocidad de respuesta y performance por asesor." },
  { icon: <IconBolt />, title: "Speed-to-Lead", desc: "Notificaciones instantaneas al equipo cuando llega un nuevo lead." },
]

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false)
  const [statsVisible, setStatsVisible] = useState(false)
  const statsRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<HTMLDivElement[]>([])

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Fade-in on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("landing-visible")
          }
        })
      },
      { threshold: 0.1 }
    )
    sectionsRef.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Stats counter trigger
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
          --color-success: #22C55E;
          --color-error: #EF4444;
          --gradient-hero: linear-gradient(135deg, #1E3A5F 0%, #2A4A6F 60%, #1a3356 100%);
        }
        html { scroll-behavior: smooth; }
        .landing-fade {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .landing-visible {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      <div className="min-h-screen" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" }}>

        {/* ─── NAVBAR ───────────────────────────────────────────────── */}
        <nav
          className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-6 transition-all duration-300"
          style={{
            background: scrolled ? "rgba(255,255,255,0.97)" : "transparent",
            backdropFilter: scrolled ? "blur(12px)" : "none",
            borderBottom: scrolled ? "1px solid var(--color-gray-medium)" : "1px solid transparent",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold" style={{ color: scrolled ? "var(--color-navy)" : "#fff" }}>
              PROPYTE
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: scrolled ? "rgba(30,58,95,0.1)" : "rgba(255,255,255,0.15)",
                color: scrolled ? "var(--color-navy)" : "#fff",
              }}
            >
              CRM
            </span>
          </div>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: scrolled ? "var(--color-graphite)" : "rgba(255,255,255,0.8)" }}>
              Features
            </a>
            <a href="#stats" className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: scrolled ? "var(--color-graphite)" : "rgba(255,255,255,0.8)" }}>
              Resultados
            </a>
          </div>

          <Link
            href="/login"
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "var(--color-teal)", color: "#fff" }}
          >
            Iniciar Sesion &rarr;
          </Link>
        </nav>

        {/* ─── HERO ─────────────────────────────────────────────────── */}
        <section
          className="relative flex min-h-[85vh] flex-col items-center justify-center px-4 pt-16 text-center"
          style={{
            background: "var(--gradient-hero)",
            backgroundImage: "var(--gradient-hero), radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 24px 24px",
          }}
        >
          <div className="mx-auto max-w-[760px]">
            {/* Eyebrow */}
            <div
              className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
              style={{
                background: "rgba(0,180,200,0.15)",
                border: "1px solid rgba(0,180,200,0.3)",
                color: "var(--color-teal)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-teal)" }} />
              Propyte CRM — Plataforma Comercial Interna
            </div>

            {/* H1 */}
            <h1 className="mb-6 text-[32px] font-bold leading-tight text-white md:text-[48px]">
              El centro de{" "}
              <span style={{ color: "var(--color-teal)" }}>operaciones</span>
              <br />
              de tu equipo comercial.
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mb-8 max-w-[560px] text-base md:text-lg" style={{ color: "rgba(255,255,255,0.75)" }}>
              Gestiona leads, propiedades y citas desde un solo lugar.
              Diseñado para el equipo Propyte.
            </p>

            {/* CTAs */}
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/login"
                className="rounded-lg px-8 py-3.5 text-base font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{ background: "var(--color-teal)" }}
              >
                Iniciar Sesion &rarr;
              </Link>
              <button
                className="rounded-lg px-8 py-3.5 text-base font-semibold text-white transition-all hover:bg-white/[0.08]"
                style={{ border: "1px solid rgba(255,255,255,0.3)" }}
                onClick={() => window.location.href = "mailto:marketing@propyte.com?subject=Solicitar%20acceso%20CRM"}
              >
                Solicitar Acceso
              </button>
            </div>

            {/* Trust line */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[13px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <IconLock />
              <span>Acceso solo para equipo Propyte</span>
              <span className="hidden sm:inline">&middot;</span>
              <span className="hidden sm:inline">Version 1.0</span>
              <span className="hidden sm:inline">&middot;</span>
              <span className="hidden sm:inline">Playa del Carmen, MX</span>
            </div>
          </div>

          {/* CRM Mockup */}
          <div className="relative z-10">
            <CrmMockup />
          </div>

          {/* Bottom fade */}
          <div className="absolute bottom-0 left-0 right-0 z-0 h-32" style={{ background: "linear-gradient(to top, white, transparent)" }} />
        </section>

        {/* ─── FEATURES ─────────────────────────────────────────────── */}
        <section id="features" className="px-4 py-20 md:py-24" style={{ background: "var(--color-white)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto max-w-[1280px]">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-2xl font-semibold md:text-[32px]" style={{ color: "var(--color-navy)" }}>
                Todo lo que necesita tu equipo, en un solo lugar.
              </h2>
              <p className="text-base" style={{ color: "var(--color-gray-text)" }}>
                Construido sobre las mejores practicas de CRMs para real estate.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="group cursor-default rounded-xl p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{
                    background: "var(--color-gray-light)",
                    border: "1px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-teal)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "transparent"
                  }}
                >
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-[10px]"
                    style={{ background: "rgba(0,180,200,0.1)", color: "var(--color-teal)" }}
                  >
                    {f.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-navy)" }}>{f.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-gray-text)" }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── STATS BAR ────────────────────────────────────────────── */}
        <section id="stats" ref={statsRef} className="px-4 py-16 md:py-20" style={{ background: "var(--color-navy)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto flex max-w-[1280px] flex-wrap items-center justify-center">
            <AnimatedStat value="< 5 min" label="Tiempo de respuesta a lead" isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="78%" label="Cierres con el primer asesor" isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="5%+" label="Meta de conversion visitante a lead" isVisible={statsVisible} />
            <div className="hidden h-16 md:block" style={{ borderLeft: "1px solid rgba(255,255,255,0.15)" }} />
            <AnimatedStat value="100%" label="Equipo Propyte conectado" isVisible={statsVisible} />
          </div>
        </section>

        {/* ─── CTA FINAL ────────────────────────────────────────────── */}
        <section className="px-4 py-24" style={{ background: "var(--color-gray-light)" }}>
          <div ref={addSectionRef} className="landing-fade mx-auto max-w-[600px] text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl" style={{ color: "var(--color-navy)" }}>
              Listo para empezar?
            </h2>
            <p className="mb-8 text-base" style={{ color: "var(--color-graphite)" }}>
              Accede con tu cuenta de Propyte para gestionar tu pipeline.
            </p>
            <Link
              href="/login"
              className="inline-block rounded-lg px-10 py-4 text-lg font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: "var(--color-teal)" }}
            >
              Iniciar Sesion en el CRM &rarr;
            </Link>
            <p className="mt-6 text-[13px]" style={{ color: "var(--color-gray-text)" }}>
              No tienes acceso? Contacta a tu lider de equipo.
            </p>
          </div>
        </section>

        {/* ─── FOOTER ───────────────────────────────────────────────── */}
        <footer className="px-4 py-10" style={{ background: "#162d4a" }}>
          <div className="mx-auto flex max-w-[1280px] flex-col items-center gap-4 text-center md:flex-row md:justify-between md:text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.65)" }}>PROPYTE</span>
              <span className="rounded px-1 text-[9px] font-semibold" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}>CRM</span>
            </div>
            <div className="flex flex-wrap justify-center gap-4 text-[13px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <span>Aviso de Privacidad</span>
              <span>&middot;</span>
              <span>Terminos de Uso</span>
              <span>&middot;</span>
              <span>Soporte</span>
            </div>
            <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              &copy; {new Date().getFullYear()} Propyte MX. Todos los derechos reservados.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
