# Shortlist v2 (PDF + promover a Quote) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Cerrar los follow-ups de la Shortlist: PDF imprimible del microsite `/p/[token]` y promover una unidad de la propuesta a una `Quote`.

**Architecture:** Sin migración. PDF = `window.print()` + `@media print`. Promover = reusar `POST /api/quotes` desde `ShortlistPanel`. Helper puro para elegir precio del snapshot.

**Tech Stack:** Next.js 14.2, React 18, vitest. Sin deps nuevas.

**Spec:** `docs/superpowers/specs/2026-06-16-shortlist-v2-pdf-promover-quote-design.md`

**Rama:** `feat/crm-shortlist-v2` apilada sobre `feat/crm-metas-scorecard`.

**Hechos verificados:** `POST /api/quotes` existe; `createQuote({dealId(req), hubUnitId?, listPrice, discountPct?, currency?, scheme})` arma `unitSnapshot` desde `getHubUnit`. `Quote.dealId` obligatorio. `Shortlist` tiene `dealId` (lo devuelve `getShortlistsFor`). `UnitSnapshot` (de `src/lib/shortlists/snapshot.ts`) tiene `precioMxn`/`precioUsd`/`moneda`/`hubUnitId`. El panel `src/components/shortlists/shortlist-panel.tsx` ya maneja la propuesta activa con sus items.

---

### Task 1: Helper puro `pickSnapshotPrice` + test (TDD)

**Files:** Create `src/lib/shortlists/quote-from-item.ts`, Test `src/lib/shortlists/quote-from-item.test.ts`

- [ ] **Step 1: Test** `src/lib/shortlists/quote-from-item.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pickSnapshotPrice } from "./quote-from-item";

describe("pickSnapshotPrice", () => {
  it("MXN → usa precioMxn", () => {
    expect(pickSnapshotPrice({ moneda: "MXN", precioMxn: 5200000, precioUsd: null }))
      .toEqual({ listPrice: 5200000, currency: "MXN" });
  });
  it("USD → usa precioUsd", () => {
    expect(pickSnapshotPrice({ moneda: "USD", precioMxn: null, precioUsd: 260000 }))
      .toEqual({ listPrice: 260000, currency: "USD" });
  });
  it("sin moneda → default MXN", () => {
    expect(pickSnapshotPrice({ precioMxn: 100, precioUsd: null }).currency).toBe("MXN");
  });
  it("sin precio → listPrice null", () => {
    expect(pickSnapshotPrice({ moneda: "MXN", precioMxn: null, precioUsd: null }).listPrice).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/shortlists/quote-from-item.test.ts` → FAIL (módulo falta).

- [ ] **Step 3: Implementar** `src/lib/shortlists/quote-from-item.ts`:
```ts
export interface PriceableSnapshot {
  moneda?: string | null;
  precioMxn?: number | null;
  precioUsd?: number | null;
}

/** Elige precio de lista + moneda del snapshot de la unidad para crear una Quote. */
export function pickSnapshotPrice(s: PriceableSnapshot): {
  listPrice: number | null;
  currency: "MXN" | "USD";
} {
  const currency: "MXN" | "USD" = s?.moneda === "USD" ? "USD" : "MXN";
  const listPrice = (currency === "USD" ? s?.precioUsd : s?.precioMxn) ?? null;
  return { listPrice, currency };
}
```

- [ ] **Step 4:** `npx vitest run src/lib/shortlists/quote-from-item.test.ts` → PASS (4 casos).

- [ ] **Step 5: Commit**
```bash
git add src/lib/shortlists/quote-from-item.ts src/lib/shortlists/quote-from-item.test.ts
git commit -m "feat(shortlist): helper pickSnapshotPrice + test"
```

---

### Task 2: PDF / print en `/p/[token]`

**Files:** Create `src/components/shortlists/print-button.tsx`; Modify `src/app/p/[token]/page.tsx`

- [ ] **Step 1:** Crear `src/components/shortlists/print-button.tsx`:
```tsx
"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      style={{ marginTop: 16, marginRight: 12, background: "#fff", color: "#0A0A0A", border: "1px solid #0A0A0A", padding: "10px 20px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
    >
      Imprimir / Guardar PDF
    </button>
  );
}
```

