import { describe, it, expect } from "vitest";
import {
  claveFicha,
  contactoDelAsesor,
  enlaceWhatsAppAlAsesor,
  enlaceParaReenviar,
  faltantesDelPerfil,
  generarTokenFicha,
  lemaDe,
  nombreDesarrollo,
  precioDestacado,
  vistaDeDesarrollo,
  vistaDeUnidad,
  type AsesorFuente,
} from "./ficha";
import type { PublishedDevelopmentDetail, PublishedUnit } from "@/lib/hub/catalog-types";

// #887 — Ficha técnica compartible. Lo que estas pruebas cuidan:
//   1. Que la ficha pública NO lleve lo que el catálogo trae para uso interno (comisión, relación
//      comercial, contacto del desarrollador).
//   2. Que el contacto sea el del asesor, con un orden de respaldo razonable, y que desaparezca
//      si el asesor ya no está activo.

function desarrollo(extra: Partial<PublishedDevelopmentDetail> = {}): PublishedDevelopmentDetail {
  return {
    id: "dev-1",
    slug: "torre-alba",
    name: "Torre Alba",
    developerName: "Grupo Uno",
    developmentType: "Departamentos",
    stage: "Preventa",
    city: "Tulum",
    state: "Quintana Roo",
    zone: "Aldea Zamá",
    priceMinMxn: 3_200_000,
    priceMaxMxn: 6_500_000,
    currency: "MXN",
    totalUnits: 40,
    availableUnits: 12,
    reservedUnits: 3,
    soldUnits: 25,
    publishedUnits: 5,
    discountedUnitsCount: 0,
    coverImage: "https://cdn.test/a.webp",
    estimatedDelivery: "2027-12-01",
    deliveryText: "Diciembre 2027",
    constructionProgress: 35,
    images: ["https://cdn.test/a.webp", "https://cdn.test/b.webp", "http://inseguro.test/c.jpg"],
    amenities: ["Alberca", "Gimnasio"],
    propertyTypes: ["Departamento", "Penthouse"],
    descriptionEs: "Descripción larga.",
    descriptionShortEs: "Descripción corta.",
    roiProjected: 9,
    roiRentalMonthly: null,
    roiAppreciation: null,
    financingDownPayment: 30,
    financingMonths: [12, 24],
    financingInterest: 0,
    address: "Calle 1",
    neighborhood: null,
    municipality: "Tulum",
    lat: 20.2,
    lng: -87.4,
    mapsUrl: null,
    beachDistance: "5 min",
    brochureUrl: null,
    virtualTourUrl: null,
    masterplan: null,
    videoUrl: null,
    commissionRate: 5,
    crmRelationship: "Exclusiva con condiciones especiales",
    contactName: "Juan del Desarrollador",
    contactPhone: "+52 984 000 0000",
    realName: "Torre Alba",
    publicationTitle: "Departamentos con rooftop en Tulum",
    ...extra,
  };
}

function unidad(extra: Partial<PublishedUnit> = {}): PublishedUnit {
  return {
    id: "u-1",
    slug: "torre-alba-302",
    title: "Depto 302",
    unitNumber: "302",
    unitType: "Departamento",
    typology: "2R",
    status: "Disponible",
    isPresale: true,
    bedrooms: 2,
    bathrooms: 2,
    halfBaths: 1,
    areaM2: 110,
    builtAreaM2: 95.5,
    priceMxn: 4_000_000,
    priceUsd: null,
    currency: "MXN",
    discountPriceMxn: null,
    discountPct: null,
    isDiscountActive: false,
    coverImage: "https://cdn.test/u-portada.webp",
    developmentId: "dev-1",
    developmentName: "Torre Alba",
    developmentSlug: "torre-alba",
    city: "Tulum",
    zone: "Aldea Zamá",
    finDirecto: true,
    finHipotecario: false,
    finEnganchePct: 20,
    finMesesOpciones: [18],
    finTasa: null,
    finEsquemasPago: null,
    finPreventa: null,
    ...extra,
  };
}

function asesor(extra: Partial<AsesorFuente> = {}): AsesorFuente {
  return {
    name: "Ana López",
    email: "ana@propyte.com",
    phone: null,
    avatarUrl: null,
    isActive: true,
    deletedAt: null,
    profile: {
      jobTitle: "Asesora Senior",
      photoUrl: "https://cdn.test/ana.jpg",
      phoneDirect: "984 123 4567",
      whatsappNumber: "+52 1 984 765 4321",
      emailFromAlias: null,
    },
    ...extra,
  };
}

