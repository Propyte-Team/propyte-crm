// Dialogo de formulario para crear/editar usuarios
// Incluye validacion con Zod y selects para enums del sistema
"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { ROLE_LABELS, PLAZA_LABELS, CAREER_REQUIREMENTS } from "@/lib/constants";
import { z } from "zod";

// Esquema de validacion del formulario
const userFormSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  email: z.string().email("Correo electronico invalido"),
  password: z.string().min(6, "Minimo 6 caracteres").optional(),
  role: z.string().min(1, "Selecciona un rol"),
  plaza: z.string().min(1, "Selecciona una plaza"),
  careerLevel: z.string().optional(),
  teamLeaderId: z.string().optional(),
  phone: z.string().optional(),
  sedetusNumber: z.string().optional(),
  sedetusExpiry: z.string().optional(),
});

// Etiquetas de nivel de carrera
const CAREER_LEVEL_LABELS: Record<string, string> = {
  JR: CAREER_REQUIREMENTS.JR.label,
  SR: CAREER_REQUIREMENTS.SR.label,
  TOP_PRODUCER: CAREER_REQUIREMENTS.TOP_PRODUCER.label,
  TEAM_LEADER: CAREER_REQUIREMENTS.TEAM_LEADER.label,
  GERENTE: CAREER_REQUIREMENTS.GERENTE.label,
};

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  plaza: string;
  careerLevel: string;
  isActive: boolean;
  phone: string | null;
  sedetusNumber: string | null;
  sedetusExpiry: Date | null;
  teamLeaderId: string | null;
}

interface TeamLeaderOption {
  id: string;
  name: string;
  role: string;
}

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserData | null;
  teamLeaderUsers: TeamLeaderOption[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  isPending: boolean;
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  teamLeaderUsers,
  onSubmit,
  isPending,
}: UserFormDialogProps) {
  const isEditing = !!user;

  // Estado del formulario
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "",
    plaza: "",
    careerLevel: "JR",
    teamLeaderId: "",
    phone: "",
    sedetusNumber: "",
    sedetusExpiry: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Inicializar formulario cuando cambia el usuario a editar
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name,
        email: user.email,
        password: "",
        role: user.role,
        plaza: user.plaza,
        careerLevel: user.careerLevel || "JR",
        teamLeaderId: user.teamLeaderId || "",
        phone: user.phone || "",
        sedetusNumber: user.sedetusNumber || "",
        sedetusExpiry: user.sedetusExpiry
          ? new Date(user.sedetusExpiry).toISOString().split("T")[0]
          : "",
      });
    } else {
      setFormData({
        name: "",
        email: "",
        password: "",
        role: "",
        plaza: "",
        careerLevel: "JR",
        teamLeaderId: "",
        phone: "",
        sedetusNumber: "",
        sedetusExpiry: "",
      });
    }
    setErrors({});
  }, [user, open]);

  // Manejar cambios en campos de texto
  function handleChange(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Limpiar error del campo
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  // Validar y enviar
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validar con Zod
    const dataToValidate = {
      ...formData,
      password: isEditing ? undefined : formData.password,
    };

    const result = userFormSchema.safeParse(dataToValidate);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0]?.toString();
        if (field) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    // Preparar datos para enviar
    const submitData: Record<string, unknown> = {
      name: formData.name,
      email: formData.email,
      role: formData.role,
      plaza: formData.plaza,
      careerLevel: formData.careerLevel || "JR",
      teamLeaderId: formData.teamLeaderId || null,
      phone: formData.phone || null,
      sedetusNumber: formData.sedetusNumber || null,
      sedetusExpiry: formData.sedetusExpiry || null,
    };

    if (!isEditing && formData.password) {
      submitData.password = formData.password;
    }

    await onSubmit(submitData);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Actualizar Usuario" : "Crear Usuario"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modifica los datos del usuario seleccionado"
              : "Ingresa los datos del nuevo usuario"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nombre */}
          <div className="space-y-2">
            <Label htmlFor="name">Nombre completo</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Juan Perez"
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Correo electronico</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="juan@propyte.com"
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email}</p>
            )}
          </div>

          {/* Contrasena (solo para crear) */}
          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="password">Contrasena</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => handleChange("password", e.target.value)}
                placeholder="Minimo 6 caracteres"
              />
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password}</p>
              )}
            </div>
          )}

          {/* Rol y Plaza en grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => handleChange("role", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.role && (
                <p className="text-sm text-red-500">{errors.role}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Plaza</Label>
              <Select
                value={formData.plaza}
                onValueChange={(v) => handleChange("plaza", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar plaza" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.plaza && (
                <p className="text-sm text-red-500">{errors.plaza}</p>
              )}
            </div>
          </div>

          {/* Nivel de carrera y Team Leader */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nivel de Carrera</Label>
              <Select
                value={formData.careerLevel}
                onValueChange={(v) => handleChange("careerLevel", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar nivel" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CAREER_LEVEL_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Team Leader</Label>
              <Select
                value={formData.teamLeaderId}
                onValueChange={(v) => handleChange("teamLeaderId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {teamLeaderUsers.map((tl) => (
                    <SelectItem key={tl.id} value={tl.id}>
                      {tl.name} ({ROLE_LABELS[tl.role] ?? tl.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Telefono */}
          <div className="space-y-2">
            <Label htmlFor="phone">Telefono</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="+52 998 123 4567"
            />
          </div>

          {/* SEDETUS */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sedetusNumber">Numero SEDETUS</Label>
              <Input
                id="sedetusNumber"
                value={formData.sedetusNumber}
                onChange={(e) => handleChange("sedetusNumber", e.target.value)}
                placeholder="SED-001234"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sedetusExpiry">Vencimiento SEDETUS</Label>
              <Input
                id="sedetusExpiry"
                type="date"
                value={formData.sedetusExpiry}
                onChange={(e) => handleChange("sedetusExpiry", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Procesando..."
                : isEditing
                  ? "Actualizar Usuario"
                  : "Crear Usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
