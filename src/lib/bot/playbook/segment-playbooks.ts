// Playbooks por segmento — un playbook por BotAgentProfile.
//
// Los 3 agentes del bot se sembraron con `playbookId = null`, así que los tres
// caían al playbook global "Calificación base" (nombre, presupuesto, zona, tipo
// de propiedad, plazo). Para un broker o un candidato a empleo esas preguntas no
// aplican: se le preguntaba presupuesto de inversión a alguien que venía a dejar
// su CV. Aquí vive el contenido; `scripts/seed-bot-playbooks-segmento.ts` solo lo
// aplica a la BD.
//
// Vive en src/ (y no dentro del script) para que `segment-playbooks.test.ts`
// pueda validar los `targetField` contra la whitelist. Importa: `resolveWrite`
// descarta un targetField desconocido con kind:"skip" **en silencio**, así que un
// typo aquí no rompería nada visible — simplemente el dato nunca se guardaría.
import type { CaptureType } from "@prisma/client";

export interface SegmentTaskSpec {
  key: string;
  /** Debe ser una llave de NATIVE_TARGET_FIELDS o `custom.<algo>`. Lo fija el test. */
  targetField: string;
  captureType: CaptureType;
  objective: string;
  required?: boolean;
  enumOptions?: { value: string; synonyms?: string[] }[];
  extractionHint?: string;
}

export interface SegmentPlaybookSpec {
  /** Nombre del BotAgentProfile al que se engancha. Debe existir en la BD. */
  agentName: string;
  name: string;
  description: string;
  tasks: SegmentTaskSpec[];
}

