// Nota «llegó a una cuenta sin registrar» (2026-10-12): el webhook la arma y el panel de leads
// huérfanos la lee. Aquí se cruzan las dos cosas para que no se desalineen.
import { describe, it, expect } from "vitest";
import {
  parseUnregisteredAccountNote,
  unknownMetaAccountReason,
  unknownWhatsAppNumberReason,
  UNREGISTERED_META_NOTE_MARKER,
  UNREGISTERED_META_NOTE_PREFIX,
  UNREGISTERED_WA_NOTE_PREFIX,
} from "./unregistered-account";
import { BOT_SILENCE_PREFIX } from "./bot-note-prefix";

/** Lo que recordBotSilence escribe en la conversación. */
const nota = (reason: string) => `${BOT_SILENCE_PREFIX}: ${reason}`;

describe("textos (idénticos a los que ya dejaban los webhooks)", () => {
  it("WhatsApp, número desconocido", () => {
    expect(
      unknownWhatsAppNumberReason({
        phoneNumberId: "pn-desconocido",
        displayNumber: "+52 998 000 0000",
        lookupFailed: false,
        generalNumberConfigured: true,
      }),
    ).toBe(
      "este WhatsApp llegó al número +52 998 000 0000 (id pn-desconocido), " +
        "que no está dado de alta en Conexiones ni es el número general del CRM.",
    );
  });

  it("WhatsApp, falló la lectura y sin número general configurado", () => {
    expect(
      unknownWhatsAppNumberReason({
        phoneNumberId: "pn-1",
        displayNumber: null,
        lookupFailed: true,
        generalNumberConfigured: false,
      }),
    ).toBe(
      "este WhatsApp llegó al número pn-1 (id pn-1); no se pudo consultar en Conexiones de qué cuenta es " +
        "(falló la lectura) y no es el número general del CRM. Ojo: el servidor no tiene configurado el " +
        "número general (META_WA_PHONE_NUMBER_ID está vacía).",
    );
  });

  it("Instagram / Messenger, cuenta sin conexión", () => {
    expect(unknownMetaAccountReason("INSTAGRAM", "1784")).toBe(
      "este mensaje de Instagram llegó a la cuenta 1784, que no tiene una conexión activa en Conexiones.",
    );
    expect(unknownMetaAccountReason("MESSENGER", "pg-9")).toBe(
      "este mensaje de Messenger llegó a la cuenta pg-9, que no tiene una conexión activa en Conexiones.",
    );
  });
});

describe("parseUnregisteredAccountNote ↔ los textos de arriba", () => {
  it("WhatsApp: número visible y su id, con o sin lectura fallida", () => {
    for (const lookupFailed of [false, true]) {
      for (const generalNumberConfigured of [false, true]) {
        const body = nota(
          unknownWhatsAppNumberReason({
            phoneNumberId: "1093",
            displayNumber: "+52 999 111 2222",
            lookupFailed,
            generalNumberConfigured,
          }),
        );
        expect(body.startsWith(UNREGISTERED_WA_NOTE_PREFIX)).toBe(true);
        expect(parseUnregisteredAccountNote(body)).toEqual({
          channel: "WHATSAPP",
          account: "+52 999 111 2222",
          accountId: "1093",
        });
      }
    }
  });

  it("Meta: canal y cuenta", () => {
    const body = nota(unknownMetaAccountReason("MESSENGER", "pg-9"));
    expect(body.startsWith(UNREGISTERED_META_NOTE_PREFIX)).toBe(true);
    expect(body).toContain(UNREGISTERED_META_NOTE_MARKER);
    expect(parseUnregisteredAccountNote(body)).toEqual({ channel: "MESSENGER", account: "pg-9", accountId: "pg-9" });
    expect(parseUnregisteredAccountNote(nota(unknownMetaAccountReason("INSTAGRAM", "1784")))?.channel).toBe("INSTAGRAM");
  });

  it("otras notas no cuentan", () => {
    expect(parseUnregisteredAccountNote(nota("el canal WHATSAPP está apagado en la configuración del bot."))).toBeNull();
    expect(parseUnregisteredAccountNote("Meta rechazó la respuesta del bot: …")).toBeNull();
    expect(parseUnregisteredAccountNote("este WhatsApp llegó al número 1 (id 1)")).toBeNull(); // sin el prefijo
  });
});
