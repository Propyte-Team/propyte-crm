import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recruitCandidate: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));
const crearCandidato = vi.fn();
vi.mock("@/server/reclutamiento", () => ({ crearCandidato: (...a: unknown[]) => crearCandidato(...a) }));
const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { asegurarCandidato, persistirEvaluacion, plazaDeRespuesta, guardarHorario, reclamarEvaluacion, sincronizarCandidato, camposDeContacto } from "./candidato";

const contacto = { id: "k1", firstName: "Ana", lastName: "López", phone: "+5219991112233", email: "ana@x.mx" };
const filaDb = { id: "c1", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, cvUrl: null, files: [] };

beforeEach(() => { findFirst.mockReset(); update.mockReset(); updateMany.mockReset(); crearCandidato.mockReset(); askClaude.mockReset(); });

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
  it("el CV como enlace (cvUrl) cuenta como CV recibido; sin archivo ni enlace, no", async () => {
    findFirst.mockResolvedValue({ ...filaDb, cvUrl: "https://drive.google.com/file/d/1/view" });
    expect((await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" }))?.tieneCv).toBe(true);
    findFirst.mockResolvedValue(filaDb);
    expect((await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" }))?.tieneCv).toBe(false);
    expect((findFirst.mock.calls[0][0] as { select: { cvUrl?: boolean } }).select.cvUrl).toBe(true);
  });
  it("#959: adopta la ficha que creó el disparador (origen CONTACTO): canal del bot y origen CHAT con la conversación", async () => {
    findFirst.mockResolvedValue(filaDb);
    updateMany.mockResolvedValue({ count: 1 });
    await asegurarCandidato({ contact: contacto, canal: "MESSENGER", conversationId: "v9" });
    expect(updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "c1", botCanal: null }, data: { botCanal: "MESSENGER" } },
      // Solo si nació por el disparador y sin referencia: una ficha manual o de Notion conserva su origen.
      { where: { id: "c1", source: "CONTACTO", sourceRef: null }, data: { source: "CHAT", sourceRef: "v9" } },
      // Sin puesto capturado (el disparador copia el del contacto, casi siempre vacío): la vacante del agente.
      { where: { id: "c1", area: null }, data: { area: "Asesor / Ventas" } },
    ]);
    expect(crearCandidato).not.toHaveBeenCalled();
  });
  it("#959: si anotar el canal falla, igual devuelve la ficha", async () => {
    findFirst.mockResolvedValue(filaDb);
    updateMany.mockRejectedValue(new Error("db"));
    expect((await asegurarCandidato({ contact: contacto, canal: "WHATSAPP", conversationId: "v1" }))?.id).toBe("c1");
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

describe("sincronizarCandidato (cada turno del bot)", () => {
  const fichaVacia = { fullName: "Candidato por chat", phone: null, email: null };
  it("llena nombre, teléfono, correo y respuestas en una ficha vacía, sin tocar etapa ni evaluación", async () => {
    findFirst.mockResolvedValue(fichaVacia);
    updateMany.mockResolvedValue({ count: 1 });
    await sincronizarCandidato({
      candidatoId: "c1",
      contacto: { firstName: "Myriam", lastName: "Pérez", phone: "+5219991112233", email: "my@x.mx" },
      respuestas: { mayor_edad: "SI", plaza: "PDC", disponibilidad: "TIEMPO_COMPLETO" },
    });
    expect((findFirst.mock.calls[0][0] as { where: unknown }).where).toEqual({ id: "c1" });
    const arg = updateMany.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "c1" });
    expect(arg.data).toEqual({
      fullName: "Myriam Pérez",
      phone: "+5219991112233",
      email: "my@x.mx",
      botRespuestas: { mayor_edad: "SI", plaza: "PDC", disponibilidad: "TIEMPO_COMPLETO" },
    });
    expect("stage" in arg.data).toBe(false);
    expect("botResultado" in arg.data).toBe(false);
  });
  it("no pisa lo que el reclutador corrigió: solo actualiza las respuestas", async () => {
    findFirst.mockResolvedValue({ fullName: "Myriam Morales Jiménez", phone: "+529841234567", email: "real@x.mx" });
    updateMany.mockResolvedValue({ count: 1 });
    await sincronizarCandidato({
      candidatoId: "c1",
      contacto: { firstName: "Myriam", lastName: "MJ", phone: "+523221227932", email: "ig@x.mx" },
      respuestas: { plaza: "PDC" },
    });
    expect((updateMany.mock.calls[0][0] as { data: unknown }).data).toEqual({ botRespuestas: { plaza: "PDC" } });
  });
  it("el nombre completo que llega durante el guion extiende al nombre de pila de la ficha", async () => {
    findFirst.mockResolvedValue({ fullName: "Myriam", phone: null, email: null });
    await sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: "Myriam", lastName: "Morales Jiménez", phone: null, email: null }, respuestas: {} });
    expect((updateMany.mock.calls[0][0] as { data: unknown }).data).toEqual({ fullName: "Myriam Morales Jiménez" });
  });
  it("solo nombre (sin apellido) y sin respuestas: manda fullName y nada más", async () => {
    findFirst.mockResolvedValue(fichaVacia);
    updateMany.mockResolvedValue({ count: 1 });
    await sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: " Myriam ", lastName: null, phone: "  ", email: null }, respuestas: {} });
    expect((updateMany.mock.calls[0][0] as { data: unknown }).data).toEqual({ fullName: "Myriam" });
  });
  it("con contacto vacío y sin respuestas no toca la base", async () => {
    await sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: "", lastName: "", phone: null, email: null }, respuestas: {} });
    expect(findFirst).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("no escribe el nombre provisional «Candidato por chat»", async () => {
    findFirst.mockResolvedValue(fichaVacia);
    updateMany.mockResolvedValue({ count: 1 });
    await sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: "Candidato por chat", lastName: "", phone: "+521", email: null }, respuestas: {} });
    expect((updateMany.mock.calls[0][0] as { data: unknown }).data).toEqual({ phone: "+521" });
  });
  it("sin nada nuevo que llenar no actualiza", async () => {
    findFirst.mockResolvedValue({ fullName: "Ana López", phone: "+52999", email: "a@x.mx" });
    await sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: "Ana", lastName: "L", phone: "+52111", email: null }, respuestas: {} });
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("nunca lanza", async () => {
    findFirst.mockRejectedValue(new Error("db"));
    await expect(
      sincronizarCandidato({ candidatoId: "c1", contacto: { firstName: "A", lastName: "B", phone: null, email: null }, respuestas: {} })
    ).resolves.toBeUndefined();
  });
});

