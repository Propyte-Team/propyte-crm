import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARAM_ETIQUETA, etiquetaDelFiltro } from "./filtro-etiqueta";
import { ESTADO_ORDER, RAZON_SALIDA_ORDER } from "@/lib/estados";

// #958 — La migración de estados es solo SQL. Estas pruebas cuidan que no se separe de lo demás:
// la vista previa clasifica igual que la migración, los enlaces de las tareas usan el filtro que la
// lista entiende, y los estados, subestados y razones que escribe existen.
const dir = join(__dirname, "..", "..", "..", "prisma", "migrations-manual");
const migracion = readFileSync(join(dir, "2026-11-04-estados-migracion-958.sql"), "utf8");
const vistaPrevia = readFileSync(join(dir, "2026-11-04-estados-migracion-958-vista-previa.sql"), "utf8");

function clasificacion(sql: string): string {
  const desde = sql.indexOf("WITH pc AS (");
  const hasta = sql.indexOf("FROM ev", desde);
  expect(desde).toBeGreaterThan(-1);
  return sql.slice(desde, hasta).replace(/\s+/g, " ");
}

describe("migración de estados #958", () => {
  it("la vista previa clasifica exactamente igual que la migración (las dos consultas)", () => {
    const enMigracion = clasificacion(migracion);
    const partes = vistaPrevia.split("-- 2) Muestra de 20");
    expect(clasificacion(partes[0])).toBe(enMigracion);
    expect(clasificacion(partes[1])).toBe(enMigracion);
  });

  it("los enlaces de las tareas abren la lista filtrada por una etiqueta que la migración pone", () => {
    const enlaces = [...migracion.matchAll(/crm\.propyte\.com\/contacts\?([a-z]+)=([a-z0-9-]+)/g)];
    expect(enlaces.length).toBe(3);
    for (const [, param, etiqueta] of enlaces) {
      expect(param).toBe(PARAM_ETIQUETA);
      expect(etiquetaDelFiltro(etiqueta)).toBe(etiqueta);
      expect(migracion).toContain(`'${etiqueta}'`);
    }
  });

  it("solo escribe estados y razones que existen", () => {
    const estados = [...migracion.matchAll(/(?:THEN|SET estado =) '([A-Z_]+)'/g)].map((m) => m[1]);
    const razones = [...migracion.matchAll(/WHEN '[a-z_]+' THEN '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(estados.length).toBeGreaterThan(0);
    for (const v of [...estados, ...razones]) {
      expect([...ESTADO_ORDER, ...RAZON_SALIDA_ORDER, "REALIZADA", "EN_CONVERSACION"]).toContain(v);
    }
  });
});