describe("lo que la ficha pública NO puede llevar", () => {
  const prohibidos = ["Exclusiva con condiciones especiales", "Juan del Desarrollador", "+52 984 000 0000"];

  it("la ficha del desarrollo no lleva comisión, relación comercial ni contacto del desarrollador", () => {
    const texto = JSON.stringify(vistaDeDesarrollo(desarrollo()));
    for (const p of prohibidos) expect(texto).not.toContain(p);
    expect(texto).not.toMatch(/comisi/i);
    expect(Object.keys(vistaDeDesarrollo(desarrollo()))).not.toContain("commissionRate");
  });

  it("la ficha de la unidad tampoco", () => {
    const texto = JSON.stringify(vistaDeUnidad(unidad(), desarrollo(), []));
    for (const p of prohibidos) expect(texto).not.toContain(p);
    expect(texto).not.toMatch(/comisi/i);
  });

  it("solo usa fotos https", () => {
    expect(vistaDeDesarrollo(desarrollo()).fotos).toEqual(["https://cdn.test/a.webp", "https://cdn.test/b.webp"]);
  });
});

describe("vista del desarrollo", () => {
  it("resume lo necesario", () => {
    const v = vistaDeDesarrollo(desarrollo());
    expect(v.tipo).toBe("DESARROLLO");
    expect(v.titulo).toBe("Torre Alba");
    expect(v.ubicacion).toBe("Aldea Zamá, Tulum, Quintana Roo");
    expect(v.descripcion).toBe("Descripción corta.");
    expect(v.enlaceSitio).toBe("https://propyte.com/es/desarrollos/torre-alba");
    expect(v.datos.map((d) => d.etiqueta)).toEqual([
      "Tipo",
      "Entrega",
      "Avance de obra",
      "Unidades disponibles",
      "Financiamiento",
      "Distancia a la playa",
    ]);
    expect(precioDestacado(v)).toMatch(/^Desde \$3,200,000/);
  });

  it("omite los datos vacíos en vez de mostrar «—»", () => {
    const v = vistaDeDesarrollo(
      desarrollo({ deliveryText: null, estimatedDelivery: null, beachDistance: null, constructionProgress: null })
    );
    expect(v.datos.map((d) => d.etiqueta)).not.toContain("Entrega");
    expect(v.datos.map((d) => d.etiqueta)).not.toContain("Distancia a la playa");
    expect(v.datos.map((d) => d.etiqueta)).not.toContain("Avance de obra");
  });

  it("recorta una descripción larga en un espacio", () => {
    const larga = "palabra ".repeat(200);
    const v = vistaDeDesarrollo(desarrollo({ descriptionShortEs: null, descriptionEs: larga }));
    expect(v.descripcion!.length).toBeLessThanOrEqual(601);
    expect(v.descripcion!.endsWith("palabra…")).toBe(true);
  });
});

describe("vista de la unidad", () => {
  it("pone primero las fotos de la unidad y completa con las del desarrollo, sin repetir", () => {
    const v = vistaDeUnidad(unidad(), desarrollo(), ["https://cdn.test/u-portada.webp", "https://cdn.test/u2.webp"]);
    expect(v.fotos).toEqual([
      "https://cdn.test/u-portada.webp",
      "https://cdn.test/u2.webp",
      "https://cdn.test/a.webp",
      "https://cdn.test/b.webp",
    ]);
  });

  it("muestra el precio con descuento y el de lista tachado", () => {
    const v = vistaDeUnidad(
      unidad({ isDiscountActive: true, discountPriceMxn: 3_600_000, priceMxn: 4_000_000 }),
      desarrollo(),
      []
    );
    expect(v.precio).toMatch(/3,600,000/);
    expect(v.precioAntes).toMatch(/4,000,000/);
    expect(precioDestacado(v)).toBe(v.precio);
  });

  it("arma los datos técnicos de la unidad", () => {
    const v = vistaDeUnidad(unidad(), desarrollo(), []);
    const datos = Object.fromEntries(v.datos.map((d) => [d.etiqueta, d.valor]));
    expect(v.titulo).toBe("Depto 302");
    expect(v.subtitulo).toBe("Torre Alba");
    expect(v.etapa).toBe("Preventa");
    expect(datos["Recámaras"]).toBe("2");
    expect(datos["Baños"]).toBe("2 y 1 medio");
    expect(datos["Construcción"]).toBe("95.5 m²");
    expect(datos["Superficie total"]).toBe("110 m²");
    expect(datos["Financiamiento"]).toContain("Crédito directo");
    expect(datos["Financiamiento"]).toContain("20% de enganche");
  });

  it("sin precio en MXN usa el de USD", () => {
    const v = vistaDeUnidad(unidad({ priceMxn: null, priceUsd: 250_000 }), desarrollo(), []);
    expect(v.precio).toMatch(/250,000/);
  });
});

