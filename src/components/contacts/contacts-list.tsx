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
import { BrandBadges, BrandFilterSelect, useBrandFilterParam, useBrandView } from "@/components/brands/brand-view";
import { BotonColumnas, GestionarColumnas, useColumnasVisibles } from "@/components/ui/gestionar-columnas";
import { COLUMNAS_CONTACTOS, STORAGE_KEY_COLUMNAS_CONTACTOS } from "@/lib/contacts/columnas";
import { CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS, CONTACT_STATUS_ORDER, CONTACT_TYPE_LABELS, CONTACT_TYPE_ORDER, CONTACT_TYPE_SIN_TIPO, CONTACT_TYPE_VACIO_LABEL, LIFECYCLE_LABELS, LIFECYCLE_COLORS, LIFECYCLE_ORDER, LEAD_SOURCE_ORDER, LEAD_SOURCE_LABELS } from "@/lib/constants";

// --- Tipos ---
interface ContactData {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  leadSource: string;
  temperature: string;
  contactType: string | null; // null = sin tipo (#863): «—» hasta que alguien lo elija
  contactStatus: string;
  lifecycleStage: string | null;
  createdAt: string;
  // Solo para las columnas opcionales de "Gestionar columnas"; la API ya las manda (include
  // trae todos los escalares del contacto).
  secondaryPhone?: string | null;
  residenceCity?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string;
  assignedTo: { id: string; name: string; email: string } | null;
  _count: { deals: number; activities: number };
  // Filas de contact_brands (entrega 3 de marcas): alimentan el badge. [] = predeterminada.
  brands?: { brandId: string }[];
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

// Tipo de contacto: etiquetas y orden salen de constants.ts (CONTACT_TYPE_*). Aquí había una
// copia a mano con 6 de los 9 tipos, sin COMPRADOR —el default del modelo y lo que escribe el
// intake—, así que el filtro no podía encontrar al tipo más común.

// Los dos <select> nativos de la barra (etapa, marca) con la misma altura y borde que los
// selectores de Radix de al lado (#894: antes eran más bajos, py-1).
const SELECT_NATIVO = "h-10 shrink-0 rounded-md border border-input bg-background px-3 text-sm";

const FECHA_CORTA: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

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
  // "Gestionar columnas", igual que en Reuniones/Llamadas de la Agenda. La preferencia vive en
  // el navegador de cada usuario.
  const [visibles, guardarColumnas] = useColumnasVisibles(COLUMNAS_CONTACTOS, STORAGE_KEY_COLUMNAS_CONTACTOS);
  const [columnasOpen, setColumnasOpen] = useState(false);
  const columnas = COLUMNAS_CONTACTOS.filter((c) => visibles.includes(c.key));
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  // Selector «Marca» (entrega 3, 2026-10-12). Vive en la URL (?marca=). fetchContacts es un
  // useCallback sin dependencias que recibe los demás filtros por argumento; la marca la lee de
  // este ref para no tener que tocar cada llamada.
  const brandOptions = useBrandView().options;
  const [brandFilter, setBrandFilter] = useBrandFilterParam();
  const brandRef = useRef<string | null>(brandFilter);
  brandRef.current = brandFilter;

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
        if (brandRef.current) params.set("marca", brandRef.current);

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

