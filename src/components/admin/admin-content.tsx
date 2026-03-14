// Componente cliente de administracion con 3 pestanas:
// Usuarios, Comisiones y Configuracion
"use client";

import { useState, useTransition } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Users, DollarSign, Settings, Plus, Pencil, Trash2, Plug } from "lucide-react";
import {
  ROLE_LABELS,
  DEAL_TYPE_LABELS,
  LEAD_SOURCE_CATEGORY_LABELS,
  PLAZA_LABELS,
  ACTIVITY_AGREEMENT_DEFAULTS,
} from "@/lib/constants";
import {
  createUser,
  updateUser,
  deactivateUser,
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
  updateSystemConfig,
} from "@/server/admin";
import { useToast } from "@/components/ui/use-toast";
import { UserFormDialog } from "./user-form-dialog";
import { CommissionRuleDialog } from "./commission-rule-dialog";
import { IntegrationsTab } from "./integrations-tab";

// Configuracion de colores para estados de usuario
const USER_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  true: { label: "Activo", className: "bg-green-100 text-green-700" },
  false: { label: "Inactivo", className: "bg-gray-100 text-gray-700" },
};

// Tipos para los datos del servidor
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
  teamLeader: { id: string; name: string } | null;
  _count: { deals: number };
  createdAt: Date;
}

interface CommissionRuleData {
  id: string;
  dealType: string;
  leadSourceCategory: string;
  role: string;
  percentage: any; // Decimal de Prisma
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookData {
  id: string;
  event: string;
  url: string;
  isActive: boolean;
  secret: string;
  createdAt: Date;
}

interface ApiKeyData {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

interface AdminContentProps {
  initialUsers: UserData[];
  initialCommissionRules: CommissionRuleData[];
  initialSystemConfig: Record<string, unknown>;
  initialWebhooks: WebhookData[];
  initialApiKeys: ApiKeyData[];
}

export function AdminContent({
  initialUsers,
  initialCommissionRules,
  initialSystemConfig,
  initialWebhooks,
  initialApiKeys,
}: AdminContentProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  // Estado local para datos
  const [users, setUsers] = useState<UserData[]>(initialUsers);
  const [commissionRules, setCommissionRules] = useState<CommissionRuleData[]>(initialCommissionRules);

  // Filtros de la tabla de usuarios
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [plazaFilter, setPlazaFilter] = useState<string>("ALL");

  // Dialogos
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRuleData | null>(null);

  // Configuracion del acuerdo de actividad
  const activityConfig = (initialSystemConfig.activity_agreement as Record<string, number>) || {};
  const [configValues, setConfigValues] = useState({
    minDailyCalls: activityConfig.minDailyCalls ?? ACTIVITY_AGREEMENT_DEFAULTS.minDailyCalls,
    minDailyWhatsapps: activityConfig.minDailyWhatsapps ?? ACTIVITY_AGREEMENT_DEFAULTS.minDailyWhatsapps,
    minWeeklyVisits: activityConfig.minWeeklyVisits ?? ACTIVITY_AGREEMENT_DEFAULTS.minWeeklyVisits,
    minDailyFollowUps: activityConfig.minDailyFollowUps ?? ACTIVITY_AGREEMENT_DEFAULTS.minDailyFollowUps,
    maxFirstResponseMinutes: activityConfig.maxFirstResponseMinutes ?? ACTIVITY_AGREEMENT_DEFAULTS.maxFirstResponseMinutes,
    maxInactivityDays: activityConfig.maxInactivityDays ?? ACTIVITY_AGREEMENT_DEFAULTS.maxInactivityDays,
  });

  // Usuarios filtrados
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
    if (plazaFilter !== "ALL" && u.plaza !== plazaFilter) return false;
    return true;
  });

  // Usuarios que pueden ser team leader (TL o Gerente)
  const teamLeaderUsers = users.filter((u) =>
    ["TEAM_LEADER", "GERENTE", "DIRECTOR"].includes(u.role) && u.isActive
  );

  // --- Handlers de usuarios ---

