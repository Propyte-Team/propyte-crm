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
import { formatDate } from "@/lib/format-date";
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
import { SavedViewsBar } from "@/components/views/saved-views-bar";
import { CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS, CONTACT_STATUS_ORDER, LIFECYCLE_LABELS, LIFECYCLE_COLORS, LIFECYCLE_ORDER, LEAD_SOURCE_ORDER, LEAD_SOURCE_LABELS } from "@/lib/constants";

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
  contactStatus: string;
  lifecycleStage: string | null;
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

// Etiquetas de fuentes: única fuente de verdad en constants.ts (AUD-20260710-02 —
// este mapa local estaba desincronizado y dejaba fuentes válidas sin label).
const SOURCE_LABEL = LEAD_SOURCE_LABELS;

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
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
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
      statusVal: string,
      pageVal: number,
      lifecycleVal: string = ""
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
        if (statusVal !== "ALL") params.set("status", statusVal);
        if (lifecycleVal) params.set("lifecycle", lifecycleVal);

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
      fetchContacts(value, filterSource, filterTemp, filterType, filterStatus, 1, lifecycleFilter);
    }, 300);
  };

  // Cambio de filtro: recargar desde página 1
  const handleFilterChange = (
    type: "source" | "temp" | "type" | "status",
    value: string
  ) => {
    const newSource = type === "source" ? value : filterSource;
    const newTemp = type === "temp" ? value : filterTemp;
    const newType = type === "type" ? value : filterType;
    const newStatus = type === "status" ? value : filterStatus;
    if (type === "source") setFilterSource(value);
    if (type === "temp") setFilterTemp(value);
    if (type === "type") setFilterType(value);
    if (type === "status") setFilterStatus(value);
    fetchContacts(search, newSource, newTemp, newType, newStatus, 1, lifecycleFilter);
  };

  // Limpiar todos los filtros
  const clearFilters = () => {
    setSearch("");
    setFilterSource("ALL");
    setFilterTemp("ALL");
    setFilterType("ALL");
    setFilterStatus("ALL");
    setLifecycleFilter("");
    fetchContacts("", "ALL", "ALL", "ALL", "ALL", 1, "");
  };

  // Cambio de página
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, newPage, lifecycleFilter);
  };

  // Aplicar una vista guardada (Fase 5): re-hidrata los filtros y recarga.
  const applyView = (f: Record<string, unknown>) => {
    const s = (f.search as string) ?? "";
    const src = (f.source as string) ?? "ALL";
    const tmp = (f.temperature as string) ?? "ALL";
    const typ = (f.type as string) ?? "ALL";
    const st = (f.status as string) ?? "ALL";
    const lc = (f.lifecycle as string) ?? "";
    setSearch(s); setFilterSource(src); setFilterTemp(tmp); setFilterType(typ); setFilterStatus(st); setLifecycleFilter(lc);
    fetchContacts(s, src, tmp, typ, st, 1, lc);
  };

  // Cambio rápido de estado de contacto desde la lista (edición inline)
  const updateStatus = async (id: string, contactStatus: string) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, contactStatus } : c)));
    await fetch(`/api/contacts?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactStatus }),
    }).catch(() => null);
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
    fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, page, lifecycleFilter);
  };

  // Eliminar contacto
  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar este contacto?")) return;

    try {
      const res = await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, page, lifecycleFilter);
      }
    } catch (err) {
      console.error("Error al eliminar contacto:", err);
    }
  };

  // Verificar si hay filtros activos
  const hasActiveFilters =
    search || filterSource !== "ALL" || filterTemp !== "ALL" || filterType !== "ALL" || filterStatus !== "ALL" || lifecycleFilter !== "";

  // Calcular rango visible
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Encabezado editorial con conteo en vivo */}
      <div>
        <p className="eyebrow">Ventas</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">Contactos</h1>
        <p className="num mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {total} en total
        </p>
      </div>

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
              fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, page);
            }} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Vistas guardadas (Fase 5) */}
      <SavedViewsBar
        module="contacts"
        currentFilters={{ search, source: filterSource, temperature: filterTemp, type: filterType, status: filterStatus }}
        onApply={applyView}
      />

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
                {LEAD_SOURCE_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {LEAD_SOURCE_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro por estado de contacto */}
            <Select
              value={filterStatus}
              onValueChange={(v) => handleFilterChange("status", v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los estados</SelectItem>
                {CONTACT_STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{CONTACT_STATUS_LABELS[s]}</SelectItem>
                ))}
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

            {/* Filtro por lifecycle */}
            <select
              value={lifecycleFilter}
              onChange={(e) => { setLifecycleFilter(e.target.value); fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, 1, e.target.value); }}
              className="rounded-md border px-2 py-1 text-sm"
            >
              <option value="">Todas las etapas</option>
              {LIFECYCLE_ORDER.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}
            </select>

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
                    <th className="pb-3 font-medium">Estado</th>
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
                      {/* Estado de contacto — edición rápida inline */}
                      <td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="relative inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--border-default, #e5e5e5)" }}>
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: CONTACT_STATUS_COLORS[contact.contactStatus] ?? "#9CA3AF" }}
                          />
                          {CONTACT_STATUS_LABELS[contact.contactStatus] ?? "Nuevo"}
                          <select
                            className="absolute inset-0 cursor-pointer opacity-0"
                            value={contact.contactStatus ?? "NUEVO"}
                            onChange={(e) => updateStatus(contact.id, e.target.value)}
                            aria-label="Cambiar estado"
                          >
                            {CONTACT_STATUS_ORDER.map((s) => (
                              <option key={s} value={s}>{CONTACT_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </div>
                        {contact.lifecycleStage && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium"
                                style={{ color: LIFECYCLE_COLORS[contact.lifecycleStage] }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LIFECYCLE_COLORS[contact.lifecycleStage] }} />
                            {LIFECYCLE_LABELS[contact.lifecycleStage] ?? contact.lifecycleStage}
                          </span>
                        )}
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
                        {formatDate(contact.createdAt, {
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