  // Cambio de marca: la primera página ya vino filtrada del servidor, así que solo se recarga
  // cuando el usuario mueve el selector.
  const handleBrandChange = (brandId: string | null) => {
    setBrandFilter(brandId);
    brandRef.current = brandId;
    fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, 1, lifecycleFilter);
  };

  // Limpiar todos los filtros
  const clearFilters = () => {
    setSearch("");
    setFilterSource("ALL");
    setFilterTemp("ALL");
    setFilterType("ALL");
    setFilterStatus("ALL");
    setLifecycleFilter("");
    setBrandFilter(null);
    brandRef.current = null;
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
    // Una vista guardada con una marca que este usuario no ve se abre en «Todas mis marcas».
    const mk = typeof f.marca === "string" && brandOptions.some((o) => o.id === f.marca) ? f.marca : null;
    setSearch(s); setFilterSource(src); setFilterTemp(tmp); setFilterType(typ); setFilterStatus(st); setLifecycleFilter(lc);
    setBrandFilter(mk);
    brandRef.current = mk;
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

  // Cambio rápido del tipo de contacto desde la lista. Si el servidor lo rechaza (permisos,
  // validación), se regresa al valor anterior para no mostrar un tipo que no se guardó.
  // null = «—» (sin tipo, #863).
  const updateType = async (id: string, contactType: string | null) => {
    const previo = contacts.find((c) => c.id === id)?.contactType;
    if (previo === contactType) return;
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, contactType } : c)));
    const res = await fetch(`/api/contacts?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactType }),
    }).catch(() => null);
    if (!res?.ok && previo !== undefined) {
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, contactType: previo } : c)));
    }
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
    search || filterSource !== "ALL" || filterTemp !== "ALL" || filterType !== "ALL" || filterStatus !== "ALL" || lifecycleFilter !== "" || brandFilter !== null;

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
        currentFilters={{ search, source: filterSource, temperature: filterTemp, type: filterType, status: filterStatus, marca: brandFilter }}
        onApply={applyView}
      />

      <Card>
        <CardContent className="p-6">
          {/* Barra de búsqueda y filtros. #894: con flex-wrap — sin él, el buscador (flex-1) se
              quedaba con el sobrante de los filtros de ancho fijo (~54 px, no se leía lo escrito)
              y en ventanas angostas la barra desbordaba la tarjeta. Ahora el buscador pide al
              menos 16rem y crece; los filtros bajan de línea cuando no caben. */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Campo de búsqueda */}
            <div className="relative w-full sm:w-auto sm:min-w-[16rem] sm:flex-[1_1_16rem]">
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
              <SelectTrigger className="w-44 shrink-0">
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
              <SelectTrigger className="w-44 shrink-0">
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
              <SelectTrigger className="w-36 shrink-0">
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
              <SelectTrigger className="w-44 shrink-0">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los tipos</SelectItem>
                <SelectItem value={CONTACT_TYPE_SIN_TIPO}>Sin tipo</SelectItem>
                {CONTACT_TYPE_ORDER.map((t) => (
                  <SelectItem key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro por lifecycle */}
            <select
              value={lifecycleFilter}
              onChange={(e) => { setLifecycleFilter(e.target.value); fetchContacts(search, filterSource, filterTemp, filterType, filterStatus, 1, e.target.value); }}
              className={SELECT_NATIVO}
              aria-label="Filtrar por etapa"
            >
              <option value="">Todas las etapas</option>
              {LIFECYCLE_ORDER.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}
            </select>

            {/* Filtro por marca (solo si el usuario ve más de una) */}
            <BrandFilterSelect
              value={brandFilter}
              onChange={handleBrandChange}
              className={SELECT_NATIVO}
            />

            {/* Botón para limpiar filtros */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Limpiar
              </Button>
            )}

            <div className="ml-auto">
              <BotonColumnas onClick={() => setColumnasOpen(true)} titulo="Contactos" />
            </div>
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
            /* Tabla de contactos. #894: el contenedor tiene alto acotado a la ventana para que
               su barra de scroll horizontal quede SIEMPRE a la vista (antes vivía al fondo de 20
               filas y la tabla parecía cortada). Encabezado fijo arriba y columna Nombre fija a
               la izquierda: al desplazarse a los lados se sigue sabiendo de quién es la fila. */
            <div className="tabla-contactos max-h-[max(24rem,calc(100vh-26rem))] overflow-auto rounded-md">
              <table className="w-full text-sm">
                <thead>
                  {/* #865: todos los encabezados centrados; las celdas, según `align` del catálogo. */}
                  <tr className="border-b text-center text-muted-foreground">
                    {columnas.map((c) => (
                      <th
                        key={c.key}
                        className={`px-2 py-3 text-center font-medium ${c.key === "nombre" ? "celda-fija" : ""}`}
                      >
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-3 text-center font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                      onClick={() => router.push(`/contacts/${contact.id}`)}
                    >
                      {columnas.map((c) => (
                        <CeldaContacto
                          key={c.key}
                          col={c.key}
                          align={c.align ?? "center"}
                          contact={contact}
                          onStatus={updateStatus}
                          onType={updateType}
                        />
                      ))}
                      {/* Menú de acciones */}
                      <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
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

      {columnasOpen && (
        <GestionarColumnas
          defs={COLUMNAS_CONTACTOS}
          visibles={visibles}
          onClose={() => setColumnasOpen(false)}
          onSave={(keys) => {
            guardarColumnas(keys);
            setColumnasOpen(false);
          }}
        />
      )}

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

// --- Celdas ---

/** Pastilla con un <select> invisible encima: se ve como etiqueta y se cambia con un clic. */
function PastillaEditable({
  label,
  color,
  value,
  options,
  ariaLabel,
  onChange,
}: {
  label: string;
  color?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--border-default, #e5e5e5)" }}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

const STATUS_OPTIONS = CONTACT_STATUS_ORDER.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] }));
// "" = sin tipo (#863). Un <select> nativo no admite null como valor, así que viaja como "".
const TYPE_OPTIONS = [
  { value: "", label: CONTACT_TYPE_VACIO_LABEL },
  ...CONTACT_TYPE_ORDER.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] })),
];

function CeldaContacto({
  col,
  align,
  contact,
  onStatus,
  onType,
}: {
  col: string;
  align: "left" | "center";
  contact: ContactData;
  onStatus: (id: string, v: string) => void;
  onType: (id: string, v: string | null) => void;
}) {
  const vacio = <span className="text-muted-foreground">-</span>;
  // Clase base de toda celda (#865): padding simétrico para que el centrado sea real.
  const base = `px-2 py-3 ${align === "left" ? "text-left" : "text-center"}`;
  const fecha = (iso: string | null | undefined) => (iso ? formatDate(iso, FECHA_CORTA) : null);

  switch (col) {
    case "nombre":
      // `celda-fija` (#894): se queda pegada a la izquierda al desplazar la tabla a los lados.
      return (
        <td className={`${base} celda-fija min-w-[9rem] font-medium`}>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span>
              {contact.firstName} {contact.lastName}
            </span>
            <BrandBadges brandIds={contact.brands?.map((b) => b.brandId)} />
          </span>
        </td>
      );
    case "estado":
      // Estado de contacto — edición rápida inline, con la etapa del ciclo debajo.
      return (
        <td className={`${base}`} onClick={(e) => e.stopPropagation()}>
          <PastillaEditable
            label={CONTACT_STATUS_LABELS[contact.contactStatus] ?? "Nuevo"}
            color={CONTACT_STATUS_COLORS[contact.contactStatus] ?? "#9CA3AF"}
            value={contact.contactStatus ?? "NUEVO"}
            options={STATUS_OPTIONS}
            ariaLabel="Cambiar estado"
            onChange={(v) => onStatus(contact.id, v)}
          />
          {contact.lifecycleStage && (
            <span
              className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${align === "left" ? "" : "justify-center"}`}
              style={{ color: LIFECYCLE_COLORS[contact.lifecycleStage] }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: LIFECYCLE_COLORS[contact.lifecycleStage] }} />
              {LIFECYCLE_LABELS[contact.lifecycleStage] ?? contact.lifecycleStage}
            </span>
          )}
        </td>
      );
    case "tipo":
      // Tipo de contacto — antes solo se veía (y cambiaba) entrando a cada contacto.
      return (
        <td className={`${base}`} onClick={(e) => e.stopPropagation()}>
          <PastillaEditable
            label={
              contact.contactType
                ? CONTACT_TYPE_LABELS[contact.contactType] ?? contact.contactType
                : CONTACT_TYPE_VACIO_LABEL
            }
            value={contact.contactType ?? ""}
            options={TYPE_OPTIONS}
            ariaLabel="Cambiar tipo de contacto"
            onChange={(v) => onType(contact.id, v || null)}
          />
        </td>
      );
    case "telefono":
      return <td className={`whitespace-nowrap ${base}`}>{contact.phone || vacio}</td>;
    case "email":
      // #896: un correo largo se recorta con «…» en una sola línea y el `title` lo muestra
      // completo al pasar el cursor (antes, #894, se partía en cualquier letra con break-all).
      // El recorte va en un bloque interior: en una tabla con layout automático el max-width
      // del propio <td> no basta para que `truncate` corte.
      return (
        <td className={`${base} text-muted-foreground`}>
          {contact.email ? (
            <span className="block max-w-[14rem] truncate" title={contact.email}>
              {contact.email}
            </span>
          ) : (
            "-"
          )}
        </td>
      );
    case "fuente":
      return (
        <td className={`${base}`}>
          <Badge variant="outline">{SOURCE_LABEL[contact.leadSource] || contact.leadSource}</Badge>
        </td>
      );
    case "temperatura":
      return (
        <td className={`${base}`}>
          <Badge variant={TEMP_VARIANT[contact.temperature] || "cold"}>
            {TEMP_LABEL[contact.temperature] || contact.temperature}
          </Badge>
        </td>
      );
    case "asesor":
      return (
        <td className={`${base}`}>
          {contact.assignedTo?.name || <span className="text-muted-foreground">Sin asignar</span>}
        </td>
      );
    case "registro":
      return <td className={`whitespace-nowrap ${base} text-muted-foreground`}>{fecha(contact.createdAt)}</td>;
    case "telefono2":
      return <td className={`whitespace-nowrap ${base}`}>{contact.secondaryPhone || vacio}</td>;
    case "ciudad":
      return <td className={`${base}`}>{contact.residenceCity || vacio}</td>;
    case "ultimaActividad":
      return (
        <td className={`whitespace-nowrap ${base} text-muted-foreground`}>{fecha(contact.lastActivityAt) ?? "-"}</td>
      );
    case "negocios":
      return <td className={`num ${base}`}>{contact._count?.deals ?? 0}</td>;
    case "actividades":
      return <td className={`num ${base}`}>{contact._count?.activities ?? 0}</td>;
    case "modificado":
      return <td className={`whitespace-nowrap ${base} text-muted-foreground`}>{fecha(contact.updatedAt) ?? "-"}</td>;
    default:
      return <td className={`${base}`}>{vacio}</td>;
  }
}