  async function handleCreateUser(data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        const newUser = await createUser(data as any);
        // Recargar datos refrescando la pagina
        window.location.reload();
        toast({ title: "Usuario creado", description: `${(newUser as any).name} fue creado exitosamente` });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleUpdateUser(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        await updateUser(id, data as any);
        window.location.reload();
        toast({ title: "Usuario actualizado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleToggleActive(user: UserData) {
    startTransition(async () => {
      try {
        if (user.isActive) {
          await deactivateUser(user.id);
        } else {
          await updateUser(user.id, { isActive: true });
        }
        // Actualizar estado local
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, isActive: !u.isActive } : u
          )
        );
        toast({
          title: user.isActive ? "Usuario desactivado" : "Usuario activado",
        });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  // --- Handlers de reglas de comision ---

  async function handleCreateRule(data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        await createCommissionRule(data as any);
        window.location.reload();
        toast({ title: "Regla de comision creada" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleUpdateRule(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        await updateCommissionRule(id, data as any);
        window.location.reload();
        toast({ title: "Regla actualizada" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleDeleteRule(id: string) {
    startTransition(async () => {
      try {
        await deleteCommissionRule(id);
        setCommissionRules((prev) => prev.filter((r) => r.id !== id));
        toast({ title: "Regla eliminada" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  // --- Handler de configuracion ---

  async function handleSaveConfig() {
    startTransition(async () => {
      try {
        await updateSystemConfig("activity_agreement", configValues);
        toast({ title: "Configuracion guardada exitosamente" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  // Agrupar reglas de comision por dealType
  const groupedRules = commissionRules.reduce(
    (acc, rule) => {
      const key = rule.dealType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(rule);
      return acc;
    },
    {} as Record<string, CommissionRuleData[]>
  );

  return (
    <>
      {/* Pestanas principales */}
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-1">
            <Users className="h-4 w-4" />
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="commissions" className="gap-1">
            <DollarSign className="h-4 w-4" />
            Comisiones
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1">
            <Settings className="h-4 w-4" />
            Configuracion
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1">
            <Plug className="h-4 w-4" />
            Integraciones
          </TabsTrigger>
        </TabsList>

        {/* Pestana: Usuarios */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Usuarios del Sistema</CardTitle>
                <CardDescription>
                  Gestiona los usuarios y sus roles asignados
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  setEditingUser(null);
                  setUserDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Usuario
              </Button>
            </CardHeader>
            <CardContent>
              {/* Filtros */}
              <div className="mb-4 flex gap-4">
                <div className="w-48">
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filtrar por rol" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todos los roles</SelectItem>
                      {Object.entries(ROLE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <Select value={plazaFilter} onValueChange={setPlazaFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filtrar por plaza" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todas las plazas</SelectItem>
                      {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tabla de usuarios */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-3 font-medium">Nombre</th>
                      <th className="pb-3 font-medium">Email</th>
                      <th className="pb-3 font-medium">Rol</th>
                      <th className="pb-3 font-medium">Plaza</th>
                      <th className="pb-3 font-medium">Team Leader</th>
                      <th className="pb-3 font-medium">Estado</th>
                      <th className="pb-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => {
                      const statusConfig = USER_STATUS_CONFIG[String(user.isActive)];
                      return (
                        <tr
                          key={user.id}
                          className="border-b last:border-0 hover:bg-muted/50"
                        >
                          <td className="py-3 font-medium">{user.name}</td>
                          <td className="py-3">{user.email}</td>
                          <td className="py-3">
                            <Badge variant="outline">
                              {ROLE_LABELS[user.role] ?? user.role}
                            </Badge>
                          </td>
                          <td className="py-3">
                            {PLAZA_LABELS[user.plaza] ?? user.plaza}
                          </td>
                          <td className="py-3">
                            {user.teamLeader?.name || "-"}
                          </td>
                          <td className="py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusConfig.className}`}
                            >
                              {statusConfig.label}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingUser(user);
                                  setUserDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleActive(user)}
                                disabled={isPending}
                              >
                                {user.isActive ? "Desactivar" : "Activar"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          No se encontraron usuarios con los filtros seleccionados
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestana: Reglas de Comisiones */}
        <TabsContent value="commissions">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Reglas de Comisiones</CardTitle>
                <CardDescription>
                  Configura los porcentajes de comision por tipo de operacion, fuente y rol
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  setEditingRule(null);
                  setRuleDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nueva Regla
              </Button>
            </CardHeader>
            <CardContent>
              {Object.entries(groupedRules).map(([dealType, rules]) => (
                <div key={dealType} className="mb-6 last:mb-0">
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">
                    {DEAL_TYPE_LABELS[dealType] ?? dealType}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Categoria de Fuente</th>
                          <th className="pb-2 font-medium">Rol</th>
                          <th className="pb-2 font-medium">Porcentaje</th>
                          <th className="pb-2 font-medium">Activa</th>
                          <th className="pb-2 font-medium">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rules.map((rule) => (
                          <tr
                            key={rule.id}
                            className="border-b last:border-0 hover:bg-muted/50"
                          >
                            <td className="py-2">
                              {LEAD_SOURCE_CATEGORY_LABELS[rule.leadSourceCategory] ??
                                rule.leadSourceCategory}
                            </td>
                            <td className="py-2">
                              <Badge variant="outline">
                                {ROLE_LABELS[rule.role] ?? rule.role}
                              </Badge>
                            </td>
                            <td className="py-2 font-medium">
                              {Number(rule.percentage)}%
                            </td>
                            <td className="py-2">
                              <Badge
                                variant={rule.isActive ? "default" : "secondary"}
                                className={rule.isActive ? "bg-green-500" : ""}
                              >
                                {rule.isActive ? "Si" : "No"}
                              </Badge>
                            </td>
                            <td className="py-2">
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingRule(rule);
                                    setRuleDialogOpen(true);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteRule(rule.id)}
                                  disabled={isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {commissionRules.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">
                  No hay reglas de comision configuradas
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestana: Configuracion del acuerdo de actividad */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Acuerdo de Actividad</CardTitle>
              <CardDescription>
                Configura los minimos de actividad esperados por asesor
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                {/* Llamadas diarias */}
                <div className="space-y-2">
                  <Label htmlFor="minCalls">Llamadas diarias minimas</Label>
                  <Input
                    id="minCalls"
                    type="number"
                    value={configValues.minDailyCalls}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        minDailyCalls: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>

                {/* WhatsApps diarios */}
                <div className="space-y-2">
                  <Label htmlFor="minWhatsapps">WhatsApps diarios minimos</Label>
                  <Input
                    id="minWhatsapps"
                    type="number"
                    value={configValues.minDailyWhatsapps}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        minDailyWhatsapps: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>

                {/* Visitas semanales */}
                <div className="space-y-2">
                  <Label htmlFor="minVisits">Visitas semanales minimas</Label>
                  <Input
                    id="minVisits"
                    type="number"
                    value={configValues.minWeeklyVisits}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        minWeeklyVisits: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>

                {/* Seguimientos diarios */}
                <div className="space-y-2">
                  <Label htmlFor="minFollowUps">Seguimientos diarios minimos</Label>
                  <Input
                    id="minFollowUps"
                    type="number"
                    value={configValues.minDailyFollowUps}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        minDailyFollowUps: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>

                {/* Tiempo de respuesta */}
                <div className="space-y-2">
                  <Label htmlFor="maxResponse">
                    Tiempo maximo de respuesta (minutos)
                  </Label>
                  <Input
                    id="maxResponse"
                    type="number"
                    value={configValues.maxFirstResponseMinutes}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        maxFirstResponseMinutes: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>

                {/* Dias de inactividad */}
                <div className="space-y-2">
                  <Label htmlFor="maxInactivity">
                    Maximo dias sin actividad
                  </Label>
                  <Input
                    id="maxInactivity"
                    type="number"
                    value={configValues.maxInactivityDays}
                    onChange={(e) =>
                      setConfigValues((prev) => ({
                        ...prev,
                        maxInactivityDays: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>

              {/* Boton de guardar */}
              <div className="mt-6">
                <Button onClick={handleSaveConfig} disabled={isPending}>
                  {isPending ? "Guardando..." : "Guardar Configuracion"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/* Pestana: Integraciones (Twilio + Zapier) */}
        <TabsContent value="integrations">
          <IntegrationsTab
            initialWebhooks={initialWebhooks}
            initialApiKeys={initialApiKeys}
          />
        </TabsContent>
      </Tabs>

      {/* Dialog de usuario */}
      <UserFormDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        user={editingUser}
        teamLeaderUsers={teamLeaderUsers}
        onSubmit={async (data) => {
          if (editingUser) {
            await handleUpdateUser(editingUser.id, data);
          } else {
            await handleCreateUser(data);
          }
          setUserDialogOpen(false);
        }}
        isPending={isPending}
      />

      {/* Dialog de regla de comision */}
      <CommissionRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        rule={editingRule}
        onSubmit={async (data) => {
          if (editingRule) {
            await handleUpdateRule(editingRule.id, data);
          } else {
            await handleCreateRule(data);
          }
          setRuleDialogOpen(false);
        }}
        isPending={isPending}
      />
    </>
  );
}
