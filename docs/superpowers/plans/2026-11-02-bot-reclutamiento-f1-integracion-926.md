# Bot de reclutamiento — Fase 1 — Anexo: integración con el módulo Reclutamiento (#926)

> **Para quien ejecuta:** este anexo REEMPLAZA las tareas 1, 6, 8, 9, 10 y 11 del plan
> `2026-11-02-bot-reclutamiento-f1.md` y enmienda las tareas 4 y 12. Las demás tareas (2, 3, 5, 7,
> 13, 14) se ejecutan como están en el plan original. Las convenciones del encabezado del plan
> original aplican aquí sin cambios.

**Decisión (Luis, 2026-11-02):** el bot NO crea una tabla paralela. Se integra al módulo
Reclutamiento que ya existe desde el #926/#927: pantalla `/reclutamiento` (Desempeño), API
`/api/reclutamiento`, tabla `recruit_candidates` (modelo Prisma `RecruitCandidate`) con las etapas
de la base de Notion «Candidatos · Marketing», ubicaciones PDC/MERIDA/TULUM/CANCUN/REMOTO/FORANEO,
CV en el bucket privado `crm-attachments` (`recruit_candidate_files`), y los ganchos que ese módulo
dejó previstos para la ingesta desde chats (`source = 'CHAT'`, `sourceRef`).

**Qué cambia respecto al plan original**

| Tema | Plan original | Ahora |
|---|---|---|
| Tabla | `recruitment_candidates` nueva, 1:1 con contacto | columnas `bot*` + `contactId` + `horarioEntrevista` en `recruit_candidates` |
| Etapas | enum `RecruitmentStage` propio | las de `ETAPAS` en `src/lib/reclutamiento/shared.ts` (TEXT). Veredicto del bot aparte en `botResultado` |
| Veredicto | enum Prisma `RecruitmentVerdict` | tipo TS `Veredicto = "APTO" \| "REVISAR" \| "NO_APTO"` en `etapas.ts`; columna TEXT |
| Plaza del candidato | enum `Plaza` (PDC/MERIDA) | `UbicacionCode` del #927: PDC, MERIDA, y OTRA_* → FORANEO |
| CV | `cvUrl` apuntando al bucket del chat | se COPIA del bucket `chat-media` a `crm-attachments` y se registra con `registrarCvDeCandidato` (la misma función de la subida manual). Solo PDF/Word, como el módulo |
| Alta del candidato | upsert por `contactId` | `crearCandidato(..., null, { source: "CHAT", sourceRef: conversationId, contactId, botCanal })` |
| Pantalla (F2) | construir `/reclutamiento` desde cero | la pantalla ya existe y muestra a los candidatos del bot desde F1 (origen CHAT). F2 solo agrega veredicto, puntaje y resumen |
| `marcarPerfilando` | etapa PERFILANDO | se elimina. Mientras el guion corre, el candidato está en RECIBIDO con `botEvaluadoAt = null` |

**Mapa de etapas del bot → etapas de Notion** (el bot solo mueve la etapa si sigue en `RECIBIDO`;
una etapa que ya movió un humano no se toca):

| Veredicto | Etapa | Por qué |
|---|---|---|
| APTO | `CONTACTO_INICIAL` | el gerente lo contacta para agendar entrevista |
| REVISAR | `FILTRO_CV` | lo revisa una persona |
| NO_APTO | `DESCARTADO` | falló un filtro eliminatorio o puntaje bajo; se puede reabrir a mano |

**Orden de ejecución con este anexo:** 1' → 2 (ya hecha) → 3 → 6' → 4 (enmendada) → 5 → 7 → 8' → 9' → 10' → 11' → 12 (enmendada) → 13 → 14.

**Mapa de archivos (reemplaza las filas afectadas del original)**

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `prisma/schema.prisma` | Modificar | columnas nuevas en `RecruitCandidate` (sin enums nuevos ni modelo nuevo) |
| `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql` | Crear | `ALTER TABLE recruit_candidates ADD COLUMN …`; índice único `contactId`; canales del bot; identidad del agente |
| `src/server/reclutamiento.ts` | Modificar | `crearCandidato` acepta `contactId` y `botCanal` en `origen` |
| `src/lib/storage/crm-attachments.ts` | Modificar | `copiarDeChatMedia(pathOrigen, pathDestino, contentType)` |
| `src/lib/reclutamiento/etapas.ts` | Crear | `Veredicto`, `etapaDeResultado`, `botPuedeMoverEtapa` |
| `src/lib/reclutamiento/candidato.ts` | Crear | `asegurarCandidato`, `persistirEvaluacion`, `guardarHorario`, `plazaDeRespuesta` sobre `recruitCandidate` |
| `src/lib/reclutamiento/avisos.ts` | Crear | igual que el original, con `UbicacionCode` en vez de `Plaza` |
| `src/lib/reclutamiento/cv.ts` | Crear | copiar el adjunto al bucket de CV y registrarlo |
| `src/lib/reclutamiento/hook.ts` | Crear | igual que el original, sobre la forma `CandidatoBot` |

---

### Task 1': Columnas del bot en `recruit_candidates` y migración SQL

**Files:**
- Modify: `prisma/schema.prisma` (modelo `RecruitCandidate`, ~línea 3209)
- Create: `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql`
- Modify: `src/server/reclutamiento.ts` (`crearCandidato`)

- [ ] **Step 1: Agregar las columnas al modelo Prisma**

En `model RecruitCandidate`, después de `sourceRef String?` y antes de `createdById String?`, insertar:

```prisma
  /// Contacto del CRM cuando el candidato llegó por el bot (spec 2026-11-02). Único: un contacto, un candidato.
  contactId         String?   @unique
  /// Canal por el que habló con el bot (ConversationChannel como texto: WHATSAPP | INSTAGRAM | MESSENGER).
  botCanal          String?
  /// Veredicto del bot: APTO | REVISAR | NO_APTO. null = aún no evaluado.
  botResultado      String?
  botPuntaje        Int?
  /// filtro:<clave> | ambiguo:<claves> | puntaje | null
  botMotivo         String?
  /// Respuestas del guion (copia de Contact.custom.reclutamiento_* al evaluar).
  botRespuestas     Json?
  /// Resultado de cada filtro eliminatorio: PASA | AMBIGUO | FALLA.
  botFiltros        Json?
  /// Puntos por criterio, incluida la actitud y sus razones.
  botDesglose       Json?
  /// Resumen de 2-3 líneas para el gerente, generado por IA.
  botResumen        String?
  botEvaluadoAt     DateTime?
  /// Días y horario que el candidato dijo que le acomodan para la entrevista (texto libre).
  horarioEntrevista String?
```

- [ ] **Step 2: Validar y generar**

Run: `DATABASE_URL="postgresql://x:x@localhost:5432/x" npx prisma validate` → `The schema at prisma\schema.prisma is valid`
Run: `npx prisma generate` → `✔ Generated Prisma Client`

- [ ] **Step 3: Escribir la migración SQL**

Crear `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql`:

```sql
-- Bot de reclutamiento F1 (spec docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md,
-- anexo docs/superpowers/plans/2026-11-02-bot-reclutamiento-f1-integracion-926.md).
-- El bot escribe en la tabla del módulo Reclutamiento (#926): columnas nuevas, todas opcionales.
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si el código se despliega antes, el bot responde sin evaluar
-- (candidato.ts trata P2022 como «sin migrar») y nada más se rompe.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."recruit_candidates"
--     DROP COLUMN IF EXISTS "contactId", DROP COLUMN IF EXISTS "botCanal",
--     DROP COLUMN IF EXISTS "botResultado", DROP COLUMN IF EXISTS "botPuntaje",
--     DROP COLUMN IF EXISTS "botMotivo", DROP COLUMN IF EXISTS "botRespuestas",
--     DROP COLUMN IF EXISTS "botFiltros", DROP COLUMN IF EXISTS "botDesglose",
--     DROP COLUMN IF EXISTS "botResumen", DROP COLUMN IF EXISTS "botEvaluadoAt",
--     DROP COLUMN IF EXISTS "horarioEntrevista";

ALTER TABLE "propyte_crm"."recruit_candidates"
  ADD COLUMN IF NOT EXISTS "contactId"         TEXT,
  ADD COLUMN IF NOT EXISTS "botCanal"          TEXT,
  ADD COLUMN IF NOT EXISTS "botResultado"      TEXT,
  ADD COLUMN IF NOT EXISTS "botPuntaje"        INTEGER,
  ADD COLUMN IF NOT EXISTS "botMotivo"         TEXT,
  ADD COLUMN IF NOT EXISTS "botRespuestas"     JSONB,
  ADD COLUMN IF NOT EXISTS "botFiltros"        JSONB,
  ADD COLUMN IF NOT EXISTS "botDesglose"       JSONB,
  ADD COLUMN IF NOT EXISTS "botResumen"        TEXT,
  ADD COLUMN IF NOT EXISTS "botEvaluadoAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "horarioEntrevista" TEXT;

-- Un contacto del CRM, un candidato (los NULL no chocan entre sí).
CREATE UNIQUE INDEX IF NOT EXISTS "recruit_candidates_contactId_key"
  ON "propyte_crm"."recruit_candidates"("contactId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."recruit_candidates"
    ADD CONSTRAINT "recruit_candidates_botResultado_check"
    CHECK ("botResultado" IS NULL OR "botResultado" IN ('APTO', 'REVISAR', 'NO_APTO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Identidad del agente (spec §4). El playbook se siembra aparte con
-- scripts/seed-bot-playbooks-segmento.ts después del deploy.
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "identity" = 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte en Playa del Carmen o Mérida. Tu misión: conocer al candidato con preguntas naturales, una o dos por mensaje, sin sonar a formulario. Eres honesto sobre el esquema: 100 % comisión, sin sueldo base, con capacitación y acompañamiento del equipo. Si pregunta por sueldo, comisiones, horario o la empresa, contesta breve con la ficha de la vacante y retoma la pregunta pendiente. No prometas contratación ni fechas. Cuando se te indique el resultado, cierra con calidez y sin listar criterios.',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "name" = 'Agente Reclutamiento';

-- Canales del bot (spec §9): WhatsApp ya estaba; entran Instagram y Messenger.
UPDATE "propyte_crm"."bot_config"
   SET "enabledChannels" = '["WHATSAPP","INSTAGRAM","MESSENGER"]'::jsonb;
```

- [ ] **Step 4: `crearCandidato` acepta el enlace al contacto**

En `src/server/reclutamiento.ts`, cambiar la firma y el `data` de `crearCandidato`:

```ts
export async function crearCandidato(
  datos: CandidatoEntrada,
  createdById: string | null,
  origen: { source: Origen; sourceRef?: string | null; contactId?: string | null; botCanal?: string | null } = {
    source: "MANUAL",
  }
): Promise<CandidatoFila> {
  const c = (await prisma.recruitCandidate.create({
    data: {
      fullName: datos.fullName,
      age: datos.age ?? null,
      email: datos.email ?? null,
      phone: datos.phone ?? null,
      area: datos.area ?? null,
      plaza: datos.plaza ?? null,
      portfolioUrl: datos.portfolioUrl ?? null,
      notes: datos.notes ?? null,
      stage: datos.stage ?? ETAPA_INICIAL,
      source: origen.source,
      sourceRef: origen.sourceRef ?? null,
      contactId: origen.contactId ?? null,
      botCanal: origen.botCanal ?? null,
      createdById,
    },
    select: SELECT_CANDIDATO,
  })) as FilaDb;
  return aFila(c);
}
```

