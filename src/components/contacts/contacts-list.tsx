// Lista de contactos con búsqueda, filtros, paginación y acciones
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Eye,
  Pencil,
  MessageCircle,
  Trash2,
  FileUp,
  X,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ContactForm } from "@/components/contacts/contact-form";
import { ContactImport } from "@/components/contacts/contact-import";

// --- Tipos ---
interface ContactData {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  leadSource: string;
  temperature: string;
  contactType: string;
  createdAt: string;
  assignedTo: { id: string; name: string; email: string } | null;
  _count: { deals: number; activities: number };
}

interface ContactsListProps {
  initialContacts: ContactData[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
  initialTotalPages: number;
  userRole: string;
}

// Etiquetas en español para fuentes de leads (según enum Prisma)
const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in",
  FACEBOOK_ADS: "Facebook Ads",
  GOOGLE_ADS: "Google Ads",
  INSTAGRAM: "Instagram",
  PORTAL_INMOBILIARIO: "Portal",
  REFERIDO_CLIENTE: "Referido cliente",
  REFERIDO_BROKER: "Referido broker",
  LLAMADA_FRIA: "Llamada fría",
  EVENTO: "Evento",
  WEBSITE: "Sitio web",
  WHATSAPP: "WhatsApp",
  OTRO: "Otro",
};

// Etiquetas para temperatura del lead
const TEMP_LABEL: Record<string, string> = {
  HOT: "Caliente",
  WARM: "Tibio",
  COLD: "Frío",
  DEAD: "Muerto",
};

// Variantes de badge para temperatura
const TEMP_VARIANT: Record<string, "hot" | "warm" | "cold" | "dead"> = {
  HOT: "hot",
  WARM: "warm",
  COLD: "cold",
  DEAD: "dead",
};

// Etiquetas para tipo de contacto
const TYPE_LABEL: Record<string, string> = {
  LEAD: "Lead",
  PROSPECTO: "Prospecto",
  CLIENTE: "Cliente",
  INVERSIONISTA: "Inversionista",
  BROKER_EXTERNO: "Broker externo",
  REFERIDO: "Referido",
};

// Tamaño de página
const PAGE_SIZE = 20;

