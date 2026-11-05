// Validación del borrador de una regla para el lienzo de /journey (J3). Pura.
// Dice qué pasos están incompletos (para pintarlos en rojo con «Falta …») y arma el resumen que
// explica por qué «Guardar» está deshabilitado. Usa los mismos catálogos que el constructor de
// Configuración: lo que aquí es obligatorio es lo que el catálogo marca como obligatorio.
import { accionPorTipo, validarAccion, type FuentesDeAccion } from "@/lib/workflows/action-catalog";
import { validarCondiciones } from "@/lib/workflows/condition-catalog";
import { disparadorDesde, validarDisparador } from "@/lib/workflows/trigger-catalog";
import { isDecisionDraft, type NodeDraft, type RuleDraft } from "./rule-draft";

export interface ResultadoDeBorrador {
  ok: boolean;
  /** Texto corto por paso incompleto (id del paso → «Falta elegir la etapa»). */
  porNodo: Record<string, string>;
  /** Todo lo que falta, en frases, para el resumen de arriba. */
  faltantes: string[];
}

const mayuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Quita el prefijo «Enviar WhatsApp: » de un problema para que el paso diga solo «Falta …». */
export function textoCorto(problema: string): string {
  const i = problema.indexOf(": ");
  const sinPrefijo = i > 0 && i < 40 ? problema.slice(i + 2) : problema;
  return mayuscula(sinPrefijo.trim());
}

function resumirProblemas(problemas: string[]): string {
  const primero = textoCorto(problemas[0]);
  return problemas.length > 1 ? `${primero} (y ${problemas.length - 1} más)` : primero;
}

export function validarBorrador(draft: RuleDraft, fuentes?: FuentesDeAccion): ResultadoDeBorrador {
  const porNodo: Record<string, string> = {};
  const faltantes: string[] = [];
  const marcar = (id: string, problemas: string[], contexto: string) => {
    if (problemas.length === 0) return;
    porNodo[id] = resumirProblemas(problemas);
    for (const p of problemas) faltantes.push(`${contexto}: ${textoCorto(p)}`);
  };

  if (draft.name.trim().length < 3) faltantes.push("Nombre de la regla: debe tener al menos 3 caracteres");

  const elegido = disparadorDesde(draft.triggerType, draft.triggerConfig);
  marcar("trigger", validarDisparador(elegido.key, elegido.valor).problemas, "Cuándo");
  const espera = Number((draft.triggerConfig as Record<string, unknown> | undefined)?.delayMinutes ?? 0);
  if (Number.isFinite(espera) && espera < 0) marcar("trigger", ["La espera debe ser de 0 minutos o más"], "Cuándo");

  marcar("condition", validarCondiciones(draft.conditions).problemas, "Si");

  const recorrer = (lista: NodeDraft[]) => {
    for (const n of lista) {
      if (isDecisionDraft(n)) {
        const nombre = n.label?.trim() ? `Decisión «${n.label.trim()}»` : "Decisión";
        const problemas: string[] = [];
        n.branches.forEach((b, i) => {
          for (const p of validarCondiciones(b.conditions).problemas) problemas.push(`${b.label?.trim() || `Rama ${i + 1}`}: ${textoCorto(p).toLowerCase()}`);
          recorrer(b.steps);
        });
        if (n.else) recorrer(n.else);
        if (problemas.length > 0) {
          // Aquí el prefijo es la rama («Meta: …»): se conserva en el texto del paso.
          porNodo[n.nodeId] = problemas.length > 1 ? `${problemas[0]} (y ${problemas.length - 1} más)` : problemas[0];
          for (const p of problemas) faltantes.push(`${nombre}: ${p}`);
        }
        continue;
      }
      const nombre = accionPorTipo(n.type)?.label ?? "Acción";
      marcar(n.nodeId, validarAccion({ type: n.type, config: n.config, delayMinutes: n.delayMinutes }, fuentes).problemas, nombre);
    }
  };
  recorrer(draft.actions);

  if (draft.actions.length === 0) faltantes.push("Agrega al menos un paso a la regla");

  return { ok: faltantes.length === 0, porNodo, faltantes };
}
