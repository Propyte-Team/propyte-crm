import { describe, it, expect, vi, beforeEach } from "vitest";

const emitEvent = vi.fn();
vi.mock("./events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));

import { emitirContactoFusionado, emitirCotizacionAbierta, emitirVisitaRealizada, esVisita } from "./emisiones";

beforeEach(() => {
  emitEvent.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("emisiones del motor", () => {
  it("contact.merged: entidad = el contacto que sobrevive", async () => {
    await emitirContactoFusionado("sobrevive", "perdedor");
    expect(emitEvent).toHaveBeenCalledWith("contact.merged", "contact", "sobrevive", { mergedContactId: "perdedor" });
  });

  it("quote.opened: entidad = el negocio de la cotización", async () => {
    await emitirCotizacionAbierta({ id: "q1", dealId: "d1", contactId: "c1" });
    expect(emitEvent).toHaveBeenCalledWith("quote.opened", "deal", "d1", { quoteId: "q1", contactId: "c1" });
  });

  it("visit.completed: solo reuniones presenciales o de showroom con contacto", async () => {
    await emitirVisitaRealizada({ id: "a1", activityType: "MEETING_SHOWROOM", contactId: "c1", dealId: "d1" });
    expect(emitEvent).toHaveBeenCalledWith("visit.completed", "contact", "c1", {
      activityId: "a1", activityType: "MEETING_SHOWROOM", dealId: "d1",
    });
    emitEvent.mockClear();
    await emitirVisitaRealizada({ id: "a2", activityType: "MEETING_VIRTUAL", contactId: "c1" });
    await emitirVisitaRealizada({ id: "a3", activityType: "CALL_OUTBOUND", contactId: "c1" });
    await emitirVisitaRealizada({ id: "a4", activityType: "MEETING_PRESENTIAL", contactId: null });
    expect(emitEvent).not.toHaveBeenCalled();
    expect(esVisita("MEETING_PRESENTIAL")).toBe(true);
  });

  it("si el motor falla, no propaga el error", async () => {
    emitEvent.mockRejectedValue(new Error("boom"));
    await expect(emitirContactoFusionado("a", "b")).resolves.toBeUndefined();
    await expect(emitirCotizacionAbierta({ id: "q", dealId: "d" })).resolves.toBeUndefined();
    await expect(emitirVisitaRealizada({ id: "a", activityType: "MEETING_PRESENTIAL", contactId: "c" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
