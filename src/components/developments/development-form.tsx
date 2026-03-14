// Formulario de creación/edición de desarrollo inmobiliario
"use client";

import { useState } from "react";
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
  PLAZA_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  CURRENCY_LABELS,
} from "@/lib/constants";

interface DevelopmentFormProps {
  initialData?: any;
  onSuccess: () => void;
  onCancel: () => void;
}

export function DevelopmentForm({
  initialData,
  onSuccess,
  onCancel,
}: DevelopmentFormProps) {
  const isEdit = !!initialData;

  // Estado del formulario
  const [name, setName] = useState(initialData?.name || "");
  const [developerName, setDeveloperName] = useState(initialData?.developerName || "");
  const [developmentType, setDevelopmentType] = useState(initialData?.developmentType || "");
  const [location, setLocation] = useState(initialData?.location || "");
  const [plaza, setPlaza] = useState(initialData?.plaza || "");
  const [totalUnits, setTotalUnits] = useState(initialData?.totalUnits?.toString() || "");
  const [availableUnits, setAvailableUnits] = useState(initialData?.availableUnits?.toString() || "");
  const [priceMin, setPriceMin] = useState(initialData?.priceMin?.toString() || "");
  const [priceMax, setPriceMax] = useState(initialData?.priceMax?.toString() || "");
  const [currency, setCurrency] = useState(initialData?.currency || "MXN");
  const [commissionRate, setCommissionRate] = useState(initialData?.commissionRate?.toString() || "");
  const [status, setStatus] = useState(initialData?.status || "PREVENTA");
  const [constructionProgress, setConstructionProgress] = useState(
    initialData?.constructionProgress?.toString() || "0"
  );
  const [deliveryDate, setDeliveryDate] = useState(
    initialData?.deliveryDate?.split("T")[0] || ""
  );
  const [brochureUrl, setBrochureUrl] = useState(initialData?.brochureUrl || "");
  const [virtualTourUrl, setVirtualTourUrl] = useState(initialData?.virtualTourUrl || "");
  const [amenitiesText, setAmenitiesText] = useState(
    (initialData?.amenities || []).join(", ")
  );
  const [description, setDescription] = useState(initialData?.description || "");

  // Estado de envío
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enviar formulario
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Parsear amenidades del texto separado por comas
      const amenities = amenitiesText
        .split(",")
        .map((a: string) => a.trim())
        .filter((a: string) => a.length > 0);

      const body = {
        name,
        developerName,
        developmentType,
        location,
        plaza,
        totalUnits: parseInt(totalUnits),
        availableUnits: parseInt(availableUnits),
        priceMin: parseFloat(priceMin),
        priceMax: parseFloat(priceMax),
        currency,
        commissionRate: parseFloat(commissionRate),
        status,
        constructionProgress: parseInt(constructionProgress),
        deliveryDate: deliveryDate || undefined,
        brochureUrl: brochureUrl || undefined,
        virtualTourUrl: virtualTourUrl || undefined,
        amenities,
        description,
      };

      const url = isEdit
        ? `/api/developments/${initialData.id}`
        : "/api/developments";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al guardar desarrollo");
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Nombre y desarrollador */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nombre del Desarrollo *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nativa Tulum"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Nombre del Desarrollador *</Label>
          <Input
            value={developerName}
            onChange={(e) => setDeveloperName(e.target.value)}
            placeholder="Grupo Inmobiliario"
            required
          />
        </div>
      </div>

      {/* Tipo, Plaza, Estado */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Tipo *</Label>
          <Select value={developmentType} onValueChange={setDevelopmentType}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEVELOPMENT_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Plaza *</Label>
          <Select value={plaza} onValueChange={setPlaza}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Estado</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEVELOPMENT_STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Ubicación */}
      <div className="space-y-2">
        <Label>Ubicación *</Label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Tulum, Quintana Roo"
          required
        />
      </div>

      {/* Unidades */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Total de Unidades *</Label>
          <Input
            type="number"
            min="1"
            value={totalUnits}
            onChange={(e) => setTotalUnits(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Unidades Disponibles *</Label>
          <Input
            type="number"
            min="0"
            value={availableUnits}
            onChange={(e) => setAvailableUnits(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Precios y moneda */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Precio Mínimo *</Label>
          <Input
            type="number"
            min="0"
            step="1000"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Precio Máximo *</Label>
          <Input
            type="number"
            min="0"
            step="1000"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Moneda</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CURRENCY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Comisión y progreso */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tasa de Comisión (%) *</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            placeholder="4.5"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Progreso de Construcción (%)</Label>
          <Input
            type="number"
            min="0"
            max="100"
            value={constructionProgress}
            onChange={(e) => setConstructionProgress(e.target.value)}
          />
        </div>
      </div>

      {/* Fechas */}
      <div className="space-y-2">
        <Label>Fecha de Entrega</Label>
        <Input
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
        />
      </div>

      {/* URLs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>URL del Brochure</Label>
          <Input
            type="url"
            value={brochureUrl}
            onChange={(e) => setBrochureUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-2">
          <Label>URL del Tour Virtual</Label>
          <Input
            type="url"
            value={virtualTourUrl}
            onChange={(e) => setVirtualTourUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>

      {/* Amenidades */}
      <div className="space-y-2">
        <Label>Amenidades (separadas por coma)</Label>
        <Input
          value={amenitiesText}
          onChange={(e) => setAmenitiesText(e.target.value)}
          placeholder="Alberca, Gym, Palapa, Seguridad 24/7"
        />
      </div>

      {/* Descripción */}
      <div className="space-y-2">
        <Label>Descripción *</Label>
        <textarea
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción del desarrollo..."
          required
        />
      </div>

      {/* Botones */}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={submitting || !name || !developerName || !developmentType || !plaza || !description}
        >
          {submitting ? "Guardando..." : isEdit ? "Actualizar" : "Crear Desarrollo"}
        </Button>
      </div>
    </form>
  );
}
