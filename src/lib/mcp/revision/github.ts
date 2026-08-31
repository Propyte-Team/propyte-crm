import { badRequest, faltaVariable, notFound, RevisionError } from "./errors";
import type {
  ArchivoRepo,
  CoincidenciaBusqueda,
  CommitRepo,
  GithubReader,
  PullRequestRepo,
} from "./types";

/**
 * Lector del repo contra la API de GitHub.
 *
 * SE LEE DE GITHUB Y NUNCA DEL FILESYSTEM DEL DEPLOY, y esa es la decisión de fondo de
 * toda la puerta. El checkout de este repo se comparte con sesiones paralelas que le
 * cambian la rama, y el deploy compila en el servidor: leer del disco significaría que la
 * respuesta depende de en qué rama quedó alguien más. Ese fallo ya costó cuatro hallazgos
 * falsos del tipo "esto no existe en el código".
 *
 * El PAT es fine-grained y de SOLO LECTURA (`contents:read` + `pull_requests:read`) sobre
 * un único repo. No hay aquí un solo método que escriba.
 */

const API = "https://api.github.com";
const REPO = process.env.GITHUB_REVISION_REPO ?? "Propyte-Team/propyte-crm";

function pat(): string {
  const t = process.env.GITHUB_REVISION_PAT ?? "";
  if (!t) {
    // La puerta a medias dice CUÁL mitad le falta: las tools de datos y fallos siguen
    // funcionando sin esto, y un error genérico mandaría a revisar la base de datos.
    throw faltaVariable(
      "GITHUB_REVISION_PAT",
      "Las tools de código no pueden leer el repo. Las de datos y fallos sí funcionan.",
    );
  }
  return t;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${pat()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "propyte-crm-revision",
    },
    // El revisor corre a diario contra un repo que cambia: una respuesta cacheada le
    // haría reportar el estado de ayer con la fecha de hoy.
    cache: "no-store",
  });

  if (res.status === 404) throw notFound(`Recurso de GitHub (${path})`);
  if (res.status === 401 || res.status === 403) {
    const resto = res.headers.get("x-ratelimit-remaining");
    // 403 con cuota agotada y 403 por permisos se arreglan distinto, así que se
    // distinguen en vez de aplanarse a "GitHub dijo que no".
    throw new RevisionError(
      res.status,
      resto === "0"
        ? "Cuota de la API de GitHub agotada. Reintenta cuando se reponga."
        : "GitHub rechazó la credencial. Revisa que GITHUB_REVISION_PAT siga vigente y cubra este repo.",
      { repo: REPO, cuota_restante: resto },
    );
  }
  if (!res.ok) {
    throw new RevisionError(res.status, `GitHub respondió ${res.status} en ${path}.`);
  }
  return (await res.json()) as T;
}

/** Rechaza rutas que se salen del repo antes de gastar una llamada. */
function pathSeguro(path: string): string {
  const limpio = path.replace(/^\/+/, "");
  if (limpio.includes("..")) throw badRequest("La ruta no puede contener `..`.");
  return limpio;
}

