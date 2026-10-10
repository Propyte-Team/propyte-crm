// Página de detalle de contacto - componente de servidor
import { getServerSession } from "@/lib/auth/session";
import { getContact } from "@/server/contacts";
import { redirect, notFound } from "next/navigation";
import { ContactDetail } from "@/components/contacts/contact-detail";
import { resolveCoreFieldAccess, stripHiddenCoreFields } from "@/lib/metadata/core-fields";

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

  return (
    <ContactDetail
      contact={JSON.parse(JSON.stringify(visibleContact))}
      userRole={session.user.role}
      fieldAccess={fieldAccess}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? session.user.email ?? null}
    />
  );
}
