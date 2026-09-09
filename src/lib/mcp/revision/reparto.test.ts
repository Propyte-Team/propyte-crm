import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { pulso } from "./handlers/pulso";
import { ROLES_RUTEABLES, asesorRuteableWhere, asesorTecnicoWhere } from "@/lib/workflows/ruteables";

/**
 * #678 apartado (e) — publicar el reparto en `crm_pulso`.
 *
 * La tarjeta lo pedía con estas palabras: «hoy la revisión no puede distinguir "no hay
 * reglas" de "las reglas no matchean", que son arreglos distintos». Y la #698 se estrelló
 * contra eso mismo: dio por raíz «no hay a quién asignarle nada», se dieron de alta seis
 * asesores reales el 03-sep, y los dos leads que entraron 45 minutos después siguieron sin
 * dueño y sin temporizador. La causa era otra y desde fuera no había forma de verla.
 *
 * Lo que se prueba aquí NO son los conteos —eso lo hace la base— sino la LECTURA: que
 * cada una de las tres causas se distinga de las otras dos, en el orden correcto. Un
 * bloque que publique cuatro números sin decir cuál mirar primero deja el diagnóstico
 * donde estaba.
 */

type Reparto = {
  reglas_activas: number;
  reglas_totales: number;
  asesores_ruteables: number;
  asesores_tecnicos_excluidos: number;
  roles_considerados: string[];
  sin_dueno: number;
  sin_dueno_7d: number;
  proporcion_sin_dueno_7d: number | null;
  nota: string;
};

/**
 * `contact.count` lo llaman SEIS consultas de este handler (crudos ×2, reales ×2 y las dos
 * nuevas de sin-dueño), y el doble devuelve el mismo valor a todas. Por eso los conteos de
 * contactos van por secuencia aquí: es la única forma de que «5 leads reales y 0 sin
 * dueño» se distinga de «5 y 5», que es justo la distinción que esta tarjeta necesita.
 *
 * El orden es el del `Promise.all` de pulso.ts: crudos24h, crudos7d, reales24h, reales7d,
 * …, sinDuenoVivos, sinDueno7d.
 */
function db(opts: {
  reglasActivas: number;
  reglasTotales?: number;
  ruteables: number;
  tecnicos?: number;
  reales?: number;
  sinDuenoVivos?: number;
  sinDueno7d?: number;
}) {
  const {
    reglasActivas, reglasTotales = Math.max(reglasActivas, 1),
    ruteables, tecnicos = 0,
    reales = 5, sinDuenoVivos = 0, sinDueno7d = 0,
  } = opts;

  return dbFalsa({
    conteos: {
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: {
      "automationRule.count": [0, 8],
      "contact.count": [reales, reales, reales, reales, sinDuenoVivos, sinDueno7d],
      "routingRule.count": [reglasActivas, reglasTotales],
      "user.count": [ruteables, tecnicos],
    },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "connectorLeadLog.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [{ role: "ASESOR_JR", _count: { _all: ruteables + tecnicos } }],
      "slaTimer.groupBy": [],
    },
    listas: { "leadConnector.findMany": [] },
  });
}

const leer = async (opts: Parameters<typeof db>[0]) =>
  ((await pulso({}, ctxFalso({ db: db(opts) }))) as unknown as { reparto: Reparto }).reparto;

