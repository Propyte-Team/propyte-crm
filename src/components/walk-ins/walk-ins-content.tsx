// Componente cliente para registro y visualización de walk-ins
// Optimizado para tablet con elementos táctiles grandes (min 44px)

"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserPlus,
  Clock,
  Search,
  Phone,
  Mail,
  CheckCircle2,
  CalendarDays,
  Users,
} from "lucide-react";
import {
  createWalkIn,
  searchContacts,
  getWalkIns,
} from "@/server/walk-ins";
import type { VisitPurpose } from "@prisma/client";

// --- Tipos de props ---
interface WalkInRecord {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  hostessName: string;
  advisorName: string | null;
  arrivalTime: string;
  departureTime: string | null;
  visitPurpose: VisitPurpose;
  convertedToDeal: boolean;
  notes: string | null;
}

interface AdvisorOption {
  id: string;
  name: string;
  role: string;
}

interface ContactSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
}

interface WalkInsContentProps {
  initialWalkIns: WalkInRecord[];
  advisors: AdvisorOption[];
  userRole: string;
  userPlaza: string;
}

// Etiquetas para propósito de visita
const PURPOSE_LABELS: Record<VisitPurpose, string> = {
  INVERSION: "Inversión",
  USO_PROPIO: "Uso Propio",
  INFORMACION: "Información",
  OTRO: "Otro",
};

// Colores de badge por propósito
const PURPOSE_BADGE_CLASSES: Record<VisitPurpose, string> = {
  INVERSION: "bg-purple-100 text-purple-700",
  USO_PROPIO: "bg-teal-100 text-teal-700",
  INFORMACION: "bg-blue-100 text-blue-700",
  OTRO: "bg-gray-100 text-gray-700",
};