Y actualizar el comentario de cabecera del archivo (el bloque «CAMINO PARA LOS CV QUE LLEGUEN POR LOS
CHATS») para que diga que ya está conectado: lo hace `src/lib/reclutamiento/candidato.ts` (alta) y
`src/lib/reclutamiento/cv.ts` (CV), llamados desde el bot y desde `messaging/core.ts`.

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/app/api/reclutamiento src/lib/reclutamiento src/components/reclutamiento`
Expected: todo verde (el cambio es aditivo).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql src/server/reclutamiento.ts
git commit -m "feat(reclutamiento): columnas del bot en recruit_candidates y migración manual

El bot de reclutamiento escribe en la tabla del módulo #926 en vez de una tabla
paralela. Columnas opcionales (bot*, contactId, horarioEntrevista); crearCandidato
acepta el enlace al contacto y el canal.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6': Veredicto y etapas

**Files:**
- Create: `src/lib/reclutamiento/etapas.ts`
- Test: `src/lib/reclutamiento/etapas.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { VEREDICTOS, etapaDeResultado, botPuedeMoverEtapa } from "./etapas";

describe("etapas", () => {
  it("los tres veredictos existen", () => {
    expect(VEREDICTOS).toEqual(["APTO", "REVISAR", "NO_APTO"]);
  });
  it("mapea veredicto a etapa de Notion", () => {
    expect(etapaDeResultado("APTO")).toBe("CONTACTO_INICIAL");
    expect(etapaDeResultado("REVISAR")).toBe("FILTRO_CV");
    expect(etapaDeResultado("NO_APTO")).toBe("DESCARTADO");
  });
  it("el bot solo mueve la etapa si el candidato sigue en RECIBIDO", () => {
    expect(botPuedeMoverEtapa("RECIBIDO")).toBe(true);
    for (const e of ["FILTRO_CV", "CONTACTO_INICIAL", "ENTREVISTA", "CONTRATADO", "DESCARTADO", "BANCO_TALENTO"]) {
      expect(botPuedeMoverEtapa(e), e).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar**

```ts
// Veredicto del bot y su mapa a las etapas del módulo Reclutamiento (#926, base de Notion).
// El bot solo mueve la etapa cuando el candidato sigue en la inicial: si un humano ya lo movió,
// el veredicto se guarda en botResultado y la etapa se respeta.
import { ETAPA_INICIAL, type EtapaCode } from "./shared";

export const VEREDICTOS = ["APTO", "REVISAR", "NO_APTO"] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

const ETAPA_POR_VEREDICTO: Record<Veredicto, EtapaCode> = {
  APTO: "CONTACTO_INICIAL", // el gerente lo contacta para agendar entrevista
  REVISAR: "FILTRO_CV", // lo revisa una persona
  NO_APTO: "DESCARTADO", // falló un filtro o puntaje bajo; se puede reabrir a mano
};

export function etapaDeResultado(v: Veredicto): EtapaCode {
  return ETAPA_POR_VEREDICTO[v];
}

export function botPuedeMoverEtapa(etapaActual: string): boolean {
  return etapaActual === ETAPA_INICIAL;
}
```

- [ ] **Step 4: Correr tests** → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/etapas.ts src/lib/reclutamiento/etapas.test.ts
git commit -m "feat(reclutamiento): veredicto del bot y mapa a etapas del módulo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Enmienda a Task 4 (evaluar.ts)

En el código de la Task 4 del plan original:
- Sustituir `import type { RecruitmentVerdict } from "@prisma/client";` por `import type { Veredicto } from "./etapas";`
- Sustituir cada `RecruitmentVerdict` por `Veredicto`.
Todo lo demás (tests incluidos) queda igual. Task 6' debe ejecutarse antes que Task 4.

---

### Task 8': Candidato en BD (asegurar, persistir, horario)

**Files:**
- Create: `src/lib/reclutamiento/candidato.ts`
- Test: `src/lib/reclutamiento/candidato.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recruitCandidate: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
const crearCandidato = vi.fn();
vi.mock("@/server/reclutamiento", () => ({ crearCandidato: (...a: unknown[]) => crearCandidato(...a) }));
const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { asegurarCandidato, persistirEvaluacion, plazaDeRespuesta, guardarHorario } from "./candidato";

const contacto = { id: "k1", firstName: "Ana", lastName: "López", phone: "+5219991112233", email: "ana@x.mx" };
const filaDb = { id: "c1", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, files: [] };

beforeEach(() => { findFirst.mockReset(); update.mockReset(); crearCandidato.mockReset(); askClaude.mockReset(); });

describe("asegurarCandidato", () => {
  it("devuelve el existente (por contactId, no borrado) en forma CandidatoBot", async () => {
    findFirst.mockResolvedValue({ ...filaDb, botResultado: "APTO", botEvaluadoAt: new Date("2026-11-02"), files: [{ id: "f1" }] });
    const r = await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" });
    expect(r).toMatchObject({ id: "c1", stage: "RECIBIDO", botResultado: "APTO", tieneCv: true, horarioEntrevista: null });
    expect(r?.botEvaluadoAt).toBeInstanceOf(Date);
    const where = (findFirst.mock.calls[0][0] as { where: unknown }).where;
    expect(where).toEqual({ contactId: "k1", deletedAt: null });
    expect(crearCandidato).not.toHaveBeenCalled();
  });
  it("si no existe lo crea con origen CHAT, el contacto y el canal", async () => {
    findFirst.mockResolvedValue(null);
    crearCandidato.mockResolvedValue({ id: "c2", stage: "RECIBIDO" });
    const r = await asegurarCandidato({ contact: contacto, canal: "MESSENGER", conversationId: "v1" });
    expect(r).toEqual({ id: "c2", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false });
    const [datos, createdById, origen] = crearCandidato.mock.calls[0] as [Record<string, unknown>, unknown, Record<string, unknown>];
    expect(datos).toMatchObject({ fullName: "Ana López", phone: "+5219991112233", email: "ana@x.mx", area: "Asesor / Ventas" });
    expect(createdById).toBeNull();
    expect(origen).toEqual({ source: "CHAT", sourceRef: "v1", contactId: "k1", botCanal: "MESSENGER" });
  });
  it("sin nombre en el contacto usa un nombre provisional", async () => {
    findFirst.mockResolvedValue(null);
    crearCandidato.mockResolvedValue({ id: "c2", stage: "RECIBIDO" });
    await asegurarCandidato({ contact: { ...contacto, firstName: "", lastName: "" }, canal: "WHATSAPP", conversationId: "v1" });
    expect((crearCandidato.mock.calls[0][0] as { fullName: string }).fullName).toBe("Candidato por chat");
  });
  it("carrera (P2002 al crear) → relee por contactId", async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(filaDb);
    crearCandidato.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const r = await asegurarCandidato({ contact: contacto, canal: "INSTAGRAM", conversationId: "v1" });
    expect(r?.id).toBe("c1");
  });
  it("sin migrar (P2022) → null sin lanzar", async () => {
    findFirst.mockRejectedValue(Object.assign(new Error("no column"), { code: "P2022" }));
    expect(await asegurarCandidato({ contact: contacto, canal: "WHATSAPP", conversationId: "v1" })).toBeNull();
  });
});

describe("plazaDeRespuesta", () => {
  it("PDC y MERIDA se conservan; otra plaza → FORANEO; vacío → null", () => {
    expect(plazaDeRespuesta("PDC")).toBe("PDC");
    expect(plazaDeRespuesta("MERIDA")).toBe("MERIDA");
    expect(plazaDeRespuesta("OTRA_CON_MUDANZA")).toBe("FORANEO");
    expect(plazaDeRespuesta("OTRA_SIN_MUDANZA")).toBe("FORANEO");
    expect(plazaDeRespuesta(undefined)).toBeNull();
    expect(plazaDeRespuesta("")).toBeNull();
  });
});

describe("persistirEvaluacion", () => {
  const evaluacion = { filtros: { plaza: "PASA" } as never, puntaje: 70, desglose: { actitud: 10 }, resultado: "APTO" as const, motivo: null };
  it("escribe las columnas bot*, la plaza, y mueve la etapa si sigue en RECIBIDO", async () => {
    askClaude.mockResolvedValue("Candidata con 4 años en bienes raíces y cartera mediana.");
    findFirst.mockResolvedValue({ stage: "RECIBIDO" });
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1",
      respuestas: { plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" },
      evaluacion,
      razonesActitud: ["concreta"],
      model: "m",
    });
    const call = update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: "c1" });
    expect(call.data).toMatchObject({ botPuntaje: 70, botResultado: "APTO", botMotivo: null, plaza: "MERIDA", stage: "CONTACTO_INICIAL" });
    expect(call.data.stageChangedAt).toBeInstanceOf(Date);
    expect(call.data.botRespuestas).toEqual({ plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" });
    expect(call.data.botDesglose).toEqual({ actitud: 10, actitud_razones: ["concreta"] });
    expect(call.data.botResumen).toContain("4 años");
    expect(call.data.botEvaluadoAt).toBeInstanceOf(Date);
  });
  it("no toca la etapa si un humano ya la movió, y no pisa una plaza si la respuesta no trae", async () => {
    askClaude.mockResolvedValue("x");
    findFirst.mockResolvedValue({ stage: "ENTREVISTA" });
    update.mockResolvedValue({});
    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion: { ...evaluacion, resultado: "NO_APTO", motivo: "puntaje" }, razonesActitud: [], model: "m" });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.stage).toBeUndefined();
    expect(data.stageChangedAt).toBeUndefined();
    expect("plaza" in data).toBe(false);
    expect(data.botResultado).toBe("NO_APTO");
  });
  it("si el resumen falla, igual persiste con resumen null", async () => {
    askClaude.mockRejectedValue(new Error("x"));
    findFirst.mockResolvedValue({ stage: "RECIBIDO" });
    update.mockResolvedValue({});
    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion, razonesActitud: [], model: "m" });
    expect((update.mock.calls[0][0] as { data: { botResumen: unknown } }).data.botResumen).toBeNull();
  });
});

describe("guardarHorario", () => {
  it("recorta a 200 y nunca lanza", async () => {
    update.mockRejectedValue(new Error("db"));
    await expect(guardarHorario("c1", "x".repeat(300))).resolves.toBeUndefined();
    expect((update.mock.calls[0][0] as { data: { horarioEntrevista: string } }).data.horarioEntrevista).toHaveLength(200);
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar `candidato.ts`**

```ts
// Candidato del bot sobre la tabla del módulo Reclutamiento (#926, recruit_candidates).
// Alta y lectura son best-effort (sin migrar → null); la evaluación sí propaga errores para que
// el hook los loguee.
import type { ConversationChannel, Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { askClaude } from "@/lib/bot/claude";
import { crearCandidato } from "@/server/reclutamiento";
import type { UbicacionCode } from "./shared";
import type { Evaluacion } from "./evaluar";
import { botPuedeMoverEtapa, etapaDeResultado, type Veredicto } from "./etapas";
import type { Respuestas } from "./respuestas";

/** Lo que el bot necesita saber del candidato. */
export interface CandidatoBot {
  id: string;
  stage: string;
  botResultado: Veredicto | null;
  botEvaluadoAt: Date | null;
  horarioEntrevista: string | null;
  tieneCv: boolean;
}

export interface ContactoDelBot {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

const NOMBRE_PROVISIONAL = "Candidato por chat";
const AREA_ASESOR = "Asesor / Ventas";
const SIN_MIGRAR = new Set(["P2021", "P2022"]);

const SELECT_BOT = {
  id: true,
  stage: true,
  botResultado: true,
  botEvaluadoAt: true,
  horarioEntrevista: true,
  files: { where: { kind: "CV", deletedAt: null }, select: { id: true }, take: 1 },
} as const;

type FilaBot = {
  id: string;
  stage: string;
  botResultado: string | null;
  botEvaluadoAt: Date | null;
  horarioEntrevista: string | null;
  files: Array<{ id: string }>;
};

function aCandidatoBot(f: FilaBot): CandidatoBot {
  return {
    id: f.id,
    stage: f.stage,
    botResultado: (f.botResultado as Veredicto | null) ?? null,
    botEvaluadoAt: f.botEvaluadoAt,
    horarioEntrevista: f.horarioEntrevista,
    tieneCv: f.files.length > 0,
  };
}

function codigo(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

async function buscarPorContacto(contactId: string): Promise<CandidatoBot | null> {
  const f = (await prisma.recruitCandidate.findFirst({
    where: { contactId, deletedAt: null },
    select: SELECT_BOT,
  })) as FilaBot | null;
  return f ? aCandidatoBot(f) : null;
}

/** Devuelve el candidato ligado al contacto; si no existe lo crea con origen CHAT. */
export async function asegurarCandidato(input: {
  contact: ContactoDelBot;
  canal: ConversationChannel;
  conversationId: string;
}): Promise<CandidatoBot | null> {
  const { contact } = input;
  try {
    const existente = await buscarPorContacto(contact.id);
    if (existente) return existente;
    const nombre = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || NOMBRE_PROVISIONAL;
    const nuevo = await crearCandidato(
      { fullName: nombre.slice(0, 200), phone: contact.phone ?? null, email: contact.email ?? null, area: AREA_ASESOR },
      null,
      { source: "CHAT", sourceRef: input.conversationId, contactId: contact.id, botCanal: input.canal }
    );
    return { id: nuevo.id, stage: nuevo.stage, botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false };
  } catch (err) {
    const code = codigo(err);
    if (code === "P2002") {
      // Dos mensajes a la vez crearon el candidato: el índice único de contactId gana y releemos.
      try {
        return await buscarPorContacto(contact.id);
      } catch {
        return null;
      }
    }
    if (code && SIN_MIGRAR.has(code)) {
      console.error("[reclutamiento] recruit_candidates sin las columnas del bot (migración 2026-11-02 pendiente); el bot sigue sin evaluar");
      return null;
    }
    console.error("[reclutamiento] asegurarCandidato falló:", err);
    return null;
  }
}

/** Respuesta de plaza del guion → ubicación del módulo (#927). */
export function plazaDeRespuesta(v: string | undefined): UbicacionCode | null {
  if (v === "PDC" || v === "MERIDA") return v;
  if (v === "OTRA_CON_MUDANZA" || v === "OTRA_SIN_MUDANZA") return "FORANEO";
  return null;
}

async function resumenIA(respuestas: Respuestas, ev: Evaluacion, model: string): Promise<string | null> {
  try {
    const texto = await askClaude({
      system:
        "Resume en 2 o 3 líneas, en español y para un gerente de ventas, el perfil de este candidato a asesor inmobiliario: " +
        "experiencia, cartera, disponibilidad, plaza y lo que más pesa a favor o en contra. Sin saludos ni viñetas.",
      messages: [
        {
          role: "user",
          content: `Respuestas: ${JSON.stringify(respuestas)}\nResultado: ${ev.resultado} (${ev.puntaje}/100, motivo ${ev.motivo ?? "ninguno"})`,
        },
      ],
      maxTokens: 200,
      model,
    });
    return texto?.trim() || null;
  } catch {
    return null;
  }
}

export async function persistirEvaluacion(input: {
  candidatoId: string;
  respuestas: Respuestas;
  evaluacion: Evaluacion;
  razonesActitud: string[];
  model: string;
}): Promise<void> {
  const { candidatoId, respuestas, evaluacion: ev } = input;
  const resumen = await resumenIA(respuestas, ev, input.model);
  const actual = await prisma.recruitCandidate.findFirst({ where: { id: candidatoId }, select: { stage: true } });
  const plaza = plazaDeRespuesta(respuestas.plaza);
  const data: Prisma.RecruitCandidateUncheckedUpdateInput = {
    botRespuestas: respuestas as Prisma.InputJsonValue,
    botFiltros: ev.filtros as Prisma.InputJsonValue,
    botPuntaje: ev.puntaje,
    botDesglose: { ...ev.desglose, actitud_razones: input.razonesActitud } as Prisma.InputJsonValue,
    botResultado: ev.resultado,
    botMotivo: ev.motivo,
    botResumen: resumen,
    botEvaluadoAt: new Date(),
  };
  if (plaza) data.plaza = plaza;
  if (actual && botPuedeMoverEtapa(actual.stage)) {
    data.stage = etapaDeResultado(ev.resultado);
    data.stageChangedAt = new Date();
  }
  await prisma.recruitCandidate.update({ where: { id: candidatoId }, data });
}

export async function guardarHorario(candidatoId: string, horario: string): Promise<void> {
  try {
    await prisma.recruitCandidate.update({ where: { id: candidatoId }, data: { horarioEntrevista: horario.slice(0, 200) } });
  } catch (err) {
    console.warn("[reclutamiento] no se pudo guardar el horario:", err);
  }
}
```

Nota: si `Prisma.RecruitCandidateUncheckedUpdateInput` no existe con ese nombre tras `prisma generate`, usar `Record<string, unknown>` tipado como `Prisma.RecruitCandidateUpdateInput`; lo importante es el contenido del `data`.

- [ ] **Step 4: Correr tests** → 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/candidato.ts src/lib/reclutamiento/candidato.test.ts
git commit -m "feat(reclutamiento): candidato del bot sobre recruit_candidates y resumen IA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9': Avisos, tarea y eventos

Igual que la Task 9 del plan original (mismos tests, mismo código, mismo cambio a `events.ts`),
con estas sustituciones en `avisos.ts` y su test:

- `import type { Plaza, RecruitmentVerdict } from "@prisma/client";` →
  `import type { Plaza } from "@prisma/client"; import type { UbicacionCode } from "./shared"; import type { Veredicto } from "./etapas";`
- `plaza: Plaza | null` → `plaza: UbicacionCode | null` (en `responsablesDe` y en el input de `avisarResultado`).
- `resultado: RecruitmentVerdict` → `resultado: Veredicto`.
- En `responsablesDe`, la configuración por plaza solo existe para PDC y MERIDA y la gerencia solo para plazas del CRM:

```ts
const PLAZAS_CRM: readonly string[] = ["PDC", "TULUM", "MERIDA"];
function esPlazaCrm(p: string): p is Plaza {
  return PLAZAS_CRM.includes(p);
}

/** Orden: configuración de la plaza → gerencia de la plaza → default configurado → ADMIN personas. */
export async function responsablesDe(plaza: UbicacionCode | null, cfg: ResponsablesReclutamiento): Promise<string[]> {
  if (plaza === "PDC" || plaza === "MERIDA") {
    if (cfg[plaza]?.length) return cfg[plaza]!;
  }
  if (plaza && esPlazaCrm(plaza)) {
    const gerencia = await gerenciaDeLaPlaza(plaza).catch(() => [] as string[]);
    if (gerencia.length > 0) return gerencia;
  }
  if (cfg.default?.length) return cfg.default;
  try {
    const admins = await prisma.user.findMany({ where: { ...usuarioRuteableWhere(), role: "ADMIN" }, select: { id: true } });
    return admins.map((a) => a.id);
  } catch {
    return [];
  }
}
```

- Agregar un test: `responsablesDe("FORANEO", { default: ["d1"] })` devuelve `["d1"]` y no llama a `gerenciaDeLaPlaza`.
- En el `description` de la tarea y en el `message` de la notificación, agregar al final ` · Ficha: /reclutamiento` para que el gerente sepa dónde ver el perfil.

---

### Task 10': Copiar el adjunto como CV del candidato

**Files:**
- Modify: `src/lib/storage/crm-attachments.ts` (agregar `copiarDeChatMedia`)
- Create: `src/lib/reclutamiento/cv.ts`
- Test: `src/lib/reclutamiento/cv.test.ts`
- Modify: `src/lib/messaging/core.ts` (después del `prisma.message.create` INBOUND, ~línea 557)

- [ ] **Step 1: Helper de copia entre buckets**

En `src/lib/storage/crm-attachments.ts`, agregar `import { CHAT_MEDIA_BUCKET } from "./chat-media";` y:

```ts
/**
 * Copia un objeto del bucket del chat al bucket de adjuntos (CV que llega por mensaje). Devuelve
 * el tamaño en bytes, o null si falla (nunca lanza). No borra el original: el inbox lo sigue mostrando.
 */
export async function copiarDeChatMedia(pathOrigen: string, pathDestino: string, contentType: string): Promise<number | null> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return null;
    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).download(pathOrigen);
    if (error || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    const up = await supabase.storage.from(CRM_ATTACHMENTS_BUCKET).upload(pathDestino, buffer, { contentType, upsert: false });
    if (up.error) return null;
    return buffer.byteLength;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const candFindFirst = vi.fn();
const fileFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recruitCandidate: { findFirst: (...a: unknown[]) => candFindFirst(...a) },
    recruitCandidateFile: { findFirst: (...a: unknown[]) => fileFindFirst(...a) },
  },
}));
const copiarDeChatMedia = vi.fn();
vi.mock("@/lib/storage/crm-attachments", () => ({ copiarDeChatMedia: (...a: unknown[]) => copiarDeChatMedia(...a) }));
const registrarCvDeCandidato = vi.fn();
vi.mock("@/server/reclutamiento", () => ({ registrarCvDeCandidato: (...a: unknown[]) => registrarCvDeCandidato(...a) }));

import { esMimeDeCv, ligarCv } from "./cv";

beforeEach(() => { candFindFirst.mockReset(); fileFindFirst.mockReset(); copiarDeChatMedia.mockReset(); registrarCvDeCandidato.mockReset(); });

describe("esMimeDeCv", () => {
  it("acepta PDF y Word; rechaza imagen, audio y video (mismas reglas que la subida manual)", () => {
    expect(esMimeDeCv("application/pdf")).toBe(true);
    expect(esMimeDeCv("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(esMimeDeCv("application/msword")).toBe(true);
    expect(esMimeDeCv("image/jpeg")).toBe(false);
    expect(esMimeDeCv("audio/ogg")).toBe(false);
    expect(esMimeDeCv("video/mp4")).toBe(false);
    expect(esMimeDeCv(null)).toBe(false);
  });
});

describe("ligarCv", () => {
  const msg = { id: "m1", contactId: "k1", mediaUrl: "2026-11/abc.pdf", mediaMimeType: "application/pdf", mediaFilename: "CV Ana.pdf" };
  it("copia el adjunto al bucket de CV y lo registra con origen CHAT", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(12345);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    expect(await ligarCv(msg)).toBe(true);
    const [origen, destino, mime] = copiarDeChatMedia.mock.calls[0] as [string, string, string];
    expect(origen).toBe("2026-11/abc.pdf");
    expect(destino).toMatch(/^candidates\/c1\/cv\/[0-9a-f-]{36}\.pdf$/);
    expect(mime).toBe("application/pdf");
    expect(registrarCvDeCandidato).toHaveBeenCalledWith({
      candidateId: "c1", storagePath: destino, fileName: "CV Ana.pdf", mimeType: "application/pdf",
      sizeBytes: 12345, source: "CHAT", sourceRef: "m1", uploadedById: null,
    });
  });
  it("sin nombre de archivo usa uno por extensión", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(1);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    await ligarCv({ ...msg, mediaFilename: null, mediaMimeType: "application/msword" });
    expect((registrarCvDeCandidato.mock.calls[0][0] as { fileName: string }).fileName).toBe("cv.doc");
    expect((copiarDeChatMedia.mock.calls[0] as string[])[1]).toMatch(/\.doc$/);
  });
  it("el mismo mensaje no se registra dos veces (no copia de nuevo)", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue({ id: "f1" });
    expect(await ligarCv(msg)).toBe(false);
    expect(copiarDeChatMedia).not.toHaveBeenCalled();
  });
  it("sin candidato, media externa (no del bucket), sin media o mime no válido → false", async () => {
    candFindFirst.mockResolvedValue(null);
    expect(await ligarCv(msg)).toBe(false);
    candFindFirst.mockResolvedValue({ id: "c1" });
    expect(await ligarCv({ ...msg, mediaUrl: "https://cdn.meta.com/x.pdf" })).toBe(false);
    expect(await ligarCv({ ...msg, mediaUrl: null })).toBe(false);
    expect(await ligarCv({ ...msg, mediaMimeType: "image/jpeg" })).toBe(false);
    expect(copiarDeChatMedia).not.toHaveBeenCalled();
  });
  it("si la copia falla no registra nada", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(null);
    expect(await ligarCv(msg)).toBe(false);
    expect(registrarCvDeCandidato).not.toHaveBeenCalled();
  });
  it("sin migrar (P2022) → false sin lanzar", async () => {
    candFindFirst.mockRejectedValue(Object.assign(new Error(), { code: "P2022" }));
    expect(await ligarCv(msg)).toBe(false);
  });
});
```

- [ ] **Step 3: Correr y ver que falla** → FAIL.

- [ ] **Step 4: Implementar `cv.ts`**

```ts
// CV que llega por chat (spec §6): se copia del bucket del chat al bucket de adjuntos del módulo
// Reclutamiento y se registra con la MISMA función que la subida manual (registrarCvDeCandidato),
// con origen CHAT y el id del mensaje como referencia (idempotente por el índice único).
// Se llama desde la ingesta (messaging/core.ts) tras guardar el mensaje. Nunca lanza.
import prisma from "@/lib/db";
import { CV_TIPOS } from "@/lib/contacts/archivos";
import { isStoragePath } from "@/lib/storage/chat-media";
import { copiarDeChatMedia } from "@/lib/storage/crm-attachments";
import { registrarCvDeCandidato } from "@/server/reclutamiento";
import { rutaCvCandidato } from "./shared";

const SIN_MIGRAR = new Set(["P2021", "P2022"]);

/** Mismos tipos que la subida manual (#917/#926): PDF, DOC y DOCX. */
export function esMimeDeCv(mime: string | null | undefined): boolean {
  return !!mime && mime in CV_TIPOS;
}

function nombrePorDefecto(mime: string): string {
  const ext = CV_TIPOS[mime]?.[0] ?? "pdf";
  return `cv.${ext.replace(/^\./, "")}`;
}

export async function ligarCv(msg: {
  id: string;
  contactId: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}): Promise<boolean> {
  const mime = msg.mediaMimeType;
  if (!msg.mediaUrl || !isStoragePath(msg.mediaUrl) || !mime || !esMimeDeCv(mime)) return false;
  try {
    const cand = await prisma.recruitCandidate.findFirst({ where: { contactId: msg.contactId, deletedAt: null }, select: { id: true } });
    if (!cand) return false;
    const yaRegistrado = await prisma.recruitCandidateFile.findFirst({ where: { source: "CHAT", sourceRef: msg.id }, select: { id: true } });
    if (yaRegistrado) return false;

    const fileName = msg.mediaFilename?.trim() || nombrePorDefecto(mime);
    const destino = rutaCvCandidato(cand.id, fileName);
    const sizeBytes = await copiarDeChatMedia(msg.mediaUrl, destino, mime);
    if (sizeBytes == null) return false;

    const r = await registrarCvDeCandidato({
      candidateId: cand.id,
      storagePath: destino,
      fileName,
      mimeType: mime,
      sizeBytes,
      source: "CHAT",
      sourceRef: msg.id,
      uploadedById: null,
    });
    return !r.duplicado;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (!code || !SIN_MIGRAR.has(code)) console.warn("[reclutamiento] ligarCv falló:", err);
    return false;
  }
}
```

Antes de implementar, leer `src/lib/contacts/archivos.ts` para confirmar la forma de `CV_TIPOS`
(mime → extensiones). Si las extensiones vienen con punto o sin él, ajustar `nombrePorDefecto`
para que el test `cv.doc` pase. `rutaCvCandidato` toma la extensión del `fileName` con `extension()`
del mismo módulo.

- [ ] **Step 5: Correr tests** → 7 passed.

- [ ] **Step 6: Llamar desde `core.ts`** — igual que el Step 5 de la Task 10 original (bloque
`if (message?.mediaUrl) { … ligarCv(...) }` con import dinámico, tras el `prisma.message.create`
INBOUND). El comentario del bloque dice: «Bot de reclutamiento (spec 2026-11-02 §6): si el contacto
es candidato y manda un PDF o Word, se registra como su CV en Reclutamiento. Best-effort».

- [ ] **Step 7: Verificar que los tests de core siguen verdes**

Run: `npx vitest run src/lib/messaging`
Expected: todos pasan. Si algún mock de `@/lib/db` falla por `recruitCandidate` indefinido, el
`catch` de `ligarCv` lo absorbe; si aun así un test se rompe, agregar al mock
`recruitCandidate: { findFirst: vi.fn(async () => null) }`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage/crm-attachments.ts src/lib/reclutamiento/cv.ts src/lib/reclutamiento/cv.test.ts src/lib/messaging/core.ts
git commit -m "feat(reclutamiento): registrar como CV los PDF/Word que el candidato manda por chat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11': Hook del bot (evaluar al terminar, cierre, horario)

Igual que la Task 11 del plan original en estructura y objetivos, con estos cambios. Donde este
anexo no dice nada, vale el texto original.

**Cambios en `hook.ts`:**

- Imports: `import type { ConversationChannel, PlaybookRunStatus } from "@prisma/client";` (ya no existe `RecruitmentCandidate`);
  `import { asegurarCandidato, guardarHorario, persistirEvaluacion, plazaDeRespuesta, type ContactoDelBot } from "./candidato";`
  (sin `marcarPerfilando`); `import type { Veredicto } from "./etapas";` en lugar de `ETAPAS_EVALUADAS` y `etapaDeResultado`.
- `OBJETIVOS_CIERRE`: donde diga «(PDF, foto o Word, aquí mismo)» poner «(PDF o Word, aquí mismo)».
- `cierreDe` recibe la forma del bot, no la fila:

```ts
function cierreDe(c: { botResultado: Veredicto | null; tieneCv: boolean; horarioEntrevista: string | null }): string | undefined {
  switch (c.botResultado) {
    case "APTO":
      if (c.horarioEntrevista) return OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO;
      return c.tieneCv ? OBJETIVOS_CIERRE.APTO_CON_CV : OBJETIVOS_CIERRE.APTO_SIN_CV;
    case "REVISAR":
      return c.tieneCv ? OBJETIVOS_CIERRE.REVISAR_CON_CV : OBJETIVOS_CIERRE.REVISAR_SIN_CV;
    case "NO_APTO":
      return OBJETIVOS_CIERRE.NO_APTO;
    default:
      return undefined;
  }
}
```
  (con `import type { Veredicto } from "./etapas";`).
- Input del hook: `contact: ContactoDelBot & { custom: unknown }` (es decir, `{ id, firstName, lastName, phone, email, custom }`).
- `asegurarCandidato({ contact: input.contact, canal: input.channel, conversationId: input.conversationId })`.
- «Ya evaluado» = `cand.botEvaluadoAt !== null` (en lugar de `ETAPAS_EVALUADAS.includes(cand.etapa)`). La captura de horario aplica cuando `cand.botResultado === "APTO" && !cand.horarioEntrevista`.
- Rama «en curso» (`status !== "COMPLETED"`): quitar la llamada a `marcarPerfilando`; solo devuelve el `contexto` con la ficha.
- `cvRecibido: cand.tieneCv` al evaluar.
- Retorno final: `return { objetivo: cierreDe({ botResultado: ev.resultado, tieneCv: cand.tieneCv, horarioEntrevista: null }) };`

**Cambios en `hook.test.ts`:**

- El mock de `./candidato` ya no exporta `marcarPerfilando`.
- `contactoApto` incluye `phone: "+521", email: "ana@x.mx"`.
- Las filas que devuelve `asegurarCandidato` tienen la forma `CandidatoBot`:
  - sin evaluar: `{ id: "c1", stage: "RECIBIDO", botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false }`
  - con CV: `tieneCv: true`
  - ya evaluado APTO: `{ ..., botResultado: "APTO", botEvaluadoAt: new Date(), tieneCv: true, horarioEntrevista: null }`
  - ya evaluado REVISAR: `{ ..., botResultado: "REVISAR", botEvaluadoAt: new Date(), tieneCv: false, horarioEntrevista: null }`
- El test «en curso» deja de esperar `marcarPerfilando`; sigue comprobando el `contexto` con la ficha y `objetivo` undefined.
- Nuevo test: «ya evaluado NO_APTO: devuelve el cierre NO_APTO sin re-evaluar».
- Las expectativas de puntaje (85 y 74) y de `avisarResultado` (`plaza: "PDC"`, `nombre: "Ana López"`) no cambian.
- `asegurarCandidato` debe haberse llamado con `expect.objectContaining({ canal: "INSTAGRAM", conversationId: "v1", contact: expect.objectContaining({ id: "k1" }) })` en el primer test de evaluación.

---

### Enmienda a Task 12 (bot-respond.ts)

- Donde el scaffolding del test agrega `recruitmentCandidate: {}` al mock de `@/lib/db`, poner `recruitCandidate: {}`.
- Al llamar al hook, el `contact` que se pasa debe incluir `id, firstName, lastName, phone, email, custom`. Verificar que el `select`/`findUnique` del contacto en `bot-respond.ts` ya trae `phone` y `email`; si no, agregarlos al select.

---

### Enmienda a Task 14 (prueba de humo)

En «Precondiciones», el paso 1 dice: «Aplicar `prisma/migrations-manual/2026-11-02-reclutamiento-bot.sql`».
En los casos: «En BD: fila en `recruit_candidates` con `botResultado=APTO`, `botPuntaje ≥ 65`,
`plaza=PDC`, `stage=CONTACTO_INICIAL`, `source=CHAT`»; REVISAR → `stage=FILTRO_CV`,
`botMotivo=ambiguo:colchon_meses`; NO_APTO → `stage=DESCARTADO`, `botMotivo=filtro:movilidad`.
«Mandar un PDF → aparece en la columna CV de `/reclutamiento`». Agregar al final de cada caso:
«Abrir `/reclutamiento` como ADMIN y confirmar que el candidato aparece con origen CHAT».

### Fuera de F1 (se suma a lo del plan original)

- F2: en `/reclutamiento`, mostrar `botResultado`, `botPuntaje`, `botResumen`, `horarioEntrevista` y
  un enlace a la conversación (`sourceRef` cuando `source = CHAT`); filtro por veredicto.
- F2: al reclasificar a LEAD_COMPRADOR a mitad del guion, mover a DESCARTADO con nota.
- Límite de tamaño del CV por chat: la subida manual corta en 10 MB; por chat no se valida tamaño
  (Meta ya limita los adjuntos). Si molesta, aplicar `CV_MAX_BYTES` en `ligarCv` y borrar la copia.
