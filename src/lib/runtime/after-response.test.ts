import { describe, it, expect, vi } from "vitest";

// El envoltorio no hace nada más que pasarle el callback a `after()` de Next: esta prueba
// fija exactamente eso, para que nadie lo convierta en un `await fn()` (que volvería a
// retener la respuesta) sin que algo se ponga rojo.
const after = vi.fn();
vi.mock("next/server", () => ({ after: (...a: unknown[]) => after(...a) }));

import { runAfterResponse } from "./after-response";

describe("runAfterResponse", () => {
  it("agenda el callback con after() y NO lo ejecuta en el momento", () => {
    const fn = vi.fn();
    runAfterResponse(fn);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
