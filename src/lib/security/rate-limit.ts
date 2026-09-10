/**
 * Límite de intentos por ventana. Tarjeta #714 (S-06): hoy no existe NINGUNO en `src/`.
 *
 * QUÉ PROTEGE Y QUÉ NO — se declara arriba porque un límite que se cree más fuerte de lo
 * que es, es peor que no tenerlo: invita a dejar de vigilar.
 *
 * Protege: la fuerza bruta desde un puñado de orígenes contra un blanco concreto. El caso
 * que la tarjeta nombra es el código de 6 dígitos, que vive 10 minutos y hoy se puede
 * probar sin tope: son 10^6 combinaciones y con 5 intentos por ventana el espacio deja de
 * ser recorrible. También frena el bombardeo de correos a una persona.
 *
 * NO protege: un ataque distribuido desde muchas IPs contra muchas cuentas, ni sobrevive a
 * un despliegue —el estado vive en memoria del proceso y se reinicia—, ni se comparte entre
 * instancias si algún día hay más de una. Para eso hace falta Redis o una tabla, y las dos
 * cosas son decisión de infraestructura, no de una sesión. Se elige memoria a propósito:
 * **cero migración, cero dependencia nueva, y cubre el caso medido**. Un contador
 * persistente por usuario es justo lo que pide la #742, que necesita migración.
 *
 * NO se usa para autorizar nada. Solo cuenta y responde «ya van muchos».
 */

/** Un intento registrado: cuándo ocurrió. */
type Ventana = { intentos: number[] };

export type Politica = {
  /** Cuántos intentos se permiten dentro de la ventana. */
  tope: number;
  /** Tamaño de la ventana en milisegundos. */
  ventanaMs: number;
};

/**
 * Las políticas, en un solo sitio y con su razón escrita. Se exportan para que las pruebas
 * midan contra el valor real y no contra una copia.
 */
export const POLITICAS = {
  /**
   * Pedir un código de acceso. El riesgo aquí no es adivinar nada: es usar el CRM para
   * bombardear de correos a una persona. Tres en un cuarto de hora es más que suficiente
   * para alguien que no recibió el primero.
   */
  otp_solicitar: { tope: 3, ventanaMs: 15 * 60 * 1000 },
  /**
   * Verificar un código. **Este es el importante.** Con 5 intentos por cada diez minutos
   * —lo que vive el código— adivinar 6 dígitos deja de ser viable. Es el hueco concreto que
   * la #742 midió: «durante los diez minutos que vive el código se puede probar sin límite».
   */
  otp_verificar: { tope: 5, ventanaMs: 10 * 60 * 1000 },
  /**
   * Contraseña en el login. Más holgado a propósito: quien se equivoca de contraseña suele
   * ser el dueño de la cuenta, y bloquearlo en el tercer intento es un problema de soporte
   * más frecuente que el ataque que evita.
   */
  login: { tope: 10, ventanaMs: 15 * 60 * 1000 },
} as const satisfies Record<string, Politica>;

export type NombreDePolitica = keyof typeof POLITICAS;

const ventanas = new Map<string, Ventana>();

/**
 * Cada cuánto se barren las llaves vencidas. Sin esto el Map crece con cada correo distinto
 * que alguien pruebe, que es un vector de agotamiento de memoria — el límite se volvería el
 * ataque.
 */
const BARRIDO_CADA = 500;
let desdeElUltimoBarrido = 0;

function barrer(ahora: number): void {
  for (const [llave, v] of ventanas) {
    // La ventana más larga de todas las políticas: si no queda ni un intento dentro de
    // ella, la llave no puede afectar a ninguna comprobación futura.
    const masLarga = Math.max(...Object.values(POLITICAS).map((p) => p.ventanaMs));
    v.intentos = v.intentos.filter((t) => ahora - t < masLarga);
    if (v.intentos.length === 0) ventanas.delete(llave);
  }
}

export type Resultado = {
  /** `true` cuando el intento se permite (y queda registrado). */
  permitido: boolean;
  /** Cuántos quedan tras este. */
  restantes: number;
  /** Cuándo vuelve a haber cupo, en ms desde ahora. 0 si hay cupo. */
  esperarMs: number;
};

/**
 * Registra un intento y dice si se permite.
 *
 * `identificador` es lo que se está protegiendo: el correo normalizado, o el correo más la
 * IP. **Nunca un secreto**: la llave se queda en memoria y podría acabar en un volcado.
 *
 * `ahora` se inyecta para que las pruebas no dependan del reloj de quien corre la suite —
 * la misma razón por la que la puerta de revisión inyecta el suyo.
 */
export function registrarIntento(
  politica: NombreDePolitica,
  identificador: string,
  ahora: number = Date.now(),
): Resultado {
  const { tope, ventanaMs } = POLITICAS[politica];
  const llave = `${politica}:${identificador}`;

  if (++desdeElUltimoBarrido >= BARRIDO_CADA) {
    desdeElUltimoBarrido = 0;
    barrer(ahora);
  }

  const v = ventanas.get(llave) ?? { intentos: [] };
  // Se descartan los que ya salieron de la ventana ANTES de contar: es una ventana
  // deslizante, no un cubo que se vacía de golpe cada N minutos. Con un cubo fijo, un
  // atacante mete el doble del tope a caballo entre dos cubos.
  v.intentos = v.intentos.filter((t) => ahora - t < ventanaMs);

  if (v.intentos.length >= tope) {
    ventanas.set(llave, v);
    const masViejo = v.intentos[0];
    return { permitido: false, restantes: 0, esperarMs: Math.max(0, ventanaMs - (ahora - masViejo)) };
  }

  v.intentos.push(ahora);
  ventanas.set(llave, v);
  return { permitido: true, restantes: tope - v.intentos.length, esperarMs: 0 };
}

/**
 * Borra los intentos de un identificador. Se llama cuando el intento SALIÓ BIEN: quien
 * acertó su contraseña o su código no debe arrastrar el castigo de los fallos anteriores.
 * Sin esto, alguien que se equivoca nueve veces y acierta a la décima se queda a un fallo
 * de quedar bloqueado durante el siguiente cuarto de hora.
 */
export function olvidarIntentos(politica: NombreDePolitica, identificador: string): void {
  ventanas.delete(`${politica}:${identificador}`);
}

/** Solo para pruebas: deja el estado en blanco. */
export function _reiniciar(): void {
  ventanas.clear();
  desdeElUltimoBarrido = 0;
}

/**
 * La IP del cliente, de las cabeceras del proxy. Devuelve `null` cuando no se puede saber,
 * y quien llama debe tratar ese caso como «no hay IP» y no inventarse una constante: con una
 * constante, TODOS los clientes sin cabecera comparten cupo y se bloquean entre sí.
 */
export function ipDe(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    // El primero de la lista es el cliente; los siguientes son proxies.
    const primera = fwd.split(",")[0]?.trim();
    if (primera) return primera;
  }
  return headers.get("x-real-ip")?.trim() || null;
}
