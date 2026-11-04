import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { findDuplicateGroups } from "@/server/contacts-dedup";
import { CLAVE_REVISADOS, firmaDeGrupo } from "./firma";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

// GET ?tipo=strong|name &offset=0 &limit=20
// Sin offset/limit devuelve todo (compatible). `data` sigue siendo la lista de grupos;
// `meta` trae los totales para paginar. Los grupos marcados "No es duplicado" no aparecen.
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const tipo = sp.get("tipo");
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);
  const limitRaw = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;

  const todos = await findDuplicateGroups();
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REVISADOS } }).catch(() => null);
  const revisados = new Set(Array.isArray(fila?.value) ? (fila!.value as string[]) : []);

  const visibles = todos
    .map((g) => ({ ...g, key: firmaDeGrupo(g.contacts.map((c) => c.id)) }))
    .filter((g) => !revisados.has(g.key));

  const meta = {
    total: visibles.length,
    totalFuertes: visibles.filter((g) => g.matchType === "strong").length,
    totalNombre: visibles.filter((g) => g.matchType === "name").length,
  };
  const filtrados = tipo === "strong" || tipo === "name" ? visibles.filter((g) => g.matchType === tipo) : visibles;
  const data = limit ? filtrados.slice(offset, offset + limit) : filtrados.slice(offset);

  return NextResponse.json({
    data,
    meta: { ...meta, filtrados: filtrados.length, offset, hayMas: limit ? offset + limit < filtrados.length : false },
  });
}
