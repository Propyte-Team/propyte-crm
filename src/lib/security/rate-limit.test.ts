import { describe, it, expect, beforeEach } from "vitest";
import {
  POLITICAS,
  registrarIntento,
  olvidarIntentos,
  ipDe,
  _reiniciar,
} from "./rate-limit";

// Tarjeta #714 (S-06). Antes de esto no existía NINGÚN límite de intentos en `src/`, así
// que el archivo entero es cobertura nueva: el negativo no es «esto fallaba», es «esto no
// existía». Lo que se prueba aquí es lo que hace que el límite sirva de algo —que la
// ventana DESLICE y que un acierto perdone— porque las dos son fáciles de romper sin que
// nada se note: un límite mal hecho sigue devolviendo `false` de vez en cuando.

const AHORA = 1_757_000_000_000; // instante fijo; el reloj se inyecta

beforeEach(() => _reiniciar());

describe("registrarIntento — el tope", () => {
  it("permite hasta el tope y rechaza el siguiente", () => {
    const { tope } = POLITICAS.otp_verificar;

    for (let i = 0; i < tope; i++) {
      const r = registrarIntento("otp_verificar", "ana@propyte.com", AHORA);
      expect(r.permitido, `el intento ${i + 1} de ${tope} debería pasar`).toBe(true);
      expect(r.restantes).toBe(tope - i - 1);
    }

    const pasado = registrarIntento("otp_verificar", "ana@propyte.com", AHORA);
    expect(pasado.permitido).toBe(false);
    expect(pasado.restantes).toBe(0);
    expect(pasado.esperarMs).toBeGreaterThan(0);
  });

  it("cada identificador tiene su propio cupo", () => {
    // Si el cupo fuera global, el primer usuario que se equivoca bloquea a toda la empresa.
    for (let i = 0; i < POLITICAS.login.tope; i++) {
      registrarIntento("login", "ana@propyte.com", AHORA);
    }

    expect(registrarIntento("login", "ana@propyte.com", AHORA).permitido).toBe(false);
    expect(registrarIntento("login", "beto@propyte.com", AHORA).permitido).toBe(true);
  });

  it("cada política tiene su propio cupo sobre el MISMO identificador", () => {
    // Quemar los 5 del código no debe dejar a nadie sin sus 10 de contraseña: son dos
    // credenciales distintas y el login usa una u otra según el método.
    for (let i = 0; i < POLITICAS.otp_verificar.tope; i++) {
      registrarIntento("otp_verificar", "ana@propyte.com", AHORA);
    }

    expect(registrarIntento("otp_verificar", "ana@propyte.com", AHORA).permitido).toBe(false);
    expect(registrarIntento("login", "ana@propyte.com", AHORA).permitido).toBe(true);
  });
});

describe("registrarIntento — la ventana DESLIZA, no se vacía de golpe", () => {
  it("un intento que salió de la ventana deja de contar", () => {
    const { tope, ventanaMs } = POLITICAS.otp_verificar;
    for (let i = 0; i < tope; i++) registrarIntento("otp_verificar", "ana@propyte.com", AHORA);
    expect(registrarIntento("otp_verificar", "ana@propyte.com", AHORA).permitido).toBe(false);

    // Justo antes de que expire el más viejo: sigue cerrado.
    expect(
      registrarIntento("otp_verificar", "ana@propyte.com", AHORA + ventanaMs - 1).permitido
    ).toBe(false);

    // Pasada la ventana entera: hay cupo otra vez.
    expect(
      registrarIntento("otp_verificar", "ana@propyte.com", AHORA + ventanaMs + 1).permitido
    ).toBe(true);
  });

  it("un cubo fijo dejaría pasar el doble del tope a caballo entre dos ventanas", () => {
    // Este es el defecto clásico y el motivo de que la ventana deslice. Con un contador que
    // se reinicia cada N minutos, un atacante mete `tope` al final de un cubo y `tope` al
    // principio del siguiente: el doble en un instante. Aquí no.
    const { tope, ventanaMs } = POLITICAS.otp_verificar;
    const casiFuera = AHORA + ventanaMs - 1000;

    for (let i = 0; i < tope; i++) registrarIntento("otp_verificar", "ana@propyte.com", AHORA);

    // 1 segundo antes de que el lote viejo expire, no cabe ni uno más.
    expect(registrarIntento("otp_verificar", "ana@propyte.com", casiFuera).permitido).toBe(false);
  });

  it("`esperarMs` dice cuándo vuelve a haber cupo, medido sobre el intento más viejo", () => {
    const { tope, ventanaMs } = POLITICAS.otp_verificar;
    for (let i = 0; i < tope; i++) registrarIntento("otp_verificar", "ana@propyte.com", AHORA);

    const transcurrido = 60_000;
    const r = registrarIntento("otp_verificar", "ana@propyte.com", AHORA + transcurrido);

    expect(r.esperarMs).toBe(ventanaMs - transcurrido);
  });

  it("un intento rechazado NO alarga el castigo", () => {
    // Si el rechazo se registrara, quien siga insistiendo se bloquea para siempre y basta
    // un script tonto para dejar a un usuario fuera de su cuenta indefinidamente.
    const { tope, ventanaMs } = POLITICAS.otp_verificar;
    for (let i = 0; i < tope; i++) registrarIntento("otp_verificar", "ana@propyte.com", AHORA);

    for (let i = 0; i < 50; i++) {
      registrarIntento("otp_verificar", "ana@propyte.com", AHORA + 1000 + i);
    }

    expect(
      registrarIntento("otp_verificar", "ana@propyte.com", AHORA + ventanaMs + 1).permitido,
      "tras la ventana debería haber cupo pese a los 50 rechazos"
    ).toBe(true);
  });
});

