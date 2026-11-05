"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { erroresPorCampo, mensajeDeError } from "@/lib/api-errors";
import {
  type RuleDraft, type RuleRow, ruleToDraft, draftToRulePayload, newRuleDraft,
  addAction, insertAction, removeAction, reorderAction, setActionConfig, setActionType, setActionDelay, setTrigger, setConditions, setMeta,
  addDecision, removeNode, setDecisionLabel, addBranch, removeBranch, setBranchLabel, setBranchConditions, addActionToBranch, setElseEnabled, addActionToElse,
  insertActionAt, insertDecisionAt, setEspera, conservarEsperaDeDisparador, type PuntoDeInsercion,
  type Conditions,
} from "@/lib/journey/rule-draft";

export function useRuleDraft() {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errores por campo de la API (p. ej. { name: "Debe tener al menos 3 caracteres" }); aditivo, el inspector puede ignorarlo.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback((row: RuleRow) => {
    const d = ruleToDraft(row);
    setDraft(d);
    setBaseline(JSON.stringify(draftToRulePayload(d)));
    setError(null);
    setFieldErrors({});
  }, []);

  /** Carga un draft ya armado (p. ej. convertido desde el constructor lineal). Sin id: siempre "sin guardar". */
  const loadDraft = useCallback((d: RuleDraft) => {
    setDraft(d);
    setBaseline(d.id ? JSON.stringify(draftToRulePayload(d)) : "");
    setError(null);
    setFieldErrors({});
  }, []);

  // Ultima regla persistida por save(): el editor la entrega a onSaved.
  const lastSaved = useRef<RuleRow | null>(null);

  const startNew = useCallback(() => {
    const d = newRuleDraft();
    setDraft(d);
    setBaseline(""); // siempre dirty
    setError(null);
    setFieldErrors({});
  }, []);

  const isDirty = useMemo(
    () => (draft ? JSON.stringify(draftToRulePayload(draft)) !== baseline : false),
    [draft, baseline],
  );

  const ops = useMemo(() => ({
    addAction: (type: string) => setDraft((d) => (d ? addAction(d, type) : d)),
    insertAction: (type: string, at: number) => setDraft((d) => (d ? insertAction(d, type, at) : d)),
    removeAction: (nodeId: string) => setDraft((d) => (d ? removeAction(d, nodeId) : d)),
    reorderAction: (nodeId: string, dir: "up" | "down") => setDraft((d) => (d ? reorderAction(d, nodeId, dir) : d)),
    setActionConfig: (nodeId: string, patch: Record<string, unknown>) => setDraft((d) => (d ? setActionConfig(d, nodeId, patch) : d)),
    setActionType: (nodeId: string, type: string) => setDraft((d) => (d ? setActionType(d, nodeId, type) : d)),
    setActionDelay: (nodeId: string, minutes: number) => setDraft((d) => (d ? setActionDelay(d, nodeId, minutes) : d)),
    setTrigger: (t: { triggerType: string; triggerConfig: Record<string, unknown> }) => setDraft((d) => (d ? setTrigger(d, t) : d)),
    setConditions: (c: Conditions) => setDraft((d) => (d ? setConditions(d, c) : d)),
    setMeta: (patch: Parameters<typeof setMeta>[1]) => setDraft((d) => (d ? setMeta(d, patch) : d)),
    // Decision ops (T12)
    addDecision: () => setDraft((d) => (d ? addDecision(d) : d)),
    removeNode: (nodeId: string) => setDraft((d) => (d ? removeNode(d, nodeId) : d)),
    setDecisionLabel: (nodeId: string, label: string) => setDraft((d) => (d ? setDecisionLabel(d, nodeId, label) : d)),
    addBranch: (decisionNodeId: string) => setDraft((d) => (d ? addBranch(d, decisionNodeId) : d)),
    removeBranch: (branchId: string) => setDraft((d) => (d ? removeBranch(d, branchId) : d)),
    setBranchLabel: (branchId: string, label: string) => setDraft((d) => (d ? setBranchLabel(d, branchId, label) : d)),
    setBranchConditions: (branchId: string, c: Conditions) => setDraft((d) => (d ? setBranchConditions(d, branchId, c) : d)),
    addActionToBranch: (branchId: string, type: string) => setDraft((d) => (d ? addActionToBranch(d, branchId, type) : d)),
    setElseEnabled: (decisionNodeId: string, enabled: boolean) => setDraft((d) => (d ? setElseEnabled(d, decisionNodeId, enabled) : d)),
    addActionToElse: (decisionNodeId: string, type: string) => setDraft((d) => (d ? addActionToElse(d, decisionNodeId, type) : d)),
    // Edición en el lienzo de /journey (J3)
    insertActionAt: (punto: PuntoDeInsercion, type: string) => setDraft((d) => (d ? insertActionAt(d, punto, type) : d)),
    insertDecisionAt: (punto: PuntoDeInsercion) => setDraft((d) => (d ? insertDecisionAt(d, punto) : d)),
    setEspera: (objetivo: string, minutos: number) => setDraft((d) => (d ? setEspera(d, objetivo, minutos) : d)),
    // Cambiar de disparador sin perder su espera (la espera no es parte de lo que se elige).
    setTriggerConEspera: (t: { triggerType: string; triggerConfig: Record<string, unknown> }) =>
      setDraft((d) => (d ? setTrigger(d, { triggerType: t.triggerType, triggerConfig: conservarEsperaDeDisparador(d.triggerConfig, t.triggerConfig) }) : d)),
  }), []);

  /**
   * La regla se encendió o apagó por su propia vía (PATCH): se refleja en el borrador y en la base de
   * comparación, para que eso no cuente como «cambio sin guardar».
   */
  const syncActive = useCallback((isActive: boolean) => {
    setDraft((d) => (d ? { ...d, isActive } : d));
    setBaseline((b) => {
      if (!b) return b;
      try {
        const o = JSON.parse(b) as Record<string, unknown>;
        o.isActive = isActive;
        return JSON.stringify(o);
      } catch { return b; }
    });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setError(null);
    setFieldErrors({});
    // La API exige nombre de al menos 3 caracteres: se avisa antes de ir al servidor.
    if (draft.name.trim().length < 3) {
      setFieldErrors({ name: "Debe tener al menos 3 caracteres" });
      setError("Nombre: debe tener al menos 3 caracteres");
      return false;
    }
    setSaving(true);
    const payload = draftToRulePayload(draft);
    const method = draft.id ? "PUT" : "POST";
    let res: Response;
    try {
      res = await fetch("/api/admin/automation/rules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setSaving(false);
      setError("No se pudo guardar: sin conexión");
      return false;
    }
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // La API de reglas manda { error: "Datos inválidos", details: <zod flatten> }: los campos
      // viven en `details`, no en `error`. erroresPorCampo/mensajeDeError esperan `error`, así que se adapta.
      const detalle = body?.details ? { error: body.details } : null;
      const porCampo = detalle ? erroresPorCampo(detalle) : {};
      setFieldErrors(porCampo);
      setError(detalle ? mensajeDeError(detalle, body?.error ?? "No se pudo guardar") : mensajeDeError(body, "No se pudo guardar"));
      return false;
    }
    const body = await res.json();
    lastSaved.current = body.data as RuleRow;
    load(body.data); // re-sincroniza baseline desde la fila persistida
    return true;
  }, [draft, load]);

  const discard = useCallback(() => setDraft(null), []);

  return { draft, isDirty, saving, error, fieldErrors, load, loadDraft, lastSaved, startNew, ops, save, discard, syncActive };
}
