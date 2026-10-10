import { describe, it, expect } from "vitest";
import { BOT_CHANNELS, toggleBotChannel } from "./bot-channels";

describe("BOT_CHANNELS", () => {
  it("ofrece WhatsApp, Instagram y Messenger en ese orden", () => {
    expect(BOT_CHANNELS.map((c) => c.value)).toEqual(["WHATSAPP", "INSTAGRAM", "MESSENGER"]);
  });
});

describe("toggleBotChannel", () => {
  it("prender agrega el canal sin duplicar", () => {
    expect(toggleBotChannel(["WHATSAPP"], "MESSENGER", true)).toEqual(["WHATSAPP", "MESSENGER"]);
    expect(toggleBotChannel(["WHATSAPP"], "WHATSAPP", true)).toEqual(["WHATSAPP"]);
  });
  it("apagar quita el canal", () => {
    expect(toggleBotChannel(["WHATSAPP", "INSTAGRAM"], "INSTAGRAM", false)).toEqual(["WHATSAPP"]);
  });
  it("conserva canales que la pantalla no muestra (p. ej. SMS)", () => {
    expect(toggleBotChannel(["SMS", "WHATSAPP"], "INSTAGRAM", true)).toEqual(["SMS", "WHATSAPP", "INSTAGRAM"]);
    expect(toggleBotChannel(["SMS", "WHATSAPP"], "WHATSAPP", false)).toEqual(["SMS"]);
  });
  it("no muta el arreglo original", () => {
    const original = ["WHATSAPP"];
    toggleBotChannel(original, "INSTAGRAM", true);
    expect(original).toEqual(["WHATSAPP"]);
  });
});
