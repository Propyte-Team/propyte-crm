/**
 * Parser simple de args para los runners CLI de robots.
 *
 * Soporta:
 *   --dry-run            (boolean, default false)
 *   --limit <N>          (int, default null = sin limit)
 *   --source <domain>    (string, filtra por source domain, default null)
 *   --verbose            (boolean, default false)
 *   --development <name> (string, filtra por development_name exacto, default null)
 */

export interface RobotCliOptions {
  dryRun: boolean;
  limit: number | null;
  source: string | null;
  verbose: boolean;
  development: string | null;
}

export function parseCli(argv: string[] = process.argv.slice(2)): RobotCliOptions {
  const opts: RobotCliOptions = {
    dryRun: false,
    limit: null,
    source: null,
    verbose: false,
    development: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--verbose":
        opts.verbose = true;
        process.env.ROBOT_DEBUG = "true";
        break;
      case "--limit": {
        const n = parseInt(argv[++i], 10);
        if (isNaN(n) || n < 1) throw new Error(`--limit requiere entero positivo, recibio: ${argv[i]}`);
        opts.limit = n;
        break;
      }
      case "--source":
        opts.source = argv[++i];
        if (!opts.source) throw new Error("--source requiere un domain");
        break;
      case "--development":
        opts.development = argv[++i];
        if (!opts.development) throw new Error("--development requiere un nombre");
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        console.warn(`[cli] argumento desconocido ignorado: ${arg}`);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Uso: tsx src/robots/<N>-<name>/run.ts [opciones]

Opciones:
  --dry-run              Simula sin escribir a DB
  --limit <N>            Limita a N properties/desarrollos
  --source <domain>      Solo process properties de ese source (ej: goodlers.com)
  --development <name>   Solo process un desarrollo especifico
  --verbose              Habilita logs SQL de Prisma
  --help, -h             Muestra esta ayuda

Ejemplos:
  tsx src/robots/01-classifier/run.ts --dry-run --limit 10
  tsx src/robots/01-classifier/run.ts --source goodlers.com
  tsx src/robots/02-images/run.ts --dry-run --development "SENDEROS PONIENTE"
`);
}
