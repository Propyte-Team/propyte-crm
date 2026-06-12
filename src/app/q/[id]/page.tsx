// Landing pública de cotización (Fase 3, T3.3). Sin auth (no está en el matcher del
// middleware). Marca openedAt al abrir. Imprimible. La vigencia bloquea la aceptación.
import { notFound } from "next/navigation";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

const SCHEME_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  CREDITO_BANCARIO: "Crédito bancario",
  MIXTO: "Mixto",
};
const INSTALLMENT_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  PAGADA: "Pagada",
  VENCIDA: "Vencida",
  CONDONADA: "Condonada",
};

function money(n: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fdate(d?: Date | null) {
  return d ? new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" }) : "—";
}

export default async function PublicQuotePage({ params }: { params: { id: string } }) {
  const quote = await prisma.quote
    .findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        deal: { include: { contact: { select: { firstName: true, lastName: true } }, assignedTo: { select: { name: true, email: true } } } },
        paymentPlan: { include: { schedules: { orderBy: { number: "asc" } } } },
      },
    })
    .catch(() => null);

  if (!quote) notFound();

  // Marcar como abierta (tracking de apertura) — sólo la primera vez.
  if (!quote.openedAt) {
    await prisma.quote
      .update({
        where: { id: quote.id },
        data: { openedAt: new Date(), ...(quote.status === "SENT" ? { status: "OPENED" } : {}) },
      })
      .catch(() => null);
  }

  const snap = (quote.unitSnapshot && typeof quote.unitSnapshot === "object" ? (quote.unitSnapshot as any) : {}) as any;
  const currency = quote.currency;
  const listPrice = Number(quote.listPrice);
  const discountPct = Number(quote.discountPct);
  const finalPrice = Number(quote.finalPrice);
  const plan = quote.paymentPlan;
  const expired = quote.expiresAt ? new Date(quote.expiresAt).getTime() < Date.now() : false;
  const contactName = quote.deal?.contact ? `${quote.deal.contact.firstName} ${quote.deal.contact.lastName}` : "Cliente";
  const advisor = quote.deal?.assignedTo;

  return (
    <main style={{ background: "#FAFAFA", minHeight: "100vh", color: "#0A0A0A", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #E5E5E5", paddingBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>Propyte</div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Cotización</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#888" }}>
            <div>Para: {contactName}</div>
            <div>{fdate(quote.createdAt)}</div>
          </div>
        </div>

        {expired && (
          <div style={{ marginTop: 16, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B91C1C", padding: "10px 14px", fontSize: 13, borderRadius: 6 }}>
            Esta cotización venció el {fdate(quote.expiresAt)}. Solicita una actualizada a tu asesor.
          </div>
        )}

        {/* Unidad */}
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", margin: "0 0 8px" }}>Unidad</h2>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{snap.titulo ?? snap.numero ?? "Unidad"}</div>
          <div style={{ color: "#555", fontSize: 14 }}>
            {[snap.tipo, snap.recamaras ? `${snap.recamaras} rec` : null, snap.banos ? `${snap.banos} baños` : null, snap.m2Construccion ? `${snap.m2Construccion} m²` : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </section>

        {/* Precio */}
        <section style={{ marginTop: 24, border: "1px solid #E5E5E5", borderRadius: 8, padding: 16, background: "#fff" }}>
          <Row label="Precio de lista" value={money(listPrice, currency)} />
          {discountPct > 0 && <Row label={`Descuento (${discountPct}%)`} value={`– ${money(listPrice - finalPrice, currency)}`} />}
          <div style={{ borderTop: "1px solid #E5E5E5", marginTop: 8, paddingTop: 8 }}>
            <Row label="Precio final" value={money(finalPrice, currency)} strong />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#888" }}>Esquema: {SCHEME_LABEL[quote.scheme] ?? quote.scheme}</div>
        </section>

        {/* Plan de pagos */}
        {plan && (
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", margin: "0 0 8px" }}>Plan de pagos</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }}>
              <span>Enganche: <b>{money(Number(plan.downPaymentAmount), currency)}</b> ({Number(plan.downPaymentPct)}%)</span>
              {plan.monthsCount > 0 && <span>{plan.monthsCount} mensualidades de <b>{money(Number(plan.monthlyAmount), currency)}</b></span>}
              {Number(plan.deliveryAmount) > 0 && <span>Contraentrega: <b>{money(Number(plan.deliveryAmount), currency)}</b></span>}
            </div>
            {plan.schedules.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #E5E5E5" }}>
                    <th style={{ padding: "6px 0" }}>#</th>
                    <th style={{ padding: "6px 0" }}>Vence</th>
                    <th style={{ padding: "6px 0", textAlign: "right" }}>Monto</th>
                    <th style={{ padding: "6px 0", textAlign: "right" }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.schedules.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #F0F0F0" }}>
                      <td style={{ padding: "6px 0" }}>{s.number}</td>
                      <td style={{ padding: "6px 0" }}>{fdate(s.dueDate)}</td>
                      <td style={{ padding: "6px 0", textAlign: "right" }}>{money(Number(s.amount), currency)}</td>
                      <td style={{ padding: "6px 0", textAlign: "right", color: "#888" }}>{INSTALLMENT_LABEL[s.status] ?? s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* Vigencia + CTA */}
        <section style={{ marginTop: 24, fontSize: 13, color: "#555" }}>
          <div>Vigencia: <b>{fdate(quote.expiresAt)}</b></div>
          {quote.notes && <p style={{ marginTop: 8 }}>{quote.notes}</p>}
        </section>

        {!expired && advisor && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Hola, me interesa la cotización de ${snap.titulo ?? "la unidad"}.`)}`}
            style={{ display: "inline-block", marginTop: 20, background: "#0A0A0A", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            Hablar con mi asesor por WhatsApp
          </a>
        )}

        {/* Disclaimer */}
        <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #E5E5E5", fontSize: 11, color: "#aaa" }}>
          {advisor && <div style={{ marginBottom: 6 }}>Tu asesor: {advisor.name}{advisor.email ? ` · ${advisor.email}` : ""}</div>}
          Documento informativo sin valor contractual. Precios y disponibilidad sujetos a cambio y a confirmación del desarrollador. Propyte.
        </footer>
      </div>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 400, padding: "2px 0" }}>
      <span style={{ color: strong ? "#0A0A0A" : "#555" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
