import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// #915: cada sitio que cambia de dueño un contacto, un negocio o una tarea tiene que pasar por el
// aviso de asignación, o estar aquí exento con su motivo escrito. La #915 nació porque ese aviso
// faltaba en la mitad de los sitios y nadie lo notaba: un sitio nuevo sin aviso tiene que romper
// esta prueba, no pasar en silencio.

const RAIZ = join(__dirname, "..", "..", "..")

/** Los sitios que asignan y avisan con `avisarAsignacion` (o con el armado puro, la Bandeja). */
const AVISAN: Record<string, string> = {
  "src/app/api/contacts/route.ts": "alta (POST) y reasignación desde la ficha (PUT)",
  "src/app/api/deals/route.ts": "alta de negocio a nombre de otro asesor",
  "src/app/api/deals/[id]/route.ts": "cambiar el asesor de un negocio",
  "src/app/api/activities/route.ts": "tarea creada para otra persona",
  "src/server/activities.ts": "createActivity / updateActivity con assigneeId (Agenda, ficha)",
  "src/server/contacts.ts": "createContact / updateContact",
  "src/server/deals.ts": "createDeal / updateDeal",
  "src/app/api/webhooks/zapier/contacts/route.ts": "alta y edición por Zapier",
  "src/app/api/webhooks/zapier/deals/route.ts": "alta de negocio por Zapier",
  "src/lib/workflows/actions.ts": "workflow CREATE_TASK",
  "src/lib/agents/tools.ts": "herramienta create_task del agente",
  "src/lib/inbox/assign.ts": "asignar desde la Bandeja (armarAvisoAsignacion)",
}

/** Escriben un dueño y NO pasan por el helper, a propósito. */
const EXENTOS: Record<string, string> = {
  "src/lib/workflows/routing.ts":
    "el reparto automático ya avisa con su propio `lead_assigned` (incluye el motivo del reparto)",
  "src/lib/whatsapp/coex/asesor.ts":
    "el asesor se queda el contacto al escribirle desde su propio WhatsApp: se lo asigna él mismo",
}

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
}

function archivosTs(dir: string): string[] {
  const out: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) out.push(...archivosTs(ruta))
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) && !/\.d\.ts$/.test(nombre)) out.push(ruta)
  }
  return out
}

/** Formas de escribir el dueño que se usan hoy en el código. No es exhaustivo; es una red. */
const ESCRIBE_DUENO = [
  /assignedTo\s*=\s*[^;]*connect/,
  /assignedTo:\s*\{\s*connect/,
  /updateData\.assignedToId\s*=/,
  /data:\s*\{\s*assignedToId:/,
  /assignedToId:\s*(?:assignedToId|d\.assignedToId|ownerUserId|assigneeId|data\.assignedToId)\b/,
  // `prisma.deal.create({ data: { …, assignedToId, … } })`, también con la clave abreviada.
  /\.(?:deal|contact)\.(?:create|update|upsert)\(\{\s*(?:where:[^}]*\},\s*)?data:\s*\{[^{}]*\bassignedTo(?:Id)?\b/,
]

describe("todo sitio que asigna, avisa (#915)", () => {
  for (const [ruta, que] of Object.entries(AVISAN)) {
    it(`${ruta} — ${que}`, () => {
      expect(leer(ruta)).toMatch(/avisarAsignacion\(|armarAvisoAsignacion\(/)
    })
  }

  it("ningún sitio nuevo escribe un dueño sin estar en AVISAN o en EXENTOS", () => {
    const sinAviso = archivosTs(join(RAIZ, "src"))
      .map((r) => relative(RAIZ, r).split("\\").join("/"))
      .filter((r) => !(r in AVISAN) && !(r in EXENTOS))
      .filter((r) => !r.startsWith("src/components/"))
      .filter((r) => ESCRIBE_DUENO.some((re) => re.test(leer(r))))
    expect(sinAviso).toEqual([])
  })

  it("los exentos existen y llevan motivo", () => {
    for (const [ruta, motivo] of Object.entries(EXENTOS)) {
      expect(() => leer(ruta)).not.toThrow()
      expect(motivo.length).toBeGreaterThan(20)
    }
  })
})