export const SEGMENT_PLAYBOOKS: SegmentPlaybookSpec[] = [
  {
    // #954 (2026-10-30): «Agente Clientes» pasó a llamarse «Agente Lead Comprador» (tipo
    // LEAD_COMPRADOR del #938). El aplicador busca agente y playbook POR NOMBRE: la migración
    // 2026-10-30-agentes-lead-comprador-y-vendedor.sql renombra las dos filas a la vez.
    agentName: "Agente Lead Comprador",
    name: "Lead Comprador — calificación de inversión",
    description:
      "Lead Comprador (compradores, inversionistas y leads) y referidos: zona, presupuesto, tipo de propiedad, plazo y perfil de inversión. " +
      "Es el playbook global más el perfil de inversión, que es lo que separa a un usuario final de un inversionista.",
    tasks: [
      {
        key: "nombre",
        targetField: "firstName",
        captureType: "FULL_NAME",
        objective: "Pregunta su nombre para poder dirigirte a él o ella de forma personal.",
      },
      {
        key: "zona",
        targetField: "preferredZone",
        captureType: "ZONE",
        objective: "Pregunta en qué zona o destino está buscando.",
      },
      {
        key: "presupuesto",
        targetField: "budgetMax",
        captureType: "BUDGET_RANGE",
        objective: "Pregunta el rango de presupuesto de inversión que maneja.",
      },
      {
        key: "tipo_propiedad",
        targetField: "propertyType",
        captureType: "ENUM",
        objective: "Pregunta qué tipo de propiedad busca.",
        enumOptions: [
          { value: "DEPARTAMENTO", synonyms: ["depa", "departamento", "depto", "condo"] },
          { value: "CASA", synonyms: ["casa", "residencia", "villa"] },
          { value: "TERRENO", synonyms: ["terreno", "lote"] },
          { value: "MACROLOTE", synonyms: ["macrolote"] },
          { value: "LOCAL_COMERCIAL", synonyms: ["local", "comercial", "oficina"] },
          { value: "OTRO", synonyms: ["otro"] },
        ],
      },
      {
        key: "plazo",
        targetField: "purchaseTimeline",
        captureType: "ENUM",
        objective: "Pregunta en qué plazo planea comprar.",
        enumOptions: [
          { value: "IMMEDIATE", synonyms: ["ya", "ahora", "inmediato", "de inmediato", "este mes"] },
          { value: "ONE_TO_THREE_MONTHS", synonyms: ["1 a 3 meses", "pronto", "unos meses"] },
          { value: "THREE_TO_SIX_MONTHS", synonyms: ["3 a 6 meses", "medio año"] },
          { value: "SIX_PLUS_MONTHS", synonyms: ["más de 6 meses", "el próximo año", "después", "solo explorando"] },
        ],
      },
      {
        key: "perfil_inversion",
        targetField: "investmentProfile",
        captureType: "ENUM",
        objective:
          'Averigua si la compra es para vivirla, para rentarla o como inversión de reventa. ' +
          'Pregúntalo natural ("¿la buscas para vivir o para invertir?"), no como formulario.',
        enumOptions: [
          { value: "END_USER", synonyms: ["para vivir", "uso propio", "vivirla", "mi casa"] },
          { value: "INVESTOR_RENTAL", synonyms: ["rentar", "airbnb", "renta vacacional", "ingresos"] },
          { value: "INVESTOR_FLIP", synonyms: ["revender", "reventa", "plusvalía", "flip"] },
          { value: "INVESTOR_LAND", synonyms: ["terreno de inversión", "banco de tierra"] },
          { value: "MIXED", synonyms: ["las dos", "ambas", "mixto", "vivir y rentar"] },
        ],
      },
    ],
  },
  {
    agentName: "Agente Brokers",
    name: "Brokers — alianza comercial",
    description:
      "Brokers externos y referidores: inmobiliaria, contacto, qué aportan (cliente o propiedad), zona donde " +
      "operan y esquema de colaboración. Nada de presupuesto de compra: el broker no es el comprador.",
    tasks: [
      {
        key: "nombre",
        targetField: "firstName",
        captureType: "FULL_NAME",
        objective: "Pregunta su nombre.",
      },
      {
        key: "inmobiliaria",
        targetField: "custom.inmobiliaria",
        captureType: "TEXT",
        objective: "Pregunta el nombre de su inmobiliaria o si trabaja de forma independiente.",
        extractionHint:
          'Guarda el nombre comercial tal cual lo diga. Si dice que es independiente o freelance, guarda "Independiente".',
      },
      {
        key: "telefono",
        targetField: "phone",
        captureType: "PHONE",
        objective: "Pide un teléfono de contacto directo para que alianzas lo busque.",
      },
      {
        key: "correo",
        targetField: "email",
        captureType: "EMAIL",
        required: false,
        objective: "Pide un correo para enviarle el esquema de colaboración por escrito.",
      },
      {
        key: "que_aporta",
        targetField: "custom.broker_aporta",
        captureType: "ENUM",
        objective:
          "Aclara si trae un cliente comprador, una propiedad para listar, o ambas cosas. " +
          "Es lo que define a quién se canaliza.",
        enumOptions: [
          { value: "CLIENTE", synonyms: ["tengo un cliente", "un comprador", "traigo cliente", "cliente"] },
          { value: "PROPIEDAD", synonyms: ["tengo una propiedad", "quiero listar", "inventario", "propiedad"] },
          { value: "AMBOS", synonyms: ["las dos", "ambas", "cliente y propiedad"] },
        ],
      },
      {
        key: "zona_operacion",
        targetField: "preferredZone",
        captureType: "ZONE",
        objective: "Pregunta en qué zona o ciudad opera.",
      },
      {
        key: "esquema",
        targetField: "custom.broker_esquema",
        captureType: "ENUM",
        required: false,
        objective:
          "Si surge de forma natural, identifica qué esquema de colaboración busca. " +
          "NO negocies porcentajes ni prometas comisiones: eso lo cierra un asesor senior.",
        enumOptions: [
          { value: "COMISION_COMPARTIDA", synonyms: ["comisión compartida", "split", "compartir comisión", "50/50"] },
          { value: "REFERIDO", synonyms: ["referido", "solo refiero", "pase de cliente"] },
          { value: "REPRESENTACION", synonyms: ["representación", "exclusiva", "represento al desarrollo"] },
          { value: "POR_DEFINIR", synonyms: ["no sé", "lo que se pueda", "por definir", "abierto"] },
        ],
      },
    ],
  },
  {
    // #955 (2026-10-30): dueños que quieren vender su propiedad (tipo LEAD_VENDEDOR del #938).
    // Todo va a `custom.propiedad_venta_*` y no a propertyType/preferredZone/budgetMax: esos
    // campos son lo que el contacto BUSCA comprar, y aquí es lo que OFRECE vender. Mezclarlos
    // haría que un vendedor apareciera en los filtros y reportes de compradores.
    agentName: "Agente Lead Vendedor",
    name: "Lead Vendedor — captación de propiedad",
    description:
      "Dueños que quieren vender: qué propiedad es, dónde está, precio que espera, situación legal y " +
      "en cuánto tiempo quiere vender. Nada de presupuesto de compra: el vendedor no viene a comprar.",
    tasks: [
      {
        key: "nombre",
        targetField: "firstName",
        captureType: "FULL_NAME",
        objective: "Pregunta su nombre para poder dirigirte a él o ella de forma personal.",
      },
      {
        key: "tipo_propiedad",
        targetField: "custom.propiedad_venta_tipo",
        captureType: "ENUM",
        objective: "Pregunta qué tipo de propiedad quiere vender.",
        enumOptions: [
          { value: "DEPARTAMENTO", synonyms: ["depa", "departamento", "depto", "condo"] },
          { value: "CASA", synonyms: ["casa", "residencia", "villa"] },
          { value: "TERRENO", synonyms: ["terreno", "lote"] },
          { value: "MACROLOTE", synonyms: ["macrolote"] },
          { value: "LOCAL_COMERCIAL", synonyms: ["local", "comercial", "oficina"] },
          { value: "OTRO", synonyms: ["otro"] },
        ],
      },
      {
        key: "ubicacion",
        targetField: "custom.propiedad_venta_ubicacion",
        captureType: "TEXT",
        objective: "Pregunta dónde está la propiedad: ciudad, zona y, si aplica, el nombre del desarrollo.",
        extractionHint:
          'Guarda la ubicación como la diga, en una línea (p. ej. "Tulum, Aldea Zamá").',
      },
      {
        key: "precio",
        targetField: "custom.propiedad_venta_precio",
        captureType: "MONEY",
        objective:
          "Pregunta en cuánto le gustaría venderla. Si todavía no lo sabe, está bien: no insistas, " +
          "el asesor le ayuda a definirlo.",
      },
      {
        key: "moneda",
        targetField: "custom.propiedad_venta_moneda",
        captureType: "ENUM",
        required: false,
        objective: "Si dio un precio y no queda claro, confirma si es en pesos o en dólares.",
        enumOptions: [
          { value: "MXN", synonyms: ["pesos", "mxn", "moneda nacional"] },
          { value: "USD", synonyms: ["dólares", "dolares", "usd", "dls"] },
        ],
      },
      {
        key: "situacion_legal",
        targetField: "custom.propiedad_venta_situacion_legal",
        captureType: "ENUM",
        objective:
          "Pregunta si la propiedad ya está escriturada a su nombre o si la compró en preventa " +
          "(cesión de derechos). Pregúntalo natural, no como trámite.",
        enumOptions: [
          { value: "ESCRITURADA", synonyms: ["escriturada", "tengo escrituras", "ya está escriturada", "a mi nombre"] },
          { value: "CESION_DE_DERECHOS", synonyms: ["preventa", "cesión de derechos", "todavía no me la entregan", "contrato de compraventa"] },
          { value: "EN_TRAMITE", synonyms: ["en trámite", "escriturando", "en proceso"] },
          { value: "OTRO", synonyms: ["no sé", "otro", "herencia", "intestado"] },
        ],
      },
      {
        key: "plazo_venta",
        targetField: "custom.propiedad_venta_plazo",
        captureType: "ENUM",
        objective: "Pregunta en cuánto tiempo le gustaría venderla.",
        enumOptions: [
          { value: "INMEDIATO", synonyms: ["ya", "lo antes posible", "urgente", "este mes"] },
          { value: "UNO_A_TRES_MESES", synonyms: ["1 a 3 meses", "pronto", "unos meses"] },
          { value: "TRES_A_SEIS_MESES", synonyms: ["3 a 6 meses", "medio año"] },
          { value: "SIN_PRISA", synonyms: ["sin prisa", "no tengo prisa", "solo explorando", "cuando se pueda"] },
        ],
      },
      {
        key: "telefono",
        targetField: "phone",
        captureType: "PHONE",
        objective: "Pide un teléfono para que el asesor de captación lo contacte.",
      },
    ],
  },
  {
    // Spec 2026-11-02 (bot de reclutamiento F1). Todo lo del candidato va a
    // custom.reclutamiento_<clave>; la evaluación (lib/reclutamiento) lo lee de ahí.
    // Orden = bloques del spec §4: básicos → filtros eliminatorios → puntuables → actitud.
    agentName: "Agente Reclutamiento",
    name: "Reclutamiento — perfil de candidato",
    description:
      "Candidatos a asesor inmobiliario en Playa del Carmen o Mérida: datos básicos, filtros (edad, comisión, " +
      "disponibilidad, colchón, plaza, movilidad), experiencia, cartera, inglés, prospección y tres preguntas de actitud. " +
      "Sin presupuesto ni zona de compra. El agente no promete contratación.",
    tasks: [
      { key: "nombre", targetField: "firstName", captureType: "FULL_NAME", objective: "Pide su nombre completo." },
      {
        key: "plaza", targetField: "custom.reclutamiento_plaza", captureType: "ENUM",
        objective: "Pregunta si quiere trabajar en Playa del Carmen o en Mérida; si vive en otra ciudad, pregunta si se mudaría.",
        enumOptions: [
          { value: "PDC", synonyms: ["playa", "playa del carmen", "riviera maya", "solidaridad"] },
          { value: "MERIDA", synonyms: ["mérida", "merida", "yucatán"] },
          { value: "OTRA_CON_MUDANZA", synonyms: ["me mudaría", "puedo mudarme", "me cambio de ciudad"] },
          { value: "OTRA_SIN_MUDANZA", synonyms: ["no me mudaría", "desde mi ciudad", "remoto", "a distancia"] },
        ],
      },
      { key: "telefono", targetField: "phone", captureType: "PHONE", objective: "Pide un teléfono con WhatsApp para coordinar la entrevista." },
      { key: "correo", targetField: "email", captureType: "EMAIL", required: false, objective: "Pide un correo, por si hay que mandarle información." },
      {
        key: "mayor_edad", targetField: "custom.reclutamiento_mayor_edad", captureType: "ENUM",
        objective: "Confirma con naturalidad que es mayor de edad.",
        enumOptions: [{ value: "SI", synonyms: ["sí", "si", "mayor de edad", "tengo 2", "tengo 3", "tengo 4", "tengo 5"] }, { value: "NO", synonyms: ["no", "menor", "tengo 17", "tengo 16"] }],
      },
      {
        key: "acepta_comision", targetField: "custom.reclutamiento_acepta_comision", captureType: "ENUM",
        objective: "Explica que el esquema es 100 % comisión, sin sueldo base, y pregunta si le funciona.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "si", "me funciona", "sin problema", "ya trabajo así"] },
          { value: "NO", synonyms: ["no", "necesito sueldo", "necesito base", "no me conviene"] },
          { value: "NO_SE", synonyms: ["no sé", "depende", "lo pensaría"] },
        ],
      },
      {
        key: "disponibilidad", targetField: "custom.reclutamiento_disponibilidad", captureType: "ENUM",
        objective: "Pregunta qué disponibilidad tiene: tiempo completo, medio tiempo o solo fines de semana.",
        enumOptions: [
          { value: "TIEMPO_COMPLETO", synonyms: ["tiempo completo", "todo el día", "completa", "full time"] },
          { value: "MEDIO_TIEMPO", synonyms: ["medio tiempo", "medio día", "por las tardes", "por las mañanas", "part time"] },
          { value: "FINES_DE_SEMANA", synonyms: ["fines de semana", "sábados", "solo fines"] },
          { value: "NO_SE", synonyms: ["no sé", "depende", "lo que se necesite"] },
        ],
      },
      {
        key: "colchon_meses", targetField: "custom.reclutamiento_colchon_meses", captureType: "ENUM",
        objective: "Explica que la primera venta suele tardar unos meses y pregunta cuántos meses de gastos tiene cubiertos mientras tanto.",
        extractionHint: "Convierte meses a rango: menos de 3 → MENOS_DE_TRES; 3 a 6 → TRES_A_SEIS; más de 6 → MAS_DE_SEIS.",
        enumOptions: [
          { value: "MENOS_DE_TRES", synonyms: ["1 mes", "2 meses", "menos de tres", "nada", "ninguno", "vivo al día"] },
          { value: "TRES_A_SEIS", synonyms: ["3 meses", "4 meses", "5 meses", "6 meses", "medio año"] },
          { value: "MAS_DE_SEIS", synonyms: ["más de 6", "un año", "varios meses", "tengo ahorros suficientes"] },
          { value: "NO_SE", synonyms: ["no sé", "no lo he calculado"] },
        ],
      },
      {
        key: "movilidad", targetField: "custom.reclutamiento_movilidad", captureType: "ENUM",
        objective: "Pregunta si tiene vehículo propio y disposición para moverse por la zona a mostrar propiedades.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "tengo coche", "tengo carro", "tengo auto", "tengo moto y puedo moverme"] },
          { value: "SOLO_DISPOSICION", synonyms: ["no tengo coche pero", "en transporte", "puedo moverme sin auto", "uber"] },
          { value: "NO", synonyms: ["no", "no tengo", "no puedo moverme"] },
        ],
      },
      {
        key: "experiencia_inmobiliaria", targetField: "custom.reclutamiento_experiencia_inmobiliaria", captureType: "ENUM",
        objective: "Pregunta cuánta experiencia tiene en bienes raíces. Sin experiencia es válido: no lo trates como problema.",
        enumOptions: [
          { value: "SIN_EXPERIENCIA", synonyms: ["ninguna", "sin experiencia", "primera vez", "nada"] },
          { value: "MENOS_1_ANO", synonyms: ["menos de un año", "unos meses", "recién empecé"] },
          { value: "DE_1_A_3_ANOS", synonyms: ["1 a 3 años", "dos años", "un par de años"] },
          { value: "MAS_DE_3_ANOS", synonyms: ["más de 3 años", "varios años", "muchos años"] },
        ],
      },
      {
        key: "cartera_clientes", targetField: "custom.reclutamiento_cartera_clientes", captureType: "ENUM",
        objective: "Pregunta si ya tiene cartera de clientes o contactos interesados en comprar, y de qué tamaño.",
        enumOptions: [
          { value: "NO", synonyms: ["no", "ninguna", "empezaría de cero"] },
          { value: "MENOS_10", synonyms: ["pocos", "algunos", "menos de 10", "cinco", "unos cuantos"] },
          { value: "DE_10_A_50", synonyms: ["10 a 50", "veinte", "treinta", "una base mediana"] },
          { value: "MAS_50_O_INVERSIONISTAS", synonyms: ["más de 50", "muchos", "inversionistas", "cartera grande", "base amplia"] },
        ],
      },
      {
        key: "experiencia_ventas", targetField: "custom.reclutamiento_experiencia_ventas", captureType: "ENUM",
        objective: "Pregunta si ha vendido algo antes y qué (autos, seguros, servicios, retail…).",
        enumOptions: [
          { value: "NINGUNA", synonyms: ["no", "nunca he vendido", "ninguna"] },
          { value: "OTRO_GIRO", synonyms: ["retail", "tienda", "mostrador", "telemarketing", "ventas en general"] },
          { value: "CONSULTIVA_ALTO_VALOR", synonyms: ["autos", "seguros", "créditos", "b2b", "servicios financieros", "ventas consultivas", "tiempo compartido"] },
        ],
      },
      {
        key: "ingles", targetField: "custom.reclutamiento_ingles", captureType: "ENUM",
        objective: "Pregunta su nivel de inglés.",
        enumOptions: [
          { value: "NO", synonyms: ["no", "nada", "muy poco"] },
          { value: "BASICO", synonyms: ["básico", "basico", "me defiendo", "intermedio bajo"] },
          { value: "CONVERSACIONAL", synonyms: ["conversacional", "fluido", "avanzado", "bilingüe", "intermedio alto"] },
        ],
      },
      {
        key: "prospeccion_digital", targetField: "custom.reclutamiento_prospeccion_digital", captureType: "ENUM",
        objective: "Pregunta si usa redes sociales para prospectar o publicar contenido.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "si", "instagram", "tiktok", "facebook", "publico contenido", "tengo seguidores"] },
          { value: "NO", synonyms: ["no", "casi no", "solo personal"] },
        ],
      },
      {
        key: "actitud_1", targetField: "custom.reclutamiento_actitud_1", captureType: "TEXT",
        objective: "Pregunta por qué quiere vender bienes raíces y no otra cosa.",
        extractionHint: "Guarda su respuesta completa tal cual, en una o dos frases.",
      },
      {
        key: "actitud_2", targetField: "custom.reclutamiento_actitud_2", captureType: "TEXT",
        objective: "Pídele que cuente la última vez que le dijeron que no y qué hizo.",
        extractionHint: "Guarda su respuesta completa tal cual.",
      },
      {
        key: "actitud_3", targetField: "custom.reclutamiento_actitud_3", captureType: "TEXT",
        objective: "Pregunta qué meta se pondría a 12 meses dentro del equipo.",
        extractionHint: "Guarda su respuesta completa tal cual.",
      },
    ],
  },
];
