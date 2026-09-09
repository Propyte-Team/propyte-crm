import { describe, it, expect } from "vitest";

// Tarjeta #685. `PROVIDER_SOURCE` mapeaba 6 de los 19 valores de `ConnectorProvider` y los
// 13 restantes caían a "WEBSITE" —WhatsApp y los cinco portales inmobiliarios entre ellos—
// así que cualquier reporte de atribución sumaba a web lo que vino de un portal.
//
// El candado que la tarjeta pedía: una prueba que falle si el mapa se queda corto. Aquí va
// sin depender del cliente de Prisma generado, para que corra también en entornos donde ese
// cliente no se puede descargar (los mismos 17 fallos de siempre). La paridad estricta
// contra el enum real es la línea comentada del final.

import { PROVIDER_SOURCE, SOURCE_SIN_MAPEAR } from "./connectors";
import { LEAD_SOURCE_ORDER } from "@/lib/constants";

/**
 * Los 19 valores de `enum ConnectorProvider` en prisma/schema.prisma, escritos a mano.
 * Si alguien agrega uno al esquema y no lo agrega aquí, la prueba de paridad estricta que
 * corre con el cliente generado lo atrapa; esta lista es para poder comprobar la cobertura
 * sin ese cliente.
 */
const PROVEEDORES = [
  "META", "INSTAGRAM", "MESSENGER", "TIKTOK", "WEBSITE", "ZAPIER", "MANUAL",
  "GOOGLE", "LINKEDIN", "INMUEBLES24", "LAMUDI_PROPPIT", "PROPIEDADES",
  "VIVANUNCIOS", "EASYBROKER", "GOOGLE_ADS", "YOUTUBE", "PINTEREST", "CUSTOM",
  "WHATSAPP",
] as const;

describe("PROVIDER_SOURCE cubre el catálogo completo (#685)", () => {
  it("los 19 proveedores tienen fuente asignada", () => {
    const sinMapear = PROVEEDORES.filter((p) => PROVIDER_SOURCE[p] === undefined);

    expect(
      sinMapear,
      `sin mapear: ${sinMapear.join(", ")} — caerían a "${SOURCE_SIN_MAPEAR}" y su atribución se perdería`
    ).toEqual([]);
  });

  it("no hay claves de más: una clave que no es proveedor no mapea nada", () => {
    // La deriva va en las dos direcciones. Una clave sobrante es código muerto que parece
    // cubrir algo.
    const sobrantes = Object.keys(PROVIDER_SOURCE).filter(
      (k) => !(PROVEEDORES as readonly string[]).includes(k)
    );

    expect(sobrantes, `claves que no son proveedores: ${sobrantes.join(", ")}`).toEqual([]);
  });

  it("cada fuente asignada es un LeadSource válido", () => {
    // Un valor fuera del enum de la base sería peor que el bug: el lead se descartaría
    // el campo al sanitizar y volvería a caer al default.
    for (const p of PROVEEDORES) {
      expect(
        LEAD_SOURCE_ORDER as readonly string[],
        `${p} → "${PROVIDER_SOURCE[p]}" no es un LeadSource válido`
      ).toContain(PROVIDER_SOURCE[p]);
    }
  });
});

describe("PROVIDER_SOURCE: los casos que la tarjeta señalaba (#685)", () => {
  it("WhatsApp ya no se registra como si viniera del sitio web", () => {
    expect(PROVIDER_SOURCE.WHATSAPP).toBe("WHATSAPP");
  });

  it("los cinco portales inmobiliarios van a PORTAL_INMOBILIARIO", () => {
    for (const portal of ["INMUEBLES24", "LAMUDI_PROPPIT", "PROPIEDADES", "VIVANUNCIOS", "EASYBROKER"]) {
      expect(PROVIDER_SOURCE[portal], `${portal} mal mapeado`).toBe("PORTAL_INMOBILIARIO");
    }
  });

  it("los seis sin equivalente van a OTRO, no a WEBSITE", () => {
    // Esta es la decisión que la tarjeta dejaba abierta: "WEBSITE" es una mentira concreta
    // —afirma un canal que no fue— y "OTRO" es ignorancia honesta. Un reporte con
    // prospectos en OTRO invita a preguntar; uno que los mete en web, no.
    for (const p of ["GOOGLE", "YOUTUBE", "PINTEREST", "ZAPIER", "MANUAL", "CUSTOM"]) {
      expect(PROVIDER_SOURCE[p], `${p} debería ser OTRO`).toBe("OTRO");
    }
  });

  it("GOOGLE genérico y GOOGLE_ADS no son lo mismo", () => {
    // Asumir que el conector GOOGLE es pauta sería inventar atribución de pago donde puede
    // no haberla: puede ser Workspace o un formulario.
    expect(PROVIDER_SOURCE.GOOGLE).toBe("OTRO");
    expect(PROVIDER_SOURCE.GOOGLE_ADS).toBe("GOOGLE_ADS");
  });

  it("el default de lo no mapeado es OTRO, no WEBSITE", () => {
    expect(SOURCE_SIN_MAPEAR).toBe("OTRO");
    expect(LEAD_SOURCE_ORDER as readonly string[]).toContain(SOURCE_SIN_MAPEAR);
  });

  it("los seis que ya estaban mapeados no cambiaron", () => {
    // El arreglo AÑADE cobertura; no debe mover lo que ya funcionaba, porque eso sí
    // cambiaría la atribución de las conexiones vivas.
    expect(PROVIDER_SOURCE.META).toBe("FACEBOOK_ADS");
    expect(PROVIDER_SOURCE.INSTAGRAM).toBe("INSTAGRAM");
    expect(PROVIDER_SOURCE.MESSENGER).toBe("MESSENGER");
    expect(PROVIDER_SOURCE.TIKTOK).toBe("TIKTOK_ADS");
    expect(PROVIDER_SOURCE.GOOGLE_ADS).toBe("GOOGLE_ADS");
    expect(PROVIDER_SOURCE.LINKEDIN).toBe("LINKEDIN");
  });
});
