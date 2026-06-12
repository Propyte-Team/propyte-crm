// Centro de Configuración — grid índice (estilo Zoho) + editores embebidos.
// Secciones con editor propio aquí: Automatización · Equipos & Territorios ·
// Campos · Agentes IA. El resto enlaza a su pantalla existente.
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Workflow, Users, Database, Bot, Plug, MessageSquare, UserCircle,
  FileText, Eye, ArrowUpRight, type LucideIcon,
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
}

const GROUPS: Array<{ title: string; cards: CardDef[] }> = [
  {
    title: "Automatización",
    cards: [
      { key: "automation", icon: Workflow, title: "Workflows & SLA", items: ["Reglas de flujo (8 canónicas)", "Cadencias / action plans", "Políticas SLA", "Cola de acciones"] },
      { key: "agents", icon: Bot, title: "Agentes IA", items: ["SDR Speed-to-lead", "Calificador", "Autonomía L0-L3", "Corridas auditadas"] },
    ],
  },
  {
    title: "Organización",
    cards: [
      { key: "teams", icon: Users, title: "Equipos & Territorios", items: ["Equipos con líder", "Territorios por plaza/zona", "Reglas de asignación", "Miembros"] },
      { href: "/admin", icon: UserCircle, title: "Usuarios & Roles", items: ["Altas y roles", "Comisiones", "Plazas"] },
    ],
  },
  {
    title: "Personalización",
    cards: [
      { key: "fields", icon: Database, title: "Módulos & Campos", items: ["Catálogo anti-sprawl", "Campos custom (Contact/Deal)", "Picklists", "Permisos por rol"] },
      { key: "corefields", icon: Eye, title: "Visibilidad de campos", items: ["Campos core por rol", "Ocultar / solo lectura / editar", "Contacto (más módulos pronto)", "Enforcement en API"] },
      { href: "/settings", icon: FileText, title: "Mi perfil & Plantillas", items: ["Firma de correo", "Tarjeta digital", "Plantillas con atajos"] },
    ],
  },
  {
    title: "Canales",
    cards: [
      { href: "/admin?tab=integrations", icon: Plug, title: "Conectores & Marketplace", items: ["Meta Lead Ads", "TikTok", "Portales inmobiliarios", "CAPI (conversiones)"] },
      { href: "/inbox", icon: MessageSquare, title: "WhatsApp", items: ["Inbox con bot", "Takeover humano", "Cloud API directo"] },
    ],
  },
];

export function ConfigCenter({ userRole }: { userRole: string }) {
  const [section, setSection] = useState<SectionKey>("index");

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
        {section === "automation" && <AutomationSection userRole={userRole} />}
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
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              {group.title}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
              {group.cards.map((card) => {
                const Icon = card.icon;
                const inner = (
                  <div className="crm-card !p-4 h-full cursor-pointer group">
                    <div className="flex items-start justify-between">
                      <Icon className="h-5 w-5" style={{ color: "var(--text-primary)" }} />
                      <ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--text-tertiary)" }} />
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
        ))}
      </div>
    </div>
  );
}