describe("contacto del asesor", () => {
  it("toma los datos de su perfil", () => {
    const c = contactoDelAsesor(asesor())!;
    expect(c).toEqual({
      nombre: "Ana López",
      puesto: "Asesora Senior",
      foto: "https://cdn.test/ana.jpg",
      telefono: "+529841234567",
      // El "1" de celular de la marcación vieja se quita, como en el resto del CRM.
      whatsapp: "529847654321",
      correo: "ana@propyte.com",
    });
    expect(faltantesDelPerfil(c)).toEqual([]);
  });

  it("sin WhatsApp propio usa el teléfono directo; sin perfil, el teléfono y avatar del usuario", () => {
    const sinWa = contactoDelAsesor(asesor({ profile: { ...asesor().profile!, whatsappNumber: null } }))!;
    expect(sinWa.whatsapp).toBe("529841234567");

    const sinPerfil = contactoDelAsesor(asesor({ profile: null, phone: "9981112233", avatarUrl: "https://cdn.test/av.png" }))!;
    expect(sinPerfil.telefono).toBe("+529981112233");
    expect(sinPerfil.whatsapp).toBe("529981112233");
    expect(sinPerfil.foto).toBe("https://cdn.test/av.png");
  });

  it("sin ningún teléfono avisa qué falta", () => {
    const c = contactoDelAsesor(asesor({ profile: null }))!;
    expect(c.whatsapp).toBeNull();
    expect(faltantesDelPerfil(c)).toEqual(["WhatsApp o teléfono", "puesto"]);
  });

  it("usa el alias de correo si lo tiene", () => {
    const c = contactoDelAsesor(asesor({ profile: { ...asesor().profile!, emailFromAlias: "ventas.ana@propyte.com" } }))!;
    expect(c.correo).toBe("ventas.ana@propyte.com");
  });

  it("un asesor inactivo o borrado ya no aparece en sus fichas", () => {
    expect(contactoDelAsesor(asesor({ isActive: false }))).toBeNull();
    expect(contactoDelAsesor(asesor({ deletedAt: new Date() }))).toBeNull();
  });
});

describe("compartir", () => {
  it("la clave es una por asesor y por desarrollo/unidad", () => {
    expect(claveFicha("u1", "d1", null)).toBe("u1:d1:-");
    expect(claveFicha("u1", "d1", "x")).toBe("u1:d1:x");
    expect(claveFicha("u2", "d1", null)).not.toBe(claveFicha("u1", "d1", null));
  });

  it("el token es largo, de URL y distinto cada vez", () => {
    const a = generarTokenFicha();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generarTokenFicha()).not.toBe(a);
  });

  it("el WhatsApp al asesor menciona la propiedad", () => {
    const c = contactoDelAsesor(asesor())!;
    const href = enlaceWhatsAppAlAsesor(c, vistaDeUnidad(unidad(), desarrollo(), []))!;
    expect(href.startsWith("https://wa.me/529847654321?text=")).toBe(true);
    expect(decodeURIComponent(href.split("text=")[1])).toBe(
      "Hola Ana, vi la ficha de Depto 302 de Torre Alba y me interesa recibir más información."
    );
    expect(enlaceWhatsAppAlAsesor({ ...c, whatsapp: null }, vistaDeDesarrollo(desarrollo()))).toBeNull();
  });

  it("el reenvío manda el MISMO enlace", () => {
    const url = "https://crm.propyte.com/f/abc";
    const href = enlaceParaReenviar(url, vistaDeDesarrollo(desarrollo()));
    expect(decodeURIComponent(href.split("text=")[1])).toBe(
      "Te comparto la ficha técnica de Torre Alba: https://crm.propyte.com/f/abc"
    );
  });
});

describe("nombre y lema del desarrollo (#898)", () => {
  // En los 27 desarrollos publicados, `name` del catálogo es la frase comercial
  // (`COALESCE(publication_title, name)`). La ficha tiene que decir CUÁL desarrollo es.
  it("el título es el nombre real, no la frase comercial", () => {
    const d = desarrollo({ name: "Casas 3 y 4 Recámaras en Preventa", realName: "Nubba", publicationTitle: "Casas 3 y 4 Recámaras en Preventa" });
    const v = vistaDeDesarrollo(d);
    expect(v.titulo).toBe("Nubba");
    expect(v.lema).toBe("Casas 3 y 4 Recámaras en Preventa");
  });

  it("la unidad lleva el nombre real del desarrollo como subtítulo", () => {
    const d = desarrollo({ name: "Naturaleza Ancestral", realName: "Lavanda (Saumeria)" });
    expect(vistaDeUnidad(unidad(), d, []).subtitulo).toBe("Lavanda (Saumeria)");
  });

  it("sin realName (catálogo viejo) cae a name", () => {
    expect(nombreDesarrollo({ realName: null, name: " Torre Alba " })).toBe("Torre Alba");
  });

  it("el lema quita lo que ya dice la ficha", () => {
    expect(lemaDe("Villalta Laguna Cancún | Departamentos frente a la laguna | Onix Living", "Villalta Laguna", "Onix Living")).toBe(
      "Departamentos frente a la laguna"
    );
    expect(lemaDe("The Landmark Playa del Carmen | Torre frente a la Quinta", "The Landmark Playa del Carmen")).toBe(
      "Torre frente a la Quinta"
    );
    expect(lemaDe(" Naturaleza Ancestral Encuentra el Lujo Contemporáneo", "Lavanda (Saumeria)")).toBe(
      "Naturaleza Ancestral Encuentra el Lujo Contemporáneo"
    );
    // Sin acentos ni mayúsculas de por medio.
    expect(lemaDe("CENTRAL PARK CANCÚN TOWERS", "Central Park Cancun Towers")).toBeNull();
    expect(lemaDe(null, "Nubba")).toBeNull();
  });
});
