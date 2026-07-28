import { describe, it, expect } from "vitest";
import { createDealSchema, stageTransitionSchema } from "./deal";

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const DEAL_ID = "22222222-2222-2222-2222-222222222222";

describe("createDealSchema — acepta Date en expectedCloseDate", () => {
  // Trampa real: src/server/deals.ts:createDeal construye
  // `new Date(data.expectedCloseDate)` a mano y se lo pasa a `.parse()`
  // (no `.safeParse()`) antes de llegar a este schema. Antes del fix, esto
  // era un ZodError no capturado ("Expected string, received date") en
  // cuanto alguien conectara esa función — que hoy no tiene llamadores, pero
  // está exportada con firma `string | Date`.
  it("createDealSchema.parse no truena con un Date ya construido", () => {
    const result = createDealSchema.parse({
      contactId: CONTACT_ID,
      dealType: "NATIVA_CONTADO",
      estimatedValue: 1000000,
      expectedCloseDate: new Date("2026-07-30T16:00:00.000Z"),
      leadSourceAtDeal: "META_ADS",
    });

    expect(result.expectedCloseDate).toBeInstanceOf(Date);
    expect(result.expectedCloseDate.toISOString()).toBe("2026-07-30T16:00:00.000Z");
  });
});

describe("stageTransitionSchema — acepta Date en actualCloseDate", () => {
  // Misma trampa en src/server/deals.ts:transitionDealStage, que hace
  // `new Date(extras.actualCloseDate as string)` y llama a
  // stageTransitionSchema.parse(...) sin capturar.
  it("stageTransitionSchema.parse no truena con un Date ya construido al ganar", () => {
    const result = stageTransitionSchema.parse({
      dealId: DEAL_ID,
      fromStage: "NEGOTIATION",
      toStage: "WON",
      actualCloseDate: new Date("2026-07-30T16:00:00.000Z"),
    });

    expect(result.actualCloseDate).toBeInstanceOf(Date);
    expect(result.actualCloseDate?.toISOString()).toBe("2026-07-30T16:00:00.000Z");
  });
});
