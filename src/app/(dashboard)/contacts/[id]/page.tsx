// Página de detalle de contacto - componente de servidor
import { getServerSession } from "@/lib/auth/session";
import { getContact } from "@/server/contacts";
import { redirect, notFound } from "next/navigation";
import { ContactDetail } from "@/components/contacts/contact-detail";

interface ContactPageProps {
  params: { id: string };
}

export default async function ContactDetailPage({ params }: ContactPageProps) {
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

  return (
    <ContactDetail
      contact={JSON.parse(JSON.stringify(contact))}
      userRole={session.user.role}
    />
  );
}
