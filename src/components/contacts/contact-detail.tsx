// Vista detallada de un contacto con pestañas de información, actividades, deals y documentos
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
  Calendar,
  User,
  MapPin,
  Briefcase,
  Tag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactForm } from "@/components/contacts/contact-form";
import { ConversationPanel } from "@/components/contacts/conversation-panel";
import { CallIndicator } from "@/components/contacts/call-indicator";

// --- Etiquetas en español ---
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

const TEMP_LABEL: Record<string, string> = {
  HOT: "Caliente",
  WARM: "Tibio",
  COLD: "Frío",
  DEAD: "Muerto",
};

const TEMP_VARIANT: Record<string, "hot" | "warm" | "cold" | "dead"> = {
  HOT: "hot",
  WARM: "warm",
  COLD: "cold",
  DEAD: "dead",
};

const TYPE_LABEL: Record<string, string> = {
  LEAD: "Lead",
  PROSPECTO: "Prospecto",
  CLIENTE: "Cliente",
  INVERSIONISTA: "Inversionista",
  BROKER_EXTERNO: "Broker externo",
  REFERIDO: "Referido",
};

const INVESTMENT_LABEL: Record<string, string> = {
  END_USER: "Usuario final",
  INVESTOR_RENTAL: "Inversionista (renta)",
  INVESTOR_FLIP: "Inversionista (flip)",
  INVESTOR_LAND: "Inversionista (terreno)",
  MIXED: "Mixto",
};

const PROPERTY_LABEL: Record<string, string> = {
  DEPARTAMENTO: "Departamento",
  CASA: "Casa",
  TERRENO: "Terreno",
  MACROLOTE: "Macrolote",
  LOCAL_COMERCIAL: "Local comercial",
  OTRO: "Otro",
};

const TIMELINE_LABEL: Record<string, string> = {
  IMMEDIATE: "Inmediato",
  ONE_TO_THREE_MONTHS: "1-3 meses",
  THREE_TO_SIX_MONTHS: "3-6 meses",
  SIX_PLUS_MONTHS: "6+ meses",
};

const PAYMENT_LABEL: Record<string, string> = {
  CONTADO: "Contado",
  CREDITO_HIPOTECARIO: "Crédito hipotecario",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
  MIXTO: "Mixto",
};

const MODALITY_LABEL: Record<string, string> = {
  PREVENTA: "Preventa",
  ENTREGA_INMEDIATA: "Entrega inmediata",
  REVENTA: "Reventa",
  ABIERTO: "Abierto",
};

const RENTAL_LABEL: Record<string, string> = {
  LONG_TERM: "Largo plazo",
  AIRBNB: "Airbnb / corto plazo",
  BOTH: "Ambos",
  NA: "No aplica",
};

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  CALL_OUTBOUND: "Llamada saliente",
  CALL_INBOUND: "Llamada entrante",
  WHATSAPP_OUT: "WhatsApp enviado",
  WHATSAPP_IN: "WhatsApp recibido",
  SMS_OUT: "SMS enviado",
  SMS_IN: "SMS recibido",
  EMAIL_SENT: "Email enviado",
  EMAIL_RECEIVED: "Email recibido",
  MEETING_VIRTUAL: "Reunión virtual",
  MEETING_PRESENTIAL: "Reunión presencial",
  MEETING_SHOWROOM: "Visita a showroom",
  DISCOVERY_CALL: "Llamada de descubrimiento",
  PROPOSAL_DELIVERY: "Entrega de propuesta",
  FOLLOW_UP: "Seguimiento",
  WALK_IN: "Walk-in",
  NOTE: "Nota",
  TASK: "Tarea",
  CONTRACT_REVIEW: "Revisión de contrato",
  CLOSING_ACTIVITY: "Actividad de cierre",
};

const DEAL_STAGE_LABEL: Record<string, string> = {
  NEW_LEAD: "Nuevo lead",
  CONTACTED: "Contactado",
  DISCOVERY_DONE: "Descubrimiento",
  MEETING_SCHEDULED: "Visita agendada",
  MEETING_COMPLETED: "Visita realizada",
  PROPOSAL_SENT: "Propuesta enviada",
  NEGOTIATION: "Negociación",
  RESERVED: "Reservado",
  CONTRACT_SIGNED: "Contrato firmado",
  CLOSING: "En cierre",
  WON: "Ganado",
  LOST: "Perdido",
  FROZEN: "Congelado",
};

