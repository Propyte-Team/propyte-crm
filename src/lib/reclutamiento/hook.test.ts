import { describe, it, expect, vi, beforeEach } from "vitest";

const asegurarCandidato = vi.fn();
const persistirEvaluacion = vi.fn();
const guardarHorario = vi.fn();
const reclamarEvaluacion = vi.fn();
const sincronizarCandidato = vi.fn();
vi.mock("./candidato", () => ({
  reclamarEvaluacion: (...a: unknown[]) => reclamarEvaluacion(...a),
  sincronizarCandidato: (...a: unknown[]) => sincronizarCandidato(...a),
  asegurarCandidato: (...a: unknown[]) => asegurarCandidato(...a),
  persistirEvaluacion: (...a: unknown[]) => persistirEvaluacion(...a),
  guardarHorario: (...a: unknown[]) => guardarHorario(...a),
  plazaDeRespuesta: (v: string | undefined) => (v === "PDC" || v === "MERIDA" ? v : null),
}));
const evaluarActitud = vi.fn();
vi.mock("./actitud", () => ({ evaluarActitud: (...a: unknown[]) => evaluarActitud(...a) }));
const cargarConfigReclutamiento = vi.fn();
vi.mock("./modelo", async (orig) => {
  const actual = await orig<typeof import("./modelo")>();
  return { ...actual, cargarConfigReclutamiento: (...a: unknown[]) => cargarConfigReclutamiento(...a) };
});
const responsablesDe = vi.fn();
const avisarResultado = vi.fn();
vi.mock("./avisos", () => ({
  responsablesDe: (...a: unknown[]) => responsablesDe(...a),
  avisarResultado: (...a: unknown[]) => avisarResultado(...a),
}));
const extractFields = vi.fn();
vi.mock("@/lib/bot/playbook/extract", () => ({ extractFields: (...a: unknown[]) => extractFields(...a) }));
const contactFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({ default: { contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) } } }));
const desarrollosParaReclutamiento = vi.fn();
vi.mock("@/lib/hub/reclutamiento-inventario", () => ({
  desarrollosParaReclutamiento: (...a: unknown[]) => desarrollosParaReclutamiento(...a),
}));

import { hookReclutamiento, esAgenteReclutamiento, OBJETIVOS_CIERRE, contextoTrasCierre } from "./hook";
import { MODELO_DEFAULT, FICHA_DEFAULT } from "./modelo";

const contactoApto = {
  id: "k1",
  firstName: "Ana",
  lastName: "López",
  phone: "+521",
  email: "ana@x.mx",
  custom: {
    reclutamiento_plaza: "PDC",
    reclutamiento_mayor_edad: "SI",
    reclutamiento_acepta_comision: "SI",
    reclutamiento_disponibilidad: "TIEMPO_COMPLETO",
    reclutamiento_colchon_meses: "TRES_A_SEIS",
    reclutamiento_movilidad: "SI",
    reclutamiento_experiencia_inmobiliaria: "MAS_DE_3_ANOS",
    reclutamiento_cartera_clientes: "DE_10_A_50",
    reclutamiento_experiencia_ventas: "CONSULTIVA_ALTO_VALOR",
    reclutamiento_ingles: "CONVERSACIONAL",
    reclutamiento_prospeccion_digital: "SI",
    reclutamiento_actitud_1: "a",
    reclutamiento_actitud_2: "b",
    reclutamiento_actitud_3: "c",
  },
};

const sinEvaluar = { id: "c1", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false };

beforeEach(() => {
  [asegurarCandidato, persistirEvaluacion, guardarHorario, reclamarEvaluacion, sincronizarCandidato, evaluarActitud, cargarConfigReclutamiento, responsablesDe, avisarResultado, extractFields, contactFindUnique].forEach(
    (f) => f.mockReset()
  );
  contactFindUnique.mockResolvedValue(null); // sin fila releída → se usa el contacto de entrada
  cargarConfigReclutamiento.mockResolvedValue({ modelo: MODELO_DEFAULT, ficha: FICHA_DEFAULT, responsables: {} });
  responsablesDe.mockResolvedValue(["u1"]);
  reclamarEvaluacion.mockResolvedValue(true);
  desarrollosParaReclutamiento.mockReset();
  desarrollosParaReclutamiento.mockResolvedValue([
    { nombre: "Yaxnáh Caucel", ciudad: "Mérida", relacion: "EXCLUSIVO", tipos: ["Casa"], disponibles: 10 },
    { nombre: "Gran Coralia", ciudad: "Tulum", relacion: "CO_BROKER", tipos: ["Terreno"], disponibles: 5 },
  ]);
});

