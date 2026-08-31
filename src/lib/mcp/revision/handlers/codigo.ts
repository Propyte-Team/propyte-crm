import { badRequest } from "../errors";
import { construirSobre, envolver, recortar } from "../sobre";
import type { RevisionContext } from "../types";

/**
 * Las cuatro tools de código.
 *
 * TODAS resuelven la ref a un SHA antes de leer nada, y ese SHA va en el sobre. No es
 * metadato: es lo que hace citable un hallazgo. Un revisor que diga "esto está mal en
 * `x.ts:40`" sin decir en qué commit lo leyó produce un reporte imposible de verificar —
 * y este proyecto ya pagó cuatro hallazgos falsos por exactamente eso.
 */

const TOPE_ARCHIVO_BYTES = 60_000;
const TOPE_COMMITS = 50;
const TOPE_COINCIDENCIAS = 100;
const TOPE_DIAS = 30;
const DIA = 24 * 60 * 60 * 1000;

function refDe(args: { ref?: unknown }): string {
  if (args.ref === undefined) return "main";
  if (typeof args.ref !== "string" || !args.ref.trim()) {
    throw badRequest("`ref` tiene que ser una rama, tag o SHA.");
  }
  return args.ref.trim();
}

function textoRequerido(v: unknown, campo: string): string {
  if (typeof v !== "string" || !v.trim()) throw badRequest(`Falta \`${campo}\`.`);
  return v.trim();
}

export async function codigoCambios(args: unknown, ctx: RevisionContext) {
  const a = (args ?? {}) as { desde?: unknown; ref?: unknown };
  const ref = refDe(a);

  let desde = new Date(ctx.ahora.getTime() - DIA);
  if (a.desde !== undefined) {
    if (typeof a.desde !== "string") throw badRequest("`desde` tiene que ser una fecha ISO.");
    const d = new Date(a.desde);
    if (Number.isNaN(d.getTime())) {
      throw badRequest(`\`desde\` no es una fecha válida: "${a.desde}".`, {
        ejemplo_valido: "2026-08-27T00:00:00Z",
      });
    }
    desde = d;
  }

  // La ventana se acota EN SILENCIO no; se acota y se dice. Pedir 6 meses y recibir 30
  // días sin aviso haría concluir "no hubo actividad antes" a quien mire el resultado.
  const minimo = new Date(ctx.ahora.getTime() - TOPE_DIAS * DIA);
  const ventanaAcotada = desde < minimo;
  if (ventanaAcotada) desde = minimo;

  const sha = await ctx.gh.resolverRef(ref);
  const [commits, prs] = await Promise.all([
    ctx.gh.listarCommits(desde, ctx.ahora, sha, TOPE_COMMITS),
    ctx.gh.listarPullRequestsAbiertos(),
  ]);

  const r = recortar(commits, TOPE_COMMITS, "commits en la ventana");

  return envolver(
    construirSobre({
      ref,
      sha,
      ahora: ctx.ahora,
      alcance: `commits entre ${desde.toISOString()} y ${ctx.ahora.toISOString()}`,
      truncado: r.truncado,
    }),
    {
      ...(ventanaAcotada
        ? {
            aviso_ventana: `La ventana se acotó a ${TOPE_DIAS} días, que es el máximo. La ausencia de commits anteriores a ${desde.toISOString()} NO significa que no los haya.`,
          }
        : {}),
      commits: r.items,
      pull_requests_abiertos: prs,
    },
  );
}

export async function codigoArbol(args: unknown, ctx: RevisionContext) {
  const a = (args ?? {}) as { path?: unknown; ref?: unknown };
  const ref = refDe(a);
  const path = a.path === undefined ? "" : textoRequerido(a.path, "path");

  const sha = await ctx.gh.resolverRef(ref);
  const entradas = await ctx.gh.listarArbol(path, sha);

  return envolver(
    construirSobre({ ref, sha, ahora: ctx.ahora, alcance: `contenido de "${path || "/"}"` }),
    { path: path || "/", entradas },
  );
}

export async function codigoLeer(args: unknown, ctx: RevisionContext) {
  const a = (args ?? {}) as {
    path?: unknown;
    desde_linea?: unknown;
    hasta_linea?: unknown;
    ref?: unknown;
  };
  const ref = refDe(a);
  const path = textoRequerido(a.path, "path");

  const sha = await ctx.gh.resolverRef(ref);
  const archivo = await ctx.gh.leerArchivo(path, sha);

  const lineas = archivo.contenido.split("\n");
  const desdeL = a.desde_linea === undefined ? 1 : Number(a.desde_linea);
  const hastaL = a.hasta_linea === undefined ? lineas.length : Number(a.hasta_linea);

  if (!Number.isInteger(desdeL) || desdeL < 1) throw badRequest("`desde_linea` empieza en 1.");
  if (!Number.isInteger(hastaL) || hastaL < desdeL) {
    throw badRequest("`hasta_linea` tiene que ser mayor o igual que `desde_linea`.");
  }

  const pidioRango = a.desde_linea !== undefined || a.hasta_linea !== undefined;
  if (!pidioRango && archivo.bytes > TOPE_ARCHIVO_BYTES) {
    throw badRequest(
      `"${path}" pesa ${archivo.bytes} bytes y el tope sin rango es ${TOPE_ARCHIVO_BYTES}. ` +
        "Pide un rango de líneas.",
      { bytes: archivo.bytes, tope: TOPE_ARCHIVO_BYTES, lineas_totales: lineas.length },
    );
  }

  const recorte = lineas.slice(desdeL - 1, hastaL);
  const texto = recorte.join("\n");
  const seRecorto = recorte.length < lineas.length;

  return envolver(
    construirSobre({
      ref,
      sha,
      ahora: ctx.ahora,
      alcance: `${path} líneas ${desdeL}-${Math.min(hastaL, lineas.length)} de ${lineas.length}`,
      truncado: seRecorto
        ? {
            motivo: "rango de líneas pedido",
            devueltos: recorte.length,
            tope: lineas.length,
          }
        : undefined,
    }),
    {
      path,
      desde_linea: desdeL,
      hasta_linea: Math.min(hastaL, lineas.length),
      lineas_totales: lineas.length,
      // La cita de un hallazgo se arma con esto: `path:linea@sha`.
      contenido: texto,
    },
  );
}

export async function codigoBuscar(args: unknown, ctx: RevisionContext) {
  const a = (args ?? {}) as { patron?: unknown; glob?: unknown; ref?: unknown };
  const ref = refDe(a);
  const patron = textoRequerido(a.patron, "patron");
  const glob = a.glob === undefined ? undefined : textoRequerido(a.glob, "glob");

  const sha = await ctx.gh.resolverRef(ref);
  const encontradas = await ctx.gh.buscar(patron, glob, sha, TOPE_COINCIDENCIAS);
  const r = recortar(encontradas, TOPE_COINCIDENCIAS, "coincidencias");

  return envolver(
    construirSobre({
      ref,
      sha,
      ahora: ctx.ahora,
      alcance: `búsqueda de "${patron}"${glob ? ` en ${glob}` : ""}`,
      truncado: r.truncado,
    }),
    {
      patron,
      glob: glob ?? null,
      coincidencias: r.items,
      limitacion_declarada:
        "La búsqueda usa el índice de código de GitHub: mira SOLO la rama por default, no acepta " +
        "expresiones regulares y no devuelve número de línea. Un resultado vacío NO prueba que el " +
        "texto no exista. Para una lectura exacta sobre cualquier ref usa crm_codigo_arbol + crm_codigo_leer.",
    },
  );
}
