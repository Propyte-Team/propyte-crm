// Tab de administración del Playbook del bot: constructor de tareas de
// calificación con reordenamiento por drag & drop (@dnd-kit).
//
// Soporta N playbooks (B-T9): un selector elige cuál se edita/activa/borra.
// Activar/desactivar refleja BotConfig.activePlaybookId con precisión aunque
// el playbook activo no sea el seleccionado en el editor.
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
import { useConfirm } from "@/components/ui/confirm-dialog";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { upsertPlaybook, setActivePlaybook, deletePlaybook } from "@/server/bot-playbook";
import { CAPTURE_TYPES } from "@/server/bot-playbook.schema";
import { NATIVE_TARGET_FIELDS, isNativeTarget } from "@/lib/bot/playbook/fields";
import {
  agregarSinonimos,
  errorDeOpciones,
  etiquetaDeValor,
  leerOpciones,
  opcionesDeFabrica,
  opcionesParaGuardar,
  quitarSinonimo,
  tieneValoresFijos,
  type OpcionEnum,
} from "./playbook-options";
import type { CaptureType } from "@prisma/client";

// --- Tipos de datos recibidos del servidor -------------------------------

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
  key?: string; // key persistida de BotTask; ausente = fila nueva, aún sin key asignada
  objective: string;
  targetField: string;
  captureType: CaptureType;
  enumOptions: OpcionEnum[];
  extractionHint: string | null;
  required: boolean;
  skipIfFilled: boolean;
}

const CAPTURE_TYPE_LABELS: Record<string, string> = {
  TEXT: "Texto",
  FULL_NAME: "Nombre completo",
  EMAIL: "Correo",
  PHONE: "Teléfono",
  MONEY: "Monto",
  BUDGET_RANGE: "Rango de presupuesto",
  ENUM: "Elegir de una lista",
  ZONE: "Zona",
  BOOLEAN: "Sí / No",
  NUMBER: "Número",
};

// Etiquetas en español de los datos del contacto que el bot puede llenar. La clave técnica
// queda solo como tooltip; un campo sin etiqueta aquí se muestra con su clave.
const FIELD_LABELS: Record<string, string> = {
  firstName: "Nombre",
  lastName: "Apellido",
  email: "Correo",
  phone: "Teléfono",
  residenceCity: "Ciudad de residencia",
  budgetMin: "Presupuesto mínimo",
  budgetMax: "Presupuesto máximo",
  preferredZone: "Zona de interés",
  propertyType: "Tipo de propiedad",
  purchaseTimeline: "Cuándo piensa comprar",
  paymentMethod: "Forma de pago",
  purchaseModality: "Modalidad de compra",
  rentalStrategy: "Estrategia de renta",
  investmentProfile: "Perfil de inversión",
  contactType: "Tipo de contacto",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

const MAX_TASKS = 30;
const MAX_OBJECTIVE = 500;

// --- Helpers de conversión -------------------------------------------------

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
      // Preservar la key persistida: ConversationPlaybookState.completedTaskKeys
      // referencia tareas por key, no por id. Si se regenerara al guardar,
      // editar wording o reordenar desincroniza conversaciones en curso.
      key: t.key,
      objective: t.objective,
      targetField: t.targetField,
      captureType: t.captureType,
      enumOptions: leerOpciones(t.enumOptions),
      extractionHint: t.extractionHint ?? null,
      required: t.required,
      skipIfFilled: t.skipIfFilled,
    }));
}

// Mensaje de un error lanzado por una server action; nunca "Error" a secas ni JSON de validación.
function errorLegible(error: unknown): string {
  const msg = error instanceof Error ? error.message : "";
  if (!msg || msg.startsWith("[") || msg.startsWith("{")) return "Revisa los datos e intenta de nuevo.";
  return msg;
}

// --- Editor de opciones (filas: opción + sinónimos en chips) -----------------

