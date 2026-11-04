// Centro de Configuración — grid índice (estilo Zoho) + editores embebidos.
// Secciones con editor propio aquí: Automatización · Equipos & Territorios ·
// Campos · Visibilidad de campos. El resto
// enlaza a su pantalla existente (incluye /admin como vista de detalle por tab:
// usuarios, comisiones, acuerdo de actividad, integraciones, bot, playbook,
// Agentes conversacionales = BotAgentProfile, persona del bot por segmento,
// Marcas del agente = Brand: persona, conocimiento, catálogo y canales por marca).
// 2026-10-09: se quitó "Agentes automáticos" (Agent Studio, AgentDef): sin uso
// (2 agentes inactivos, 0 corridas). Solo se retiró la UI; el backend (src/lib/agents,
// APIs y modelos AgentDef/AgentRun) sigue porque el servidor MCP usa tools.ts.
// Un enlace viejo con ?section=agents cae al índice.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Workflow, Users, Database, Bot, Plug, UserCircle,
  FileText, Eye, ArrowUpRight, DollarSign, ClipboardCheck,
  GitBranch, ListChecks, CopyCheck, KeyRound, MessageCircle, Tag, type LucideIcon,
} from "lucide-react";
import { AutomationSection } from "./automation-section";
import { TeamsSection } from "./teams-section";
import { FieldsSection } from "./fields-section";
import { CoreFieldsSection } from "./core-fields-section";

type SectionKey = "index" | "automation" | "teams" | "fields" | "corefields";

interface CardDef {
  key?: SectionKey;
  href?: string;
  icon: LucideIcon;
  title: string;
  items: string[];
  /** Si está presente, solo se muestra a estos roles (ADMIN siempre ve todo). */
  roles?: string[];
}

// Filtra las cards visibles para un rol dado. Extraída como función pura
// para poder testearla sin montar el componente.
export function visibleCards(cards: CardDef[], userRole: string): CardDef[] {
  return cards.filter((card) => {
    if (!card.roles) return true;
    if (userRole === "ADMIN") return true;
    return card.roles.includes(userRole);
  });
}

const SECTION_KEYS: SectionKey[] = ["index", "automation", "teams", "fields", "corefields"];

/**
 * Determina la sección inicial a partir del query param `section` (deep-link desde
 * Journey: cadence node → /configuracion?section=automation&planId=... — ver
 * journey-map-view.tsx). Valores ausentes/desconocidos degradan a "index" sin
 * crashear. Pura para poder testearla sin montar el componente.
 */
export function resolveInitialSection(sectionParam: string | null | undefined): SectionKey {
  return (SECTION_KEYS as string[]).includes(sectionParam ?? "") ? (sectionParam as SectionKey) : "index";
}

// Exportada para poder verificar en pruebas qué tarjetas muestra el índice.
// Grupos por tarea de la persona, en lenguaje de negocio (auditoría 05 §5).
// Cada tarjeta administrativa declara `roles`; quien no puede usarla no la ve.
const ADMIN_DIR = ["ADMIN", "DIRECTOR"];
const GERENCIA = ["ADMIN", "DIRECTOR", "GERENTE"];

