// Catálogo de campos CORE del contacto (columnas Prisma) con su etiqueta en español.
// #934: vive aparte, sin Prisma, para que también lo use la cronología (lib/timeline/format.ts,
// que corre en el navegador). core-fields.ts lo reexporta: nadie tiene que cambiar su import.
import { CAMPOS_ADICIONALES, GRUPO_CAMPOS_ADICIONALES } from "@/lib/contacts/campos-adicionales";

export interface CoreFieldDef {
  key: string;
  label: string;
  group: string;
}

// Campos editables/visibles del módulo Contacto (orden = grupos del detalle).
export const CORE_FIELDS: Record<string, CoreFieldDef[]> = {
  contact: [
    { key: "firstName", label: "Nombre", group: "Datos" },
    { key: "lastName", label: "Apellido", group: "Datos" },
    { key: "phone", label: "Teléfono", group: "Datos" },
    { key: "secondaryPhone", label: "Teléfono 2", group: "Datos" },
    { key: "whatsappUserId", label: "Usuario de WhatsApp", group: "Datos" },
    { key: "email", label: "Email", group: "Datos" },
    { key: "preferredLanguage", label: "Idioma", group: "Datos" },
    { key: "residenceCity", label: "Ciudad", group: "Ubicación" },
    { key: "residenceCountry", label: "País", group: "Ubicación" },
    { key: "nationality", label: "Nacionalidad", group: "Ubicación" },
    { key: "investmentProfile", label: "Perfil de inversión", group: "Perfil de inversión" },
    { key: "propertyType", label: "Tipo de propiedad", group: "Perfil de inversión" },
    { key: "purchaseTimeline", label: "Horizonte de compra", group: "Perfil de inversión" },
    { key: "budgetMin", label: "Presupuesto mín.", group: "Perfil de inversión" },
    { key: "budgetMax", label: "Presupuesto máx.", group: "Perfil de inversión" },
    { key: "paymentMethod", label: "Forma de pago", group: "Perfil de inversión" },
    { key: "preferredZone", label: "Zona preferida", group: "Perfil de inversión" },
    { key: "purchaseModality", label: "Modalidad de compra", group: "Perfil de inversión" },
    { key: "rentalStrategy", label: "Estrategia de renta", group: "Perfil de inversión" },
    { key: "contactStatus", label: "Estado del contacto", group: "Clasificación" },
    { key: "temperature", label: "Temperatura", group: "Clasificación" },
    { key: "contactType", label: "Tipo de contacto", group: "Clasificación" },
    { key: "urgency", label: "Urgencia", group: "Clasificación" },
    { key: "score", label: "Score", group: "Clasificación" },
    // AUD-20260710-04: fuente editable inline en el detalle — gateable por rol desde aquí
    { key: "leadSource", label: "Fuente del lead", group: "Clasificación" },
    // #907: el broker que trajo al contacto. Gateable igual que los demás; si se oculta, la
    // ficha no muestra la liga ni la lista de referidos (ver contacts/[id]/page.tsx).
    { key: "referredById", label: "Registrado por", group: "Clasificación" }, // #929: antes «Referido por»
    // #914: «Información adicional» — de la lista única, sin copiarla.
    ...CAMPOS_ADICIONALES.map((c) => ({ key: c.key, label: c.label, group: GRUPO_CAMPOS_ADICIONALES })),
  ],
};

export function coreFieldKeys(object: string): Set<string> {
  return new Set((CORE_FIELDS[object] ?? []).map((f) => f.key));
}