function OpcionesEditor({
  targetField,
  opciones,
  onChange,
}: {
  targetField: string;
  opciones: OpcionEnum[];
  onChange: (next: OpcionEnum[]) => void;
}) {
  const fijas = tieneValoresFijos(targetField);
  const [borradores, setBorradores] = useState<Record<number, string>>({});

  function patchFila(i: number, patch: Partial<OpcionEnum>) {
    onChange(opciones.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function confirmarSinonimos(i: number) {
    const texto = borradores[i] ?? "";
    if (!texto.trim()) return;
    patchFila(i, { synonyms: agregarSinonimos(opciones[i].synonyms, texto, opciones[i].value) });
    setBorradores((b) => ({ ...b, [i]: "" }));
  }

  return (
    <div className="space-y-2">
      <Label>Opciones que el bot puede elegir</Label>
      <div className="space-y-2">
        {opciones.map((o, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
            <div className="w-48 shrink-0">
              {fijas ? (
                <span className="block pt-1.5 text-sm font-medium" title={o.value}>
                  {etiquetaDeValor(targetField, o.value)}
                </span>
              ) : (
                <Input
                  value={o.value}
                  aria-label="Opción"
                  placeholder="Opción"
                  onChange={(e) => patchFila(i, { value: e.target.value })}
                />
              )}
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {o.synonyms.map((sn) => (
                  <span key={sn} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                    {sn}
                    <button
                      type="button"
                      aria-label={"Quitar " + sn}
                      onClick={() => patchFila(i, { synonyms: quitarSinonimo(o.synonyms, sn) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <Input
                value={borradores[i] ?? ""}
                aria-label="Otras formas en que el cliente lo dice"
                placeholder="Cómo lo dice el cliente (Enter para agregar)"
                onChange={(e) => setBorradores((b) => ({ ...b, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    confirmarSinonimos(i);
                  }
                }}
                onBlur={() => confirmarSinonimos(i)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Quitar opción"
              title="Quitar opción"
              onClick={() => onChange(opciones.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        ))}
        {opciones.length === 0 && <p className="text-xs text-muted-foreground">Sin opciones todavía.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!fijas && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...opciones, { value: "", synonyms: [] }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Agregar opción
          </Button>
        )}
        {fijas && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(opcionesDeFabrica(targetField))}>
            Restaurar opciones
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {fijas
          ? "Las opciones son las del sistema. En cada una agrega las palabras con que el cliente suele decirlo (por ejemplo «depa» para Departamento)."
          : "Escribe cada opción y, debajo, las otras formas en que el cliente la dice."}
      </p>
    </div>
  );
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
          aria-label="Reordenar pregunta"
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
              maxLength={MAX_OBJECTIVE}
              onChange={(e) => onChange({ objective: e.target.value })}
              placeholder="Ej. Obtener el correo electrónico del contacto"
            />
            <p className="text-right text-[10px] text-muted-foreground">
              {row.objective.length}/{MAX_OBJECTIVE}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Dónde se guarda el dato</Label>
              <Select
                value={row.captureType === "FULL_NAME" ? "firstName" : row.targetField || undefined}
                onValueChange={onTargetFieldChange}
                disabled={row.captureType === "FULL_NAME"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un campo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Del contacto</SelectLabel>
                    {nativeFieldKeys.map((f) => (
                      <SelectItem key={f} value={f} title={f}>
                        {fieldLabel(f)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customFields.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Personalizados</SelectLabel>
                      {customFields.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {row.captureType === "FULL_NAME" && (
                <p className="text-xs text-muted-foreground">
                  Con «Nombre completo» el bot guarda el nombre y, si lo dan, el apellido.
                </p>
              )}
            </div>

            {!isNativeTarget(row.targetField) && (
            <div className="space-y-1.5">
              <Label>Cómo interpreta la respuesta</Label>
              <Select
                value={row.captureType}
                onValueChange={(v) => {
                  const captureType = v as CaptureType;
                  // FULL_NAME siempre escribe firstName/lastName (capture.ts lo
                  // ignora targetField) — bloquear el campo destino evita que el
                  // admin elija un campo con el que nunca coincidirá el efecto.
                  onChange(
                    captureType === "FULL_NAME"
                      ? { captureType, targetField: "firstName" }
                      : { captureType },
                  );
                }}
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
            )}
          </div>

          {row.captureType === "ENUM" && (
            <OpcionesEditor
              targetField={row.targetField}
              opciones={row.enumOptions}
              onChange={(enumOptions) => onChange({ enumOptions })}
            />
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
            <label
              className="flex items-center gap-2 text-sm"
              title="Si el contacto ya tiene este dato guardado, el bot no vuelve a preguntarlo."
            >
              <input
                type="checkbox"
                checked={row.skipIfFilled}
                onChange={(e) => onChange({ skipIfFilled: e.target.checked })}
              />
              No preguntar si ya lo sabemos
            </label>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Eliminar pregunta" title="Eliminar pregunta">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

// --- Componente principal --------------------------------------------------

export function PlaybookTab({ initialPlaybooks, activePlaybookId, customFields }: PlaybookTabProps) {
  const { toast } = useToast();
  const confirmar = useConfirm();
  const [pending, startTransition] = useTransition();

  // Lista local de playbooks (v1 ya no edita solo initialPlaybooks[0]: soporta
  // N playbooks vía selector). Se mantiene sincronizada a mano en cada
  // create/save/delete para no depender de window.location.reload().
  const [playbooks, setPlaybooks] = useState<PlaybookData[]>(initialPlaybooks);
  const [activeId, setActiveId] = useState<string | null>(activePlaybookId);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(() => {
    if (activePlaybookId && initialPlaybooks.some((p) => p.id === activePlaybookId)) {
      return activePlaybookId;
    }
    return initialPlaybooks[0]?.id ?? null;
  });

  const playbook = playbooks.find((p) => p.id === selectedPlaybookId) ?? null;

  const [name, setName] = useState(playbook?.name ?? "Calificación");
  const [rows, setRows] = useState<TaskRowState[]>(playbook ? tasksToRows(playbook.tasks) : []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const isActive = playbook != null && activeId === playbook.id;
  const nativeFieldKeys = Object.keys(NATIVE_TARGET_FIELDS);

  // Cambia el playbook en edición: carga su nombre/tareas en el estado local.
  function selectPlaybook(id: string) {
    const next = playbooks.find((p) => p.id === id) ?? null;
    setSelectedPlaybookId(id);
    setName(next?.name ?? "Calificación");
    setRows(next ? tasksToRows(next.tasks) : []);
  }

  function handleCreateBase() {
    startTransition(async () => {
      try {
        const created = (await upsertPlaybook({ name: "Calificación", tasks: [] })) as unknown as PlaybookData;
        setPlaybooks((prev) => [created, ...prev]);
        setSelectedPlaybookId(created.id);
        setName(created.name);
        setRows(tasksToRows(created.tasks ?? []));
        toast({ title: "Playbook creado" });
      } catch (error: any) {
        toast({ title: "No se pudo crear el playbook", description: errorLegible(error), variant: "destructive" });
      }
    });
  }

  async function handleDeletePlaybook() {
    if (!playbook) return;
    const ok = await confirmar({
      titulo: `¿Eliminar el playbook "${playbook.name}"?`,
      descripcion:
        playbook.id === activeId
          ? "Es el playbook activo: si lo eliminas, el bot dejará de calificar contactos hasta que actives otro. No se puede deshacer."
          : "Revisa antes que ninguna marca o agente lo esté usando. No se puede deshacer.",
      confirmar: "Eliminar playbook",
      peligroso: true,
    });
    if (!ok) return;
    const deletedId = playbook.id;
    startTransition(async () => {
      try {
        await deletePlaybook(deletedId);
        const remaining = playbooks.filter((p) => p.id !== deletedId);
        setPlaybooks(remaining);
        if (activeId === deletedId) setActiveId(null);
        const next = remaining[0] ?? null;
        setSelectedPlaybookId(next?.id ?? null);
        setName(next?.name ?? "Calificación");
        setRows(next ? tasksToRows(next.tasks) : []);
        toast({ title: "Playbook eliminado" });
      } catch (error: any) {
        toast({ title: "No se pudo eliminar el playbook", description: errorLegible(error), variant: "destructive" });
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
        enumOptions: [],
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
        // Campo nativo con lista fija: se cargan sus opciones de fábrica; si no, se conservan las que había.
        const enumOptions = captureType === "ENUM" ? opcionesDeFabrica(field) : r.enumOptions;
        return { ...r, targetField: field, captureType, enumOptions };
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
    // Validación antes de mandar: así el aviso dice qué pregunta falla, no un error técnico.
    if (rows.length > MAX_TASKS) {
      toast({
        title: "Demasiadas preguntas",
        description: `Un playbook admite máximo ${MAX_TASKS} preguntas; tienes ${rows.length}. Quita algunas.`,
        variant: "destructive",
      });
      return;
    }
    const sinObjetivo = rows.findIndex((r) => !r.objective.trim());
    if (sinObjetivo !== -1) {
      toast({
        title: "Falta el objetivo",
        description: `La pregunta ${sinObjetivo + 1} no tiene objetivo. Escribe qué debe averiguar el bot.`,
        variant: "destructive",
      });
      return;
    }
    const sinCampo = rows.findIndex((r) => r.captureType !== "FULL_NAME" && !r.targetField);
    if (sinCampo !== -1) {
      toast({
        title: "Falta dónde guardar el dato",
        description: `La pregunta ${sinCampo + 1} no tiene un campo elegido en «Dónde se guarda el dato».`,
        variant: "destructive",
      });
      return;
    }
    const filaConLista = rows.findIndex((r) => r.captureType === "ENUM" && errorDeOpciones(r.enumOptions));
    if (filaConLista !== -1) {
      toast({
        title: "Revisa las opciones",
        description: `La pregunta ${filaConLista + 1}: ${errorDeOpciones(rows[filaConLista].enumOptions)}`,
        variant: "destructive",
      });
      return;
    }
    startTransition(async () => {
      try {
        // Keys ya asignadas (filas cargadas de DB) van primero al set para que
        // las filas nuevas nunca colisionen contra ellas.
        const usedKeys = new Set<string>(rows.filter((r) => r.key).map((r) => r.key as string));

        const tasks = rows.map((r, index) => {
          // Filas existentes conservan su key intacta: completedTaskKeys en
          // ConversationPlaybookState referencia tareas por key, no por id, así
          // que regenerarla al editar wording/reordenar desincroniza
          // conversaciones en curso (el bot re-pregunta o salta mal).
          let key = r.key;
          if (!key) {
            const base = slugify(r.objective) || `tarea_${index + 1}`;
            let candidate = base;
            let i = 2;
            while (usedKeys.has(candidate)) {
              candidate = `${base}_${i}`;
              i += 1;
            }
            key = candidate;
            usedKeys.add(key);
          }

          return {
            key,
            order: index,
            objective: r.objective,
            // FULL_NAME siempre escribe firstName/lastName (capture.ts ignora
            // targetField) — normalizar aquí también por si la fila viene de
            // datos previos a este fix con un targetField desalineado.
            targetField: r.captureType === "FULL_NAME" ? "firstName" : r.targetField,
            captureType: r.captureType,
            enumOptions: r.captureType === "ENUM" ? opcionesParaGuardar(r.enumOptions) : [],
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
        setPlaybooks((prev) => {
          const exists = prev.some((p) => p.id === savedData.id);
          return exists
            ? prev.map((p) => (p.id === savedData.id ? savedData : p))
            : [savedData, ...prev];
        });
        setSelectedPlaybookId(savedData.id);
        setName(savedData.name);
        setRows(tasksToRows(savedData.tasks));
        toast({ title: "Playbook guardado" });
      } catch (error: any) {
        toast({ title: "No se pudo guardar el playbook", description: errorLegible(error), variant: "destructive" });
      }
    });
  }

  async function toggleActive() {
    if (!playbook) return;
    if (isActive) {
      const ok = await confirmar({
        titulo: `¿Desactivar el playbook "${playbook.name}"?`,
        descripcion: "El bot dejará de calificar con este playbook hasta que actives otro.",
        confirmar: "Desactivar",
        peligroso: true,
      });
      if (!ok) return;
    }
    const nextId = isActive ? null : playbook.id;
    startTransition(async () => {
      try {
        await setActivePlaybook(nextId);
        setActiveId(nextId);
        toast({ title: nextId ? "Playbook activado" : "Playbook desactivado" });
      } catch (error: any) {
        toast({
          title: nextId ? "No se pudo activar el playbook" : "No se pudo desactivar el playbook",
          description: errorLegible(error),
          variant: "destructive",
        });
      }
    });
  }

  if (!playbook) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Playbook</CardTitle>
          <CardDescription>
            Aún no existe un playbook de calificación (la lista de preguntas con las que el bot conoce a cada
            contacto). Crea uno base para empezar a definirlas.
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
        <CardHeader>
          <CardTitle className="text-lg">Playbooks</CardTitle>
          <CardDescription>Elige cuál playbook editar. Solo uno puede ser el general (activo); marcas y agentes pueden usar otro.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <Label>Playbook</Label>
            <Select value={selectedPlaybookId ?? undefined} onValueChange={selectPlaybook}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un playbook" />
              </SelectTrigger>
              <SelectContent>
                {playbooks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.id === activeId ? " (activo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={handleCreateBase} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" />
            Crear playbook base
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{name || "Playbook"}</CardTitle>
            <CardDescription>
              Preguntas que el bot hace, en orden, para conocer a un contacto. Activar no guarda los cambios de abajo: guarda primero.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant={isActive ? "outline" : "default"} onClick={toggleActive} disabled={pending}>
              {isActive ? "Desactivar" : "Activar este playbook"}
            </Button>
            <Button variant="ghost" onClick={handleDeletePlaybook} disabled={pending}>
              <Trash2 className="mr-2 h-3.5 w-3.5 text-red-500" />
              Eliminar playbook
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preguntas del bot</CardTitle>
          <CardDescription>Arrastra el ícono para reordenar. El bot las hace en este orden (máximo 30).</CardDescription>
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
              Este playbook todavía no tiene preguntas.
            </p>
          )}

          <Button variant="outline" onClick={addRow} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar pregunta
          </Button>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
