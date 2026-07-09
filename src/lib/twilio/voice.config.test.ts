import { describe, it, expect, afterEach } from "vitest";
import { isVoiceConfigured } from "./voice";

const KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_TWIML_APP_SID", "TWILIO_API_KEY_SECRET", "TWILIO_AUTH_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function clear() { for (const k of KEYS) delete process.env[k]; }

describe("isVoiceConfigured", () => {
  it("false cuando faltan las env vars", () => {
    clear();
    expect(isVoiceConfigured()).toBe(false);
  });
  it("false si falta el TwiML App SID", () => {
    clear();
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    expect(isVoiceConfigured()).toBe(false);
  });
  it("true con config mínima (account + twiml + auth token)", () => {
    clear();
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_TWIML_APP_SID = "AP";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    expect(isVoiceConfigured()).toBe(true);
  });
  it("true usando API key secret en vez de auth token", () => {
    clear();
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_TWIML_APP_SID = "AP";
    process.env.TWILIO_API_KEY_SECRET = "sec";
    expect(isVoiceConfigured()).toBe(true);
  });
});