- [ ] **Step 2:** En `src/app/p/[token]/page.tsx`:
  - Importar `import { PrintButton } from "@/components/shortlists/print-button";`.
  - Renderizar `<PrintButton />` justo ANTES del enlace de WhatsApp.
  - Agregar `className="no-print"` al `<a>` de WhatsApp (es inline-styled; añadir el atributo `className="no-print"`).
  - Inyectar estilos print: agregar dentro del `<main>` (al inicio) un `<style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } }`}</style>`.

- [ ] **Step 3:** `npx tsc --noEmit` → sin errores en los archivos tocados.

- [ ] **Step 4: Commit**
```bash
git add src/components/shortlists/print-button.tsx "src/app/p/[token]/page.tsx"
git commit -m "feat(shortlist): PDF imprimible en /p/[token] (print + @media print)"
```

---

### Task 3: Promover unidad a Cotización en `ShortlistPanel`

**Files:** Modify `src/components/shortlists/shortlist-panel.tsx`

- [ ] **Step 1: Leer** `src/components/shortlists/shortlist-panel.tsx` para ubicar el tipo `ShortlistLite`, el render de items de la propuesta activa, y los imports.

- [ ] **Step 2:** Agregar `dealId: string | null;` al tipo `ShortlistLite` (la API `/api/shortlists` ya lo devuelve). Asegurar que `precioMxn`/`precioUsd`/`moneda` estén en el tipo del snapshot del item (ya están parcialmente; agregar `precioUsd?` si falta).

- [ ] **Step 3:** Importar el helper: `import { pickSnapshotPrice } from "@/lib/shortlists/quote-from-item";`.

- [ ] **Step 4:** Agregar la función dentro del componente:
```tsx
  async function promover(item: { hubUnitId: string; snapshot: any }) {
    if (!active?.dealId) return;
    const { listPrice, currency } = pickSnapshotPrice(item.snapshot ?? {});
    if (!listPrice) { alert("La unidad no tiene precio en el snapshot; no se puede cotizar."); return; }
    const res = await fetch("/api/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: active.dealId, hubUnitId: item.hubUnitId, listPrice, currency, scheme: "CONTADO" }),
    });
    if (res.ok) alert("Cotización creada en el negocio vinculado.");
    else { const j = await res.json().catch(() => ({})); alert(j.error ?? "No se pudo crear la cotización."); }
  }
```

- [ ] **Step 5:** En la fila de cada item de la propuesta activa, junto al botón "Quitar", agregar:
```tsx
<button
  className="text-xs text-[color:var(--text-secondary)] hover:underline disabled:opacity-40 disabled:no-underline"
  disabled={!active.dealId}
  title={active.dealId ? "Crear cotización de esta unidad" : "Vincula la propuesta a un negocio para cotizar"}
  onClick={() => promover(i)}
>
  Cotizar
</button>
```
(Ajustar `i` al nombre real de la variable del `.map` de items; las clases B/N a las que ya usa el panel.)

- [ ] **Step 6:** `npx tsc --noEmit` → sin errores.

- [ ] **Step 7: Commit**
```bash
git add src/components/shortlists/shortlist-panel.tsx
git commit -m "feat(shortlist): promover unidad a cotización (Quote) desde el panel"
```

---

### Task 4: Verificación + smoke

- [ ] **Step 1:** `npx vitest run` → verde (los previos + 4 nuevos).
- [ ] **Step 2:** `npm run build` → exit 0.
- [ ] **Step 3: Smoke local** (no requiere migración): abrir `/p/[token]` de una shortlist → "Imprimir / Guardar PDF" muestra el diálogo sin el botón ni el CTA WhatsApp. En un contacto con una propuesta **vinculada a un deal**, botón "Cotizar" en un item → crea Quote (verla en el deal/`/cotizaciones`). En una propuesta sin deal, "Cotizar" está deshabilitado con tooltip.

---

## Self-Review
- Cobertura: PDF → Task 2. Promover → Task 1 (helper) + Task 3 (UI/POST). Verificación → Task 4. ✅
- Sin migración (reusa Quote + print). ✅
- Tipos: `pickSnapshotPrice` (Task 1) consumido en Task 3; payload `/api/quotes` coincide con `createQuote`. ✅
- Sin placeholders; nombres reales a confirmar en implementación (variable del `.map`, clases B/N) — instruido.