export const CONFIG_GROUPS: Array<{ title: string; cards: CardDef[] }> = [
  {
    title: "Mi cuenta",
    cards: [
      { href: "/settings", icon: FileText, title: "Mi perfil", items: ["Tu firma de correo, tu tarjeta digital y tus plantillas de mensajes"] },
    ],
  },
  {
    title: "Equipo y permisos",
    cards: [
      { href: "/admin?tab=users", icon: UserCircle, title: "Usuarios", roles: ADMIN_DIR, items: ["Alta, puesto, plaza y acceso de cada persona"] },
      { key: "teams", icon: Users, title: "Equipos y zonas", roles: ADMIN_DIR, items: ["Quién atiende cada plaza y a quién le llegan los leads nuevos"] },
      { key: "corefields", icon: Eye, title: "Qué ve cada puesto", roles: ADMIN_DIR, items: ["Decide qué datos del contacto ve y edita cada puesto"] },
      { href: "/admin?tab=commissions", icon: DollarSign, title: "Comisiones", roles: ADMIN_DIR, items: ["Cómo se reparten las comisiones por tipo de venta"] },
      { href: "/admin?tab=settings", icon: ClipboardCheck, title: "Metas de actividad", roles: ADMIN_DIR, items: ["Mínimos diarios y semanales de llamadas, mensajes y visitas"] },
    ],
  },
  {
    title: "Proceso de ventas",
    cards: [
      { href: "/journey", icon: GitBranch, title: "Etapas del recorrido del cliente", roles: ADMIN_DIR, items: ["Mapa de las etapas por las que pasa un cliente, con cuántos contactos pasan por cada regla"] },
      { key: "automation", icon: Workflow, title: "Seguimientos y reglas automáticas", roles: ADMIN_DIR, items: ["Recordatorios y tareas que el CRM crea solo, tiempos máximos de respuesta y reglas del tipo \"cuando pase esto, haz aquello\""] },
    ],
  },
  {
    title: "Fichas y datos",
    cards: [
      { key: "fields", icon: Database, title: "Campos de la ficha", roles: ADMIN_DIR, items: ["Agrega datos propios a contactos y negocios, con listas de opciones y permisos por puesto"] },
    ],
  },
  {
    title: "Calidad de datos",
    cards: [
      { href: "/duplicados", icon: CopyCheck, title: "Duplicados", roles: GERENCIA, items: ["Contactos repetidos listos para revisar y unir"] },
      { href: "/conexiones/huerfanos", icon: Users, title: "Leads sin asesor", roles: GERENCIA, items: ["Contactos y mensajes que llegaron y no tienen quién los atienda"] },
    ],
  },
  {
    title: "Asistente de WhatsApp y redes",
    cards: [
      { href: "/admin?tab=bot", icon: Bot, title: "Comportamiento del asistente", roles: ADMIN_DIR, items: ["Tono, cuándo responde solo y cuándo pasa la conversación a una persona"] },
      { href: "/admin?tab=playbook", icon: ListChecks, title: "Guion de calificación", roles: ADMIN_DIR, items: ["Las preguntas que hace el asistente para calificar a un contacto"] },
      { href: "/admin?tab=botAgents", icon: Bot, title: "Perfiles por tipo de cliente", roles: ADMIN_DIR, items: ["Cómo se presenta con clientes, brokers y candidatos"] },
      { href: "/admin?tab=botBrands", icon: Tag, title: "Marcas", roles: ADMIN_DIR, items: ["Qué sabe y qué ofrece el asistente por cada marca"] },
      { href: "/admin?tab=comments", icon: MessageCircle, title: "Respuestas en redes", roles: ADMIN_DIR, items: ["Respuestas automáticas a comentarios en Instagram y Facebook"] },
    ],
  },
  {
    title: "Conexiones",
    cards: [
      // Misma audiencia que la pantalla de conexiones (ADMIN/DIRECTOR/GERENTE).
      { href: "/conexiones", icon: Plug, title: "Cuentas conectadas", roles: GERENCIA, items: ["Meta, Instagram y Messenger: de dónde llegan tus leads y su estado"] },
      { href: "/admin?tab=integrations", icon: KeyRound, title: "Integraciones técnicas", roles: ADMIN_DIR, items: ["Llaves de acceso y avisos a otros sistemas, para integraciones técnicas"] },
    ],
  },
];

export function ConfigCenter({ userRole }: { userRole: string }) {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<SectionKey>(() => resolveInitialSection(searchParams.get("section")));

  if (section !== "index") {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSection("index")}
          className="text-[13px] font-medium hover:underline"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Configuración
        </button>
        {section === "automation" && (
          <AutomationSection
            userRole={userRole}
            deepLinkPlanId={searchParams.get("planId") ?? undefined}
            deepLinkSlaId={searchParams.get("slaId") ?? undefined}
            deepLinkRuleId={searchParams.get("ruleId") ?? undefined}
          />
        )}
        {section === "teams" && <TeamsSection userRole={userRole} />}
        {section === "fields" && <FieldsSection userRole={userRole} />}
        {section === "corefields" && <CoreFieldsSection userRole={userRole} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">Ajusta tu cuenta, tu equipo y cómo trabaja el CRM</p>
      </div>

      <div className="space-y-8">
        {CONFIG_GROUPS.map((group) => {
          const cards = visibleCards(group.cards, userRole);
          if (cards.length === 0) return null;
          return (
            <div key={group.title}>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
                {cards.map((card) => {
                  const Icon = card.icon;
                  const inner = (
                    <div className="crm-card !p-4 h-full cursor-pointer group">
                      <div className="flex items-start justify-between">
                        <Icon className="h-5 w-5" style={{ color: "var(--text-primary)" }} />
                        <div className="flex items-center gap-1.5">
                          <ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--text-tertiary)" }} />
                        </div>
                      </div>
                      <p className="mt-3 text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
                        {card.title}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {card.items.map((item) => (
                          <li key={item} className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                  return card.href ? (
                    <Link key={card.title} href={card.href}>{inner}</Link>
                  ) : (
                    <button key={card.title} className="text-left" onClick={() => setSection(card.key!)}>
                      {inner}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
