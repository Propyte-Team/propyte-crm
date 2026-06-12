// ============================================================
// Página: /cotizaciones — Vista global de cotizaciones
// Server component con filtros por status y búsqueda
// ============================================================

import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { QuotesGlobalView } from "@/components/quotes/quotes-global-view";
import prisma from "@/lib/db";

export const metadata = {
  title: "Cotizaciones | Propyte CRM",
};

export default async function CotizacionesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Cargar cotizaciones con relaciones para la vista inicial
  const quotes = await prisma.quote.findMany({
    where: { deletedAt: null },
    include: {
      deal: {
        select: {
          id: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
          development: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
      paymentPlan: { select: { id: true, monthsCount: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Serializar Decimals y Dates para el cliente
  const serialized = quotes.map((q) => ({
    ...q,
    listPrice: Number(q.listPrice),
    discountPct: Number(q.discountPct),
    finalPrice: Number(q.finalPrice),
    fxRate: q.fxRate ? Number(q.fxRate) : null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    sentAt: q.sentAt?.toISOString() ?? null,
    openedAt: q.openedAt?.toISOString() ?? null,
    expiresAt: q.expiresAt?.toISOString() ?? null,
    deletedAt: q.deletedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-zinc-400">Ventas</p>
        <h1 className="text-2xl font-semibold text-zinc-900">Cotizaciones</h1>
      </div>

      <QuotesGlobalView
        initialQuotes={serialized}
        userRole={session.user.role}
      />
    </div>
  );
}
