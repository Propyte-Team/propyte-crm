// Componente cliente para detalle de deal
// Renderiza info, barra de progreso, comisiones, actividades y acciones
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  Edit,
  Plus,
  Calendar,
  Phone,
  Mail,
  Building2,
  DollarSign,
  Clock,
  User,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  DEAL_TYPE_LABELS,
  LOST_REASON_LABELS,
  ACTIVITY_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { StageTransitionDialog } from "@/components/pipeline/stage-transition-dialog";
import type { PipelineDeal } from "@/components/pipeline/pipeline-view";

interface DealDetailClientProps {
  deal: any;
  userRole: string;
  userId: string;
}

export function DealDetailClient({ deal, userRole, userId }: DealDetailClientProps) {
  const router = useRouter();
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [selectedStage, setSelectedStage] = useState("");

  // Etapas ordenadas para la barra de progreso (excluyendo LOST y FROZEN)
  const progressStages = PIPELINE_STAGES.filter(
    (s) => !["LOST", "FROZEN"].includes(s.code)
  );

  // Índice de la etapa actual
  const currentStageIdx = progressStages.findIndex((s) => s.code === deal.stage);
  const isTerminal = ["WON", "LOST", "FROZEN"].includes(deal.stage);

  // Formatear fecha
  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Formatear tiempo relativo
  function timeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `hace ${diffDays}d`;
    if (diffHours > 0) return `hace ${diffHours}h`;
    return `hace ${diffMins}m`;
  }

  // Crear PipelineDeal para el diálogo de transición
  const pipelineDeal: PipelineDeal = {
    id: deal.id,
    contactId: deal.contactId,
    contactName: `${deal.contact?.firstName || ""} ${deal.contact?.lastName || ""}`.trim(),
    contactFirstName: deal.contact?.firstName || "",
    contactLastName: deal.contact?.lastName || "",
    development: deal.development?.name || null,
    developmentId: deal.developmentId,
    unit: deal.unit?.unitNumber || null,
    unitId: deal.unitId,
    value: Number(deal.estimatedValue || 0),
    currency: deal.currency || "MXN",
    stage: deal.stage,
    dealType: deal.dealType,
    probability: deal.probability || 0,
    temperature: deal.contact?.temperature || "COLD",
    advisorName: deal.assignedTo?.name || "",
    advisorId: deal.assignedToId,
    advisorAvatar: deal.assignedTo?.avatarUrl || null,
    daysInStage: 0,
    expectedCloseDate: deal.expectedCloseDate,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    isStagnant: false,
    leadSourceAtDeal: deal.leadSourceAtDeal || "",
    lostReason: deal.lostReason,
    lostReasonDetail: deal.lostReasonDetail,
    actualCloseDate: deal.actualCloseDate,
    commissionTotal: deal.commissionTotal ? Number(deal.commissionTotal) : null,
  };

  const stageColor = STAGE_COLORS[deal.stage] || "#6B7280";

  return (
    <div className="space-y-6">
      {/* Encabezado con navegación */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/pipeline")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Pipeline
        </Button>
      </div>

      {/* Header del deal */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {deal.contact?.firstName} {deal.contact?.lastName}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white"
              style={{ backgroundColor: stageColor }}
            >
              {STAGE_LABELS[deal.stage] || deal.stage}
            </span>
            <span className="text-sm text-muted-foreground">
              {DEAL_TYPE_LABELS[deal.dealType] || deal.dealType}
            </span>
            <span className="text-lg font-bold text-primary">
              {formatCurrency(Number(deal.estimatedValue || 0), deal.currency)}
            </span>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex gap-2">
          {!isTerminal && (
            <Button
              onClick={() => setShowStageDialog(true)}
              size="sm"
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Cambiar Etapa
            </Button>
          )}
        </div>
      </div>

      {/* Barra de progreso de etapas */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center overflow-x-auto gap-1">
            {progressStages.map((stage, idx) => {
              const isCurrent = stage.code === deal.stage;
              const isCompleted = currentStageIdx >= 0 && idx < currentStageIdx;
              const isLost = deal.stage === "LOST";
              const isFrozen = deal.stage === "FROZEN";

              return (
                <div key={stage.code} className="flex items-center flex-shrink-0">
                  <div
                    className={`flex items-center justify-center rounded-full text-xs font-semibold transition-all ${
                      isCurrent
                        ? "h-8 w-8 text-white ring-2 ring-offset-2"
                        : isCompleted
                        ? "h-6 w-6 text-white"
                        : "h-6 w-6 bg-muted text-muted-foreground"
                    }`}
                    style={{
                      backgroundColor: isCurrent || isCompleted ? stage.color : undefined,
                    }}
                    title={stage.label}
                  >
                    {idx + 1}
                  </div>
                  {idx < progressStages.length - 1 && (
                    <div
                      className={`h-0.5 w-6 mx-0.5 ${
                        isCompleted ? "bg-primary" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Etiquetas debajo (solo para la etapa actual) */}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {deal.stage === "LOST"
              ? `Perdido: ${LOST_REASON_LABELS[deal.lostReason] || deal.lostReason || "Sin razón"}`
              : deal.stage === "FROZEN"
              ? "Deal congelado"
              : `Probabilidad de cierre: ${deal.probability}%`}
          </p>
        </CardContent>
      </Card>

      {/* Grid de información */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Info del deal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información del Deal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow icon={<DollarSign className="h-4 w-4" />} label="Valor estimado">
              {formatCurrency(Number(deal.estimatedValue || 0), deal.currency)}
            </InfoRow>
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Cierre esperado">
              {formatDate(deal.expectedCloseDate)}
            </InfoRow>
            {deal.actualCloseDate && (
              <InfoRow icon={<Calendar className="h-4 w-4" />} label="Cierre real">
                {formatDate(deal.actualCloseDate)}
              </InfoRow>
            )}
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Creado">
              {formatDate(deal.createdAt)}
            </InfoRow>
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Tipo">
              {DEAL_TYPE_LABELS[deal.dealType] || deal.dealType}
            </InfoRow>
            <InfoRow icon={<User className="h-4 w-4" />} label="Fuente lead">
              {deal.leadSourceAtDeal}
            </InfoRow>
          </CardContent>
        </Card>

        {/* Info del contacto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contacto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow icon={<User className="h-4 w-4" />} label="Nombre">
              {deal.contact?.firstName} {deal.contact?.lastName}
            </InfoRow>
            {deal.contact?.phone && (
              <InfoRow icon={<Phone className="h-4 w-4" />} label="Teléfono">
                {deal.contact.phone}
              </InfoRow>
            )}
            {deal.contact?.email && (
              <InfoRow icon={<Mail className="h-4 w-4" />} label="Email">
                {deal.contact.email}
              </InfoRow>
            )}
            <InfoRow icon={<User className="h-4 w-4" />} label="Tipo">
              {deal.contact?.contactType || "-"}
            </InfoRow>
            <InfoRow icon={<DollarSign className="h-4 w-4" />} label="Perfil inversión">
              {deal.contact?.investmentProfile || "Sin completar"}
            </InfoRow>
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Tipo propiedad">
              {deal.contact?.propertyType || "Sin completar"}
            </InfoRow>
          </CardContent>
        </Card>

        {/* Info del desarrollo y unidad */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desarrollo / Unidad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {deal.development ? (
              <>
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Desarrollo">
                  {deal.development.name}
                </InfoRow>
                <InfoRow icon={<MapPin className="h-4 w-4" />} label="Desarrollador">
                  {deal.development.developerName}
                </InfoRow>
                <InfoRow icon={<DollarSign className="h-4 w-4" />} label="Comisión">
                  {Number(deal.development.commissionRate)}%
                </InfoRow>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin desarrollo asignado</p>
            )}
            <Separator />
            {deal.unit ? (
              <>
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Unidad">
                  {deal.unit.unitNumber}
                </InfoRow>
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Tipo">
                  {deal.unit.unitType}
                </InfoRow>
                <InfoRow icon={<DollarSign className="h-4 w-4" />} label="Precio">
                  {formatCurrency(Number(deal.unit.price || 0), deal.unit.currency)}
                </InfoRow>
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Area">
                  {Number(deal.unit.area_m2)} m2
                </InfoRow>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin unidad asignada</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Comisiones (si WON o estimado) */}
      {(deal.commissionTotal || deal.stage === "WON") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desglose de Comisiones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <CommissionItem
                label="Total"
                value={Number(deal.commissionTotal || 0)}
                currency={deal.currency}
              />
              <CommissionItem
                label="Asesor"
                value={Number(deal.commissionAdvisor || 0)}
                currency={deal.currency}
              />
              <CommissionItem
                label="Team Leader"
                value={Number(deal.commissionTL || 0)}
                currency={deal.currency}
              />
              <CommissionItem
                label="Gerente"
                value={Number(deal.commissionGerente || 0)}
                currency={deal.currency}
              />
              <CommissionItem
                label="Director"
                value={Number(deal.commissionDirector || 0)}
                currency={deal.currency}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Asesor asignado */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Asesor Asignado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {(deal.assignedTo?.name || "")
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{deal.assignedTo?.name}</p>
              <p className="text-sm text-muted-foreground">
                {deal.assignedTo?.email} &middot; {deal.assignedTo?.role}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline de actividades */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Historial de Actividades ({deal.activities?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deal.activities && deal.activities.length > 0 ? (
            <div className="space-y-4">
              {deal.activities.map((activity: any) => (
                <div key={activity.id} className="flex gap-3">
                  {/* Línea vertical */}
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-primary mt-2" />
                    <div className="w-px flex-1 bg-muted" />
                  </div>

                  {/* Contenido de la actividad */}
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {activity.subject}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {ACTIVITY_TYPE_LABELS[activity.activityType] || activity.activityType}
                      </Badge>
                    </div>
                    {activity.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {activity.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activity.user?.name} &middot; {timeAgo(activity.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Sin actividades registradas
            </p>
          )}
        </CardContent>
      </Card>

      {/* Diálogo de selección de etapa */}
      <Dialog open={showStageDialog} onOpenChange={setShowStageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seleccionar Nueva Etapa</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={selectedStage} onValueChange={setSelectedStage}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar etapa..." />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.filter((s) => s.code !== deal.stage).map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowStageDialog(false)}>
                Cancelar
              </Button>
              <Button
                disabled={!selectedStage}
                onClick={() => {
                  setShowStageDialog(false);
                }}
              >
                Continuar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo de transición con reglas de negocio */}
      {selectedStage && !showStageDialog && (
        <StageTransitionDialog
          deal={pipelineDeal}
          toStage={selectedStage}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedStage("");
          }}
          onSuccess={() => {
            setSelectedStage("");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Componente auxiliar para filas de información
function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <span className="text-muted-foreground flex-shrink-0 min-w-[100px]">{label}:</span>
      <span className="font-medium truncate">{children}</span>
    </div>
  );
}

// Componente auxiliar para items de comisión
function CommissionItem({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="rounded-md border p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{formatCurrency(value, currency)}</p>
    </div>
  );
}
