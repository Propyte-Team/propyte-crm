// Flujo de LECTURA de una regla (J2): el borrador convertido a nodos y aristas para dibujarlo de arriba
// hacia abajo. No sustituye a `draftToFlow` ni toca el formato guardado: es solo una vista.
//   · «Cuando…» (disparador) y «Si…» (condiciones, solo si las hay).
//   · Una espera visible antes de cada acción con retraso.
//   · Decisiones con ramas etiquetadas; si hay pasos después de la decisión, las ramas se juntan.
import { describeAction } from "@/lib/workflows/action-catalog";
import { describeConditions } from "@/lib/workflows/condition-catalog";
import { describeTrigger } from "@/lib/workflows/trigger-catalog";
import type { Flow, RFEdge, RFNode } from "./flow-adapter";
import { isDecisionDraft, type NodeDraft, type RuleDraft } from "./rule-draft";

/** «Esperar 2 días», «Esperar 3 horas», «Esperar 1 hora y 30 min». */
export function textoEspera(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const partes: string[] = [];
  if (d > 0) partes.push(`${d} ${d === 1 ? "día" : "días"}`);
  if (h > 0) partes.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m > 0) partes.push(`${m} min`);
  if (partes.length === 0) return "Esperar un momento";
  return `Esperar ${partes.slice(0, 2).join(" y ")}`;
}

function sinCondiciones(c: unknown): boolean {
  if (!c || typeof c !== "object") return true;
  const o = c as Record<string, unknown>;
  const all = Array.isArray(o.all) ? o.all.length : 0;
  const any = Array.isArray(o.any) ? o.any.length : 0;
  return all === 0 && any === 0 && typeof o.field !== "string";
}

/** Punto del que cuelga lo que sigue. `label`/`branchId` solo marcan la primera línea que sale de ahí. */
interface Cola { id: string; label?: string; branchId?: string; vacia?: boolean }

const mayuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export interface OpcionesDeFlujo {
  /**
   * Para editar (J3): el «Si» aparece siempre (con «aplica siempre» si no hay condiciones, para poder
   * abrirlo) y un nodo «Fin» recoge los finales para poder agregar pasos al final.
   */
  edicion?: boolean;
}

export function draftToReadFlow(draft: RuleDraft, opts: OpcionesDeFlujo = {}): Flow {
  const edicion = opts.edicion === true;
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  const usados = new Set<string>();
  const pos = { x: 0, y: 0 };

  const nodo = (id: string, type: string, data: Record<string, unknown>) => {
    nodes.push({ id, type, position: pos, data });
  };
  const unir = (colas: Cola[], target: string) => {
    for (const c of colas) {
      let id = `${c.id}->${target}`;
      for (let k = 2; usados.has(id); k++) id = `${c.id}->${target}#${k}`;
      usados.add(id);
      const data = c.label || c.branchId ? { ...(c.label ? { label: c.label } : {}), ...(c.branchId ? { branchId: c.branchId } : {}) } : undefined;
      edges.push({ id, source: c.id, target, ...(data ? { data } : {}) });
    }
  };

  nodo("trigger", "trigger", {
    titulo: "Cuando",
    texto: mayuscula(describeTrigger(draft.triggerType, draft.triggerConfig)),
  });
  let colas: Cola[] = [{ id: "trigger" }];
  // Retraso del disparador (p. ej. WF4: 48 h después de la visita). Va antes del «Si»: el motor
  // evalúa las condiciones al cumplirse la espera.
  const esperaDisparo = Number((draft.triggerConfig as Record<string, unknown> | undefined)?.delayMinutes ?? 0);
  if (esperaDisparo > 0) {
    nodo("trigger~espera", "wait", { titulo: "Espera", texto: textoEspera(esperaDisparo), minutos: esperaDisparo });
    unir(colas, "trigger~espera");
    colas = [{ id: "trigger~espera" }];
  }
  if (edicion || !sinCondiciones(draft.conditions)) {
    nodo("condition", "condition", {
      titulo: "Si",
      texto: sinCondiciones(draft.conditions) ? "Sin condiciones: aplica siempre" : mayuscula(describeConditions(draft.conditions)),
    });
    unir(colas, "condition");
    colas = [{ id: "condition" }];
  }

  function emitir(lista: NodeDraft[], entrada: Cola[]): Cola[] {
    let actuales = entrada;
    for (const n of lista) {
      if (isDecisionDraft(n)) {
        nodo(n.nodeId, "decision", { titulo: "Decisión", texto: n.label?.trim() || "¿Qué sigue?" });
        unir(actuales, n.nodeId);
        const unica = n.branches.length === 1;
        const salidas: Cola[] = [];
        n.branches.forEach((b, i) => {
          const etiqueta = b.label?.trim() || (unica ? "Sí" : `Rama ${i + 1}`);
          const entra: Cola = { id: n.nodeId, label: etiqueta, branchId: b.branchId };
          salidas.push(...(b.steps.length > 0 ? emitir(b.steps, [entra]) : [{ ...entra, vacia: true }]));
        });
        if (n.else) {
          const entra: Cola = { id: n.nodeId, label: unica ? "No" : "En otro caso", branchId: `${n.nodeId}.else` };
          salidas.push(...(n.else.length > 0 ? emitir(n.else, [entra]) : [{ ...entra, vacia: true }]));
        }
        // Sin «si no» no hay salida propia: lo que sigue cuelga solo de las ramas.
        actuales = salidas.length > 0 ? salidas : [{ id: n.nodeId }];
        continue;
      }
      const minutos = n.delayMinutes ?? (typeof n.config?.delayMinutes === "number" ? (n.config.delayMinutes as number) : 0);
      if (minutos > 0) {
        const idEspera = `${n.nodeId}~espera`;
        nodo(idEspera, "wait", { titulo: "Espera", texto: textoEspera(minutos), minutos });
        unir(actuales, idEspera);
        actuales = [{ id: idEspera }];
      }
      nodo(n.nodeId, n.type === "CHANGE_STAGE" ? "stage" : "action", {
        titulo: "Entonces",
        texto: mayuscula(describeAction({ type: n.type, config: n.config })),
        actionType: n.type,
        config: n.config,
      });
      unir(actuales, n.nodeId);
      actuales = [{ id: n.nodeId }];
    }
    return actuales;
  }

  const finales = emitir(draft.actions, colas);
  if (edicion) {
    const sueltos = finales.filter((c) => !c.vacia);
    if (sueltos.length > 0) {
      nodo("fin", "fin", { titulo: "", texto: "Fin" });
      unir(sueltos, "fin");
    }
  }
  // Ramas vacías que nada recoge después: se marcan para que la etiqueta no quede colgando.
  finales.filter((c) => c.vacia).forEach((c, i) => {
    const id = `${c.id}~vacio${i}`;
    nodo(id, "empty", { titulo: "", texto: "No hace nada" });
    unir([{ ...c, vacia: false }], id);
  });
  return { nodes, edges };
}
