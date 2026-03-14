// Formulario de creación/edición de deal
// Selects buscables para contacto, desarrollo y unidad
"use client";

import { useState, useEffect } from "react";
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
import { DEAL_TYPE_LABELS, CURRENCY_LABELS, LEAD_SOURCE_LABELS } from "@/lib/constants";

interface DealFormProps {
  // Datos iniciales para edición
  initialData?: {
    contactId: string;
    developmentId?: string;
    unitId?: string;
    dealType: string;
    estimatedValue: number;
    currency: string;
    expectedCloseDate: string;
    leadSourceAtDeal: string;
    notes?: string;
    stage?: string;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

interface ContactOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  leadSource: string;
}

interface DevelopmentOption {
  id: string;
  name: string;
}

interface UnitOption {
  id: string;
  unitNumber: string;
  unitType: string;
  price: string;
  status: string;
}

export function DealForm({ initialData, onSuccess, onCancel }: DealFormProps) {
  const isEdit = !!initialData;

  // Estado del formulario
  const [contactId, setContactId] = useState(initialData?.contactId || "");
  const [developmentId, setDevelopmentId] = useState(initialData?.developmentId || "");
  const [unitId, setUnitId] = useState(initialData?.unitId || "");
  const [dealType, setDealType] = useState(initialData?.dealType || "");
  const [estimatedValue, setEstimatedValue] = useState(
    initialData?.estimatedValue?.toString() || ""
  );
  const [currency, setCurrency] = useState(initialData?.currency || "MXN");
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    initialData?.expectedCloseDate?.split("T")[0] || ""
  );
  const [leadSourceAtDeal, setLeadSourceAtDeal] = useState(
    initialData?.leadSourceAtDeal || ""
  );

  // Opciones para selects
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [developments, setDevelopments] = useState<DevelopmentOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [contactSearch, setContactSearch] = useState("");

  // Estado de envío
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar contactos
  useEffect(() => {
    async function loadContacts() {
      try {
        const params = new URLSearchParams({ pageSize: "100" });
        if (contactSearch) params.set("search", contactSearch);
        const res = await fetch(`/api/contacts?${params}`);
        if (res.ok) {
          const json = await res.json();
          setContacts(json.data || []);
        }
      } catch (err) {
        console.error("Error al cargar contactos:", err);
      }
    }
    loadContacts();
  }, [contactSearch]);

  // Cargar desarrollos
  useEffect(() => {
    async function loadDevelopments() {
      try {
        const res = await fetch("/api/developments");
        if (res.ok) {
          const json = await res.json();
          setDevelopments(json.data || []);
        }
      } catch (err) {
        console.error("Error al cargar desarrollos:", err);
      }
    }
    loadDevelopments();
  }, []);

  // Cargar unidades cuando se selecciona un desarrollo
  useEffect(() => {
    async function loadUnits() {
      if (!developmentId) {
        setUnits([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/units?developmentId=${developmentId}&status=DISPONIBLE`
        );
        if (res.ok) {
          const json = await res.json();
          setUnits(json.data || []);
        }
      } catch (err) {
        console.error("Error al cargar unidades:", err);
      }
    }
    loadUnits();
  }, [developmentId]);

  // Auto-llenar leadSource del contacto seleccionado
  useEffect(() => {
    if (contactId && !leadSourceAtDeal) {
      const contact = contacts.find((c) => c.id === contactId);
      if (contact) {
        setLeadSourceAtDeal(contact.leadSource);
      }
    }
  }, [contactId, contacts, leadSourceAtDeal]);

  // Enviar formulario
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body: any = {
        contactId,
        dealType,
        estimatedValue: parseFloat(estimatedValue),
        currency,
        expectedCloseDate,
        leadSourceAtDeal: leadSourceAtDeal || "OTRO",
      };

      if (developmentId) body.developmentId = developmentId;
      if (unitId) body.unitId = unitId;

      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear deal");
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

      {/* Contacto */}
      <div className="space-y-2">
        <Label htmlFor="contact">Contacto *</Label>
        <Select value={contactId} onValueChange={setContactId}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar contacto..." />
          </SelectTrigger>
          <SelectContent>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.firstName} {c.lastName} - {c.phone}
              </SelectItem>
            ))}
            {contacts.length === 0 && (
              <div className="p-2 text-center text-sm text-muted-foreground">
                No se encontraron contactos
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Desarrollo */}
      <div className="space-y-2">
        <Label htmlFor="development">Desarrollo</Label>
        <Select value={developmentId} onValueChange={(v) => { setDevelopmentId(v); setUnitId(""); }}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar desarrollo..." />
          </SelectTrigger>
          <SelectContent>
            {developments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Unidad (filtrada por desarrollo, solo disponibles) */}
      {developmentId && (
        <div className="space-y-2">
          <Label htmlFor="unit">Unidad</Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar unidad..." />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.unitNumber} - {u.unitType} - ${Number(u.price).toLocaleString()}
                </SelectItem>
              ))}
              {units.length === 0 && (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No hay unidades disponibles
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tipo de deal */}
      <div className="space-y-2">
        <Label htmlFor="dealType">Tipo de Operación *</Label>
        <Select value={dealType} onValueChange={setDealType}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar tipo..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Valor estimado y moneda */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="value">Valor Estimado *</Label>
          <Input
            id="value"
            type="number"
            min="0"
            step="1000"
            placeholder="4,130,844"
            value={estimatedValue}
            onChange={(e) => setEstimatedValue(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Moneda</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CURRENCY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Fecha esperada de cierre */}
      <div className="space-y-2">
        <Label htmlFor="closeDate">Fecha Esperada de Cierre *</Label>
        <Input
          id="closeDate"
          type="date"
          value={expectedCloseDate}
          onChange={(e) => setExpectedCloseDate(e.target.value)}
          required
        />
      </div>

      {/* Fuente del lead */}
      <div className="space-y-2">
        <Label htmlFor="leadSource">Fuente del Lead</Label>
        <Select value={leadSourceAtDeal} onValueChange={setLeadSourceAtDeal}>
          <SelectTrigger>
            <SelectValue placeholder="Auto-llenado del contacto" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LEAD_SOURCE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Botones de acción */}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting || !contactId || !dealType || !estimatedValue}>
          {submitting ? "Guardando..." : isEdit ? "Actualizar" : "Crear Deal"}
        </Button>
      </div>
    </form>
  );
}
