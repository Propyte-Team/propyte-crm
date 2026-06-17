# Shortlist v2 — PDF imprimible + promover a Cotización

> Fecha: 2026-06-16. Cierra los follow-ups de la Shortlist "Propuesta express" (§5.11.4): PDF y "promover una unidad a Quote".
> Sin migración (reusa `Quote` existente + print del navegador). Rama apilada.

## Alcance

1. **PDF imprimible** del microsite `/p/[token]`: botón "Imprimir / Guardar PDF" (client) que llama `window.print()`, con estilos `@media print` que limpian el CTA/botón y dejan la propuesta lista para "Guardar como PDF". Mismo enfoque "imprimible" que `/q/[id]`.
2. **Promover unidad a Cotización**: en `ShortlistPanel`, por ítem, botón "Promover a cotización" que crea un `Quote` (modelo existente) desde el snapshot de la unidad. **Requiere que la shortlist tenga `dealId`** (el `Quote` exige `dealId`). Si no hay deal, el botón se deshabilita con tooltip "Vincula la propuesta a un negocio para cotizar".

## Detalle

### 1. PDF / print en `/p/[token]`
- Nuevo componente client `src/components/shortlists/print-button.tsx`: botón que hace `window.print()`. Se monta en la página pública (server) — patrón client-en-server válido.
- Estilos print: agregar un bloque `@media print` (en `globals.css` con una clase scope `.shortlist-print`, o inline `<style>` en la página) que oculte `.no-print` (el botón y el CTA de WhatsApp) y fuerce fondo blanco. Reusar el contenedor existente.
- El botón y el CTA WhatsApp llevan `className="no-print"`.

### 2. Promover a Quote
- **Datos:** del `ShortlistItem.snapshot` (UnitSnapshot) → `hubUnitId`, `precioMxn`/`precioUsd`, `moneda`. La shortlist aporta `dealId`.
- **API:** reusa `POST /api/quotes` (ya existe; body `{ dealId, hubUnitId, listPrice, currency, scheme }`). `listPrice` = precio del snapshot según moneda; `scheme` default `"CONTADO"`; `discountPct` 0.
- **Server:** no cambia `createQuote` (ya arma `unitSnapshot` desde `getHubUnit`). Solo se invoca.
- **UI (`ShortlistPanel`):**
  - Exponer `dealId` en el tipo `ShortlistLite` y leerlo del GET `/api/shortlists` (la API ya lo devuelve; solo falta tiparlo/usarlo).
  - Por cada ítem en la propuesta activa, botón "Cotizar":
    - Habilitado solo si `active.dealId` existe.
    - Al click: `POST /api/quotes` con `{ dealId, hubUnitId: item.hubUnitId, listPrice: precioDelSnapshot, currency, scheme: "CONTADO" }`. Éxito → toast/alert "Cotización creada" (v1: `alert`, consistente con el resto del panel).
  - Si `!active.dealId`: el botón se muestra deshabilitado con `title="Vincula la propuesta a un negocio para cotizar"`.

## Pruebas
- Helper puro `pickSnapshotPrice(snapshot)` → `{ listPrice: number|null, currency: "MXN"|"USD" }` (precio según `moneda`), con test (MXN, USD, sin precio).
- Resto: build + smoke local (imprimir `/p/[token]`; promover un ítem con deal vinculado → ver Quote creada en el deal).

## Riesgos / notas
- Sin migración. `Quote.dealId` es obligatorio → la promoción solo aplica a shortlists con deal; documentado en la UI.
- `window.print()` no genera PDF programático; el usuario usa "Guardar como PDF" del diálogo de impresión (igual que `/q`). PDF server-side (react-pdf) queda como follow-up si se pide branding fino.
- Crear una Quote es additivo y no dispara automatizaciones; smoke con datos de prueba.