export function ContactsList({
  initialContacts,
  initialTotal,
  initialPage,
  initialPageSize,
  initialTotalPages,
  userRole,
}: ContactsListProps) {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactData[]>(initialContacts);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState("ALL");
  const [filterTemp, setFilterTemp] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editContact, setEditContact] = useState<ContactData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Función para obtener contactos desde la API
  const fetchContacts = useCallback(
    async (
      searchVal: string,
      sourceVal: string,
      tempVal: string,
      typeVal: string,
      pageVal: number
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageVal));
        params.set("pageSize", String(PAGE_SIZE));
        if (searchVal) params.set("search", searchVal);
        if (sourceVal !== "ALL") params.set("source", sourceVal);
        if (tempVal !== "ALL") params.set("temperature", tempVal);
        if (typeVal !== "ALL") params.set("type", typeVal);

        const res = await fetch(`/api/contacts?${params.toString()}`);
        if (!res.ok) throw new Error("Error al cargar contactos");

        const json = await res.json();
        setContacts(json.data || []);
        setTotal(json.pagination?.total || 0);
        setPage(json.pagination?.page || 1);
        setTotalPages(json.pagination?.totalPages || 0);
      } catch (err) {
        console.error("Error al obtener contactos:", err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Búsqueda con debounce de 300ms
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchContacts(value, filterSource, filterTemp, filterType, 1);
    }, 300);
  };

  // Cambio de filtro: recargar desde página 1
  const handleFilterChange = (
    type: "source" | "temp" | "type",
    value: string
  ) => {
    const newSource = type === "source" ? value : filterSource;
    const newTemp = type === "temp" ? value : filterTemp;
    const newType = type === "type" ? value : filterType;
    if (type === "source") setFilterSource(value);
    if (type === "temp") setFilterTemp(value);
    if (type === "type") setFilterType(value);
    fetchContacts(search, newSource, newTemp, newType, 1);
  };

  // Limpiar todos los filtros
  const clearFilters = () => {
    setSearch("");
    setFilterSource("ALL");
    setFilterTemp("ALL");
    setFilterType("ALL");
    fetchContacts("", "ALL", "ALL", "ALL", 1);
  };

  // Cambio de página
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchContacts(search, filterSource, filterTemp, filterType, newPage);
  };

  // Abrir WhatsApp con el número del contacto
  const openWhatsApp = (phone: string) => {
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, "");
    window.open(`https://wa.me/${cleanPhone}`, "_blank");
  };

  // Callback al crear/editar contacto exitosamente
  const handleFormSuccess = () => {
    setCreateOpen(false);
    setEditOpen(false);
    setEditContact(null);
    fetchContacts(search, filterSource, filterTemp, filterType, page);
  };

  // Eliminar contacto
  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar este contacto?")) return;

    try {
      const res = await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchContacts(search, filterSource, filterTemp, filterType, page);
      }
    } catch (err) {
      console.error("Error al eliminar contacto:", err);
    }
  };

  // Verificar si hay filtros activos
  const hasActiveFilters =
    search || filterSource !== "ALL" || filterTemp !== "ALL" || filterType !== "ALL";

  // Calcular rango visible
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Barra de acciones superior */}
      <div className="flex items-center justify-between gap-4">
        {/* Dialogo para nuevo contacto */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Contacto
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuevo Contacto</DialogTitle>
            </DialogHeader>
            <ContactForm mode="create" onSuccess={handleFormSuccess} />
          </DialogContent>
        </Dialog>

        {/* Botón de importación CSV */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <FileUp className="mr-2 h-4 w-4" />
              Importar CSV
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Importar Contactos</DialogTitle>
            </DialogHeader>
            <ContactImport onSuccess={() => {
              setImportOpen(false);
              fetchContacts(search, filterSource, filterTemp, filterType, page);
            }} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-6">
          {/* Barra de búsqueda y filtros */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Campo de búsqueda */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, email o teléfono..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filtro por fuente de lead */}
            <Select
              value={filterSource}
              onValueChange={(v) => handleFilterChange("source", v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Fuente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las fuentes</SelectItem>
                <SelectItem value="WALK_IN">Walk-in</SelectItem>
                <SelectItem value="FACEBOOK_ADS">Facebook Ads</SelectItem>
                <SelectItem value="GOOGLE_ADS">Google Ads</SelectItem>
                <SelectItem value="INSTAGRAM">Instagram</SelectItem>
                <SelectItem value="PORTAL_INMOBILIARIO">Portal</SelectItem>
                <SelectItem value="REFERIDO_CLIENTE">Referido cliente</SelectItem>
                <SelectItem value="REFERIDO_BROKER">Referido broker</SelectItem>
                <SelectItem value="LLAMADA_FRIA">Llamada fría</SelectItem>
                <SelectItem value="EVENTO">Evento</SelectItem>
                <SelectItem value="WEBSITE">Sitio web</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="OTRO">Otro</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro por temperatura */}
            <Select
              value={filterTemp}
              onValueChange={(v) => handleFilterChange("temp", v)}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Temperatura" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="HOT">Caliente</SelectItem>
                <SelectItem value="WARM">Tibio</SelectItem>
                <SelectItem value="COLD">Frío</SelectItem>
                <SelectItem value="DEAD">Muerto</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro por tipo de contacto */}
            <Select
              value={filterType}
              onValueChange={(v) => handleFilterChange("type", v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                <SelectItem value="LEAD">Lead</SelectItem>
                <SelectItem value="PROSPECTO">Prospecto</SelectItem>
                <SelectItem value="CLIENTE">Cliente</SelectItem>
                <SelectItem value="INVERSIONISTA">Inversionista</SelectItem>
                <SelectItem value="BROKER_EXTERNO">Broker externo</SelectItem>
                <SelectItem value="REFERIDO">Referido</SelectItem>
              </SelectContent>
            </Select>

            {/* Botón para limpiar filtros */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Limpiar
              </Button>
            )}
          </div>

          {/* Estado de carga (skeleton) */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            /* Estado vacío */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">
                No se encontraron contactos
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Intenta ajustar los filtros de búsqueda"
                  : "Comienza agregando tu primer contacto"}
              </p>
              {!hasActiveFilters && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Contacto
                </Button>
              )}
            </div>
          ) : (
            /* Tabla de contactos */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Nombre</th>
                    <th className="pb-3 font-medium">Teléfono</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Fuente</th>
                    <th className="pb-3 font-medium">Temperatura</th>
                    <th className="pb-3 font-medium">Asesor asignado</th>
                    <th className="pb-3 font-medium">Fecha de registro</th>
                    <th className="pb-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                      onClick={() => router.push(`/contacts/${contact.id}`)}
                    >
                      {/* Nombre completo */}
                      <td className="py-3 font-medium">
                        {contact.firstName} {contact.lastName}
                      </td>
                      {/* Teléfono */}
                      <td className="py-3">{contact.phone}</td>
                      {/* Email */}
                      <td className="py-3 text-muted-foreground">
                        {contact.email || "-"}
                      </td>
                      {/* Fuente del lead */}
                      <td className="py-3">
                        <Badge variant="outline">
                          {SOURCE_LABEL[contact.leadSource] || contact.leadSource}
                        </Badge>
                      </td>
                      {/* Temperatura */}
                      <td className="py-3">
                        <Badge variant={TEMP_VARIANT[contact.temperature] || "cold"}>
                          {TEMP_LABEL[contact.temperature] || contact.temperature}
                        </Badge>
                      </td>
                      {/* Asesor asignado */}
                      <td className="py-3">
                        {contact.assignedTo?.name || (
                          <span className="text-muted-foreground">Sin asignar</span>
                        )}
                      </td>
                      {/* Fecha de registro */}
                      <td className="py-3 text-muted-foreground">
                        {new Date(contact.createdAt).toLocaleDateString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      {/* Menú de acciones */}
                      <td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => router.push(`/contacts/${contact.id}`)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Ver detalle
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditContact(contact);
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openWhatsApp(contact.phone)}
                            >
                              <MessageCircle className="mr-2 h-4 w-4 text-green-500" />
                              WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(
                                  `/pipeline?newDeal=true&contactId=${contact.id}`
                                )
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Crear Deal
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(contact.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Controles de paginación */}
          {total > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {rangeStart}-{rangeEnd} de {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => handlePageChange(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  Página {page} de {totalPages || 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => handlePageChange(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diálogo de edición de contacto */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        setEditOpen(open);
        if (!open) setEditContact(null);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Contacto</DialogTitle>
          </DialogHeader>
          {editContact && (
            <ContactForm
              mode="edit"
              initialData={editContact}
              onSuccess={handleFormSuccess}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
