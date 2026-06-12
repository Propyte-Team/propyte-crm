// Cobranza (Fase 3, T3.4) — aging de parcialidades. Componente de servidor.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getCobranza } from "@/server/cobranza";

export const dynamic = "force-dynamic";

const BUCKET_COLOR: Record<string, string> = {
  upcoming: "#64748B",
  d30: "#D97706",
  d60: "#EA580C",
  d90: "#DC2626",
  d90plus: "#991B1B",
};

function money(n: number, c = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
}

export default async function CobranzaPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const data = await getCobranza(session.user.id, session.user.role);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Desempeño</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">Cobranza</h1>
        <p className="num mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {money(data.totalOverdue)} vencido en total
        </p>
      </div>

      {/* Aging buckets */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border md:grid-cols-5"
        style={{ borderColor: "var(--border-default)", background: "var(--border-subtle)" }}>
        {data.buckets.map((b) => (
          <div key={b.key} className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[b.key] }} />
              <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">{b.label}</p>
            </div>
            <p className="num mt-1 text-[15px] font-medium">{money(b.total)}</p>
            <p className="text-[11px] text-[color:var(--text-tertiary)]">{b.count} parcialidad{b.count === 1 ? "" : "es"}</p>
          </div>
        ))}
      </div>

      {/* Vencidas */}
      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
            Parcialidades vencidas
          </span>
        </div>
        {data.overdue.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[color:var(--text-tertiary)]" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Venció</th>
                  <th className="px-4 py-2 font-medium">Días</th>
                  <th className="px-4 py-2 font-medium">Asesor</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {data.overdue.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="px-4 py-2">{r.contact}</td>
                    <td className="px-4 py-2 text-[color:var(--text-tertiary)]">
                      {new Date(r.dueDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="num px-4 py-2" style={{ color: r.daysOverdue > 60 ? "#DC2626" : "var(--text-primary)" }}>{r.daysOverdue}</td>
                    <td className="px-4 py-2 text-[color:var(--text-tertiary)]">{r.advisor}</td>
                    <td className="num px-4 py-2 text-right">{money(r.amount, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
            Sin parcialidades vencidas. Cobranza al día.
          </p>
        )}
      </div>
    </div>
  );
}