// Formatear hora desde ISO string
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Formatear fecha para mostrar
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function WalkInsContent({
  initialWalkIns,
  advisors,
  userRole,
  userPlaza,
}: WalkInsContentProps) {
  // Estado de walk-ins
  const [walkIns, setWalkIns] = useState<WalkInRecord[]>(initialWalkIns);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Estado del formulario
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [showNewContactForm, setShowNewContactForm] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Campos de nuevo contacto
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Campos del walk-in
  const [visitPurpose, setVisitPurpose] = useState<string>("");
  const [assignedAdvisorId, setAssignedAdvisorId] = useState<string>("");
  const [notes, setNotes] = useState("");

  // Estado de UI
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Búsqueda de contactos con debounce
  const handleContactSearch = useCallback((query: string) => {
    setContactQuery(query);
    setSelectedContact(null);
    setShowNewContactForm(false);

    // Limpiar timeout anterior
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim().length < 2) {
      setContactResults([]);
      setShowDropdown(false);
      return;
    }

    // Debounce de 300ms
    searchTimeoutRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await searchContacts(query);
          setContactResults(results);
          setShowDropdown(true);
        } catch {
          setContactResults([]);
        }
      });
    }, 300);
  }, []);

  // Seleccionar contacto existente
  const handleSelectContact = useCallback((contact: ContactSearchResult) => {
    setSelectedContact(contact);
    setContactQuery(`${contact.firstName} ${contact.lastName} - ${contact.phone}`);
    setShowDropdown(false);
    setShowNewContactForm(false);
  }, []);

  // Mostrar formulario de nuevo contacto
  const handleNewContact = useCallback(() => {
    setShowNewContactForm(true);
    setShowDropdown(false);
    setSelectedContact(null);
  }, []);

  // Registrar walk-in
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setSuccess("");

      // Validaciones
      if (!selectedContact && !showNewContactForm) {
        setError("Busca un contacto existente o crea uno nuevo");
        return;
      }

      if (showNewContactForm) {
        if (!newFirstName.trim()) {
          setError("El nombre es obligatorio");
          return;
        }
        if (!newLastName.trim()) {
          setError("El apellido es obligatorio");
          return;
        }
        if (!newPhone.trim()) {
          setError("El teléfono es obligatorio");
          return;
        }
      }

      if (!visitPurpose) {
        setError("Selecciona el motivo de visita");
        return;
      }

      startTransition(async () => {
        try {
          await createWalkIn({
            contactId: selectedContact?.id,
            firstName: showNewContactForm ? newFirstName.trim() : undefined,
            lastName: showNewContactForm ? newLastName.trim() : undefined,
            phone: showNewContactForm ? newPhone.trim() : undefined,
            email: showNewContactForm && newEmail.trim() ? newEmail.trim() : undefined,
            visitPurpose: visitPurpose as VisitPurpose,
            assignedAdvisorId: assignedAdvisorId || undefined,
            notes: notes.trim() || undefined,
          });

          // Limpiar formulario
          setContactQuery("");
          setSelectedContact(null);
          setShowNewContactForm(false);
          setNewFirstName("");
          setNewLastName("");
          setNewPhone("");
          setNewEmail("");
          setVisitPurpose("");
          setAssignedAdvisorId("");
          setNotes("");
          setSuccess("Visitante registrado exitosamente");

          // Recargar lista de walk-ins
          const updated = await getWalkIns({ date: selectedDate });
          setWalkIns(updated);

          // Limpiar mensaje de éxito después de 3s
          setTimeout(() => setSuccess(""), 3000);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Error al registrar visitante";
          setError(message);
        }
      });
    },
    [
      selectedContact,
      showNewContactForm,
      newFirstName,
      newLastName,
      newPhone,
      newEmail,
      visitPurpose,
      assignedAdvisorId,
      notes,
      selectedDate,
    ]
  );

  // Cambiar fecha para ver otros días
  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
    startTransition(async () => {
      try {
        const updated = await getWalkIns({ date: newDate });
        setWalkIns(updated);
      } catch {
        setWalkIns([]);
      }
    });
  }, []);

  // Verificar si es hoy
  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  return (
    <>
      {/* Formulario de registro */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5" />
            Registrar Visitante
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Búsqueda de contacto */}
            <div className="space-y-2" ref={dropdownRef}>
              <Label htmlFor="contact-search">
                Buscar contacto (teléfono o nombre)
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="contact-search"
                  placeholder="Buscar por teléfono o nombre..."
                  value={contactQuery}
                  onChange={(e) => handleContactSearch(e.target.value)}
                  className="min-h-[44px] pl-10 text-base"
                  autoComplete="off"
                />
              </div>

              {/* Dropdown de resultados */}
              {showDropdown && (
                <div className="rounded-md border bg-white shadow-lg">
                  {contactResults.length > 0 ? (
                    <>
                      {contactResults.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => handleSelectContact(contact)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 min-h-[44px]"
                        >
                          <div className="flex-1">
                            <p className="font-medium">
                              {contact.firstName} {contact.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {contact.phone}
                              {contact.email && ` | ${contact.email}`}
                            </p>
                          </div>
                        </button>
                      ))}
                      <div className="border-t">
                        <button
                          type="button"
                          onClick={handleNewContact}
                          className="flex w-full items-center gap-2 px-4 py-3 text-left text-teal-700 hover:bg-teal-50 min-h-[44px]"
                        >
                          <UserPlus className="h-4 w-4" />
                          Crear nuevo contacto
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="p-4">
                      <p className="mb-2 text-sm text-muted-foreground">
                        No se encontraron contactos
                      </p>
                      <button
                        type="button"
                        onClick={handleNewContact}
                        className="flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-800 min-h-[44px]"
                      >
                        <UserPlus className="h-4 w-4" />
                        Crear nuevo contacto
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Contacto seleccionado */}
              {selectedContact && (
                <div className="flex items-center gap-2 rounded-md bg-teal-50 px-3 py-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                  <span className="font-medium">
                    {selectedContact.firstName} {selectedContact.lastName}
                  </span>
                  <span className="text-muted-foreground">
                    — {selectedContact.phone}
                  </span>
                </div>
              )}
            </div>

            {/* Formulario de nuevo contacto (inline) */}
            {showNewContactForm && (
              <div className="space-y-4 rounded-md border border-teal-200 bg-teal-50/50 p-4">
                <p className="text-sm font-medium text-teal-800">
                  Nuevo Contacto
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-first-name">Nombre *</Label>
                    <Input
                      id="new-first-name"
                      placeholder="Nombre"
                      value={newFirstName}
                      onChange={(e) => setNewFirstName(e.target.value)}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-last-name">Apellido *</Label>
                    <Input
                      id="new-last-name"
                      placeholder="Apellido"
                      value={newLastName}
                      onChange={(e) => setNewLastName(e.target.value)}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-phone">Teléfono *</Label>
                    <Input
                      id="new-phone"
                      type="tel"
                      placeholder="+52 999 123 4567"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-email">Correo electrónico</Label>
                    <Input
                      id="new-email"
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Propósito y asesor */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Motivo de visita */}
              <div className="space-y-2">
                <Label>Motivo de visita *</Label>
                <Select value={visitPurpose} onValueChange={setVisitPurpose}>
                  <SelectTrigger className="min-h-[44px] text-base">
                    <SelectValue placeholder="Seleccionar motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INVERSION">Inversión</SelectItem>
                    <SelectItem value="USO_PROPIO">Uso Propio</SelectItem>
                    <SelectItem value="INFORMACION">Información</SelectItem>
                    <SelectItem value="OTRO">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Asesor asignado */}
              <div className="space-y-2">
                <Label>Asesor asignado (auto si vacío)</Label>
                <Select
                  value={assignedAdvisorId}
                  onValueChange={setAssignedAdvisorId}
                >
                  <SelectTrigger className="min-h-[44px] text-base">
                    <SelectValue placeholder="Asignación automática" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Asignación automática</SelectItem>
                    {advisors.map((advisor) => (
                      <SelectItem key={advisor.id} value={advisor.id}>
                        {advisor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <textarea
                id="notes"
                placeholder="Observaciones adicionales..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Mensajes de error y éxito */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-md bg-green-100 p-3 text-sm text-green-700">
                {success}
              </div>
            )}

            {/* Botón de registro */}
            <Button
              type="submit"
              size="lg"
              disabled={isPending}
              className="w-full bg-teal-600 text-base hover:bg-teal-700 min-h-[48px] sm:w-auto sm:px-8"
            >
              <UserPlus className="mr-2 h-5 w-5" />
              {isPending ? "Registrando..." : "Registrar Visitante"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Selector de fecha y lista de visitantes */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              Visitantes
              <Badge variant="secondary" className="ml-1 text-sm">
                {walkIns.length} visitante{walkIns.length !== 1 ? "s" : ""}{" "}
                {isToday ? "hoy" : ""}
              </Badge>
            </CardTitle>

            {/* Selector de fecha */}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="min-h-[44px] w-auto text-base"
              />
            </div>
          </div>
          {!isToday && (
            <p className="text-sm text-muted-foreground">
              {formatDate(selectedDate)}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {walkIns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-lg font-medium text-muted-foreground">
                No hay visitantes registrados
              </p>
              <p className="mt-1 text-sm text-muted-foreground/60">
                {isToday
                  ? "Usa el formulario de arriba para registrar un visitante"
                  : "No hubo visitas en esta fecha"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {walkIns.map((walkIn) => (
                <div
                  key={walkIn.id}
                  className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {/* Info del contacto */}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-medium">
                          {walkIn.contactName}
                        </p>
                        {walkIn.convertedToDeal && (
                          <Badge className="bg-green-100 text-green-700 text-xs">
                            Convertido a Deal
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {walkIn.contactPhone}
                        </span>
                        {walkIn.contactEmail && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {walkIn.contactEmail}
                          </span>
                        )}
                      </div>
                      {walkIn.advisorName && (
                        <p className="text-sm text-muted-foreground">
                          Asesor: <span className="font-medium">{walkIn.advisorName}</span>
                        </p>
                      )}
                      {walkIn.notes && (
                        <p className="text-sm text-muted-foreground italic">
                          {walkIn.notes}
                        </p>
                      )}
                    </div>

                    {/* Badges y hora */}
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          PURPOSE_BADGE_CLASSES[walkIn.visitPurpose]
                        }`}
                      >
                        {PURPOSE_LABELS[walkIn.visitPurpose]}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTime(walkIn.arrivalTime)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
