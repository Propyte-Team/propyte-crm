/**
 * Quién puede lanzar un agente. Tarjeta #714 (S-03).
 *
 * EL HUECO: `POST /api/agents/[id]/run` solo pedía sesión. Cualquier cuenta del CRM —un
 * asesor, recepción, marketing— podía disparar un agente, y los agentes tienen
 * herramientas de ESCRITURA: `send_whatsapp` le manda un mensaje a una persona real
 * (`lib/agents/tools.ts`) y `capture_lead` da de alta contactos. O sea que el permiso más
 * consecuente del sistema era el único sin puerta.
 *
 * LA DECISIÓN, y conviene que se revise: **ADMIN y DIRECTOR.** El razonamiento es que un
 * agente le habla a un cliente en nombre de la empresa, así que el permiso pertenece a
 * quien responde por eso, no a quien atiende un lead. Se deja fuera GERENTE a propósito
 * —aunque es defendible incluirlo— porque la dirección segura de esta puerta es abrirla
 * después de que alguien la pida y no cerrarla después de un incidente. **Añadir un rol es
 * una línea en esta lista.**
 *
 * Por qué se puede cerrar sin preguntar, aunque cambie quién puede hacer algo: la revisión
 * no registra NINGUNA corrida de agente en los últimos 14 días (`crm_anomalias`, serie
 * `corridas_de_agente`: último día completo 0, mediana 0), así que hoy no le quita a nadie
 * algo que esté usando. Si mañana alguien lo necesita, se ve en el 403 y se añade su rol.
 *
 * El camino de cron (`x-cron-secret`) NO pasa por aquí: es el motor disparándose a sí mismo
 * y su credencial ya es la puerta. Esto gobierna a las personas.
 */
export const ROLES_QUE_CORREN_AGENTES = ["ADMIN", "DIRECTOR"] as const;

export function puedeCorrerAgentes(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ROLES_QUE_CORREN_AGENTES as readonly string[]).includes(role);
}

/**
 * Tope al `input` que se le pasa al agente.
 *
 * La otra mitad de S-03: el esquema era `z.record(z.unknown())`, o sea cualquier objeto de
 * cualquier tamaño, y ese objeto acaba dentro del prompt del modelo. Sin tope, quien pueda
 * llamar al endpoint puede empujar un texto arbitrariamente largo —coste de tokens— y
 * tiene todo el espacio del mundo para intentar reescribir las instrucciones del agente.
 *
 * El tope no impide una inyección: la acota. Es una barandilla, no una defensa, y se dice
 * así a propósito para que nadie la tome por lo segundo. La defensa de verdad es que las
 * herramientas de escritura estén gobernadas, que es lo que hace la lista de arriba.
 */
export const TOPE_CLAVES_INPUT = 32;
export const TOPE_BYTES_INPUT = 8 * 1024;

export type RechazoDeInput = { motivo: string };

export function inputFueraDeTope(input: Record<string, unknown>): RechazoDeInput | null {
  const claves = Object.keys(input);
  if (claves.length > TOPE_CLAVES_INPUT) {
    return { motivo: `input con ${claves.length} claves; el tope es ${TOPE_CLAVES_INPUT}` };
  }
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  } catch {
    // Referencias circulares: JSON.stringify truena. Un input que no se puede serializar
    // tampoco se le puede pasar al modelo, así que se rechaza en vez de dejarlo pasar.
    return { motivo: "input no serializable" };
  }
  if (bytes > TOPE_BYTES_INPUT) {
    return { motivo: `input de ${bytes} bytes; el tope es ${TOPE_BYTES_INPUT}` };
  }
  return null;
}
