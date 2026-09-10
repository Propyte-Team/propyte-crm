import { describe, it, expect } from "vitest";
import {
  destinoDelVencimiento,
  tituloDelAviso,
  mensajeDelAviso,
  explicacionSinAviso,
  type DuenoDelContacto,
} from "./escalacion";

// Tarjeta #756. Un SLA vencido no avisaba a NADIE: `checkSlaBreaches` marcaba BREACHED,
// encadenaba el RETRY y emitía `sla.breach`, y ese evento solo lo consume una AutomationRule
// con disparador SLA_BREACH — de las que hay cero activas. Mudo por construcción, no por
// configuración.
//
// Esto prueba la DECISIÓN, sin base de datos: a quién le toca enterarse. El cableado va en
// sla.breach-aviso.test.ts.

const ASESOR: DuenoDelContacto = {
  asesorId: "ase-1",
  email: "sonia@nativatulum.mx",
  teamLeaderId: null,
  plaza: "TULUM",
};

describe("destinoDelVencimiento — primera respuesta va al asesor (#756)", () => {
  it("FIRST_TOUCH avisa al dueño, no a su jefe", () => {
    // Avisar al jefe de entrada convierte un olvido de cinco minutos en un problema de
    // desempeño. El plazo es del asesor y lo más probable es que se le pasara.
    expect(destinoDelVencimiento("FIRST_TOUCH", ASESOR)).toEqual({ a: "asesor", usuarioId: "ase-1" });
  });

  it("aunque el asesor tenga líder de equipo, el primero es suyo", () => {
    const conLider = { ...ASESOR, teamLeaderId: "tl-1" };
    expect(destinoDelVencimiento("FIRST_TOUCH", conLider)).toEqual({ a: "asesor", usuarioId: "ase-1" });
  });
});

describe("destinoDelVencimiento — el reintento ESCALA, no repite (#756)", () => {
  it("RETRY va al líder de equipo si lo tiene", () => {
    // La pregunta que la #751 dejó abierta. Un RETRY solo nace cuando el FIRST_TOUCH de ese
    // contacto ya venció: el asesor YA no contestó una vez con el aviso puesto, así que
    // mandarle el segundo a la misma persona es previsible que no funcione.
    const conLider = { ...ASESOR, teamLeaderId: "tl-1" };

    expect(destinoDelVencimiento("RETRY", conLider)).toEqual({
      a: "mando",
      teamLeaderId: "tl-1",
      plaza: "TULUM",
    });
  });

  it("sin líder de equipo, escala por plaza", () => {
    expect(destinoDelVencimiento("RETRY", ASESOR)).toEqual({
      a: "mando",
      teamLeaderId: null,
      plaza: "TULUM",
    });
  });

  it("NUNCA vuelve al mismo asesor", () => {
    // El invariante del apartado. Si alguien simplificara esto a «avisa al dueño», el 0 de
    // 83 se repetiría con el aviso puesto y parecería que el aviso no sirve.
    for (const dueno of [ASESOR, { ...ASESOR, teamLeaderId: "tl-1" }, { ...ASESOR, plaza: null }]) {
      expect(destinoDelVencimiento("RETRY", dueno).a).not.toBe("asesor");
    }
  });
});

