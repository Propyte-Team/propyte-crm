import { upsertDevelopment, insertTypologies } from "@/lib/intake/catalog-writer";
import { intakePayloadSchema } from "@/lib/intake/schema";

async function main() {
  const payload = intakePayloadSchema.parse({
    generales: { nombre: "ZZZ Smoke Captura", tipo: "vertical" },
    ubicacion: { ciudad: "Playa del Carmen" },
    descripciones: { descripcionEs: "smoke" },
    tipologias: [{ etiqueta: "A", recamaras: 1, banosCompletos: 1, m2: 60, precioDesde: 1000000 }],
    faq: [],
  });
  const devId = await upsertDevelopment(payload, null);
  const n = await insertTypologies(payload, devId);
  console.log("OK dev", devId, "unidades", n);
}
main().catch((e) => { console.error(e); process.exit(1); });
