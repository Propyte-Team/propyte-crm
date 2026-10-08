import { describe, it, expect } from "vitest";
import {
  COLUMNAS_LLAMADAS,
  COLUMNAS_REUNIONES,
  columnasVisibles,
  filtrarColumnas,
} from "./columnas";

describe("columnasVisibles", () => {
  it("sin preferencia guardada usa los valores por defecto", () => {
    expect(columnasVisibles(COLUMNAS_REUNIONES, null)).toEqual([
      "titulo",
      "de",
      "a",
      "relacionado",
      "contacto",
    ]);
  });

  it("respeta lo guardado y conserva el orden del catálogo", () => {
    // Guardado en otro orden: el resultado sigue el orden del catálogo.
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["telefono", "duracion", "asunto"])).toEqual([
      "asunto",
      "telefono",
      "duracion",
    ]);
  });

  it("siempre incluye la columna obligatoria aunque no esté guardada", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["telefono"])).toEqual(["asunto", "telefono"]);
  });

  it("descarta claves que ya no existen en el catálogo", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["asunto", "columna_borrada", "tipo"])).toEqual([
      "asunto",
      "tipo",
    ]);
  });

  it("una preferencia sin ninguna clave reconocible vuelve al default", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["x", "y"])).toEqual([
      "asunto",
      "relacionado",
      "inicio",
      "telefono",
    ]);
  });

  it("acepta quedarse solo con la obligatoria (lista vacía guardada)", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, [])).toEqual(["asunto"]);
  });

  it("guardar solo la obligatoria es una elección válida, no vuelve al default", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["asunto"])).toEqual(["asunto"]);
  });

  it("un valor corrupto (no arreglo) cae al default", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, "basura")).toEqual(
      columnasVisibles(COLUMNAS_LLAMADAS, null),
    );
    expect(columnasVisibles(COLUMNAS_LLAMADAS, { a: 1 })).toEqual(
      columnasVisibles(COLUMNAS_LLAMADAS, null),
    );
  });

  it("ignora elementos que no son texto", () => {
    expect(columnasVisibles(COLUMNAS_LLAMADAS, ["asunto", 42, null, "tipo"])).toEqual([
      "asunto",
      "tipo",
    ]);
  });
});

describe("filtrarColumnas", () => {
  it("sin texto devuelve todo el catálogo", () => {
    expect(filtrarColumnas(COLUMNAS_REUNIONES, "  ")).toHaveLength(COLUMNAS_REUNIONES.length);
  });

  it("busca sin importar acentos ni mayúsculas", () => {
    const res = filtrarColumnas(COLUMNAS_REUNIONES, "CREACION");
    expect(res.map((c) => c.key)).toEqual(["creado"]);
  });

  it("devuelve vacío si nada coincide", () => {
    expect(filtrarColumnas(COLUMNAS_LLAMADAS, "zzz")).toEqual([]);
  });
});
