// Formulario reutilizable para crear/editar contactos
"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// --- Esquema de validación Zod ---
const contactFormSchema = z.object({
  firstName: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  lastName: z.string().min(2, "El apellido debe tener al menos 2 caracteres").max(100),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().min(10, "El teléfono debe tener al menos 10 dígitos").max(15),
  secondaryPhone: z.string().max(15).optional().or(z.literal("")),
  preferredLanguage: z.enum(["ES", "EN"]).optional(),
  contactType: z.enum(["LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO"]).optional(),
  leadSource: z.enum([
    "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "PORTAL_INMOBILIARIO",
    "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA", "EVENTO", "WEBSITE", "WHATSAPP", "OTRO",
  ]),
  leadSourceDetail: z.string().max(200).optional(),
  residenceCity: z.string().max(100).optional(),
  residenceCountry: z.string().max(100).optional(),
  nationality: z.string().max(100).optional(),
  investmentProfile: z.enum(["END_USER", "INVESTOR_RENTAL", "INVESTOR_FLIP", "INVESTOR_LAND", "MIXED"]).optional(),
  propertyType: z.enum(["DEPARTAMENTO", "CASA", "TERRENO", "MACROLOTE", "LOCAL_COMERCIAL", "OTRO"]).optional(),
  purchaseTimeline: z.enum(["IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS"]).optional(),
  budgetMin: z.number().positive("Debe ser positivo").optional().nullable(),
  budgetMax: z.number().positive("Debe ser positivo").optional().nullable(),
  paymentMethod: z.enum(["CONTADO", "CREDITO_HIPOTECARIO", "FINANCIAMIENTO_DIRECTO", "MIXTO"]).optional(),
  preferredZone: z.string().max(200).optional(),
  purchaseModality: z.enum(["PREVENTA", "ENTREGA_INMEDIATA", "REVENTA", "ABIERTO"]).optional(),
  rentalStrategy: z.enum(["LONG_TERM", "AIRBNB", "BOTH", "NA"]).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  temperature: z.enum(["HOT", "WARM", "COLD", "DEAD"]).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// --- Tipos del formulario ---
type ContactFormData = z.infer<typeof contactFormSchema>;

interface Advisor {
  id: string;
  name: string;
  email: string;
  role: string;
  plaza: string;
}

interface ContactFormProps {
  mode: "create" | "edit";
  initialData?: any;
  onSuccess: () => void;
}

// --- Opciones de selects con etiquetas en español ---
const CONTACT_TYPE_OPTIONS = [
  { value: "LEAD", label: "Lead" },
  { value: "PROSPECTO", label: "Prospecto" },
  { value: "CLIENTE", label: "Cliente" },
  { value: "INVERSIONISTA", label: "Inversionista" },
  { value: "BROKER_EXTERNO", label: "Broker externo" },
  { value: "REFERIDO", label: "Referido" },
];

const LEAD_SOURCE_OPTIONS = [
  { value: "WALK_IN", label: "Walk-in" },
  { value: "FACEBOOK_ADS", label: "Facebook Ads" },
  { value: "GOOGLE_ADS", label: "Google Ads" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "PORTAL_INMOBILIARIO", label: "Portal inmobiliario" },
  { value: "REFERIDO_CLIENTE", label: "Referido por cliente" },
  { value: "REFERIDO_BROKER", label: "Referido por broker" },
  { value: "LLAMADA_FRIA", label: "Llamada en frío" },
  { value: "EVENTO", label: "Evento" },
  { value: "WEBSITE", label: "Sitio web" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "OTRO", label: "Otro" },
];

const LANGUAGE_OPTIONS = [
  { value: "ES", label: "Español" },
  { value: "EN", label: "Inglés" },
];

const INVESTMENT_PROFILE_OPTIONS = [
  { value: "END_USER", label: "Usuario final" },
  { value: "INVESTOR_RENTAL", label: "Inversionista (renta)" },
  { value: "INVESTOR_FLIP", label: "Inversionista (flip)" },
  { value: "INVESTOR_LAND", label: "Inversionista (terreno)" },
  { value: "MIXED", label: "Mixto" },
];

const PROPERTY_TYPE_OPTIONS = [
  { value: "DEPARTAMENTO", label: "Departamento" },
  { value: "CASA", label: "Casa" },
  { value: "TERRENO", label: "Terreno" },
  { value: "MACROLOTE", label: "Macrolote" },
  { value: "LOCAL_COMERCIAL", label: "Local comercial" },
  { value: "OTRO", label: "Otro" },
];

const PURCHASE_TIMELINE_OPTIONS = [
  { value: "IMMEDIATE", label: "Inmediato" },
  { value: "ONE_TO_THREE_MONTHS", label: "1-3 meses" },
  { value: "THREE_TO_SIX_MONTHS", label: "3-6 meses" },
  { value: "SIX_PLUS_MONTHS", label: "6+ meses" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "CONTADO", label: "Contado" },
  { value: "CREDITO_HIPOTECARIO", label: "Crédito hipotecario" },
  { value: "FINANCIAMIENTO_DIRECTO", label: "Financiamiento directo" },
  { value: "MIXTO", label: "Mixto" },
];

const PURCHASE_MODALITY_OPTIONS = [
  { value: "PREVENTA", label: "Preventa" },
  { value: "ENTREGA_INMEDIATA", label: "Entrega inmediata" },
  { value: "REVENTA", label: "Reventa" },
  { value: "ABIERTO", label: "Abierto" },
];

const RENTAL_STRATEGY_OPTIONS = [
  { value: "LONG_TERM", label: "Largo plazo" },
  { value: "AIRBNB", label: "Airbnb / corto plazo" },
  { value: "BOTH", label: "Ambos" },
  { value: "NA", label: "No aplica" },
];

const TEMPERATURE_OPTIONS = [
  { value: "HOT", label: "Caliente" },
  { value: "WARM", label: "Tibio" },
  { value: "COLD", label: "Frío" },
  { value: "DEAD", label: "Muerto" },
];

export function ContactForm({ mode, initialData, onSuccess }: ContactFormProps) {
  // Estado del formulario
  const [formData, setFormData] = useState<Partial<ContactFormData>>({
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    secondaryPhone: initialData?.secondaryPhone || "",
    preferredLanguage: initialData?.preferredLanguage || "ES",
    contactType: initialData?.contactType || "LEAD",
    leadSource: initialData?.leadSource || "OTRO",
    leadSourceDetail: initialData?.leadSourceDetail || "",
    residenceCity: initialData?.residenceCity || "",
    residenceCountry: initialData?.residenceCountry || "",
    nationality: initialData?.nationality || "",
    investmentProfile: initialData?.investmentProfile || undefined,
    propertyType: initialData?.propertyType || undefined,
    purchaseTimeline: initialData?.purchaseTimeline || undefined,
    budgetMin: initialData?.budgetMin ? Number(initialData.budgetMin) : undefined,
    budgetMax: initialData?.budgetMax ? Number(initialData.budgetMax) : undefined,
    paymentMethod: initialData?.paymentMethod || undefined,
    preferredZone: initialData?.preferredZone || "",
    purchaseModality: initialData?.purchaseModality || undefined,
    rentalStrategy: initialData?.rentalStrategy || undefined,
    assignedToId: initialData?.assignedToId || initialData?.assignedTo?.id || undefined,
    temperature: initialData?.temperature || "COLD",
    tags: initialData?.tags || [],
  });

  const [tagsInput, setTagsInput] = useState(
    (initialData?.tags || []).join(", ")
  );
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  // Cargar lista de asesores al montar
  useEffect(() => {
    fetch("/api/users?role=advisor")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) setAdvisors(data.data);
      })
      .catch(() => {});
  }, []);

  // Actualizar campo del formulario
  const updateField = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Limpiar error del campo al modificarlo
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Enviar formulario
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");
    setErrors({});

    // Parsear tags desde el input separado por comas
    const tags = tagsInput
      .split(",")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);

    const submitData = {
      ...formData,
      tags,
      // Convertir cadenas vacías a undefined para campos opcionales
      email: formData.email || undefined,
      secondaryPhone: formData.secondaryPhone || undefined,
      leadSourceDetail: formData.leadSourceDetail || undefined,
      residenceCity: formData.residenceCity || undefined,
      residenceCountry: formData.residenceCountry || undefined,
      nationality: formData.nationality || undefined,
      preferredZone: formData.preferredZone || undefined,
      budgetMin: formData.budgetMin || undefined,
      budgetMax: formData.budgetMax || undefined,
    };

    // Validar con Zod
    const validation = contactFormSchema.safeParse(submitData);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      const url = mode === "create"
        ? "/api/contacts"
        : `/api/contacts?id=${initialData?.id}`;
      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json.error || "Error al guardar el contacto");
        return;
      }

      onSuccess();
    } catch (err) {
      setServerError("Error de conexión al servidor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error del servidor */}
      {serverError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      {/* Sección: Datos Básicos */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Datos Básicos
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">Nombre *</Label>
            <Input
              id="firstName"
              value={formData.firstName || ""}
              onChange={(e) => updateField("firstName", e.target.value)}
              placeholder="Nombre"
            />
            {errors.firstName && (
              <p className="text-xs text-destructive">{errors.firstName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Apellido *</Label>
            <Input
              id="lastName"
              value={formData.lastName || ""}
              onChange={(e) => updateField("lastName", e.target.value)}
              placeholder="Apellido"
            />
            {errors.lastName && (
              <p className="text-xs text-destructive">{errors.lastName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email || ""}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="correo@ejemplo.com"
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono *</Label>
            <Input
              id="phone"
              value={formData.phone || ""}
              onChange={(e) => updateField("phone", e.target.value)}
              placeholder="+52 984 123 4567"
            />
            {errors.phone && (
              <p className="text-xs text-destructive">{errors.phone}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="secondaryPhone">Teléfono secundario</Label>
            <Input
              id="secondaryPhone"
              value={formData.secondaryPhone || ""}
              onChange={(e) => updateField("secondaryPhone", e.target.value)}
              placeholder="+52 984 765 4321"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferredLanguage">Idioma preferido</Label>
            <Select
              value={formData.preferredLanguage || "ES"}
              onValueChange={(v) => updateField("preferredLanguage", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Sección: Origen */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Origen
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contactType">Tipo de contacto</Label>
            <Select
              value={formData.contactType || "LEAD"}
              onValueChange={(v) => updateField("contactType", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leadSource">Fuente del lead *</Label>
            <Select
              value={formData.leadSource || "OTRO"}
              onValueChange={(v) => updateField("leadSource", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.leadSource && (
              <p className="text-xs text-destructive">{errors.leadSource}</p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="leadSourceDetail">Detalle de la fuente</Label>
            <Input
              id="leadSourceDetail"
              value={formData.leadSourceDetail || ""}
              onChange={(e) => updateField("leadSourceDetail", e.target.value)}
              placeholder="Ej: Campaña PDC Octubre 2024"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Sección: Ubicación */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Ubicación
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="residenceCity">Ciudad de residencia</Label>
            <Input
              id="residenceCity"
              value={formData.residenceCity || ""}
              onChange={(e) => updateField("residenceCity", e.target.value)}
              placeholder="Ciudad de México"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="residenceCountry">País de residencia</Label>
            <Input
              id="residenceCountry"
              value={formData.residenceCountry || ""}
              onChange={(e) => updateField("residenceCountry", e.target.value)}
              placeholder="México"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nationality">Nacionalidad</Label>
            <Input
              id="nationality"
              value={formData.nationality || ""}
              onChange={(e) => updateField("nationality", e.target.value)}
              placeholder="Mexicana"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Sección: Perfil de Inversión */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Perfil de Inversión
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="investmentProfile">Perfil de inversión</Label>
            <Select
              value={formData.investmentProfile || "_none"}
              onValueChange={(v) => updateField("investmentProfile", v === "_none" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {INVESTMENT_PROFILE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="propertyType">Tipo de propiedad</Label>
            <Select
              value={formData.propertyType || "_none"}
              onValueChange={(v) => updateField("propertyType", v === "_none" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {PROPERTY_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchaseTimeline">Horizonte de compra</Label>
            <Select
              value={formData.purchaseTimeline || "_none"}
              onValueChange={(v) => updateField("purchaseTimeline", v === "_none" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {PURCHASE_TIMELINE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Forma de pago</Label>
            <Select
              value={formData.paymentMethod || "_none"}
              onValueChange={(v) => updateField("paymentMethod", v === "_none" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="budgetMin">Presupuesto mínimo (MXN)</Label>
            <Input
              id="budgetMin"
              type="number"
              value={formData.budgetMin ?? ""}
              onChange={(e) =>
                updateField("budgetMin", e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="budgetMax">Presupuesto máximo (MXN)</Label>
            <Input
              id="budgetMax"
              type="number"
              value={formData.budgetMax ?? ""}
              onChange={(e) =>
                updateField("budgetMax", e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferredZone">Zona preferida</Label>
            <Input
              id="preferredZone"
              value={formData.preferredZone || ""}
              onChange={(e) => updateField("preferredZone", e.target.value)}
              placeholder="Playa del Carmen, Tulum..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchaseModality">Modalidad de compra</Label>
            <Select
              value={formData.purchaseModality || "_none"}
              onValueChange={(v) => updateField("purchaseModality", v === "_none" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {PURCHASE_MODALITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rentalStrategy">Estrategia de renta</Label>
            <Select
              value={formData.rentalStrategy || "_none"}
              onValueChange={(v) => updateField("rentalStrategy", v === "_none" ? undefined : v)}
            >
              <SelectTrigger className="sm:w-1/2">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin definir</SelectItem>
                {RENTAL_STRATEGY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Sección: Asignación */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Asignación
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="assignedToId">Asesor asignado</Label>
            <Select
              value={formData.assignedToId || "_auto"}
              onValueChange={(v) => updateField("assignedToId", v === "_auto" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Asignación automática" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_auto">Asignación automática (round-robin)</SelectItem>
                {advisors.map((advisor) => (
                  <SelectItem key={advisor.id} value={advisor.id}>
                    {advisor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="temperature">Temperatura</Label>
            <Select
              value={formData.temperature || "COLD"}
              onValueChange={(v) => updateField("temperature", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPERATURE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="tags">Etiquetas (separadas por coma)</Label>
            <Input
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="VIP, seguimiento, Tulum"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Botón de envío */}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Guardando..."
            : mode === "create"
            ? "Guardar Contacto"
            : "Actualizar Contacto"}
        </Button>
      </div>
    </form>
  );
}
