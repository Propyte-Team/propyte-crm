/**
 * Catálogo curado de prácticas de CRM inmobiliario.
 *
 * POR QUÉ EXISTE. Sin él, "busca mejoras" produce recomendaciones de manual: «agrega
 * scoring de leads», «implementa nurturing». Son ciertas, genéricas e inaccionables, y
 * llenan el tablero de tarjetas que nadie puede cerrar.
 *
 * `como_se_mide` ES OBLIGATORIO y es lo que hace útil el catálogo: obliga a que la
 * propuesta llegue con la cifra del CRM real. Una práctica sin criterio de medición no
 * entra aquí — se convertiría justo en el ruido que este archivo existe para evitar.
 *
 * `ya_existe_si` es el otro guardia: describe cómo se ve la práctica CUANDO YA ESTÁ.
 * Proponer algo que el CRM ya hace es el error más frecuente de una cosecha automática,
 * y ya ocurrió aquí: de dos tareas cosechadas y trabajadas, las dos estaban resueltas.
 *
 * 🚨 NINGÚN `como_se_mide` manda a `crm_codigo_buscar`, y no es un olvido. El índice de
 * código de GitHub no responde para este repo: `q=export repo:Propyte-Team/propyte-crm`
 * devuelve `total_count: 0` con `incomplete_results: true` en 5 de 5 corridas, contra un
 * repo público grande que sí devuelve cientos. Cinco prácticas dependían solo de esa
 * herramienta y por lo tanto no se podían medir (tarjeta #662). La ruta buena mientras
 * tanto es `crm_codigo_arbol` + `crm_codigo_leer`, que lee blobs reales sobre un SHA
 * concreto. Si algún día el índice revive, se puede volver — pero midiéndolo antes.
 */

export type Practica = {
  id: string;
  area: Area;
  practica: string;
  por_que: string;
  /** Cómo se comprueba contra ESTE CRM. Obligatorio. */
  como_se_mide: string;
  /** Cómo se ve cuando ya está implementada. Evita proponer lo que ya existe. */
  ya_existe_si: string;
};

export type Area =
  | "velocidad"
  | "calidad_lead"
  | "pipeline"
  | "seguimiento"
  | "inventario"
  | "reportes"
  | "adopcion";

