// Centro de Configuración — grid índice (estilo Zoho) + editores embebidos.
// Secciones con editor propio aquí: Automatización · Equipos & Territorios ·
// Campos · Agentes automáticos (AgentDef, tareas de IA en segundo plano). El resto
// enlaza a su pantalla existente (incluye /admin como vista de detalle por tab:
// usuarios, comisiones, acuerdo de actividad, integraciones, bot, playbook,
// Agentes conversacionales = BotAgentProfile, persona del bot por segmento).
"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Workflow, Users, Database, Bot, Plug, MessageSquare, UserCircle,
  FileText, Eye, ArrowUpRight, ShieldCheck, DollarSign, ClipboardCheck,
  GitBranch, ListChecks, CopyCheck, KeyRound, type LucideIcon,
} from "lucide-react";
import { AutomationSection } from "./automation-section";
import { TeamsSection } from "./teams-section";
import { FieldsSection } from "./fields-section";
import { AgentsSection } from "./agents-section";
import { CoreFieldsSection } from "./core-fields-section";

type SectionKey = "index" | "automation" | "teams" | "fields" | "agents" | "corefields";

interface CardDef {
  key?: SectionKey;
  href?: string;
  icon: LucideIcon;
  title: string;
  items: string[];
  /** Pinta un chip "Admin" — la sección es de gestión administrativa. */
  admin?: boolean;
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

const SECTION_KEYS: SectionKey[] = ["index", "automation", "teams", "fields", "agents", "corefields"];

/**
 * Determina la sección inicial a partir del query param `section` (deep-link desde
 * Journey: cadence node → /configuracion?section=automation&planId=... — ver
 * journey-map-view.tsx). Valores ausentes/desconocidos degradan a "index" sin
 * crashear. Pura para poder testearla sin montar el componente.
 */
export function resolveInitialSection(sectionParam: string | null | undefined): SectionKey {
  return (SECTION_KEYS as string[]).includes(sectionParam ?? "") ? (sectionParam as SectionKey) : "index";
}

const GROUPS: Array<{ title: string; cards: CardDef[] }> = [
  {
    title: "Organización",
    cards: [
      { href: "/admin?tab=users", icon: UserCircle, title: "Usuarios & Roles", admin: true, items: ["Altas y roles", "Plazas", "Activar/desactivar"] },
      { href: "/admin?tab=commissions", icon: DollarSign, title: "Comisiones", admin: true, items: ["Reglas por tipo de deal", "Por fuente y rol"] },
      { href: "/admin?tab=settings", icon: ClipboardCheck, title: "Acuerdo de actividad", admin: true, items: ["Mínimos diarios/semanales", "Llamadas, WhatsApps, visitas"] },
      { key: "teams", icon: Users, title: "Equipos & Territorios", admin: true, items: ["Equipos con líder", "Territorios por plaza/zona", "Reglas de asignación", "Miembros"] },
    ],
  },
  {
    title: "Automatización",
    cards: [
      { key: "automation", icon: Workflow, title: "Flujos de trabajo y SLA", items: ["Reglas de flujo (8 canónicas)", "Cadencias / planes de acción", "Políticas SLA", "Cola de acciones"] },
      { key: "agents", icon: Bot, title: "Agentes automáticos", items: ["Tareas de IA en segundo plano", "SDR Speed-to-lead", "Autonomía L0-L3 con herramientas", "Corridas auditadas"] },
      { href: "/journey", icon: GitBranch, title: "Journey", admin: true, roles: ["ADMIN", "DIRECTOR"], items: ["Mapa del customer journey", "Etapas y layout"] },
    ],
  },
  {
    title: "Bot conversacional",
    cards: [
      { href: "/admin?tab=bot", icon: Bot, title: "Bot: tono y comportamiento", items: ["Encendido y canales", "Tono elegible (4 presets)", "Autonomía L0-L2", "Escalamiento"] },
      { href: "/admin?tab=playbook", icon: ListChecks, title: "Playbook de calificación", items: ["Tareas ordenadas", "Auto-llenado del contacto", "Activar/desactivar"] },
      { href: "/admin?tab=botAgents", icon: Bot, title: "Agentes conversacionales", items: ["Persona del bot por segmento", "Clasificador por tipo de contacto", "Identidad + playbook por segmento", "Clientes / Brokers / Reclutamiento"] },
    ],
  },
  {
    title: "Datos & Campos",
    cards: [
      { key: "fields", icon: Database, title: "Módulos & Campos", admin: true, items: ["Catálogo anti-sprawl", "Campos custom (Contact/Deal)", "Picklists", "Permisos por rol"] },
      { key: "corefields", icon: Eye, title: "Visibilidad de campos", admin: true, items: ["Campos core por rol", "Ocultar / solo lectura / editar", "Contacto (más módulos pronto)", "Enforcement en API"] },
      { href: "/duplicados", icon: CopyCheck, title: "Duplicados", admin: true, roles: ["ADMIN", "DIRECTOR"], items: ["Detección de contactos duplicados", "Merge humano-en-loop"] },
    ],
  },
  {
    title: "Canales & Integraciones",
    cards: [
      { href: "/conexiones", icon: Plug, title: "Centro de conexiones", items: ["Meta Lead Ads / IG / Messenger", "Mapeo de campos por conector", "Estado y últimos leads"] },
      { href: "/admin?tab=integrations", icon: KeyRound, title: "API keys & Webhooks", admin: true, items: ["API keys", "Webhooks salientes"] },
      { href: "/inbox", icon: MessageSquare, title: "WhatsApp", items: ["Inbox con bot", "Takeover humano", "Cloud API directo"] },
    ],
  },
  {
    title: "Personal",
    cards: [
      { href: "/settings", icon: FileText, title: "Mi perfil & Plantillas", items: ["Firma de correo", "Tarjeta digital", "Plantillas con atajos"] },
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
          />
        )}
        {section === "teams" && <TeamsSection userRole={userRole} />}
        {section === "fields" && <FieldsSection userRole={userRole} />}
        {section === "corefields" && <CoreFieldsSection userRole={userRole} />}
        {section === "agents" && <AgentsSection userRole={userRole} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">Todo lo configurable del CRM, en un solo lugar</p>
      </div>

      <div className="space-y-8">
        {GROUPS.map((group) => {
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
                          {card.admin && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                              style={{ color: "var(--text-tertiary)", borderColor: "var(--border-subtle)" }}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Admin
                            </span>
                          )}
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
