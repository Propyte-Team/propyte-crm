// Página de detalle de contacto - componente de servidor
import { getServerSession } from "@/lib/auth/session";
import { getContact } from "@/server/contacts";
import { redirect, notFound } from "next/navigation";
import { ContactDetail } from "@/components/contacts/contact-detail";
import { resolveCoreFieldAccess, stripHiddenCoreFields } from "@/lib/metadata/core-fields";
import { BrandViewProvider } from "@/components/brands/brand-view";
import { getBrandViewContext } from "@/lib/brands/view-context";
import { cargarConfigScoring, obtenerScoreContacto } from "@/lib/scoring/recalcular";

interface ContactPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactDetailPage(props: ContactPageProps) {
  const params = await props.params;
  // Verificar sesión activa
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  // Obtener contacto con todas las relaciones
  let contact;
  try {
    contact = await getContact(params.id);
  } catch {
    notFound();
  }

  if (!contact) {
    notFound();
  }

  // Field-level security: resolver acceso por rol, ocultar campos HIDDEN (server-side).
  const fieldAccess = await resolveCoreFieldAccess("contact", session.user.role);
  const visibleContact = stripHiddenCoreFields("contact", fieldAccess, contact as Record<string, unknown>);
  // #907: «Referido por» oculto para el rol → tampoco la liga ya resuelta ni los referidos.
  if (fieldAccess.referredById === "HIDDEN") {
    delete visibleContact.referredBy;
    delete visibleContact.referidos;
    delete visibleContact.referidosNoListados;
  }
  // #949: «Empresa» oculta para el rol → tampoco el nombre ya resuelto.
  if (fieldAccess.developerPartnerId === "HIDDEN") {
    delete visibleContact.developerPartner;
  }
  // #937: «Campaña o evento» oculta para el rol → tampoco el nombre ya resuelto.
  if (fieldAccess.campaignId === "HIDDEN") {
    delete visibleContact.campaign;
  }
  // Badge de marca en el encabezado (entrega 3, 2026-10-12). getContact ya trae contact.brands.
  const brandView = await getBrandViewContext(session.user);
  // Lead scoring: el desglose solo se carga si el rol puede ver el score. Las dos lecturas son
  // best-effort: sin contact_scores migrada la ficha se ve como antes.
  const veScore = fieldAccess.score !== "HIDDEN";
  const [scoreGuardado, scoringActivo] = veScore
    ? await Promise.all([
        obtenerScoreContacto(params.id),
        cargarConfigScoring().then((c) => c.activo).catch(() => false),
      ])
    : [null, false];

  return (
    <BrandViewProvider value={brandView}>
      <ContactDetail
        contact={JSON.parse(JSON.stringify(visibleContact))}
        userRole={session.user.role}
        fieldAccess={fieldAccess}
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? session.user.email ?? null}
        scoreGuardado={scoreGuardado ? JSON.parse(JSON.stringify(scoreGuardado)) : null}
        scoringActivo={scoringActivo}
      />
    </BrandViewProvider>
  );
}