describe("crm_pulso — el reparto (#678 e)", () => {
  it("publica los cuatro números", async () => {
    const r = await leer({ reglasActivas: 2, reglasTotales: 3, ruteables: 6, tecnicos: 1, reales: 7, sinDuenoVivos: 9, sinDueno7d: 2 });

    expect(r.reglas_activas).toBe(2);
    expect(r.reglas_totales).toBe(3);
    expect(r.asesores_ruteables).toBe(6);
    expect(r.asesores_tecnicos_excluidos).toBe(1);
    expect(r.sin_dueno).toBe(9);
    expect(r.sin_dueno_7d).toBe(2);
  });

  it("el acumulado de sin-dueño NO es el de la ventana", async () => {
    // Un lead que quedó huérfano hace tres semanas sigue huérfano hoy. Con solo la cifra
    // de 7 días, el pasivo desaparece del reporte en cuanto pasa la semana.
    const r = await leer({ reglasActivas: 1, ruteables: 3, reales: 4, sinDuenoVivos: 11, sinDueno7d: 1 });

    expect(r.sin_dueno).toBe(11);
    expect(r.sin_dueno_7d).toBe(1);
    expect(r.sin_dueno).not.toBe(r.sin_dueno_7d);
  });

  it("la proporción se calcula sobre los leads reales, y es null sin denominador", async () => {
    expect((await leer({ reglasActivas: 1, ruteables: 3, reales: 4, sinDueno7d: 1 })).proporcion_sin_dueno_7d).toBe(0.25);
    expect((await leer({ reglasActivas: 1, ruteables: 3, reales: 0, sinDueno7d: 0 })).proporcion_sin_dueno_7d).toBeNull();
  });

  it("CAUSA 1 · cero reglas activas: es configuración, y lo demás no se puede leer todavía", async () => {
    const r = await leer({ reglasActivas: 0, reglasTotales: 4, ruteables: 6, sinDueno7d: 5, reales: 5 });

    expect(r.nota).toMatch(/CERO reglas de reparto activas/);
    // Y se separa a mano de la decisión del BETA, que es el otro cero de esta respuesta.
    // Confundir los dos hace que se reporte como fallo algo deliberado, o al revés.
    expect(r.nota).toMatch(/automatizaciones/);
  });

  it("CAUSA 2 · reglas pero cero asesores ruteables: el arreglo es dar de alta asesores", async () => {
    const r = await leer({ reglasActivas: 2, ruteables: 0, tecnicos: 3, sinDueno7d: 5, reales: 5 });

    expect(r.nota).toMatch(/CERO asesores ruteables/);
    // El caso concreto de la #734: las únicas cuentas con rol de asesor son del dominio
    // técnico. Sin esta frase, el número se lee como «falta contratar».
    expect(r.nota).toMatch(/dominio t/);
  });

  it("CAUSA 3 · reglas y asesores, y AUN ASÍ leads sin dueño: el problema es el reparto", async () => {
    // Esta es la firma exacta de la #678 tras el cotejo del 04-sep: seis asesores
    // ruteables, reglas activas, y cero asignaciones. Antes de este bloque, este caso y
    // los dos anteriores producían el mismo silencio.
    const r = await leer({ reglasActivas: 2, ruteables: 6, reales: 7, sinDueno7d: 7 });

    expect(r.nota).toMatch(/7 lead\(s\)/);
    // Manda a mirar el motivo que la #678 (a) ya publica en el evento, en vez de dejar
    // el hallazgo sin siguiente paso.
    expect(r.nota).toMatch(/lead\.orphaned/);
    expect(r.nota).toMatch(/sin_plaza_resoluble/);
  });

  it("todo en orden: lo dice sin apagar el acumulado", async () => {
    const r = await leer({ reglasActivas: 2, ruteables: 6, reales: 7, sinDuenoVivos: 4, sinDueno7d: 0 });

    expect(r.nota).not.toMatch(/🚨/);
    expect(r.nota).toMatch(/acumulado/);
    expect(r.sin_dueno).toBe(4);
  });

  it("el criterio de «ruteable» es el del reparto, no una copia", async () => {
    // La razón de que `lib/workflows/ruteables` exista. Si alguien escribiera el `where` a
    // mano en el handler, este número mediría la idea que la puerta tiene del reparto y no
    // el reparto — el defecto de la #682 (el filtro de leads copiado en nueve sitios) y de
    // la #730 (el enum de fuentes copiado a mano).
    expect(asesorRuteableWhere()).toEqual({
      role: { in: ["ASESOR", "ASESOR_SR", "ASESOR_JR"] },
      isActive: true,
      deletedAt: null,
      NOT: { email: { endsWith: ".local" } },
    });
    expect(asesorTecnicoWhere().email).toEqual({ endsWith: ".local" });
    expect((await leer({ reglasActivas: 1, ruteables: 3 })).roles_considerados).toEqual([...ROLES_RUTEABLES]);
  });

  it("los dos «ruteables» y «técnicos» son disjuntos por construcción", async () => {
    // Uno excluye el dominio y el otro lo exige, así que ninguna cuenta cae en los dos y
    // el par se puede sumar para contrastarlo con `usuarios_activos`.
    const ruteable = asesorRuteableWhere();
    const tecnico = asesorTecnicoWhere();

    expect(ruteable.NOT.email.endsWith).toBe(tecnico.email.endsWith);
    expect(ruteable).not.toHaveProperty("email");
    expect(tecnico).not.toHaveProperty("NOT");
  });
});