interface ContactDetailProps {
  contact: any;
  userRole: string;
}

export function ContactDetail({ contact, userRole }: ContactDetailProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [activeCall, setActiveCall] = useState(false);

  // Formatear fecha legible
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Formatear moneda
  const formatCurrency = (value: number | string | null, currency = "MXN") => {
    if (!value) return "-";
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
    }).format(Number(value));
  };

  // Abrir WhatsApp
  const openWhatsApp = () => {
    const cleanPhone = contact.phone.replace(/[\s\-\(\)]/g, "");
    window.open(`https://wa.me/${cleanPhone}`, "_blank");
  };

  // Eliminar contacto
  const handleDelete = async () => {
    if (!confirm("¿Estás seguro de que deseas eliminar este contacto?")) return;
    try {
      const res = await fetch(`/api/contacts?id=${contact.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/contacts");
      }
    } catch (err) {
      console.error("Error al eliminar:", err);
    }
  };

  // Callback de edición exitosa
  const handleEditSuccess = () => {
    setEditOpen(false);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Encabezado con acciones */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/contacts")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {contact.firstName} {contact.lastName}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={TEMP_VARIANT[contact.temperature] || "cold"}>
                {TEMP_LABEL[contact.temperature] || contact.temperature}
              </Badge>
              <Badge variant="outline">
                {TYPE_LABEL[contact.contactType] || contact.contactType}
              </Badge>
              <Badge variant="outline">
                {SOURCE_LABEL[contact.leadSource] || contact.leadSource}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const el = document.querySelector('[data-value="conversations"]') as HTMLElement;
              el?.click();
            }}
          >
            <MessageCircle className="mr-2 h-4 w-4 text-green-500" />
            Mensajes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveCall(true)}
            disabled={activeCall}
          >
            <Phone className="mr-2 h-4 w-4 text-blue-500" />
            Llamar VoIP
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/pipeline?newDeal=true&contactId=${contact.id}`)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Crear Deal
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar
          </Button>
        </div>
      </div>

      {/* Pestañas de contenido */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList>
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="activities">
            Actividades ({contact.activities?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="deals">
            Deals ({contact.deals?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="conversations" data-value="conversations">
            Conversaciones
          </TabsTrigger>
          <TabsTrigger value="documents">Documentos</TabsTrigger>
        </TabsList>

        {/* Pestaña: Información */}
        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Datos Básicos */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4" />
                  Datos Básicos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Nombre" value={`${contact.firstName} ${contact.lastName}`} />
                <InfoRow label="Teléfono" value={contact.phone} />
                <InfoRow label="Teléfono secundario" value={contact.secondaryPhone} />
                <InfoRow label="Email" value={contact.email} />
                <InfoRow label="Idioma preferido" value={contact.preferredLanguage === "EN" ? "Inglés" : "Español"} />
                <InfoRow label="Registro" value={formatDate(contact.createdAt)} />
              </CardContent>
            </Card>

            {/* Ubicación */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" />
                  Ubicación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Ciudad" value={contact.residenceCity} />
                <InfoRow label="País" value={contact.residenceCountry} />
                <InfoRow label="Nacionalidad" value={contact.nationality} />
              </CardContent>
            </Card>

            {/* Perfil de Inversión */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Briefcase className="h-4 w-4" />
                  Perfil de Inversión
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Perfil" value={INVESTMENT_LABEL[contact.investmentProfile] || null} />
                <InfoRow label="Tipo de propiedad" value={PROPERTY_LABEL[contact.propertyType] || null} />
                <InfoRow label="Horizonte de compra" value={TIMELINE_LABEL[contact.purchaseTimeline] || null} />
                <InfoRow label="Presupuesto mín." value={formatCurrency(contact.budgetMin)} />
                <InfoRow label="Presupuesto máx." value={formatCurrency(contact.budgetMax)} />
                <InfoRow label="Forma de pago" value={PAYMENT_LABEL[contact.paymentMethod] || null} />
                <InfoRow label="Zona preferida" value={contact.preferredZone} />
                <InfoRow label="Modalidad de compra" value={MODALITY_LABEL[contact.purchaseModality] || null} />
                <InfoRow label="Estrategia de renta" value={RENTAL_LABEL[contact.rentalStrategy] || null} />
              </CardContent>
            </Card>

            {/* Asignación y etiquetas */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="h-4 w-4" />
                  Asignación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Asesor asignado" value={contact.assignedTo?.name || "Sin asignar"} />
                <InfoRow label="Temperatura" value={TEMP_LABEL[contact.temperature]} />
                <InfoRow label="Score" value={String(contact.score)} />
                <div>
                  <p className="text-sm text-muted-foreground">Etiquetas</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {contact.tags?.length > 0 ? (
                      contact.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">Sin etiquetas</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Pestaña: Actividades */}
        <TabsContent value="activities">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial de Actividades</CardTitle>
            </CardHeader>
            <CardContent>
              {contact.activities?.length > 0 ? (
                <div className="space-y-4">
                  {contact.activities.map((activity: any) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-4 border-b pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{activity.subject}</p>
                          <Badge variant="outline" className="text-xs">
                            {ACTIVITY_TYPE_LABEL[activity.activityType] || activity.activityType}
                          </Badge>
                        </div>
                        {activity.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {activity.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>Por: {activity.user?.name || "Sistema"}</span>
                          <span>{formatDate(activity.createdAt)}</span>
                          <Badge
                            variant={activity.status === "COMPLETADA" ? "default" : "outline"}
                            className="text-xs"
                          >
                            {activity.status === "COMPLETADA"
                              ? "Completada"
                              : activity.status === "PENDIENTE"
                              ? "Pendiente"
                              : activity.status === "VENCIDA"
                              ? "Vencida"
                              : "Cancelada"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay actividades registradas para este contacto
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Deals */}
        <TabsContent value="deals">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Operaciones</CardTitle>
              <Button
                size="sm"
                onClick={() =>
                  router.push(`/pipeline?newDeal=true&contactId=${contact.id}`)
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Deal
              </Button>
            </CardHeader>
            <CardContent>
              {contact.deals?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Etapa</th>
                        <th className="pb-2 font-medium">Desarrollo</th>
                        <th className="pb-2 font-medium">Unidad</th>
                        <th className="pb-2 font-medium">Valor estimado</th>
                        <th className="pb-2 font-medium">Asesor</th>
                        <th className="pb-2 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contact.deals.map((deal: any) => (
                        <tr
                          key={deal.id}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                          onClick={() => router.push(`/pipeline?dealId=${deal.id}`)}
                        >
                          <td className="py-2">
                            <Badge variant="outline">
                              {DEAL_STAGE_LABEL[deal.stage] || deal.stage}
                            </Badge>
                          </td>
                          <td className="py-2">
                            {deal.development?.name || "-"}
                          </td>
                          <td className="py-2">
                            {deal.unit?.unitNumber || "-"}
                          </td>
                          <td className="py-2">
                            {formatCurrency(deal.estimatedValue, deal.currency)}
                          </td>
                          <td className="py-2">
                            {deal.assignedTo?.name || "-"}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {formatDate(deal.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay operaciones asociadas a este contacto
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Conversaciones (Twilio SMS/WhatsApp) */}
        <TabsContent value="conversations">
          <ConversationPanel
            contactId={contact.id}
            contactName={`${contact.firstName} ${contact.lastName}`}
            contactPhone={contact.phone}
          />
        </TabsContent>

        {/* Pestaña: Documentos */}
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground text-center py-8">
                La gestión de documentos estará disponible próximamente
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Indicador de llamada VoIP activa */}
      {activeCall && (
        <CallIndicator
          contactId={contact.id}
          contactName={`${contact.firstName} ${contact.lastName}`}
          contactPhone={contact.phone}
          onClose={() => setActiveCall(false)}
        />
      )}

      {/* Diálogo de edición */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Contacto</DialogTitle>
          </DialogHeader>
          <ContactForm
            mode="edit"
            initialData={contact}
            onSuccess={handleEditSuccess}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Componente auxiliar para mostrar filas de información
function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "-"}</span>
    </div>
  );
}