export const PRACTICAS: Practica[] = [
  {
    id: "sla-primera-respuesta",
    area: "velocidad",
    practica: "La primera respuesta a un lead nuevo ocurre en minutos, no en horas.",
    por_que:
      "La probabilidad de contactar a un prospecto cae de forma abrupta pasada la primera hora. En obra nueva el lead suele estar cotizando con tres desarrolladoras a la vez.",
    como_se_mide:
      "crm_pulso() → sla.incumplidos_7d SOBRE sla.temporizadores_7d, nunca el numerador solo: con el denominador en cero, `incumplidos_7d: 0` significa que no se midió nada, no que se cumplió. sla.vencidos_sin_marcar es el otro revelador: son temporizadores que siguen RUNNING con su hora ya pasada, es decir incumplimientos que nadie marcó. Si vencidos_sin_marcar > 0 mientras incumplidos_7d se ve sano, el tablero está mintiendo.",
    ya_existe_si:
      "Hay al menos una SlaPolicy activa que cubre el alta de contacto, y la proporción de BREACHED sobre el total de temporizadores del periodo es baja.",
  },
  {
    id: "lead-sin-dueno",
    area: "velocidad",
    practica: "Ningún lead se queda sin asesor asignado.",
    por_que:
      "Un lead sin dueño no tiene a quién reclamarle el seguimiento. Es la fuga más silenciosa: no aparece como error en ningún log.",
    como_se_mide:
      "crm_codigo_arbol + crm_codigo_leer sobre las reglas de enrutamiento (RoutingRule) y contraste con crm_pulso() → leads.reales_7d. Si hay reglas activas pero el reparto se concentra en un solo asesor, el round-robin está secuestrando leads.",
    ya_existe_si:
      "Existen RoutingRule activas que cubren todos los orígenes de lead vigentes, y ninguna deja un hueco por territorio o por tipo de producto.",
  },
  {
    id: "origen-del-lead-completo",
    area: "calidad_lead",
    practica:
      "El asesor puede registrar el origen REAL del lead: el catálogo del formulario cubre todos los canales activos.",
    por_que:
      "Si el formulario no ofrece el canal por el que llegó el lead, el asesor elige el más parecido. A partir de ahí, todo reporte de atribución está midiendo una ficción, y las decisiones de pauta se toman sobre esa ficción.",
    como_se_mide:
      "Comparar el enum LeadSource del esquema contra las opciones que ofrece el formulario de alta en el código, y ambos contra crm_pulso() → leads.por_origen_7d. Un canal con inversión publicitaria activa que no aparece en el catálogo del formulario es el hallazgo.",
    ya_existe_si:
      "El selector de origen ofrece el mismo número de opciones que el enum, o la diferencia está documentada como deliberada.",
  },
  {
    id: "leads-de-conector-sin-perdida",
    area: "calidad_lead",
    practica: "Todo lead que entrega el anunciante termina como contacto o como error explicado.",
    por_que:
      "Un lead que el conector recibió y no supo procesar YA SE PAGÓ. Es el fallo más caro del CRM y no duele en ninguna pantalla: simplemente no aparece.",
    como_se_mide:
      "crm_fallos() → leads_de_conector_perdidos. Cada grupo trae su conteo y su firma de error. Cruzar con crm_pulso() → conectores para ver si el conector además acumula errores.",
    ya_existe_si:
      "leads_de_conector_perdidos está vacío, o los grupos que aparecen son duplicados legítimos y no fallos de mapeo.",
  },
  {
    id: "dedup-por-telefono-y-correo",
    area: "calidad_lead",
    practica: "El mismo prospecto no se duplica al llegar por dos canales.",
    por_que:
      "Un prospecto duplicado se reparte entre dos asesores, que lo llaman por separado. El costo no es la fila extra: es la llamada repetida que el cliente recibe.",
    como_se_mide:
      "crm_codigo_arbol + crm_codigo_leer del guardia de duplicados en el alta de contactos, y verificar que cubra teléfono Y correo. Contrastar con crm_fallos(): un grupo de errores de clave única indica que el guardia está actuando tarde.",
    ya_existe_si:
      "El alta rechaza un teléfono ya registrado con un conflicto explícito, y el mismo guardia corre en la ruta de los conectores, no solo en el formulario.",
  },
  {
    id: "etapas-sin-estancamiento",
    area: "pipeline",
    practica: "Ninguna etapa del pipeline acumula deals que ya no se mueven.",
    por_que:
      "Un pipeline con la mitad de los deals atorados en una etapa temprana no es un pipeline: es una lista de pendientes disfrazada de pronóstico, y el pronóstico se usa para decidir inversión.",
    como_se_mide:
      "crm_pulso() → deals_por_etapa. Una etapa que concentra una fracción desproporcionada del total, o NEW_LEAD creciendo mientras las etapas siguientes no, es la señal.",
    ya_existe_si:
      "La distribución por etapa se estrecha de forma monótona hacia el cierre, sin acumulaciones en las primeras.",
  },
  {
    id: "automatizaciones-vivas",
    area: "seguimiento",
    practica: "Las automatizaciones activas efectivamente disparan.",
    por_que:
      "Una regla marcada como activa que nunca disparó da una falsa sensación de cobertura: el equipo cree que el seguimiento está automatizado y nadie lo hace a mano.",
    como_se_mide:
      "crm_pulso() → automatizaciones.activas contra totales, y crm_fallos() → acciones_fallidas y acciones_agotadas. Una regla activa sin lastFiredAt es una regla dormida; una acción agotada es seguimiento que se perdió sin aviso.",
    ya_existe_si:
      "Las reglas activas tienen disparos recientes y la cola de acciones no acumula agotadas. " +
      "🚨 OJO: mientras el CRM esté en BETA las reglas están pausadas A PROPÓSITO — ver " +
      "`contexto_declarado` en crm_revision_protocolo(). En ese caso «0 activas» NO es un hallazgo; " +
      "lo que sí lo es es que una regla ENCENDIDA falle o que la cola acumule agotadas.",
  },
  {
    id: "cadencia-de-seguimiento",
    area: "seguimiento",
    practica: "Cada lead tiene una cadencia definida de contactos, no un recordatorio suelto.",
    por_que:
      "La mayoría de las ventas de obra nueva cierran después de varios contactos. Un CRM que solo agenda el siguiente paso deja que la cadencia dependa de la disciplina de cada asesor.",
    como_se_mide:
      "Contar ActionPlan activos y sus inscripciones (ActionPlanEnrollment) vía crm_codigo_arbol + crm_codigo_leer sobre las consultas existentes, contrastando con crm_pulso() → leads.reales_7d. Si entran leads y no se inscriben en ningún plan, la cadencia no está operando.",
    ya_existe_si:
      "Existen ActionPlan activos y la mayoría de los leads nuevos queda inscrito en alguno de forma automática.",
  },
  {
    id: "inventario-sin-vender-lo-vendido",
    area: "inventario",
    practica: "El CRM no ofrece unidades que ya se vendieron.",
    por_que:
      "Cotizar una unidad vendida quema la relación con el cliente en el peor momento: cuando ya decidió comprar. Este error ya ocurrió en un sitio de esta casa.",
    como_se_mide:
      "Cruzar el estado de las unidades con los deals en etapas de cierre (RESERVED, CONTRACT_SIGNED, WON) vía crm_codigo_arbol + crm_codigo_leer sobre las consultas de disponibilidad. Una unidad con deal ganado que sigue apareciendo como disponible es el hallazgo.",
    ya_existe_si:
      "La consulta de unidades disponibles excluye las comprometidas por un deal en etapa de cierre.",
  },
  {
    id: "eventos-que-se-procesan",
    area: "seguimiento",
    practica: "La cola de eventos no acumula pendientes.",
    por_que:
      "Los eventos sin procesar son automatizaciones que no corrieron. El síntoma no es un error: es que nada pasó, y nada pasando no dispara ninguna alarma.",
    como_se_mide:
      "crm_pulso() → eventos_sin_procesar y crm_fallos() → eventos_sin_procesar_por_tipo. Cualquier valor que crezca día con día indica que el cron que los consume no está corriendo.",
    ya_existe_si:
      "El conteo se mantiene cerca de cero entre corridas; un pico aislado que baja solo es normal.",
  },
  {
    id: "metas-con-linea-base",
    area: "reportes",
    practica: "Las metas del equipo se comparan contra una línea base medida, no contra un deseo.",
    por_que:
      "Una meta sin línea base no se puede evaluar: cualquier resultado se puede narrar como éxito o fracaso según convenga.",
    como_se_mide:
      "crm_anomalias() → series.leads_reales_nuevos y series.deals_nuevos dan la línea base real por mediana. Contrastar con las metas configuradas (modelo Goal) vía crm_codigo_arbol + crm_codigo_leer.",
    ya_existe_si:
      "Las metas vigentes están dentro de un rango razonable de la mediana observada, en vez de ser múltiplos arbitrarios.",
  },
  {
    id: "adopcion-real-por-rol",
    area: "adopcion",
    practica: "Cada rol con acceso usa el CRM; una licencia sin actividad es un proceso que ocurre fuera.",
    por_que:
      "Si un rol no registra actividad, su trabajo está pasando por WhatsApp o por una hoja de cálculo. El CRM entonces reporta una parte del negocio y se toman decisiones creyendo que reporta todo.",
    como_se_mide:
      "crm_pulso() → usuarios_activos por rol, contra el volumen de actividad del periodo. Un rol con usuarios activos y sin contactos ni deals asociados en 7 días es el hallazgo.",
    ya_existe_si:
      "Todos los roles con usuarios activos muestran actividad en el periodo.",
  },
];
