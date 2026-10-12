// Página principal de contactos - componente de servidor
import { getServerSession } from "@/lib/auth/session";
import { getContacts } from "@/server/contacts";
import { redirect } from "next/navigation";
import { ContactsList } from "@/components/contacts/contacts-list";
import { BrandViewProvider } from "@/components/brands/brand-view";
import { getBrandViewContext } from "@/lib/brands/view-context";
import { BRAND_FILTER_PARAM } from "@/lib/brands/filter";

export default async function ContactsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  // Verificar sesión activa
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  // Selector «Marca» (entrega 3, 2026-10-12): la primera página ya sale filtrada por el `?marca=`
  // de la URL. getContacts ignora una marca que el usuario no ve.
  const marca = searchParams[BRAND_FILTER_PARAM];
  const brandId = typeof marca === "string" ? marca : undefined;
  const brandView = await getBrandViewContext(session.user);

  // Obtener primera página de contactos para renderizado inicial
  let initialData;
  try {
    initialData = await getContacts({ page: 1, pageSize: 20, brandId });
  } catch {
    initialData = { contacts: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }

  return (
    <div className="space-y-6">
      {/* El encabezado vive en ContactsList para que el conteo se actualice en vivo */}
      {/* Componente cliente con tabla, filtros, paginación y formulario */}
      <BrandViewProvider value={brandView}>
        <ContactsList
          initialContacts={JSON.parse(JSON.stringify(initialData.contacts))}
          initialTotal={initialData.total}
          initialPage={initialData.page}
          initialPageSize={initialData.pageSize}
          initialTotalPages={initialData.totalPages}
          userRole={session.user.role}
        />
      </BrandViewProvider>
    </div>
  );
}