describe("olvidarIntentos — un acierto perdona los fallos", () => {
  it("deja el cupo entero", () => {
    const { tope } = POLITICAS.login;
    for (let i = 0; i < tope - 1; i++) registrarIntento("login", "ana@propyte.com", AHORA);

    olvidarIntentos("login", "ana@propyte.com");

    const r = registrarIntento("login", "ana@propyte.com", AHORA);
    expect(r.permitido).toBe(true);
    expect(r.restantes, "el cupo debería estar entero otra vez").toBe(tope - 1);
  });

  it("solo olvida esa política y ese identificador", () => {
    registrarIntento("login", "ana@propyte.com", AHORA);
    registrarIntento("otp_verificar", "ana@propyte.com", AHORA);
    registrarIntento("login", "beto@propyte.com", AHORA);

    olvidarIntentos("login", "ana@propyte.com");

    expect(registrarIntento("login", "ana@propyte.com", AHORA).restantes).toBe(POLITICAS.login.tope - 1);
    expect(registrarIntento("otp_verificar", "ana@propyte.com", AHORA).restantes).toBe(
      POLITICAS.otp_verificar.tope - 2
    );
    expect(registrarIntento("login", "beto@propyte.com", AHORA).restantes).toBe(POLITICAS.login.tope - 2);
  });
});

describe("las políticas, con su razón", () => {
  it("el código de acceso es el más apretado, y por mucho", () => {
    // Es la única credencial con un espacio de búsqueda pequeño: 10^6 y diez minutos de
    // vida. La contraseña se puede permitir más margen porque quien se equivoca es casi
    // siempre su dueño.
    expect(POLITICAS.otp_verificar.tope).toBeLessThan(POLITICAS.login.tope);
    expect(POLITICAS.otp_verificar.tope).toBeLessThanOrEqual(5);
  });

  it("la ventana de verificación no sobrevive al código", () => {
    // El código vive 10 minutos (request-code y forgot-password). Una ventana MÁS LARGA
    // castigaría sobre un código que ya expiró; una más corta regalaría intentos extra
    // dentro de la vida del mismo código.
    expect(POLITICAS.otp_verificar.ventanaMs).toBe(10 * 60 * 1000);
  });
});

describe("ipDe", () => {
  it("toma el primero de x-forwarded-for, que es el cliente", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(ipDe(h)).toBe("203.0.113.7");
  });

  it("cae a x-real-ip", () => {
    expect(ipDe(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("devuelve null y NO una constante cuando no se puede saber", () => {
    // Con una constante de relleno, todos los clientes sin cabecera comparten cupo y se
    // bloquean entre sí — el límite se convertiría en el ataque.
    expect(ipDe(new Headers())).toBeNull();
    expect(ipDe(new Headers({ "x-forwarded-for": "" }))).toBeNull();
    expect(ipDe(new Headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});
