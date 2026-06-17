// Microsite público de la propuesta express (§5.11.4). Sin auth (fuera del matcher del
// middleware). Registra una vista al abrir. Clon del patrón de /q/[id].
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getShortlistByToken, recordView } from "@/server/shortlists";
import type { UnitSnapshot } from "@/lib/shortlists/snapshot";
import { PrintButton } from "@/components/shortlists/print-button";

export const dynamic = "force-dynamic";

function money(n: number | null | undefined, currency = "MXN") {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default async function PublicShortlistPage({ params }: { params: { token: string } }) {
  const shortlist = await getShortlistByToken(params.token).catch(() => null);
  if (!shortlist) notFound();

  // Tracking de apertura (no debe romper el render si falla).
  const ua = headers().get("user-agent");
  await recordView(shortlist.id, ua).catch(() => null);

  const contactName = shortlist.contact
    ? `${shortlist.contact.firstName} ${shortlist.contact.lastName}`
    : "Cliente";
  const advisor = shortlist.createdBy;

  return (
    <main style={{ background: "#FAFAFA", minHeight: "100vh", color: "#0A0A0A", fontFamily: "system-ui, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: "@media print { .no-print { display: none !important; } body { background: #fff !important; } }" }} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #E5E5E5", paddingBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>Propyte</div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Propuesta</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#888" }}>
            <div>Para: {contactName}</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 24 }}>{shortlist.title}</h1>

        <section style={{ marginTop: 16, display: "grid", gap: 16 }}>
          {shortlist.items.map((item) => {
            const s = (item.snapshot && typeof item.snapshot === "object" ? item.snapshot : {}) as unknown as Partial<UnitSnapshot>;
            const currency = s.moneda ?? "MXN";
            const price = currency === "USD" ? s.precioUsd : s.precioMxn;
            const specs = [
              s.tipo,
              s.recamaras ? `${s.recamaras} rec` : null,
              s.banos ? `${s.banos} baños` : null,
              s.m2Construccion ? `${s.m2Construccion} m²` : null,
            ].filter(Boolean).join(" · ");
            return (
              <article key={item.id} style={{ border: "1px solid #E5E5E5", borderRadius: 8, padding: 16, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{s.titulo ?? s.numero ?? "Unidad"}</div>
                    <div style={{ color: "#555", fontSize: 14, marginTop: 2 }}>{specs || "—"}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap" }}>{money(price, currency)}</div>
                </div>
                {item.note && <p style={{ marginTop: 10, fontSize: 13, color: "#444" }}>{item.note}</p>}
              </article>
            );
          })}
          {shortlist.items.length === 0 && (
            <div style={{ color: "#888", fontSize: 14 }}>Esta propuesta aún no tiene unidades.</div>
          )}
        </section>

        {advisor && (
          <>
            <PrintButton />
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Hola, me interesa la propuesta "${shortlist.title}".`)}`}
              className="no-print"
              style={{ display: "inline-block", marginTop: 24, background: "#0A0A0A", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
            >
              Hablar con mi asesor por WhatsApp
            </a>
          </>
        )}

        <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #E5E5E5", fontSize: 11, color: "#aaa" }}>
          {advisor && <div style={{ marginBottom: 6 }}>Tu asesor: {advisor.name}{advisor.email ? ` · ${advisor.email}` : ""}</div>}
          Documento informativo sin valor contractual. Precios y disponibilidad sujetos a cambio y a confirmación del desarrollador. Propyte.
        </footer>
      </div>
    </main>
  );
}
