"use client";
import { useCallback, useMemo, useState } from "react";
import {
  type RuleDraft, type RuleRow, ruleToDraft, draftToRulePayload, newRuleDraft,
  addAction, insertAction, removeAction, reorderAction, setActionConfig, setActionType, setActionDelay, setTrigger, setConditions, setMeta,
  addDecision, removeNode, setDecisionLabel, addBranch, removeBranch, setBranchLabel, setBranchConditions, addActionToBranch,
  type Conditions,
} from "@/lib/journey/rule-draft";

export function useRuleDraft() {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((row: RuleRow) => {
    const d = ruleToDraft(row);
    setDraft(d);
    setBaseline(JSON.stringify(draftToRulePayload(d)));
    setError(null);
  }, []);

  const startNew = useCallback(() => {
    const d = newRuleDraft();
    setDraft(d);
    setBaseline(""); // siempre dirty
    setError(null);
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
  }), []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    setError(null);
    const payload = draftToRulePayload(draft);
    const method = draft.id ? "PUT" : "POST";
    const res = await fetch("/api/admin/automation/rules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "No se pudo guardar");
      return false;
    }
    const body = await res.json();
    load(body.data); // re-sincroniza baseline desde la fila persistida
    return true;
  }, [draft, load]);

  const discard = useCallback(() => setDraft(null), []);

  return { draft, isDirty, saving, error, load, startNew, ops, save, discard };
}
