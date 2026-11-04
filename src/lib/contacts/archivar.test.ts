import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { IDS_DE_CANAL, datosDeArchivado, idsQuePasanAlQueQueda } from "./archivar";

// #903: archivar un contacto suelta sus ids de canal únicos.
describe("datosDeArchivado", () => {
  it("marca borrado y pone en null los tres ids de canal", () => {
    const ahora = new Date("2026-11-04T18:00:00Z");
    expect(datosDeArchivado(ahora)).toEqual({
      deletedAt: ahora,
      instagramId: null,
      messengerPsid: null,
      whatsappUserId: null,
    });
  });

  it("IDS_DE_CANAL cubre todas las columnas únicas y opcionales de contacto, salvo zohoId", () => {
    // Si alguien agrega otro id único (p. ej. TikTok), esta prueba obliga a decidir si archivar lo
    // suelta. zohoId se conserva a propósito: no es un canal por el que la persona escriba, es el
    // enlace con su registro de Zoho, y un archivado tiene que seguir apuntando a él.
    const NO_SE_SUELTAN = ["zohoId"];
    const campos = Prisma.dmmf.datamodel.models.find((m) => m.name === "Contact")!.fields;
    const unicosOpcionales = campos
      .filter((f) => f.isUnique && !f.isRequired && f.kind === "scalar" && !NO_SE_SUELTAN.includes(f.name))
      .map((f) => f.name);
    expect([...unicosOpcionales].sort()).toEqual([...IDS_DE_CANAL].sort());
  });
});

describe("idsQuePasanAlQueQueda", () => {
  it("solo pasan los canales que el que queda no tiene", () => {
    expect(
      idsQuePasanAlQueQueda(
        { instagramId: "ig-1", messengerPsid: null },
        { instagramId: "ig-2", messengerPsid: "psid-2", whatsappUserId: "MX.wa-2" },
      ),
    ).toEqual({ messengerPsid: "psid-2", whatsappUserId: "MX.wa-2" });
  });

  it("nada que pasar si el fusionado no tiene ids", () => {
    expect(idsQuePasanAlQueQueda({}, { instagramId: null })).toEqual({});
  });
});