describe("destinoDelVencimiento — el filtro que va ANTES de todo (#756 + #734)", () => {
  it("una cuenta del dominio técnico NO genera aviso", () => {
    // El más importante de este archivo. De los 168 vencimientos de la historia del CRM,
    // 166 son de `agentes@propyte.local`. Sin este filtro, el día del despliegue la gerencia
    // recibe un centenar de avisos sobre un buzón que nadie abre y deja de mirar la campana.
    const tecnica = { ...ASESOR, asesorId: "agentes", email: "agentes@propyte.local" };

    expect(destinoDelVencimiento("FIRST_TOUCH", tecnica)).toEqual({ a: "nadie", motivo: "cuenta_tecnica" });
    expect(destinoDelVencimiento("RETRY", tecnica)).toEqual({ a: "nadie", motivo: "cuenta_tecnica" });
  });

  it("reconoce el dominio técnico con mayúsculas y con espacios", () => {
    // Los correos entran a mano desde la administración. Un `.LOCAL` o un espacio al final
    // no debe convertir una cuenta técnica en destinataria de cien avisos.
    for (const email of ["Agentes@Propyte.LOCAL", " qa-asesor@propyte.local ", "x@PROPYTE.Local"]) {
      expect(
        destinoDelVencimiento("FIRST_TOUCH", { ...ASESOR, email }).a,
        `"${email}" debería reconocerse como cuenta técnica`
      ).toBe("nadie");
    }
  });

  it("sin dueño no se avisa: no hay a quién reclamarle el plazo", () => {
    const huerfano = { asesorId: null, email: null, teamLeaderId: null, plaza: null };

    expect(destinoDelVencimiento("FIRST_TOUCH", huerfano)).toEqual({ a: "nadie", motivo: "sin_dueno" });
    expect(destinoDelVencimiento("RETRY", huerfano)).toEqual({ a: "nadie", motivo: "sin_dueno" });
  });

  it("la bandeja de rescate no avisa aquí, porque ya avisó al crearse", () => {
    // `sendToPond` notifica a la gerencia en el momento en que sella el ORPHAN. Avisar otra
    // vez 24 horas después es el segundo aviso del MISMO hecho, y un aviso repetido es la
    // forma más rápida de que se dejen de leer todos.
    expect(destinoDelVencimiento("ORPHAN", ASESOR)).toEqual({ a: "nadie", motivo: "ya_aviso_al_crearse" });
    expect(destinoDelVencimiento("ORPHAN", { asesorId: null, email: null, teamLeaderId: null, plaza: null }))
      .toEqual({ a: "nadie", motivo: "ya_aviso_al_crearse" });
  });

  it("el orden de los filtros importa: ORPHAN gana a todo lo demás", () => {
    // Un ORPHAN sobre un contacto sin dueño es el caso NORMAL —por eso existe— así que si
    // `sin_dueno` se evaluara primero, el motivo registrado sería el equivocado y alguien
    // buscaría un problema de asignación donde no lo hay.
    const huerfano = { asesorId: null, email: null, teamLeaderId: null, plaza: null };
    const d = destinoDelVencimiento("ORPHAN", huerfano);

    expect(d).toEqual({ a: "nadie", motivo: "ya_aviso_al_crearse" });
  });
});

describe("el texto del aviso (#756)", () => {
  it("distingue el primero del segundo", () => {
    expect(tituloDelAviso("FIRST_TOUCH")).not.toBe(tituloDelAviso("RETRY"));
    expect(tituloDelAviso("RETRY")).toMatch(/[Ss]egundo/);
  });

  it("al mando se le dice lo que él puede accionar, no «contéstale»", () => {
    // A quien manda no le sirve «contéstale a este prospecto»: le sirve saber que su asesor
    // no contestó dos veces. Es la diferencia entre un aviso que se lee y uno que se ignora.
    const aMando = mensajeDelAviso("RETRY", "Ana Pérez", "MESSENGER", true);
    const aAsesor = mensajeDelAviso("RETRY", "Ana Pérez", "MESSENGER", false);

    expect(aMando).toMatch(/asesor/i);
    expect(aMando).not.toBe(aAsesor);
    expect(aMando).toContain("Ana Pérez");
    expect(aMando).toContain("MESSENGER");
  });

  it("aguanta un contacto sin fuente sin dejar paréntesis vacíos", () => {
    const m = mensajeDelAviso("FIRST_TOUCH", "Ana Pérez", null, false);
    expect(m).toContain("Ana Pérez");
    expect(m).not.toContain("()");
  });

  it("cada motivo de no-aviso tiene explicación, y ninguna está vacía", () => {
    for (const motivo of ["sin_dueno", "cuenta_tecnica", "ya_aviso_al_crearse"] as const) {
      expect(explicacionSinAviso(motivo).length, motivo).toBeGreaterThan(20);
    }
  });
});
