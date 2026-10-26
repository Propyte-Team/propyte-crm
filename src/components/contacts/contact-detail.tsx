// Detalle de contacto — una sola pantalla, "instrumento" (no pestañas).
// Estado/temperatura/tipo/urgencia editables inline en el header; datos editables
// inline por campo; timeline unificada con compositor de notas. Diseño minimalista
// del Speckit #6 (hairlines, tokens, color solo como señal).
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactForm } from "@/components/contacts/contact-form";
import { LifecycleStepper } from "@/components/contacts/lifecycle-stepper";
import { InfoAdicionalSection, AnuncioOrigenSection } from "@/components/contacts/info-adicional";
import { CvContacto } from "@/components/contacts/cv-contacto";
import { DealForm } from "@/components/pipeline/deal-form";
import { ConversationPanel } from "@/components/contacts/conversation-panel";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { BotonOjoCronologia, useCronologiaVisible } from "@/components/contacts/cronologia-visible";
import { CallButton } from "@/components/voice/call-button";
import { BotonCorreo } from "@/components/contacts/boton-correo";
import { useVoice } from "@/components/voice/voice-device-provider";
import { QuoteList } from "@/components/quotes/quote-list";
import { puedeModificarCotizaciones } from "@/lib/rbac/quote-scope";
import { DealDocumentsSection } from "@/components/quotes/deal-documents-section";
import { CustomFieldsSection } from "@/components/metadata/custom-fields-section";
import { ActivityLog } from "@/components/activities/activity-log";
import { ShortlistPanel } from "@/components/shortlists/shortlist-panel";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import { BrandBadges } from "@/components/brands/brand-view";
import { ReferidoPorEncabezado } from "@/components/contacts/referido-por";
import { tituloRegistros } from "@/lib/contacts/referidos";
import { ScoreMetric, type ScoreGuardado } from "./score-metric";
import {
  CONTACT_STATUS_LABELS,
  CONTACT_STATUS_COLORS,
  CONTACT_STATUS_ORDER,
  URGENCY_LABELS,
  URGENCY_COLORS,
  CONTACT_TYPE_LABELS,
  CONTACT_TYPE_ORDER,
  CONTACT_TYPE_VACIO_LABEL,
  CONTACT_TYPE_BROKER,
  tieneCicloDeVida,
  LEAD_TEMPERATURE_LABELS,
  LEAD_SOURCE_ORDER,
  LEAD_SOURCE_LABELS,
} from "@/lib/constants";
import {
  INVESTMENT_LABEL,
  PROPERTY_LABEL,
  TIMELINE_LABEL,
  PAYMENT_LABEL,
  MODALITY_LABEL,
  RENTAL_LABEL,
} from "@/lib/contacts/perfil-labels";

// --- Etiquetas locales (no en constants) ---
const TEMP_COLORS: Record<string, string> = {
  HOT: "#DC2626",
  WARM: "#D97706",
  COLD: "#3B82F6",
  DEAD: "#9CA3AF",
};
const DEAL_STAGE_LABEL: Record<string, string> = {
  NEW_LEAD: "Nuevo lead",
  CONTACTED: "Contactado",
  DISCOVERY_DONE: "Descubrimiento",
  MEETING_SCHEDULED: "Visita agendada",
  MEETING_COMPLETED: "Visita realizada",
  PROPOSAL_SENT: "Propuesta enviada",
  NEGOTIATION: "Negociación",
  RESERVED: "Reservado",
  CONTRACT_SIGNED: "Contrato firmado",
  CLOSING: "En cierre",
  WON: "Ganado",
  LOST: "Perdido",
  FROZEN: "Congelado",
};

type FieldAccess = "HIDDEN" | "READ" | "EDIT";

interface ContactDetailProps {
  contact: any;
  userRole: string;
  fieldAccess?: Record<string, FieldAccess>;
  currentUserId?: string;
  currentUserName?: string | null;
  /** Lead scoring: último cálculo guardado (contact_scores) y si ya está activo o en sombra. */
  scoreGuardado?: ScoreGuardado | null;
  scoringActivo?: boolean;
}

