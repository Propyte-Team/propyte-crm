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
    agentName: "Agente Reclutamiento",
    name: "Reclutamiento — perfil de candidato",
    description:
      "Candidatos a unirse al equipo: nombre, puesto de interés, experiencia inmobiliaria, ciudad y contacto. " +
      "Sin presupuesto ni zona de compra. El agente no promete vacantes ni sueldos.",
    tasks: [
      {
        key: "nombre",
        targetField: "firstName",
        captureType: "FULL_NAME",
        objective: "Pide su nombre completo.",
      },
      {
        key: "puesto",
        targetField: "custom.puesto_interes",
        captureType: "ENUM",
        objective: "Pregunta qué puesto le interesa.",
        enumOptions: [
          { value: "ASESOR_VENTAS", synonyms: ["asesor", "ventas", "vendedor", "asesor inmobiliario", "comercial"] },
          { value: "TEAM_LEADER", synonyms: ["team leader", "líder de equipo", "gerente de ventas"] },
          { value: "MARKETING", synonyms: ["marketing", "mercadotecnia", "redes", "diseño", "community"] },
          { value: "ADMINISTRATIVO", synonyms: ["administrativo", "administración", "contabilidad", "recepción"] },
          { value: "OTRO", synonyms: ["otro", "cualquiera", "lo que haya"] },
        ],
      },
      {
        key: "experiencia",
        targetField: "custom.experiencia_inmobiliaria",
        captureType: "ENUM",
        objective:
          "Pregunta cuánta experiencia tiene en bienes raíces. Sin experiencia es una respuesta válida: " +
          "no la trates como un problema.",
        enumOptions: [
          { value: "SIN_EXPERIENCIA", synonyms: ["ninguna", "sin experiencia", "es mi primera vez", "nada"] },
          { value: "MENOS_1_ANO", synonyms: ["menos de un año", "unos meses", "recién empecé"] },
          { value: "DE_1_A_3_ANOS", synonyms: ["1 a 3 años", "dos años", "un par de años"] },
          { value: "MAS_DE_3_ANOS", synonyms: ["más de 3 años", "varios años", "muchos años"] },
        ],
      },
      {
        key: "ciudad",
        targetField: "residenceCity",
        captureType: "TEXT",
        objective: "Pregunta en qué ciudad vive o dónde busca trabajar, para saber a qué plaza canalizarlo.",
      },
      {
        key: "telefono",
        targetField: "phone",
        captureType: "PHONE",
        objective: "Pide un teléfono para que reclutamiento lo contacte.",
      },
      {
        key: "correo",
        targetField: "email",
        captureType: "EMAIL",
        required: false,
        objective: "Pide un correo para que pueda enviar su CV.",
      },
    ],
  },
];
