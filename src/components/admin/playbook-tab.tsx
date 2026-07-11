// Tab de administración del Playbook del bot: constructor de tareas de
// calificación con reordenamiento por drag & drop (@dnd-kit).
//
// v1: un único playbook "global" (B-T9 soporta N playbooks, pero el admin
// sólo edita el primero que exista — activar/desactivar sigue reflejando
// BotConfig.activePlaybookId con precisión aunque apunte a otro playbook).
"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { upsertPlaybook, setActivePlaybook } from "@/server/bot-playbook";
import { CAPTURE_TYPES } from "@/server/bot-playbook.schema";
import { NATIVE_TARGET_FIELDS } from "@/lib/bot/playbook/fields";
import type { CaptureType } from "@prisma/client";

// --- Tipos de datos recibidos del servidor -------------------------------

interface EnumOption {
  value: string;
  synonyms: string[];
}

export interface PlaybookTaskData {
  id: string;
  order: number;
  key: string;
  objective: string;
  targetField: string;
  captureType: CaptureType;
  enumOptions: unknown;
  extractionHint: string | null;
  required: boolean;
  skipIfFilled: boolean;
}

export interface PlaybookData {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  tasks: PlaybookTaskData[];
}

interface PlaybookTabProps {
  initialPlaybooks: PlaybookData[];
  activePlaybookId: string | null;
  customFields: string[];
}

// --- Estado local de edición por fila ------------------------------------

interface TaskRowState {
  uid: string; // id estable para dnd-kit (id de BotTask o uuid generado en cliente)
  objective: string;
  targetField: string;
  captureType: CaptureType;
  enumOptionsText: string;
  extractionHint: string | null;
  required: boolean;
  skipIfFilled: boolean;
}

const CAPTURE_TYPE_LABELS: Record<string, string> = {
  TEXT: "Texto",
  FULL_NAME: "Nombre completo",
  EMAIL: "Email",
  PHONE: "Teléfono",
  MONEY: "Monto",
  BUDGET_RANGE: "Rango de presupuesto",
  ENUM: "Enumeración (opciones)",
  ZONE: "Zona",
  BOOLEAN: "Sí / No",
  NUMBER: "Número",
};

// --- Helpers de conversión -------------------------------------------------

function toEnumOptionsArray(json: unknown): EnumOption[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
    .map((o) => ({
      value: String(o.value ?? ""),
      synonyms: Array.isArray(o.synonyms) ? o.synonyms.map(String) : [],
    }))
    .filter((o) => o.value.length > 0);
}

// "valor:sinónimo1,sinónimo2" por línea → [{value, synonyms}]
function parseEnumOptionsText(text: string): EnumOption[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return { value: line, synonyms: [] };
      const value = line.slice(0, idx).trim();
      const synonyms = line
        .slice(idx + 1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { value, synonyms };
    })
    .filter((o) => o.value.length > 0);
}

function enumOptionsToText(options: EnumOption[]): string {
  return options
    .map((o) => (o.synonyms.length > 0 ? `${o.value}:${o.synonyms.join(",")}` : o.value))
    .join("\n");
}

// slug simple: minúsculas, sin acentos, espacios → guion bajo
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function tasksToRows(tasks: PlaybookTaskData[]): TaskRowState[] {
  return tasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => ({
      uid: t.id,
      objective: t.objective,
      targetField: t.targetField,
      captureType: t.captureType,
      enumOptionsText: enumOptionsToText(toEnumOptionsArray(t.enumOptions)),
      extractionHint: t.extractionHint ?? null,
      required: t.required,
      skipIfFilled: t.skipIfFilled,
    }));
}

// --- Fila de tarea (sortable) ---------------------------------------------