export function ContactDetail({ contact, userRole, fieldAccess = {}, currentUserId, currentUserName, scoreGuardado = null, scoringActivo = false }: ContactDetailProps) {
  // Acceso por campo core (default EDIT). HIDDEN ya viene removido del server; aquí
  // ocultamos en UI igual por robustez y degradamos READ a solo lectura.
  const acc = (key: string): FieldAccess => fieldAccess[key] ?? "EDIT";
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  // Llamadas: salen por el navegador (WebRTC, VoiceDeviceProvider). Antes había un
  // CallIndicator que pegaba a /api/twilio/call (Twilio llamaba al contacto y volvía a
  // marcar el mismo número → "ocupado") y simulaba "activa" a los 3 s. Ver #847.
  const voice = useVoice();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(
    contact.deals?.length > 0 ? contact.deals[0].id : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [showConv, setShowConv] = useState(false);
  // #932: la cronología se puede ocultar; la preferencia la recuerda el navegador.
  const [cronologiaVisible, alternarCronologia] = useCronologiaVisible();
  // #885: al enviar un correo desde el encabezado, el historial (ActivityLog) se relee.
  const [historialKey, setHistorialKey] = useState(0);

  const canDelete = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT"].includes(userRole);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const formatShort = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  };
  const relative = (dateStr: string | null) => {
    if (!dateStr) return "Sin contacto";
    const diff = Date.now() - new Date(dateStr).getTime();
    const d = Math.floor(diff / 86400000);
    if (d <= 0) return "Hoy";
    if (d === 1) return "Ayer";
    if (d < 30) return `Hace ${d}d`;
    return formatShort(dateStr);
  };
  const formatCurrency = (value: number | string | null, currency = "MXN") => {
    if (!value) return "—";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
  };

  // --- Métricas de resumen (at-a-glance) ---
  const activities: any[] = contact.activities ?? [];
  const lastActivity = activities[0]?.createdAt ?? contact.lastActivityAt ?? null;
  const nextFollowUp = useMemo(() => {
    const pending = activities
      .filter((a) => a.status === "PENDIENTE" && a.dueDate)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    return pending[0]?.dueDate ?? null;
  }, [activities]);

  // --- Guardado inline de un campo del contacto ---
  async function save(patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/contacts?id=${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      router.refresh();
      return true;
    }
    return false;
  }

  async function changeField(field: string, value: unknown) {
    setBusy(field);
    await save({ [field]: value });
    setBusy(null);
  }

  // Campo de texto con gating de acceso (HIDDEN → nada, READ → solo lectura, EDIT → inline).
  function gText(
    key: string,
    label: string,
    opts: { type?: string; display?: string; transform?: (v: string) => unknown } = {}
  ) {
    const a = acc(key);
    if (a === "HIDDEN") return null;
    const raw = contact[key];
    const strVal = raw === null || raw === undefined ? "" : String(raw);
    if (a === "READ") return <ReadRow label={label} value={opts.display ?? strVal} />;
    return (
      <InlineText
        label={label}
        value={strVal}
        type={opts.type}
        display={opts.display}
        onSave={(v) => save({ [key]: opts.transform ? opts.transform(v) : v })}
      />
    );
  }

  // Select con gating de acceso.
  function gSelect(
    key: string,
    label: string,
    options: { value: string; label: string }[],
    opts: { nullable?: boolean } = {}
  ) {
    const a = acc(key);
    if (a === "HIDDEN") return null;
    const value = contact[key] ?? "";
    if (a === "READ") {
      const lbl = options.find((o) => o.value === value)?.label ?? "—";
      return <ReadRow label={label} value={lbl} />;
    }
    return (
      <InlineSelectRow
        label={label}
        value={value}
        options={options}
        onSave={(v) => save({ [key]: opts.nullable ? v || null : v })}
      />
    );
  }

  const openWhatsApp = () => {
    // #830: wa.me es un esquema de enlace que solo entiende números — no tiene
    // equivalente por Usuario de WhatsApp (BSUID), así que sin teléfono no hay a
    // dónde abrir. El botón se deshabilita más abajo para este caso; esto es el
    // respaldo si de todos modos se llegara a invocar.
    if (!contact.phone) return;
    const cleanPhone = contact.phone.replace(/[\s\-()]/g, "");
    window.open(`https://wa.me/${cleanPhone}`, "_blank");
  };

  const handleDelete = async () => {
    if (!confirm("¿Eliminar este contacto? (soft delete)")) return;
    const res = await fetch(`/api/contacts?id=${contact.id}`, { method: "DELETE" });
    if (res.ok) router.push("/contacts");
  };

  const statusColor = CONTACT_STATUS_COLORS[contact.contactStatus] ?? "#9CA3AF";

  // #907: referidos del broker. La sección se muestra en todo Broker (aunque aún no tenga) y en
  // cualquier contacto que ya tenga referidos ligados, para que no queden ligas invisibles si
  // alguien le cambia el tipo.
  const referidos: Referido[] = contact.referidos ?? [];
  const referidosNoListados: number = contact.referidosNoListados ?? 0;
  const mostrarReferidos =
    acc("referredById") !== "HIDDEN" &&
    (contact.contactType === CONTACT_TYPE_BROKER || referidos.length > 0 || referidosNoListados > 0);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.push("/contacts")}
            className="mt-1 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display, inherit)" }}>
                {contact.firstName} {contact.lastName}
              </h1>
              {/* Marca(s) del contacto (entrega 3, 2026-10-12): solo si aporta, ver brandBadges */}
              <BrandBadges brandIds={contact.brands?.map((b: { brandId: string }) => b.brandId)} />
            </div>
            {/* #909: solo si es referido; la página ya lo quita si el rol tiene el campo oculto */}
            {acc("referredById") !== "HIDDEN" && <ReferidoPorEncabezado referredBy={contact.referredBy} />}
            {/* Chips editables inline */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {acc("contactStatus") !== "HIDDEN" && (
                <ChipSelect
                  value={contact.contactStatus ?? "NUEVO"}
                  options={CONTACT_STATUS_ORDER.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] }))}
                  dotColor={statusColor}
                  loading={busy === "contactStatus"}
                  readOnly={acc("contactStatus") !== "EDIT"}
                  onChange={(v) => changeField("contactStatus", v)}
                />
              )}
              {acc("temperature") !== "HIDDEN" && (
                <ChipSelect
                  value={contact.temperature ?? "COLD"}
                  options={Object.entries(LEAD_TEMPERATURE_LABELS).map(([value, label]) => ({ value, label }))}
                  dotColor={TEMP_COLORS[contact.temperature] ?? "#9CA3AF"}
                  loading={busy === "temperature"}
                  readOnly={acc("temperature") !== "EDIT"}
                  onChange={(v) => changeField("temperature", v)}
                />
              )}
              {acc("contactType") !== "HIDDEN" && (
                <ChipSelect
                  // #863: sin tipo se muestra «—» (antes caía a "LEAD" y mostraba un tipo falso).
                  value={contact.contactType ?? ""}
                  options={[
                    { value: "", label: `Tipo ${CONTACT_TYPE_VACIO_LABEL}` },
                    ...CONTACT_TYPE_ORDER.map((value) => ({ value, label: CONTACT_TYPE_LABELS[value] })),
                  ]}
                  loading={busy === "contactType"}
                  readOnly={acc("contactType") !== "EDIT"}
                  onChange={(v) => changeField("contactType", v || null)}
                />
              )}
              {acc("urgency") !== "HIDDEN" && (
                <ChipSelect
                  value={contact.urgency ?? ""}
                  options={[
                    { value: "", label: "Urgencia —" },
                    ...Object.entries(URGENCY_LABELS).map(([value, label]) => ({ value, label: `Urgencia ${label}` })),
                  ]}
                  dotColor={contact.urgency ? URGENCY_COLORS[contact.urgency] : undefined}
                  loading={busy === "urgency"}
                  readOnly={acc("urgency") !== "EDIT"}
                  onChange={(v) => changeField("urgency", v || null)}
                />
              )}
              {/* AUD-20260710-04: la fuente ahora es editable inline (antes span estático) */}
              {acc("leadSource") !== "HIDDEN" && (
                <ChipSelect
                  value={contact.leadSource ?? "OTRO"}
                  options={LEAD_SOURCE_ORDER.map((v) => ({ value: v, label: LEAD_SOURCE_LABELS[v] }))}
                  loading={busy === "leadSource"}
                  readOnly={acc("leadSource") !== "EDIT"}
                  onChange={(v) => changeField("leadSource", v)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary text-[13px]"
            onClick={openWhatsApp}
            disabled={!contact.phone}
            title={!contact.phone ? "Sin teléfono — escríbele desde el Inbox con su Usuario de WhatsApp" : undefined}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </button>
          {voice?.ready && currentUserId && contact.phone ? (
            <CallButton
              phone={contact.phone}
              contactId={contact.id}
              userId={currentUserId}
              doNotContact={contact.doNotContact ?? false}
            />
          ) : (
            <button
              className="btn-secondary text-[13px]"
              disabled
              title={
                !contact.phone
                  ? "Sin teléfono"
                  : "Telefonía no disponible: revisa el micrófono del navegador o la configuración de Twilio"
              }
            >
              <Phone className="h-4 w-4" /> Llamar
            </button>
          )}
          {/* #885: correo desde la cuenta del asesor (hoy Gmail). Explica al hacer clic si no se puede. */}
          <BotonCorreo
            contactId={contact.id}
            contactName={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()}
            contactEmail={contact.email}
            contactFirstName={contact.firstName ?? undefined}
            contactLastName={contact.lastName ?? undefined}
            doNotContact={contact.doNotContact ?? false}
            onSent={() => {
              setHistorialKey((k) => k + 1);
              router.refresh();
            }}
          />
          <button
            className="btn-secondary text-[13px]"
            onClick={() => setDealOpen(true)}
          >
            <Plus className="h-4 w-4" /> Crear Deal
          </button>
          <button className="btn-secondary text-[13px]" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Editar todo
          </button>
          {canDelete && (
            <button className="btn-danger text-[13px]" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* #917: CV del contacto — botón opcional «Subir CV» o la tarjeta con los que ya hay. */}
      <CvContacto contactId={contact.id} />

      {/* ── Barra de resumen ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border md:grid-cols-5" style={{ borderColor: "var(--border-default)", background: "var(--border-subtle)" }}>
        <Metric label="Último contacto" value={relative(lastActivity)} sub={lastActivity ? formatShort(lastActivity) : undefined} />
        <Metric label="Actividades" value={String(activities.length)} num />
        <Metric label="Próx. seguimiento" value={nextFollowUp ? formatShort(nextFollowUp) : "—"} highlight={!!nextFollowUp} />
        <Metric label="Deals" value={String(contact.deals?.length ?? 0)} num />
        {acc("score") !== "HIDDEN" && (
          <ScoreMetric scoreContacto={Number(contact.score ?? 0)} guardado={scoreGuardado} activo={scoringActivo} />
        )}
      </div>

      {/* ── Grid principal: datos (izq) + timeline (der) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Columna izquierda — datos inline */}
        <div className="space-y-5 lg:col-span-5">
          <Section title="Datos">
            {gText("firstName", "Nombre")}
            {gText("lastName", "Apellido")}
            {gText("phone", "Teléfono")}
            {gText("secondaryPhone", "Teléfono 2")}
            {gText("whatsappUserId", "Usuario de WhatsApp")}
            {gText("email", "Email", { type: "email" })}
            {gSelect("preferredLanguage", "Idioma", [
              { value: "ES", label: "Español" },
              { value: "EN", label: "Inglés" },
            ])}
            <ReadRow label="Registro" value={formatDate(contact.createdAt)} />
          </Section>

          <Section title="Ubicación">
            {gText("residenceCity", "Ciudad")}
            {gText("residenceCountry", "País")}
            {gText("nationality", "Nacionalidad")}
          </Section>

          <Section title="Perfil de inversión">
            {gSelect("investmentProfile", "Perfil", [{ value: "", label: "—" }, ...Object.entries(INVESTMENT_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
            {gSelect("propertyType", "Tipo de propiedad", [{ value: "", label: "—" }, ...Object.entries(PROPERTY_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
            {gSelect("purchaseTimeline", "Horizonte", [{ value: "", label: "—" }, ...Object.entries(TIMELINE_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
            {gText("budgetMin", "Presupuesto mín.", { type: "number", display: formatCurrency(contact.budgetMin), transform: (v) => (v ? Number(v) : null) })}
            {gText("budgetMax", "Presupuesto máx.", { type: "number", display: formatCurrency(contact.budgetMax), transform: (v) => (v ? Number(v) : null) })}
            {gSelect("paymentMethod", "Forma de pago", [{ value: "", label: "—" }, ...Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
            {gText("preferredZone", "Zona preferida")}
            {gSelect("purchaseModality", "Modalidad", [{ value: "", label: "—" }, ...Object.entries(MODALITY_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
            {gSelect("rentalStrategy", "Estrategia de renta", [{ value: "", label: "—" }, ...Object.entries(RENTAL_LABEL).map(([value, label]) => ({ value, label }))], { nullable: true })}
          </Section>

          {/* #914: datos que llegaron de Zoho (y que se pueden capturar a mano) + anuncio de origen. */}
          <InfoAdicionalSection contact={contact} acc={acc} save={save} />
          <AnuncioOrigenSection adAttribution={contact.adAttribution} />

          {tieneCicloDeVida(contact.contactType) && (
            <Section title="Ciclo de vida">
              <div className="space-y-1 py-1">
                <label className="text-xs text-[color:var(--text-tertiary)]">Etapa</label>
                <LifecycleStepper
                  value={contact.lifecycleStage ?? null}
                  loading={busy === "lifecycleStage"}
                  readOnly={acc("lifecycleStage") === "HIDDEN" || acc("lifecycleStage") === "READ"}
                  onChange={(v) => changeField("lifecycleStage", v)}
                />
              </div>
            </Section>
          )}

          <Section title="Asignación">
            {/* #907: el broker que lo trajo. Se cambia en «Editar todo». */}
            {acc("referredById") !== "HIDDEN" && (
              <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                <span className="text-[color:var(--text-tertiary)]">Registrado por</span>
                {contact.referredBy ? (
                  contact.referredBy.puedeAbrir ? (
                    <Link
                      href={`/contacts/${contact.referredBy.id}`}
                      className="text-right font-medium underline-offset-2 hover:underline"
                      style={{ color: "var(--color-teal, #0D9488)" }}
                    >
                      {contact.referredBy.nombre}
                    </Link>
                  ) : (
                    <span
                      className="text-right font-medium text-[color:var(--text-primary)]"
                      title="No tienes acceso a la ficha de este broker"
                    >
                      {contact.referredBy.nombre}
                    </span>
                  )
                ) : (
                  <span className="text-right text-[color:var(--text-tertiary)]">—</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="text-[color:var(--text-tertiary)]">Asesor</span>
              <AdvisorSelect
                value={contact.assignedToId ?? contact.assignedTo?.id ?? null}
                allowUnassigned
                // 2026-10-10: quien ve la ficha puede asignársela aunque no tenga rol
                // de asesor (p. ej. ADMIN de marketing). Ver advisor-options.ts.
                self={currentUserId ? { id: currentUserId, name: currentUserName ?? null, email: null } : null}
                onChange={(id) => changeField("assignedToId", id)}
              />
            </div>
            <div className="flex items-start justify-between gap-3 py-1.5">
              <span className="text-[13px] text-[color:var(--text-tertiary)]">Etiquetas</span>
              <div className="flex flex-wrap justify-end gap-1">
                {contact.tags?.length > 0 ? (
                  contact.tags.map((t: string, i: number) => (
                    <span key={i} className="rounded border px-1.5 py-0.5 text-xs" style={{ borderColor: "var(--border-default)" }}>
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-[13px] text-[color:var(--text-tertiary)]">Sin etiquetas</span>
                )}
              </div>
            </div>
          </Section>

          <CustomFieldsSection object="contact" recordId={contact.id} />
        </div>

        {/* Columna derecha — timeline unificada + notas */}
        <div className="space-y-5 lg:col-span-7">
          <div className="crm-card">
            <ActivityLog
              contactId={contact.id}
              contactName={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()}
              contactEmail={contact.email ?? undefined}
              contactFirstName={contact.firstName ?? undefined}
              contactLastName={contact.lastName ?? undefined}
              contactPhone={contact.phone ?? undefined}
              doNotContact={contact.doNotContact ?? false}
              currentUserId={currentUserId}
              onChanged={() => router.refresh()}
              refreshKey={historialKey}
            />
          </div>
          <ShortlistPanel contactId={contact.id} />
        </div>
      </div>

      {/* ── Deals ── */}
      <Section
        title={`Deals (${contact.deals?.length ?? 0})`}
        action={
          <button className="btn-secondary text-[13px]" onClick={() => setDealOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo deal
          </button>
        }
      >
        {contact.deals?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="hairline-b text-left text-[color:var(--text-tertiary)]">
                  <th className="pb-2 font-medium">Etapa</th>
                  <th className="pb-2 font-medium">Desarrollo</th>
                  <th className="pb-2 font-medium">Unidad</th>
                  <th className="pb-2 font-medium">Valor</th>
                  <th className="pb-2 font-medium">Asesor</th>
                  <th className="pb-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {contact.deals.map((deal: any) => (
                  <tr
                    key={deal.id}
                    className="hairline-b cursor-pointer last:border-0 hover:bg-[color:var(--bg-row-hover)]"
                    onClick={() => router.push(`/pipeline?dealId=${deal.id}`)}
                  >
                    <td className="py-2">{DEAL_STAGE_LABEL[deal.stage] ?? deal.stage}</td>
                    <td className="py-2">{deal.development?.name ?? "—"}</td>
                    <td className="py-2">{deal.unit?.unitNumber ?? "—"}</td>
                    <td className="num py-2">{formatCurrency(deal.estimatedValue, deal.currency)}</td>
                    <td className="py-2">{deal.assignedTo?.name ?? "—"}</td>
                    <td className="py-2 text-[color:var(--text-tertiary)]">{formatShort(deal.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
            Sin operaciones. Crea un deal para iniciar el proceso comercial.
          </p>
        )}
      </Section>

      {/* ── Cotizaciones / Documentos por deal ── */}
      {contact.deals?.length > 0 && selectedDealId && (
        <Section
          title="Cotizaciones y documentos"
          action={
            contact.deals.length > 1 ? (
              <select
                className="form-input max-w-[240px] text-[13px]"
                value={selectedDealId ?? ""}
                onChange={(e) => setSelectedDealId(e.target.value)}
              >
                {contact.deals.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.development?.name ?? "Sin desarrollo"} — {DEAL_STAGE_LABEL[d.stage] ?? d.stage}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        >
          <QuoteList dealId={selectedDealId} soloLectura={!puedeModificarCotizaciones(userRole)} />
          <div className="mt-6 border-t pt-6" style={{ borderColor: "var(--border-subtle)" }}>
            <DealDocumentsSection dealId={selectedDealId} />
          </div>
        </Section>
      )}

      {/* ── Conversaciones (WhatsApp/SMS) ── */}
      {/* Bajo demanda: ConversationPanel hace scrollIntoView al montar; si se renderiza
          siempre, secuestra el scroll de la página y tapa la edición inline. */}
      <Section
        title="Conversaciones"
        action={
          <button className="btn-secondary text-[13px]" onClick={() => setShowConv((v) => !v)}>
            <MessageCircle className="h-3.5 w-3.5" /> {showConv ? "Ocultar" : "Abrir conversación"}
          </button>
        }
      >
        {showConv ? (
          <ConversationPanel
            contactId={contact.id}
            contactName={`${contact.firstName} ${contact.lastName}`}
            contactPhone={contact.phone}
          />
        ) : (
          <p className="py-4 text-center text-[13px] text-[color:var(--text-tertiary)]">
            Abre la conversación para ver el hilo de WhatsApp/SMS de este contacto.
          </p>
        )}
      </Section>

      {/* ── Cronología ── #932: ojo para ocultarla; oculta no se monta (ni pide datos) */}
      <Section
        title="Cronología"
        action={<BotonOjoCronologia visible={cronologiaVisible} onClick={alternarCronologia} />}
      >
        {cronologiaVisible ? (
          <ContactTimeline contactId={contact.id} />
        ) : (
          <p className="py-4 text-center text-[13px] text-[color:var(--text-tertiary)]">
            Cronología oculta. Usa «Mostrar» para ver los cambios, actividades y mensajes.
          </p>
        )}
      </Section>

      {/* ── Referidos del broker (#907): hasta abajo, cada uno abre su ficha ── */}
      {mostrarReferidos && (
        // #929: «Registro(s) de Broker» (antes «Referidos»).
        <Section title={tituloRegistros(referidos.length + referidosNoListados)}>
          {referidos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="hairline-b text-left text-[color:var(--text-tertiary)]">
                    <th className="pb-2 font-medium">Nombre</th>
                    <th className="pb-2 font-medium">Tipo</th>
                    <th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 font-medium">Asesor</th>
                    <th className="pb-2 font-medium">Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {referidos.map((r) => (
                    <tr
                      key={r.id}
                      className="hairline-b cursor-pointer last:border-0 hover:bg-[color:var(--bg-row-hover)]"
                      onClick={() => router.push(`/contacts/${r.id}`)}
                    >
                      <td className="py-2">
                        {/* Enlace real (no solo la fila): abre en otra pestaña con clic medio o Ctrl. */}
                        <Link
                          href={`/contacts/${r.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                          style={{ color: "var(--color-teal, #0D9488)" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.nombre}
                        </Link>
                      </td>
                      <td className="py-2">
                        {r.contactType ? CONTACT_TYPE_LABELS[r.contactType] ?? r.contactType : CONTACT_TYPE_VACIO_LABEL}
                      </td>
                      <td className="py-2">{CONTACT_STATUS_LABELS[r.contactStatus] ?? r.contactStatus ?? "—"}</td>
                      <td className="py-2">{r.asesor ?? "Sin asignar"}</td>
                      <td className="py-2 text-[color:var(--text-tertiary)]">{formatShort(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            referidosNoListados === 0 && (
              <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
                Este broker aún no tiene registros. Para ligar uno, abre el contacto y elige a este
                broker en «Registrado por» (Editar todo).
              </p>
            )
          )}
          {referidosNoListados > 0 && (
            <p className="pt-3 text-[12px] text-[color:var(--text-tertiary)]">
              {referidosNoListados === 1
                ? "1 registro más no aparece aquí: está asignado a otro asesor o fuera de tu alcance."
                : `${referidosNoListados} registros más no aparecen aquí: están asignados a otros asesores o fuera de tu alcance.`}
            </p>
          )}
        </Section>
      )}

      {/* Modal de crear deal */}
      <Dialog open={dealOpen} onOpenChange={setDealOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear nuevo deal</DialogTitle>
          </DialogHeader>
          <DealForm
            initialData={{ contactId: contact.id }}
            onSuccess={() => {
              setDealOpen(false);
              router.refresh();
            }}
            onCancel={() => setDealOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Modal de edición completa */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar contacto</DialogTitle>
          </DialogHeader>
          <ContactForm mode="edit" initialData={contact} onSuccess={() => { setEditOpen(false); router.refresh(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Sub-componentes ─────────────────────────

/** Un referido del broker tal como lo arma getContact (#907). */
interface Referido {
  id: string;
  nombre: string;
  contactType: string | null;
  contactStatus: string;
  createdAt: string;
  asesor: string | null;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="crm-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, sub, num, highlight }: { label: string; value: string; sub?: string; num?: boolean; highlight?: boolean }) {
  return (
    <div className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
      <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">{label}</p>
      <p className={`mt-0.5 text-[15px] font-medium ${num ? "num" : ""}`} style={{ color: highlight ? "var(--color-teal, #0D9488)" : "var(--text-primary)" }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-[color:var(--text-tertiary)]">{sub}</p>}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span className="text-right font-medium text-[color:var(--text-primary)]">{value || "—"}</span>
    </div>
  );
}

// Campo de texto editable inline (click → input → guardar)
function InlineText({
  label,
  value,
  type = "text",
  display,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  type?: string;
  display?: string;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function commit() {
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(false);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (ok) setEditing(false);
    else setError(true);
  }

  if (editing) {
    return (
      <div className="py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">{label}</span>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            autoFocus
            type={type}
            className="form-input text-[13px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
            }}
          />
          <button className="btn-primary !px-2 !py-2" onClick={commit} disabled={saving} aria-label="Guardar">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button className="btn-secondary !px-2 !py-2" onClick={() => { setDraft(value ?? ""); setEditing(false); }} aria-label="Cancelar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <p className="mt-1 text-[11px]" style={{ color: "var(--color-error, #DC2626)" }}>No se pudo guardar (revisa el formato)</p>}
      </div>
    );
  }

  return (
    <div
      className="group flex cursor-text items-center justify-between gap-3 py-1.5 text-[13px]"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
    >
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-medium text-[color:var(--text-primary)]">
        {display ?? value ?? <span className="text-[color:var(--text-tertiary)]">—</span>}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
      </span>
    </div>
  );
}

// Select editable inline en fila (guarda onChange)
function InlineSelectRow({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <select
        className="form-input max-w-[180px] text-[13px]"
        value={value}
        disabled={saving}
        onChange={async (e) => { setSaving(true); await onSave(e.target.value); setSaving(false); }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// Chip-select compacto para el header (dot de color + label + dropdown nativo encima)
function ChipSelect({
  value,
  options,
  dotColor,
  loading,
  readOnly,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  dotColor?: string;
  loading?: boolean;
  readOnly?: boolean;
  onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <span
      className="relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-card)", opacity: loading ? 0.5 : 1 }}
    >
      {dotColor && <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />}
      {current?.label ?? value}
      {!readOnly && (
        <>
          <svg className="h-3 w-3 text-[color:var(--text-tertiary)]" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          <select
            className="absolute inset-0 cursor-pointer opacity-0"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Cambiar"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </>
      )}
    </span>
  );
}