describe("esAgenteReclutamiento", () => {
  it("por nombre del agente", () => {
    expect(esAgenteReclutamiento({ name: "Agente Reclutamiento" })).toBe(true);
    expect(esAgenteReclutamiento({ name: "Agente Brokers" })).toBe(false);
    expect(esAgenteReclutamiento(null)).toBe(false);
  });
});

describe("hookReclutamiento", () => {
  const base = { conversationId: "v1", channel: "INSTAGRAM" as const, model: "m", messages: [{ role: "user" as const, content: "hola" }] };

  it("sin tabla (candidato null) → no hace nada y devuelve {}", async () => {
    asegurarCandidato.mockResolvedValue(null);
    expect(await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } })).toEqual({});
  });

  it("en curso: añade la ficha de la vacante al contexto sin objetivo", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(r.contexto).toContain("Esquema 100 % comisión");
    expect(r.objetivo).toBeUndefined();
    expect(persistirEvaluacion).not.toHaveBeenCalled();
  });

  it("en curso: copia a la ficha el contacto releído y las respuestas capturadas hasta ahora", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    contactFindUnique.mockResolvedValue({
      firstName: "Myriam",
      lastName: "",
      phone: "+5219991112233",
      email: null,
      custom: { reclutamiento_mayor_edad: "SI", reclutamiento_plaza: "PDC", otra_cosa: "x" },
    });
    await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(sincronizarCandidato).toHaveBeenCalledWith({
      candidatoId: "c1",
      contacto: { firstName: "Myriam", lastName: "", phone: "+5219991112233", email: null },
      respuestas: { mayor_edad: "SI", plaza: "PDC" },
    });
  });

  it("ya evaluado: también sincroniza la ficha (el teléfono puede llegar después)", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "REVISAR", botEvaluadoAt: new Date() });
    await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(sincronizarCandidato).toHaveBeenCalledWith(
      expect.objectContaining({ candidatoId: "c1", contacto: { firstName: "Ana", lastName: "López", phone: "+521", email: "ana@x.mx" } })
    );
  });

  it("en curso: el contexto trae las reglas del guion (no cerrar, no pedir CV) antes de la ficha", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(r.contexto).toMatch(/^Reglas del guion: /);
    expect(r.contexto).toContain("NO cierres la conversación, NO pidas CV");
    expect(r.contexto).toContain("no inventes desarrollos");
    expect(r.contexto).toContain("Ficha de la vacante: ");
    expect(r.contexto!.indexOf("Reglas del guion")).toBeLessThan(r.contexto!.indexOf("Ficha de la vacante"));
  });

  it("en curso: la ficha lleva oficinas y desarrollos del Hub (exclusivos con nombre, co-broker solo contados)", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(desarrollosParaReclutamiento).toHaveBeenCalledTimes(1);
    expect(r.contexto).toContain("Oficinas: Playa del Carmen, Quinta Avenida esquina con calle 40");
    expect(r.contexto).toContain("Mérida: oficina de ventas de Yaxnáh Caucel, en Ciudad Caucel.");
    expect(r.contexto).toContain("Desarrollos exclusivos de Propyte (producto propio): Yaxnáh Caucel (casas, Mérida).");
    expect(r.contexto).toContain("(co-broker): Tulum: 1 desarrollo (terrenos).");
    expect(r.contexto).not.toContain("Gran Coralia");
  });

  it("en curso: si el Hub no responde, la ficha base sigue (sin líneas de desarrollos)", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    desarrollosParaReclutamiento.mockResolvedValue([]);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(r.contexto).toContain("Esquema 100 % comisión");
    expect(r.contexto).toContain("Oficinas: ");
    expect(r.contexto).not.toContain("Desarrollos exclusivos");
  });

  it("al completar: evalúa, persiste, avisa y devuelve el cierre APTO pidiendo CV y horario", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    evaluarActitud.mockResolvedValue({ puntos: 16, razones: ["clara"] });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(asegurarCandidato).toHaveBeenCalledWith(
      expect.objectContaining({ canal: "INSTAGRAM", conversationId: "v1", contact: expect.objectContaining({ id: "k1" }) })
    );
    expect(reclamarEvaluacion).toHaveBeenCalledWith("c1");
    expect(persistirEvaluacion).toHaveBeenCalledWith(expect.objectContaining({ candidatoId: "c1", razonesActitud: ["clara"] }));
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { resultado: string; puntaje: number } }).evaluacion;
    expect(ev.resultado).toBe("APTO");
    expect(ev.puntaje).toBe(85); // 25+14+15+10+5 + 16
    expect(avisarResultado).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: "APTO", plaza: "PDC", nombre: "Ana López", responsables: ["u1"] })
    );
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_SIN_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("al completar con CV ya recibido: suma puntos de CV y no lo pide", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, tieneCv: true });
    evaluarActitud.mockResolvedValue(null);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { puntaje: number } }).evaluacion;
    expect(ev.puntaje).toBe(74); // 69 + 5
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_CON_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("al completar relee el contacto: evalúa con las capturas del turno, no con el contacto cargado al inicio", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    evaluarActitud.mockResolvedValue(null);
    // El contacto que llegó al hook trae movilidad NO (viejo); la base ya tiene SI (capturado este turno).
    const contactoViejo = { ...contactoApto, firstName: "Candidato", lastName: "", custom: { ...contactoApto.custom, reclutamiento_movilidad: "NO" } };
    contactFindUnique.mockResolvedValue({ firstName: "Ana", lastName: "López", phone: "+522", email: "ana2@x.mx", custom: contactoApto.custom });
    const r = await hookReclutamiento({ ...base, contact: contactoViejo, playbook: { status: "COMPLETED" } });
    expect(contactFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "k1" }, select: { firstName: true, lastName: true, phone: true, email: true, custom: true } })
    );
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { resultado: string } }).evaluacion;
    expect(ev.resultado).toBe("APTO");
    expect(persistirEvaluacion).toHaveBeenCalledWith(
      expect.objectContaining({ contacto: { firstName: "Ana", lastName: "López", phone: "+522", email: "ana2@x.mx" } })
    );
    expect(avisarResultado).toHaveBeenCalledWith(expect.objectContaining({ nombre: "Ana López" }));
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_SIN_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("si releer el contacto falla, evalúa con el contacto de entrada", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    evaluarActitud.mockResolvedValue(null);
    contactFindUnique.mockRejectedValue(new Error("db"));
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { resultado: string } }).evaluacion;
    expect(ev.resultado).toBe("APTO");
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_SIN_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("NO_APTO: cierre amable sin pedir nada", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    evaluarActitud.mockResolvedValue(null);
    const contacto = { ...contactoApto, custom: { ...contactoApto.custom, reclutamiento_movilidad: "NO" } };
    const r = await hookReclutamiento({ ...base, contact: contacto, playbook: { status: "COMPLETED" } });
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.NO_APTO);
    expect(r.contexto).toContain("Ficha de la vacante");
    expect(avisarResultado).toHaveBeenCalledWith(expect.objectContaining({ resultado: "NO_APTO" }));
  });

  it("ya evaluado (APTO) sin horario: extrae el horario del último mensaje y lo guarda", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "APTO", botEvaluadoAt: new Date(), tieneCv: true });
    extractFields.mockResolvedValue({ horario_entrevista: "martes por la tarde" });
    const r = await hookReclutamiento({
      ...base,
      contact: contactoApto,
      playbook: { status: "COMPLETED" },
      messages: [{ role: "user", content: "martes por la tarde" }],
    });
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(guardarHorario).toHaveBeenCalledWith("c1", "martes por la tarde");
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("otro turno ya reclamó la evaluación: no evalúa, no avisa y devuelve {}", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    reclamarEvaluacion.mockResolvedValue(false);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(r).toEqual({});
    expect(evaluarActitud).not.toHaveBeenCalled();
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(avisarResultado).not.toHaveBeenCalled();
  });

  it("ya evaluado (APTO) sin horario: pasa solo el último mensaje a extractFields con la tarea de horario", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "APTO", botEvaluadoAt: new Date(), tieneCv: true });
    extractFields.mockResolvedValue({ horario_entrevista: "jueves" });
    await hookReclutamiento({
      ...base,
      contact: contactoApto,
      playbook: { status: "COMPLETED" },
      messages: [{ role: "user", content: "hola" }, { role: "assistant", content: "¿qué horario?" }, { role: "user", content: "jueves" }],
    });
    const arg = extractFields.mock.calls[0][0] as { messages: unknown[]; tasks: Array<{ key: string; captureType: string }> };
    expect(arg.messages).toEqual([{ role: "user", content: "jueves" }]);
    expect(arg.tasks).toHaveLength(1);
    expect(arg.tasks[0]).toMatchObject({ key: "horario_entrevista", captureType: "TEXT" });
  });

  it("ya evaluado (APTO) sin horario y extractFields no saca nada: mantiene el cierre APTO_CON_CV", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "APTO", botEvaluadoAt: new Date(), tieneCv: true });
    extractFields.mockResolvedValue({});
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(guardarHorario).not.toHaveBeenCalled();
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_CON_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("ya evaluado (APTO) con horario: confirma sin volver a extraer", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "APTO", botEvaluadoAt: new Date(), tieneCv: true, horarioEntrevista: "lunes" });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(extractFields).not.toHaveBeenCalled();
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("ya evaluado REVISAR: solo mantiene el cierre, no re-evalúa", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "REVISAR", botEvaluadoAt: new Date(), tieneCv: false });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.REVISAR_SIN_CV);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("ya evaluado NO_APTO: devuelve el cierre NO_APTO sin re-evaluar", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "NO_APTO", botEvaluadoAt: new Date() });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(avisarResultado).not.toHaveBeenCalled();
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.NO_APTO);
    expect(r.contexto).toContain("Ficha de la vacante");
  });

  it("si la evaluación revienta, no lanza y devuelve {}", async () => {
    asegurarCandidato.mockResolvedValue(sinEvaluar);
    evaluarActitud.mockResolvedValue(null);
    persistirEvaluacion.mockRejectedValue(new Error("db"));
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(r).toEqual({});
  });
});

