// Página principal de contactos - componente de servidor
import { getServerSession } from "@/lib/auth/session";
import { getContacts } from "@/server/contacts";
import { redirect } from "next/navigation";
import { ContactsList } from "@/components/contacts/contacts-list";

export default async function ContactsPage() {
  // Verificar sesión activa
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  // Obtener primera página de contactos para renderizado inicial
  let initialData;
  try {
    initialData = await getContacts({ page: 1, pageSize: 20 });
  } catch {
    initialData = { contacts: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }

  return (
    <div className="space-y-6">
      {/* El encabezado vive en ContactsList para que el conteo se actualice en vivo */}
      {/* Componente cliente con tabla, filtros, paginación y formulario */}
      <ContactsList
        initialContacts={JSON.parse(JSON.stringify(initialData.contacts))}
        initialTotal={initialData.total}
        initialPage={initialData.page}
        initialPageSize={initialData.pageSize}
        initialTotalPages={initialData.totalPages}
        userRole={session.user.role}
      />
    </div>
  );
}