describe("camposDeContacto", () => {
  const vacia = { fullName: null, phone: null, email: null };
  const c = (firstName: string | null, lastName: string | null, phone: string | null = null, email: string | null = null) => ({ firstName, lastName, phone, email });
  it("ficha vacía o con el nombre provisional: escribe nombre, teléfono y correo", () => {
    expect(camposDeContacto(vacia, c(" Ana ", " López  Ruiz", " +52 ", " a@x.mx "))).toEqual({ fullName: "Ana López Ruiz", phone: "+52", email: "a@x.mx" });
    expect(camposDeContacto({ ...vacia, fullName: "Candidato por chat" }, c("Ana", ""))).toEqual({ fullName: "Ana" });
  });
  it("el nombre de perfil del canal (prueba 2026-11-04) se reemplaza por el que da el candidato", () => {
    expect(camposDeContacto({ ...vacia, fullName: "☆ (@jkarla.idk)" }, c("Karla", "Jaqueline Muñoz Trejo"))).toEqual({
      fullName: "Karla Jaqueline Muñoz Trejo",
    });
    expect(camposDeContacto({ ...vacia, fullName: "★ ✨" }, c("Ana", "López"))).toEqual({ fullName: "Ana López" });
    // Un nombre de persona sigue protegido aunque traiga paréntesis sin usuario.
    expect(camposDeContacto({ ...vacia, fullName: "Ana (prima de Luis)" }, c("Karla", "Muñoz"))).toEqual({});
  });
  it("el nombre completo extiende al que ya estaba (sin importar mayúsculas ni acentos)", () => {
    expect(camposDeContacto({ ...vacia, fullName: "Myriam" }, c("Myriam", "Morales Jiménez"))).toEqual({ fullName: "Myriam Morales Jiménez" });
    expect(camposDeContacto({ ...vacia, fullName: "jose" }, c("José", "Pérez"))).toEqual({ fullName: "José Pérez" });
  });
  it("no pisa un nombre distinto que escribió el reclutador, ni teléfono/correo ya llenos", () => {
    const actual = { fullName: "Myriam Morales Jiménez", phone: "+529841234567", email: "real@x.mx" };
    expect(camposDeContacto(actual, c("Myriam", "", "+52999", "otro@x.mx"))).toEqual({});
    expect(camposDeContacto({ ...actual, fullName: "Myriam Morales" }, c("Myriamx", "Morales"))).toEqual({});
  });
  it("nunca escribe el nombre provisional ni valores vacíos", () => {
    expect(camposDeContacto(vacia, c("Candidato por chat", "", "  ", ""))).toEqual({});
    expect(camposDeContacto(vacia, c(null, null))).toEqual({});
  });
  it("recorta el nombre a 200", () => {
    expect(camposDeContacto(vacia, c("a".repeat(250), null)).fullName).toHaveLength(200);
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
  it("con contacto sincroniza nombre, teléfono y correo; sin contacto o con valores vacíos no los toca", async () => {
    askClaude.mockResolvedValue("x");
    findFirst.mockResolvedValue({ stage: "RECIBIDO" });
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1",
      respuestas: {},
      evaluacion,
      razonesActitud: [],
      model: "m",
      contacto: { firstName: "Ana", lastName: "López", phone: "+5219991112233", email: "  " },
    });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ fullName: "Ana López", phone: "+5219991112233" });
    expect("email" in data).toBe(false);

    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m" });
    const data2 = (update.mock.calls[1][0] as { data: Record<string, unknown> }).data;
    expect("fullName" in data2).toBe(false);
    expect("phone" in data2).toBe(false);

    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m", contacto: { firstName: "", lastName: null, phone: null, email: null } });
    const data3 = (update.mock.calls[2][0] as { data: Record<string, unknown> }).data;
    expect("fullName" in data3).toBe(false);
  });
  it("lee nombre/teléfono/correo actuales y no pisa lo que corrigió el reclutador", async () => {
    askClaude.mockResolvedValue("x");
    findFirst.mockResolvedValue({ stage: "RECIBIDO", fullName: "Myriam Morales Jiménez", phone: "+529841234567", email: "real@x.mx" });
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m",
      contacto: { firstName: "Myriam", lastName: "", phone: "+52999", email: "otro@x.mx" },
    });
    expect((findFirst.mock.calls[0][0] as { select: Record<string, boolean> }).select).toMatchObject({ stage: true, fullName: true, phone: true, email: true });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect("fullName" in data).toBe(false);
    expect("phone" in data).toBe(false);
    expect("email" in data).toBe(false);
  });
  it("completa el nombre cuando el del contacto extiende al de la ficha", async () => {
    askClaude.mockResolvedValue("x");
    findFirst.mockResolvedValue({ stage: "RECIBIDO", fullName: "Myriam", phone: null, email: null });
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m",
      contacto: { firstName: "Myriam", lastName: "Morales Jiménez", phone: null, email: null },
    });
    expect((update.mock.calls[0][0] as { data: Record<string, unknown> }).data.fullName).toBe("Myriam Morales Jiménez");
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

describe("reclamarEvaluacion", () => {
  it("gana la reserva (count 1) → true, condicionado a botEvaluadoAt null", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reclamarEvaluacion("c1")).toBe(true);
    const arg = updateMany.mock.calls[0][0] as { where: unknown; data: { botEvaluadoAt: unknown } };
    expect(arg.where).toEqual({ id: "c1", botEvaluadoAt: null });
    expect(arg.data.botEvaluadoAt).toBeInstanceOf(Date);
  });
  it("otro turno ya la reclamó (count 0) → false", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await reclamarEvaluacion("c1")).toBe(false);
  });
  it("si la base falla → false sin lanzar", async () => {
    updateMany.mockRejectedValue(new Error("db"));
    expect(await reclamarEvaluacion("c1")).toBe(false);
  });
});