describe("contextoTrasCierre", () => {
  it("da la ficha sin las reglas de «no cierres» del guion", () => {
    const t = contextoTrasCierre("FICHA-X");
    expect(t).toContain("Ficha de la vacante");
    expect(t).toContain("FICHA-X");
    expect(t).toContain("no inventes datos");
    expect(t).not.toMatch(/NO cierres/);
  });

  it("ya evaluado: la ficha incluye los desarrollos del Hub", async () => {
    asegurarCandidato.mockResolvedValue({ ...sinEvaluar, botResultado: "NO_APTO", botEvaluadoAt: new Date() });
    const base = { conversationId: "v1", channel: "INSTAGRAM" as const, model: "m", messages: [{ role: "user" as const, content: "hola" }] };
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(cargarConfigReclutamiento).toHaveBeenCalledTimes(1);
    expect(r.contexto).toContain("Yaxnáh Caucel");
  });
});

describe("OBJETIVOS_CIERRE (decisiones 2026-11-03)", () => {
  it("hablan del Gerente de Ventas, nunca del «gerente de la plaza»", () => {
    for (const [k, texto] of Object.entries(OBJETIVOS_CIERRE)) {
      expect(texto, k).not.toMatch(/gerente de la plaza/i);
      if (/gerente/i.test(texto)) expect(texto, k).toContain("Gerente de Ventas");
    }
  });

  it("el contacto es por WhatsApp al número que dejó, no «por este chat»", () => {
    for (const [k, texto] of Object.entries(OBJETIVOS_CIERRE)) {
      expect(texto, k).not.toMatch(/por este chat/i);
      if (/contacta/i.test(texto)) expect(texto, k).toContain("por WhatsApp al número que dejó");
    }
  });

  it("al pedir CV aceptan archivo o enlace (Instagram no manda archivos)", () => {
    for (const k of ["APTO_SIN_CV", "REVISAR_SIN_CV"] as const) {
      expect(OBJETIVOS_CIERRE[k]).toContain("archivo PDF o Word");
      expect(OBJETIVOS_CIERRE[k]).toContain("enlace (Drive, Dropbox)");
      expect(OBJETIVOS_CIERRE[k]).not.toContain("aquí mismo");
    }
  });
});
