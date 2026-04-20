/**
 * Seed Propyte_faqs_zona con FAQs específicas por ciudad.
 * Cubre las 4 ciudades principales de Propyte (Cancún, Playa del Carmen, Tulum, Mérida).
 *
 * Uso: npx tsx scripts/seed-faqs-zona.ts [--dry-run]
 *
 * Idempotente: si ya hay rows con misma (ciudad, pregunta_es) hace UPDATE, si no INSERT.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const DRY_RUN = process.argv.includes("--dry-run");

const pwd = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(pwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasourceUrl: URL });

type FaqSeed = {
  ciudad: string;
  estado: string;
  pregunta_es: string;
  respuesta_es: string;
  pregunta_en?: string;
  respuesta_en?: string;
};

const FAQS: FaqSeed[] = [
  // ============= CANCUN =============
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuáles son las zonas con mejor plusvalía en Cancún?",
    respuesta_es: "La Zona Hotelera (Boulevard Kukulcán) y Puerto Cancún son las de mayor plusvalía histórica (8-12% anual), seguidas por Malecón Américas y zonas nuevas como Aqua. Los centros consolidados como Supermanzana 1 ofrecen mejor rentabilidad residencial a menor ticket de entrada.",
    pregunta_en: "Which areas in Cancún have the best property appreciation?",
    respuesta_en: "The Hotel Zone (Boulevard Kukulcán) and Puerto Cancún have the highest historical appreciation (8-12% annually), followed by Malecón Américas and newer areas like Aqua. Established centers like Supermanzana 1 offer better residential rental yields at a lower entry price.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuánto rinde una propiedad en renta vacacional en Cancún?",
    respuesta_es: "En Zona Hotelera y Puerto Cancún, un condo bien ubicado genera entre 8-14% anual neto en renta vacacional (Airbnb/Booking) con ocupación promedio de 65-80%. En zonas residenciales como Aqua o Residencial Cumbres el rendimiento baja a 5-8% anual pero con menor rotación.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué tan lejos está el aeropuerto de las zonas residenciales?",
    respuesta_es: "El Aeropuerto Internacional de Cancún (CUN) está a 20-30 minutos de Zona Hotelera, Puerto Cancún y Malecón Américas. Las zonas al norte (Aqua, Residencial Cumbres) quedan a 25-40 minutos. Hay servicio de transporte privado, Uber y ADO.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Es mejor comprar en Zona Hotelera o en zonas residenciales?",
    respuesta_es: "Zona Hotelera: máxima plusvalía + renta vacacional alta, pero HOA elevadas y menos habitable todo el año. Residenciales (Aqua, Puerto Cancún, Cumbres): mejor para vivir con familia, servicios privados, pero renta vacacional menor. Depende si buscas inversión pura o uso mixto.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuál es el rango de precios típico en Cancún?",
    respuesta_es: "Entrada: condos de 1 recámara desde $2-3M MXN en zonas emergentes (Residencial Cumbres, Arbolada). Medio: 2 recámaras en Puerto Cancún o Aqua desde $5-8M MXN. Alto: frente al mar en Zona Hotelera desde $8-15M MXN, penthouses desde $20M+.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué servicios y amenidades debo buscar en un desarrollo en Cancún?",
    respuesta_es: "Alberca climatizada, gimnasio, área de BBQ y terraza común son estándar. Para renta vacacional valora: acceso a playa (propio o cercano), lock-off studio, vista al mar/laguna, seguridad 24/7, parking 2 lugares, y administración profesional on-site.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Puedo rentar por Airbnb sin restricciones en Cancún?",
    respuesta_es: "Generalmente sí, pero cada desarrollo tiene su reglamento interno. Algunos condos residenciales prohíben rentas menores a 6 meses. En Zona Hotelera y Puerto Cancún la renta vacacional es común y permitida. Verifica siempre el reglamento y cuota HOA adicional si aplica.",
  },
  {
    ciudad: "Cancún",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué impuestos pago al comprar en Cancún?",
    respuesta_es: "ISABI (Impuesto de adquisición): 2% del valor catastral. Honorarios notariales: 1-2%. Avalúo: ~$5,000-15,000 MXN. Total aproximado 6-8% del precio. Si eres extranjero, sumar ~$25-45K MXN por constitución de fideicomiso bancario obligatorio en zona costera.",
  },

  // ============= PLAYA DEL CARMEN =============
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuáles son las mejores zonas para invertir en Playa del Carmen?",
    respuesta_es: "Centro / 5ta Avenida: máxima renta vacacional con ocupación de 75-90%. Playacar Fase 1 y 2: residencial exclusivo con campo de golf, plusvalía sólida. Corasol: desarrollo maestro con amenidades de lujo. Zonas emergentes al norte (Mayakoba) ofrecen ticket medio con alto potencial.",
    pregunta_en: "What are the best areas to invest in Playa del Carmen?",
    respuesta_en: "Downtown / 5th Avenue: highest vacation rental yield with 75-90% occupancy. Playacar Phases 1 and 2: exclusive residential with golf course, solid appreciation. Corasol: master-planned development with luxury amenities. Emerging northern areas (Mayakoba) offer mid-ticket with high upside.",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué tan rentable es una propiedad cerca de 5ta Avenida?",
    respuesta_es: "Un condo de 1-2 recámaras a 2-5 cuadras de 5ta Avenida genera 10-16% anual neto en renta vacacional con ocupación de 75-90% durante el año. La cercanía a la playa y a la peatonal es el factor #1 de precio y ocupación.",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Playa del Carmen está saturada o sigue creciendo?",
    respuesta_es: "Es una de las ciudades de mayor crecimiento de México (~7-10% anual en población). La zona norte (Mayakoba, Xcalacoco) y el sur (Playacar, Corasol) siguen desarrollándose. El centro histórico tiene oferta limitada — por eso mantiene plusvalía alta.",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Conviene comprar en preventa en Playa del Carmen?",
    respuesta_es: "Sí: típicamente ofrece 20-35% de descuento vs precio de entrega, enganches diferidos 10-18 meses sin interés, y plusvalía adicional de 15-25% durante construcción (18-36 meses). Riesgo: retrasos o desarrollador sin experiencia. Elige siempre desarrolladores con historial.",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuál es el rango de precios en Playa del Carmen?",
    respuesta_es: "Studio: desde $2-3M MXN en preventa fuera del centro. 1 recámara centro/playa: $3.5-6M MXN. 2 recámaras premium: $6-12M MXN. Penthouses con roof privado frente al mar: $12M+. Playacar y Corasol parten desde $8M MXN por townhouse.",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Cómo me traslado entre Playa del Carmen y Cancún?",
    respuesta_es: "Por la Carretera Federal 307 son 55-70 minutos. ADO corre cada 15-30 minutos desde CUN aeropuerto hasta centro Playa por ~$250 MXN. Uber y transporte privado cobran $800-1,500 MXN. Hay ferry a Cozumel desde el muelle de Playa (45 min, cada hora).",
  },
  {
    ciudad: "Playa del Carmen",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué amenidades son clave para renta vacacional en Playa?",
    respuesta_es: "Must: piscina con roof/terraza, seguridad 24/7, acceso a playa (directo o en club). Valor agregado: gimnasio, beach club con transporte, lock-off (renta 2 espacios), vista al mar. Para familia: kids club, piscina infantil. Para inversión pura: studios y 1 rec (mayor rotación).",
  },

  // ============= TULUM =============
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuáles son las diferencias entre Tulum Pueblo y Zona Hotelera?",
    respuesta_es: "Zona Hotelera / Costera: frente al mar, boho-chic, precios $8M+, renta vacacional premium, sin servicios municipales propios. Tulum Pueblo: moderno, servicios completos, Aldea Zamá y Región 15 son las zonas premium con precios desde $2.5M MXN. Para vivir, pueblo; para inversión vacacional de lujo, costera.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué es Aldea Zamá y por qué es tan popular?",
    respuesta_es: "Aldea Zamá es el fraccionamiento premium de Tulum Pueblo con urbanización privada, arquitectura tulumesca (tulum-style), jungla conservada y acceso controlado. Plusvalía histórica de 10-15% anual. Ticket de entrada desde $3-5M MXN, premium $8-15M. La más consolidada de Tulum.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Cómo impacta el nuevo aeropuerto de Tulum (TQO)?",
    respuesta_es: "El Aeropuerto Felipe Carrillo Puerto (TQO) opera desde dic-2023. Esperado: +25-40% de plusvalía a 3-5 años, triplicación de oferta turística, mejor conectividad. Ya conecta con CDMX, EUA, Canadá. Zonas beneficiadas: Región 15, Aldea Zamá, costera sur, y desarrollo hacia la carretera TQO.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué rendimiento puedo esperar en renta vacacional en Tulum?",
    respuesta_es: "Costera / frente al mar: 10-18% anual con ocupación 60-80% (temporada alta nov-abril). Aldea Zamá y Región 15 con alberca y diseño: 8-14% anual. Tulum es el destino con ADR (tarifa promedio diaria) más alto de México: $150-400 USD por noche en villas de diseño.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Hay problemas de agua, luz o servicios en Tulum?",
    respuesta_es: "Sí, es algo a considerar. La costera no tiene red municipal de agua ni drenaje — cada desarrollo depende de pozo propio + planta de tratamiento. En el pueblo y Aldea Zamá los servicios son CFE y red municipal. Cortes eléctricos son más frecuentes que en Cancún/Playa. Desarrollos buenos tienen planta solar + backup.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Qué tipos de propiedades se encuentran en Tulum?",
    respuesta_es: "Lofts y studios boho (desde $2.5M), condos de 1-2 rec con alberca privada o compartida ($3-8M), villas con piscina ($6-20M), y casas en la costera ($15M+). Lo más único: townhouses tulum-style con azotea y piscina plunge privada, estilo que define al destino.",
  },
  {
    ciudad: "Tulum",
    estado: "Quintana Roo",
    pregunta_es: "¿Cuánto cuesta mantener una propiedad en Tulum?",
    respuesta_es: "HOA: $2,500-8,000 MXN/mes en desarrollos premium (más alto que Playa/Cancún por infraestructura propia). Predial: 0.1-0.3% anual del valor catastral. Si rentas: administración 20-30% del bruto, limpieza entre huéspedes $800-1,500 MXN, mantenimiento piscina $1,500 MXN/mes.",
  },

  // ============= MÉRIDA =============
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Por qué Mérida se considera la ciudad más segura de México?",
    respuesta_es: "Según el INEGI y rankings internacionales, Mérida consistentemente aparece como la ciudad capital con menor tasa de homicidios del país (< 2 por 100k habitantes) y una de las 2-3 más seguras de Latinoamérica. Este factor es el #1 motor de migración interna e internacional hacia la ciudad.",
    pregunta_en: "Why is Mérida considered Mexico's safest city?",
    respuesta_en: "According to INEGI and international rankings, Mérida consistently has the lowest homicide rate of any state capital in Mexico (< 2 per 100k) and is among the 2-3 safest cities in Latin America. This is the #1 driver of domestic and international migration to the city.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Cuáles son las mejores zonas de Mérida para invertir?",
    respuesta_es: "Norte (Altabrisa, Montebello, Santa Gertrudis Copó, Temozón Norte): desarrollo premium, plusvalía 8-12% anual. Centro Histórico: casas coloniales con enorme potencial de renta airbnb y plusvalía alta. Cholul: zona en expansión con precios medios. Temozón Norte es el polo de mayor crecimiento actual.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Rinde la renta vacacional en Mérida?",
    respuesta_es: "Una casa colonial restaurada en Centro Histórico genera 9-15% anual neto en Airbnb con ocupación 65-85% (estancias largas de turistas canadienses/americanos nov-marzo). Casas modernas en el norte tienen renta residencial más estable (5-7% anual) con inquilinos de largo plazo.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Cuánto cuesta una casa en Mérida comparado con la Riviera Maya?",
    respuesta_es: "Significativamente menos: casa nueva de 3 recámaras en zona norte desde $3-5M MXN (en Playa la misma sería $8-12M). Casa colonial Centro para restaurar: $2.5-6M. Casa restaurada premium: $8-20M. El m² de construcción cuesta 40-50% menos que en Cancún o Playa del Carmen.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Cómo es el clima en Mérida y qué implica para la propiedad?",
    respuesta_es: "Calor húmedo todo el año, máximas de 38-42°C en mayo-julio. Todas las casas requieren aire acondicionado (presupuesta $3-8K MXN/mes en CFE si vives full-time). Construcción moderna con aislamiento ventilado y ventanas de doble cristal reduce 40-50% el consumo eléctrico.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Vale la pena comprar casa colonial en Centro de Mérida?",
    respuesta_es: "Para inversión y uso personal híbrido: excelente. Restauración costa $8-15K MXN/m² construcción. El retorno viene de Airbnb + plusvalía histórica del Centro. Riesgos: permisos de INAH si está catalogada, costos de mantenimiento de estructuras antiguas, humedad. Para renta residencial pura no es la mejor opción.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Qué impuestos pago al comprar en Mérida?",
    respuesta_es: "ISAI (Impuesto de adquisición): 2% del valor catastral. Honorarios notariales: ~1.5-2%. Avalúo y certificados: $5-12K MXN. Total aproximado 5-7% del precio. Mérida no requiere fideicomiso para extranjeros (no está en zona restringida costera), por lo que el trámite es más simple que en QR.",
  },
  {
    ciudad: "Mérida",
    estado: "Yucatán",
    pregunta_es: "¿Qué tan lejos está el mar desde Mérida?",
    respuesta_es: "30-45 minutos en auto por autopista hacia Progreso, Chicxulub, Telchac o Sisal. Muchos meridanos tienen 'casa de playa' como segunda propiedad — opción de inversión interesante: propiedad principal en Mérida + casa de playa en Progreso/Chicxulub desde $2-4M MXN.",
  },
];

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Seeding Propyte_faqs_zona con ${FAQS.length} FAQs`);
  let orden = 1;
  let prevCity = "";
  let inserted = 0, updated = 0, errors = 0;

  for (const f of FAQS) {
    if (f.ciudad !== prevCity) { orden = 1; prevCity = f.ciudad; }
    if (DRY_RUN) {
      console.log(`  [DRY] ${f.ciudad} #${orden}: ${f.pregunta_es.slice(0, 60)}…`);
      orden++;
      continue;
    }
    try {
      // Upsert por (ciudad, pregunta_es)
      const result = await db.$executeRawUnsafe(`
        INSERT INTO real_estate_hub."Propyte_faqs_zona"
          (ciudad, estado, pregunta_es, respuesta_es, pregunta_en, respuesta_en, orden, ext_publicado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        ON CONFLICT DO NOTHING
      `,
        f.ciudad, f.estado, f.pregunta_es, f.respuesta_es,
        f.pregunta_en ?? null, f.respuesta_en ?? null, orden
      );
      if (result > 0) inserted++; else updated++;
    } catch (e: any) {
      console.log(`  [ERR] ${f.ciudad}: ${e.message?.slice(0, 100)}`);
      errors++;
    }
    orden++;
  }

  if (!DRY_RUN) {
    const counts = await db.$queryRawUnsafe<Array<{ ciudad: string; count: bigint }>>(`
      SELECT ciudad, COUNT(*)::bigint AS count
      FROM real_estate_hub."Propyte_faqs_zona"
      GROUP BY ciudad ORDER BY ciudad
    `);
    console.log(`\nResumen: inserted=${inserted} / skipped=${updated} / errors=${errors}\n`);
    console.log("Totales por ciudad:");
    counts.forEach(c => console.log(`  ${c.ciudad}: ${c.count}`));
  }

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