export function crearGithubReader(): GithubReader {
  return {
    async resolverRef(ref) {
      const commits = await gh<Array<{ sha: string }>>(
        `/repos/${REPO}/commits?sha=${encodeURIComponent(ref)}&per_page=1`,
      );
      if (commits.length === 0) throw notFound(`La ref "${ref}"`);
      return commits[0].sha;
    },

    async leerArchivo(path, ref) {
      const limpio = pathSeguro(path);
      const data = await gh<{ content?: string; encoding?: string; size?: number; type?: string }>(
        `/repos/${REPO}/contents/${limpio}?ref=${encodeURIComponent(ref)}`,
      );
      if (data.type !== "file") {
        throw badRequest(`"${limpio}" no es un archivo. Usa crm_codigo_arbol para listar un directorio.`);
      }
      const contenido =
        data.encoding === "base64" && data.content
          ? Buffer.from(data.content, "base64").toString("utf8")
          : "";
      return { path: limpio, contenido, bytes: data.size ?? Buffer.byteLength(contenido, "utf8") };
    },

    async listarArbol(path, ref) {
      const limpio = pathSeguro(path);
      const ruta = limpio ? `/repos/${REPO}/contents/${limpio}` : `/repos/${REPO}/contents`;
      const data = await gh<Array<{ path: string; type: string }>>(
        `${ruta}?ref=${encodeURIComponent(ref)}`,
      );
      if (!Array.isArray(data)) {
        throw badRequest(`"${limpio}" es un archivo, no un directorio. Usa crm_codigo_leer.`);
      }
      return data.map((e) => (e.type === "dir" ? `${e.path}/` : e.path)).sort();
    },

    async listarCommits(desde, hasta, ref, tope) {
      const q = new URLSearchParams({
        sha: ref,
        since: desde.toISOString(),
        until: hasta.toISOString(),
        per_page: String(tope),
      });
      const data = await gh<
        Array<{
          sha: string;
          commit: { message: string; author: { name?: string; date?: string } | null };
        }>
      >(`/repos/${REPO}/commits?${q.toString()}`);

      return data.map<CommitRepo>((c) => ({
        sha: c.sha,
        fecha: c.commit.author?.date ?? "",
        autor: c.commit.author?.name ?? "desconocido",
        // Solo el asunto: el cuerpo de un commit puede traer párrafos y aquí se listan
        // decenas. El detalle se pide con crm_codigo_leer sobre los archivos tocados.
        mensaje: c.commit.message.split("\n")[0],
      }));
    },

    async listarPullRequestsAbiertos() {
      const data = await gh<
        Array<{
          number: number;
          title: string;
          state: string;
          draft: boolean;
          updated_at: string;
          head: { ref: string };
        }>
      >(`/repos/${REPO}/pulls?state=open&per_page=50&sort=updated&direction=desc`);

      return data.map<PullRequestRepo>((p) => ({
        numero: p.number,
        titulo: p.title,
        estado: p.draft ? "borrador" : p.state,
        rama: p.head.ref,
        actualizado: p.updated_at,
        borrador: p.draft,
      }));
    },

    /**
     * Búsqueda por la API de code search de GitHub.
     *
     * LIMITACIÓN REAL Y DECLARADA, no un descuido: code search indexa la RAMA POR DEFAULT
     * y no acepta expresiones regulares. Se eligió sobre la alternativa —bajar el árbol y
     * grepear archivo por archivo— porque esa cuesta decenas de peticiones por búsqueda y
     * nginx corta una petición que pasa minutos sin mandar bytes.
     *
     * El camino exacto para cualquier ref existe y es la combinación
     * `crm_codigo_arbol` + `crm_codigo_leer`. La descripción de la tool lo dice para que
     * el agente no elija esta para lo que no puede.
     */
    async buscar(patron, glob, ref, tope) {
      const partes = [patron, `repo:${REPO}`];
      if (glob) partes.push(`path:${glob}`);
      const q = encodeURIComponent(partes.join(" "));

      const data = await gh<{
        total_count: number;
        items: Array<{ path: string; text_matches?: Array<{ fragment: string }> }>;
      }>(`/search/code?q=${q}&per_page=${Math.min(tope, 100)}`);

      const out: CoincidenciaBusqueda[] = [];
      for (const item of data.items) {
        // Sin `text_matches` la API no devuelve el fragmento; se reporta el archivo con
        // línea 0, que es honesto: "está aquí, no sé en qué renglón".
        if (!item.text_matches || item.text_matches.length === 0) {
          out.push({ path: item.path, linea: 0, texto: "" });
          continue;
        }
        for (const m of item.text_matches) {
          out.push({ path: item.path, linea: 0, texto: m.fragment.trim().slice(0, 400) });
        }
      }
      void ref; // La ref no se usa: code search solo mira la rama por default. Ver el comentario.
      return out.slice(0, tope);
    },
  };
}
