import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recruitCandidate: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
const crearCandidato = vi.fn();
vi.mock("@/server/reclutamiento", () => ({ crearCandidato: (...a: unknown[]) => crearCandidato(...a) }));
const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { asegurarCandidato, persistirEvaluacion, plazaDeRespuesta, guardarHorario } from "./candidato";

const contacto = { id: "k1", firstName: "Ana", lastName: "López", phone: "+5219991112233", email: "ana@x.mx" };
const filaDb = { id: "c1", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, files: [] };

beforeEach(() => { findFirst.mockReset(); update.mockReset(); crearCandidato.mockReset(); askClaude.mockReset(); });

describe("asegurarCandidato", () => {
  it("devuelve el existente (por contactId, no borrado) en forma CandidatoBot", async () => {
    findFirst.mockResolvedValue({ ...filaDb, botResultado: "APTO", botEvaluadoAt: new Date("2026-11-02"), files: [{ id: "f1" }] });
    const r = await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" });
    expect(r).toMatchObject({ id: "c1", stage: "RECIBIDO", botResultado: "APTO", tieneCv: true, horarioEntrevista: null });
    expect(r?.botEvaluadoAt).toBeInstanceOf(Date);
    const where = (findFirst.mock.calls[0][0] as { where: unknown }).where;
    expect(where).toEqual({ contactId: "k1", deletedAt: null });
    expect(crearCandidato).not.toHaveBeenCalled();
  });
  it("si no existe lo crea con origen CHAT, el contacto y el canal", async () => {
    findFirst.mockResolvedValue(null);
    crearCandidato.mockResolvedValue({ id: "c2", stage: "RECIBIDO" });
    const r = await asegurarCandidato({ contact: contacto, canal: "MESSENGER", conversationId: "v1" });
    expect(r).toEqual({ id: "c2", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false });
    const [datos, createdById, origen] = crearCandidato.mock.calls[0] as [Record<string, unknown>, unknown, Record<string, unknown>];
    expect(datos).toMatchObject({ fullName: "Ana López", phone: "+5219991112233", email: "ana@x.mx", area: "Asesor / Ventas" });
    expect(createdById).toBeNull();
    expect(origen).toEqual({ source: "CHAT", sourceRef: "v1", contactId: "k1", botCanal: "MESSENGER" });
  });
  it("sin nombre en el contacto usa un nombre provisional", async () => {
    findFirst.mockResolvedValue(null);
    crearCandidato.mockResolvedValue({ id: "c2", stage: "RECIBIDO" });
    await asegurarCandidato({ contact: { ...contacto, firstName: "", lastName: "" }, canal: "WHATSAPP", conversationId: "v1" });
    expect((crearCandidato.mock.calls[0][0] as { fullName: string }).fullName).toBe("Candidato por chat");
  });
  it("carrera (P2002 al crear) → relee por contactId", async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(filaDb);
    crearCandidato.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const r = await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" });
    expect(r?.id).toBe("c1");
  });
  it("sin migrar (P2022) → null sin lanzar", async () => {
    findFirst.mockRejectedValue(Object.assign(new Error("no column"), { code: "P2022" }));
    expect(await asegurarCandidato({ contact: contacto, canal: "WHATSAPP", conversationId: "v1" })).toBeNull();
  });
});

describe("plazaDeRespuesta", () => {
  it("PDC y MERIDA se conservan; otra plaza → FORANEO; vacío → null", () => {
    expect(plazaDeRespuesta("PDC")).toBe("PDC");
    expect(plazaDeRespuesta("MERIDA")).toBe("MERIDA");
    expect(plazaDeRespuesta("OTRA_CON_MUDANZA")).toBe("FORANEO");
    expect(plazaDeRespuesta("OTRA_SIN_MUDANZA")).toBe("FORANEO");
    expect(plazaDeRespuesta(undefined)).toBeNull();
    expect(plazaDeRespuesta("")).toBeNull();
  });
});

describe("persistirEvaluacion", () => {
  const evaluacion = { filtros: { plaza: "PASA" } as never, puntaje: 70, desglose: { actitud: 10 }, resultado: "APTO" as const, motivo: null };
  it("escribe las columnas bot*, la plaza, y mueve la etapa si sigue en RECIBIDO", async () => {
    askClaude.mockResolvedValue("Candidata con 4 años en bienes raíces y cartera mediana.");
    findFirst.mockResolvedValue({ stage: "RECIBIDO" });
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1",
      respuestas: { plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" },
      evaluacion,
      razonesActitud: ["concreta"],
      model: "m",
    });
    const call = update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: "c1" });
    expect(call.data).toMatchObject({ botPuntaje: 70, botResultado: "APTO", botMotivo: null, plaza: "MERIDA", stage: "CONTACTO_INICIAL" });
    expect(call.data.stageChangedAt).toBeInstanceOf(Date);
    expect(call.data.botRespuestas).toEqual({ plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" });
    expect(call.data.botDesglose).toEqual({ actitud: 10, actitud_razones: ["concreta"] });
    expect(call.data.botResumen).toContain("4 años");
    expect(call.data.botEvaluadoAt).toBeInstanceOf(Date);
  });
  it("no toca la etapa si un humano ya la movió, y no pisa una plaza si la respuesta no trae", async () => {
    askClaude.mockResolvedValue("x");
    findFirst.mockResolvedValue({ stage: "ENTREVISTA" });
    update.mockResolvedValue({});
    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion: { ...evaluacion, resultado: "NO_APTO", motivo: "puntaje" }, razonesActitud: [], model: "m" });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.stage).toBeUndefined();
    expect(data.stageChangedAt).toBeUndefined();
    expect("plaza" in data).toBe(false);
    expect(data.botResultado).toBe("NO_APTO");
  });
  it("si el resumen falla, igual persiste con resumen null", async () => {
    askClaude.mockRejectedValue(new Error("x"));
    findFirst.mockResolvedValue({ stage: "RECIBIDO" });
    update.mockResolvedValue({});
    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m" });
    expect((update.mock.calls[0][0] as { data: { botResumen: unknown } }).data.botResumen).toBeNull();
  });
});

describe("guardarHorario", () => {
  it("recorta a 200 y nunca lanza", async () => {
    update.mockRejectedValue(new Error("db"));
    await expect(guardarHorario("c1", "x".repeat(300))).resolves.toBeUndefined();
    expect((update.mock.calls[0][0] as { data: { horarioEntrevista: string } }).data.horarioEntrevista).toHaveLength(200);
  });
});
