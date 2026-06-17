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
