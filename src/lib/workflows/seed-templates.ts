// Plantillas globales (userId=null) del seed F1. Módulo puro (sin Prisma) para poder testearlas.
export const GLOBAL_TEMPLATES = [
  {
    channel: "WHATSAPP" as const,
    name: "Primer contacto ES",
    shortcut: "/hola",
    language: "ES" as const,
    body:
      "Hola {{contact.firstName}}, soy {{user.name}} de Propyte. Gracias por tu interés" +
      " — ¿te gustaría que te comparta opciones según tu presupuesto y zona de interés?",
  },
  {
    channel: "WHATSAPP" as const,
    name: "First contact EN",
    shortcut: "/hello",
    language: "EN" as const,
    body:
      "Hi {{contact.firstName}}, this is {{user.name}} with Propyte. Thanks for reaching out" +
      " — would you like me to share options based on your budget and preferred area?",
  },
  {
    channel: "WHATSAPP" as const,
    name: "Seguimiento post-visita ES",
    shortcut: "/postvisita",
    language: "ES" as const,
    body:
      "{{contact.firstName}}, gracias por visitarnos. Te preparo la información de las unidades" +
      " que vimos y te la mando hoy mismo. ¿Hay algo específico que quieras revisar primero?",
  },
  {
    channel: "EMAIL" as const,
    name: "Presentación ES",
    shortcut: "/presentacion",
    language: "ES" as const,
    subject: "Opciones de inversión en la Riviera Maya — Propyte",
    body:
      "Hola {{contact.firstName}},\n\nSoy {{user.name}}, asesor en Propyte. Con gusto te acompaño" +
      " en tu búsqueda. Puedes agendar una llamada aquí: {{user.calendarUrl}}\n\nSaludos,\n{{user.name}}\n{{card.url}}",
  },
  // Plantillas que usan WF6/WF8 como `config.template`. actions.ts resuelve por id O nombre EXACTO
  // (activa, no borrada, idioma del contacto), así que `name` debe ser igual a la clave de la regla.
  // Solo {{contact.firstName}}: es la única variable que el motor rellena (una línea con variables
  // sin resolver se elimina completa, fillTemplate J.2).
  {
    channel: "WHATSAPP" as const,
    name: "pago_vencido",
    language: "ES" as const,
    body:
      "Hola {{contact.firstName}}, te escribimos de Propyte para recordarte que tienes un pago pendiente" +
      " con fecha vencida. ¿Nos confirmas cuándo podrías regularizarlo o si necesitas apoyo con el proceso?",
  },
  {
    channel: "WHATSAPP" as const,
    name: "bienvenida_postventa",
    language: "ES" as const,
    body:
      "Hola {{contact.firstName}}, ¡felicidades por tu compra y bienvenido a la familia Propyte!" +
      " Seguiremos acompañándote en cada paso. Cualquier duda, escríbenos por aquí.",
  },
  {
    channel: "EMAIL" as const,
    name: "encuesta_satisfaccion",
    language: "ES" as const,
    subject: "¿Cómo fue tu experiencia con Propyte?",
    body:
      "Hola {{contact.firstName}},\n\nGracias por confiar en Propyte. Tu opinión nos ayuda a mejorar:" +
      " ¿podrías responder este correo contándonos cómo fue tu experiencia y qué podríamos hacer mejor?\n\nSaludos,\nEquipo Propyte",
  },
  {
    channel: "WHATSAPP" as const,
    name: "referidos",
    language: "ES" as const,
    body:
      "Hola {{contact.firstName}}, esperamos que estés disfrutando tu inversión. Si conoces a alguien que" +
      " busque propiedad en la Riviera Maya, con gusto lo atendemos de tu parte. ¿Te comparto cómo funciona nuestro programa de referidos?",
  },
];