function TaskRowItem({
  row,
  nativeFieldKeys,
  customFields,
  onChange,
  onTargetFieldChange,
  onRemove,
}: {
  row: TaskRowState;
  nativeFieldKeys: string[];
  customFields: string[];
  onChange: (patch: Partial<TaskRowState>) => void;
  onTargetFieldChange: (field: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.uid,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border bg-background p-3 ${isDragging ? "opacity-60" : ""}`}
    >
      <div className="flex gap-3">
        <button
          type="button"
          className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label="Reordenar tarea"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 space-y-3">
          <div className="space-y-1.5">
            <Label>Objetivo</Label>
            <Input
              value={row.objective}
              onChange={(e) => onChange({ objective: e.target.value })}
              placeholder="Ej. Obtener el correo electrónico del contacto"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Campo destino</Label>
              <Select value={row.targetField || undefined} onValueChange={onTargetFieldChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un campo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Nativos</SelectLabel>
                    {nativeFieldKeys.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customFields.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Custom</SelectLabel>
                      {customFields.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de captura</Label>
              <Select
                value={row.captureType}
                onValueChange={(v) => onChange({ captureType: v as CaptureType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTURE_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CAPTURE_TYPE_LABELS[c] ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {row.captureType === "ENUM" && (
            <div className="space-y-1.5">
              <Label>Opciones (una por línea: valor:sinónimo1,sinónimo2)</Label>
              <textarea
                className="form-input min-h-[80px] resize-y font-mono text-xs"
                value={row.enumOptionsText}
                onChange={(e) => onChange({ enumOptionsText: e.target.value })}
                placeholder={"DEPARTAMENTO:depa,depto\nCASA"}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.required}
                onChange={(e) => onChange({ required: e.target.checked })}
              />
              Obligatoria
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.skipIfFilled}
                onChange={(e) => onChange({ skipIfFilled: e.target.checked })}
              />
              Omitir si ya está lleno
            </label>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Eliminar tarea">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

// --- Componente principal --------------------------------------------------

export function PlaybookTab({ initialPlaybooks, activePlaybookId, customFields }: PlaybookTabProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [playbook, setPlaybook] = useState<PlaybookData | null>(initialPlaybooks[0] ?? null);
  const [activeId, setActiveId] = useState<string | null>(activePlaybookId);
  const [name, setName] = useState(playbook?.name ?? "Calificación");
  const [rows, setRows] = useState<TaskRowState[]>(playbook ? tasksToRows(playbook.tasks) : []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const isActive = playbook != null && activeId === playbook.id;
  const nativeFieldKeys = Object.keys(NATIVE_TARGET_FIELDS);

  function handleCreateBase() {
    startTransition(async () => {
      try {
        const created = await upsertPlaybook({ name: "Calificación", tasks: [] });
        setPlaybook(created as unknown as PlaybookData);
        setName(created.name);
        setRows(tasksToRows((created as unknown as PlaybookData).tasks ?? []));
        toast({ title: "Playbook creado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        objective: "",
        targetField: "",
        captureType: "TEXT" as CaptureType,
        enumOptionsText: "",
        extractionHint: null,
        required: true,
        skipIfFilled: true,
      },
    ]);
  }

  function removeRow(uid: string) {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  }

  function updateRow(uid: string, patch: Partial<TaskRowState>) {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }

  function handleTargetFieldChange(uid: string, field: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.uid !== uid) return r;
        const spec = NATIVE_TARGET_FIELDS[field];
        const captureType = (spec?.captureType ?? "TEXT") as CaptureType;
        const enumOptionsText =
          captureType === "ENUM"
            ? enumOptionsToText((spec?.enumValues ?? []).map((v) => ({ value: v, synonyms: [] })))
            : r.enumOptionsText;
        return { ...r, targetField: field, captureType, enumOptionsText };
      }),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const oldIndex = prev.findIndex((r) => r.uid === active.id);
      const newIndex = prev.findIndex((r) => r.uid === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function save() {
    startTransition(async () => {
      try {
        const usedKeys = new Set<string>();
        const tasks = rows.map((r, index) => {
          const base = slugify(r.objective) || `tarea_${index + 1}`;
          let key = base;
          let i = 2;
          while (usedKeys.has(key)) {
            key = `${base}_${i}`;
            i += 1;
          }
          usedKeys.add(key);

          return {
            key,
            order: index,
            objective: r.objective,
            targetField: r.targetField,
            captureType: r.captureType,
            enumOptions: r.captureType === "ENUM" ? parseEnumOptionsText(r.enumOptionsText) : [],
            extractionHint: r.extractionHint ?? undefined,
            required: r.required,
            skipIfFilled: r.skipIfFilled,
          };
        });

        const saved = await upsertPlaybook({
          id: playbook?.id,
          name: name.trim() || "Calificación",
          tasks,
        });

        const savedData = saved as unknown as PlaybookData;
        setPlaybook(savedData);
        setName(savedData.name);
        setRows(tasksToRows(savedData.tasks));
        toast({ title: "Playbook guardado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  function toggleActive() {
    if (!playbook) return;
    startTransition(async () => {
      try {
        const nextId = isActive ? null : playbook.id;
        await setActivePlaybook(nextId);
        setActiveId(nextId);
        toast({ title: nextId ? "Playbook activado" : "Playbook desactivado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  if (!playbook) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Playbook</CardTitle>
          <CardDescription>
            Aún no existe un playbook de calificación. Crea uno base para empezar a definir
            las tareas que el bot debe cumplir con cada contacto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCreateBase} disabled={pending}>
            {pending ? "Creando…" : "Crear playbook base"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{name || "Playbook"}</CardTitle>
            <CardDescription>
              Secuencia de tareas que el bot ejecuta para calificar a un contacto.
            </CardDescription>
          </div>
          <Button variant={isActive ? "outline" : "default"} onClick={toggleActive} disabled={pending}>
            {isActive ? "Desactivar" : "Activar este playbook"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tareas</CardTitle>
          <CardDescription>Arrastra el ícono para reordenar. El bot las ejecuta en este orden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={rows.map((r) => r.uid)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {rows.map((row) => (
                  <TaskRowItem
                    key={row.uid}
                    row={row}
                    nativeFieldKeys={nativeFieldKeys}
                    customFields={customFields}
                    onChange={(patch) => updateRow(row.uid, patch)}
                    onTargetFieldChange={(field) => handleTargetFieldChange(row.uid, field)}
                    onRemove={() => removeRow(row.uid)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Este playbook no tiene tareas todavía.
            </p>
          )}

          <Button variant="outline" onClick={addRow} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar tarea
          </Button>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
