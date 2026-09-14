// Valores custom de un record núcleo (Contact/Deal) — GET defs+valores · PATCH con
// validación zod-from-registry + field-level security (speckit §3.4/PC5).
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getActiveFields, visibleFields, buildZodFromRegistry } from "@/lib/metadata/registry";
import type { UserRole } from "@prisma/client";
import { withChangeSource } from "@/lib/audit/change-context";
import { puedeTocarRecord } from "@/lib/rbac/record-access";

const SUPPORTED: Record<string, "contact" | "deal"> = { contact: "contact", deal: "deal" };

async function loadRecord(object: "contact" | "deal", id: string) {
  if (object === "contact") {
    return prisma.contact.findUnique({ where: { id }, select: { id: true, custom: true } });
  }
  return prisma.deal.findUnique({ where: { id }, select: { id: true, custom: true } });
}

export async function GET(req: NextRequest, { params }: { params: { object: string; id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = SUPPORTED[params.object];
  if (!object) return NextResponse.json({ error: "Objeto no soportado" }, { status: 404 });

  const record = await loadRecord(object, params.id);
  if (!record) return NextResponse.json({ error: "Record no existe" }, { status: 404 });

  // #711: `visibleFields` filtra QUÉ campos ve cada rol, pero nadie comprobaba DE QUIÉN
  // es el record. Cualquier usuario leía y escribía el `custom` de cualquier contacto o
  // negocio con solo poner su id en la URL. Mismo 404 que si no existiera.
  if (!(await puedeTocarRecord(object, params.id, session.user, "ver"))) {
    return NextResponse.json({ error: "Record no existe" }, { status: 404 });
  }

  const fields = await getActiveFields(object);
  const visible = visibleFields(fields, session.user.role as UserRole);
  const values = (record.custom ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    data: visible.map(({ field, canEdit }) => ({
      apiName: field.apiName,
      label: field.label,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      helpText: field.helpText,
      options: field.options.map((o) => ({ value: o.value, label: o.label, color: o.color })),
      canEdit,
      value: values[field.apiName] ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { object: string; id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = SUPPORTED[params.object];
  if (!object) return NextResponse.json({ error: "Objeto no soportado" }, { status: 404 });

  // #741: esta lectura ya NO alimenta la mezcla —la hace la base, abajo— y se queda solo
  // como comprobación de existencia, para seguir devolviendo 404 antes de mirar permisos.
  const record = await loadRecord(object, params.id);
  if (!record) return NextResponse.json({ error: "Record no existe" }, { status: 404 });

  if (!(await puedeTocarRecord(object, params.id, session.user, "editar"))) {
    return NextResponse.json({ error: "Record no existe" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const fields = await getActiveFields(object);
  const visible = visibleFields(fields, session.user.role as UserRole);

  // Solo claves que el rol puede EDITAR
  const editable = new Set(visible.filter((v) => v.canEdit).map((v) => v.field.apiName));
  for (const key of Object.keys(body)) {
    if (!editable.has(key)) {
      return NextResponse.json({ error: `Sin permiso o campo inexistente: ${key}` }, { status: 403 });
    }
  }

  const validator = buildZodFromRegistry(visible.map((v) => v.field));
  const parsed = validator.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // #741 — La mezcla se hace EN LA BASE, no en memoria.
  //
  // EL DEFECTO: antes esta ruta leía el `custom` en la línea 62 (fuera de cualquier
  // transacción), lo mezclaba en JavaScript con `{ ...viejo, ...nuevo }` y escribía el
  // resultado completo. Dos personas editando campos DISTINTOS del mismo contacto casi a
  // la vez leían las dos el mismo estado anterior, cada una escribía su copia entera
  // encima, y la segunda borraba lo de la primera. Las dos recibían `ok: true`.
  //
  // POR QUÉ NO BASTA RELEER DENTRO DE LA TRANSACCIÓN, que es el arreglo que parece obvio
  // y que la propia tarjeta ofrecía como primera opción: Prisma abre las transacciones en
  // READ COMMITTED, y en ese nivel dos transacciones pueden leer la misma versión de la
  // fila y la segunda escritura sigue ganando. Meter el SELECT dentro del $transaction
  // mueve el problema de sitio sin resolverlo. Haría falta `FOR UPDATE` o Serializable con
  // reintento; las dos son más código y más modos de fallo que esto.
  //
  // LO QUE SÍ LO RESUELVE: que la fila vieja la lea el propio UPDATE. El operador `||` de
  // jsonb hace exactamente la misma mezcla superficial que el spread de JavaScript, y en
  // READ COMMITTED un UPDATE que choca con otro sobre la misma fila espera a que el
  // primero confirme y REEVALÚA sobre la versión ya confirmada. Así la segunda escritura
  // se apila sobre la primera en vez de pisarla.
  //
  // EL `case jsonb_typeof`: reproduce el `?? {}` que había en JavaScript. Si `custom`
  // llegara a guardar el valor JSON `null` en vez de un objeto, `'null'::jsonb || '{...}'`
  // NO falla: devuelve el ARRAY `[null, {...}]` y corrompería el registro en silencio.
  // Medido hoy en producción son 0 filas de 111 contactos y 1 deal, pero «hoy son cero» es
  // justo el argumento que la #682 demostró que caduca.
  //
  // `updatedAt` se pone a mano porque `@updatedAt` lo aplica Prisma, no la base, y un
  // UPDATE crudo no pasa por ahí. En UTC, que es como Prisma escribe esta columna.
  const nuevos = JSON.stringify(parsed.data);
  const filas = await withChangeSource({ source: "ui", actorId: session.user.id }, async (tx) => {
    // Sin interpolar el nombre de la tabla: son dos consultas literales y `object` ya viene
    // acotado por SUPPORTED, pero una tabla interpolada es una costumbre que se copia mal.
    if (object === "contact") {
      return tx.$queryRaw<Array<{ custom: unknown }>>`
        UPDATE propyte_crm.contacts
           SET custom = (CASE WHEN jsonb_typeof(custom) = 'object' THEN custom ELSE '{}'::jsonb END)
                        || ${nuevos}::jsonb,
               "updatedAt" = (now() AT TIME ZONE 'utc')
         WHERE id = ${params.id}
        RETURNING custom`;
    }
    return tx.$queryRaw<Array<{ custom: unknown }>>`
      UPDATE propyte_crm.deals
         SET custom = (CASE WHEN jsonb_typeof(custom) = 'object' THEN custom ELSE '{}'::jsonb END)
                      || ${nuevos}::jsonb,
             "updatedAt" = (now() AT TIME ZONE 'utc')
       WHERE id = ${params.id}
      RETURNING custom`;
  });

  // Cero filas significa que el record desapareció entre la comprobación de acceso y el
  // UPDATE. Mismo 404 que el resto de la ruta, en vez de responder `ok: true` sobre algo
  // que ya no existe.
  if (filas.length === 0) {
    return NextResponse.json({ error: "Record no existe" }, { status: 404 });
  }

  // Lo que se devuelve es lo que quedó GUARDADO, no lo que este request creía que iba a
  // quedar: si otra edición entró en medio, la respuesta la incluye y la pantalla se
  // entera. Antes se devolvía la mezcla calculada en memoria, que podía no ser ya cierta.
  const merged = (filas[0].custom ?? {}) as Record<string, unknown>;

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: object === "contact" ? "Contact.custom" : "Deal.custom",
      entityId: params.id,
      changes: parsed.data as object,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, data: merged });
}
