"use client";

interface EditableFieldProps {
  fieldKey: string;
  label: string;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  isEditing: boolean;
}

// Infer input type from field key
function getFieldType(key: string): "text" | "number" | "boolean" | "textarea" | "url" | "select" {
  // Boolean fields
  if (key.startsWith("amenidad_") || key === "es_verificado" || key === "ext_tiene_alberca" ||
      key === "ext_publicado" || key === "ext_destacado") return "boolean";

  // Number fields
  if (key.includes("precio") || key.includes("precio_venta") || key.includes("superficie") ||
      key.includes("unidades") || key.includes("recamaras") || key.includes("banos") ||
      key.includes("piso") || key.includes("porcentaje") || key.includes("rate") ||
      key.includes("roi") || key.includes("meses") || key.includes("tasa") ||
      key.includes("avance") || key === "latitud" || key === "longitud" ||
      key === "ext_reserved_units" || key === "ext_sold_units") return "number";

  // URL fields
  if (key.includes("url") || key.includes("brochure") || key.includes("tour_virtual") ||
      key.includes("video") || key === "sitio_web" || key === "logo" ||
      key === "plano_unidad" || key === "ext_source_url") return "url";

  // Textarea (long text) fields
  if (key.includes("descripcion") || key.includes("texto_brochure")) return "textarea";

  // Select fields
  if (key === "etapa_construccion" || key === "tipo_desarrollo" || key === "estado_unidad" ||
      key === "tipo_unidad" || key === "ext_moneda" || key === "ext_tipologia") return "select";

  return "text";
}

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  etapa_construccion: [
    { value: "PREVENTA", label: "Preventa" },
    { value: "CONSTRUCCION", label: "Construcción" },
    { value: "ENTREGA_INMEDIATA", label: "Entrega Inmediata" },
    { value: "VENDIDO", label: "Vendido" },
    { value: "SUSPENDIDO", label: "Suspendido" },
  ],
  tipo_desarrollo: [
    { value: "PROPIO", label: "Propio" },
    { value: "MASTERBROKER", label: "Masterbroker" },
    { value: "CORRETAJE", label: "Corretaje" },
  ],
  estado_unidad: [
    { value: "disponible", label: "Disponible" },
    { value: "apartada", label: "Apartada" },
    { value: "vendida", label: "Vendida" },
    { value: "no_disponible", label: "No Disponible" },
  ],
  tipo_unidad: [
    { value: "DEPTO_1REC", label: "Depto 1 Rec" },
    { value: "DEPTO_2REC", label: "Depto 2 Rec" },
    { value: "DEPTO_3REC", label: "Depto 3 Rec" },
    { value: "PENTHOUSE", label: "Penthouse" },
    { value: "CASA", label: "Casa" },
    { value: "TERRENO", label: "Terreno" },
    { value: "MACROLOTE", label: "Macrolote" },
    { value: "LOCAL", label: "Local" },
  ],
  ext_moneda: [
    { value: "MXN", label: "MXN" },
    { value: "USD", label: "USD" },
  ],
  ext_tipologia: [
    { value: "studio", label: "Studio" },
    { value: "1BR", label: "1 Recámara" },
    { value: "2BR", label: "2 Recámaras" },
    { value: "3BR", label: "3 Recámaras" },
    { value: "penthouse", label: "Penthouse" },
    { value: "casa", label: "Casa" },
    { value: "villa", label: "Villa" },
    { value: "terreno", label: "Terreno" },
  ],
};

const inputClasses = "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none";

export function EditableField({ fieldKey, label, value, onChange, isEditing }: EditableFieldProps) {
  const fieldType = getFieldType(fieldKey);

  // Read-only: skip image/array fields (handled by ImageGallery)
  if (fieldKey.includes("fotos_") || (fieldKey === "logo" && isEditing)) return null;

  if (!isEditing) return null; // Display is handled by FieldGrid

  if (fieldType === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600 min-w-[120px]">{label}</label>
        <button
          type="button"
          onClick={() => onChange(fieldKey, !value)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            value ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[18px]" : "translate-x-0.5"
          }`} />
        </button>
        <span className="text-xs text-gray-500">{value ? "Sí" : "No"}</span>
      </div>
    );
  }

  if (fieldType === "select") {
    const options = SELECT_OPTIONS[fieldKey] || [];
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">{label}</label>
        <select
          value={String(value || "")}
          onChange={(e) => onChange(fieldKey, e.target.value || null)}
          className={inputClasses}
        >
          <option value="">— Seleccionar —</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (fieldType === "textarea") {
    return (
      <div className="flex flex-col gap-1 col-span-2">
        <label className="text-xs text-gray-500">{label}</label>
        <textarea
          value={String(value || "")}
          onChange={(e) => onChange(fieldKey, e.target.value || null)}
          rows={3}
          className={`${inputClasses} resize-y`}
        />
      </div>
    );
  }

  if (fieldType === "number") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">{label}</label>
        <input
          type="number"
          value={value != null ? String(value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(fieldKey, v === "" ? null : Number(v));
          }}
          step={fieldKey.includes("latitud") || fieldKey.includes("longitud") ? "0.000001" : "any"}
          className={inputClasses}
        />
      </div>
    );
  }

  // text or url
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      <input
        type={fieldType === "url" ? "url" : "text"}
        value={String(value || "")}
        onChange={(e) => onChange(fieldKey, e.target.value || null)}
        className={inputClasses}
        placeholder={fieldType === "url" ? "https://..." : ""}
      />
    </div>
  );
}
