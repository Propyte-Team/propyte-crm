// #988 — ¿El error es de una migración manual sin correr? Lo usan el cron y las páginas de Copilot
// para no tumbarse si el código sale antes que el SQL.
//   - P2021: la tabla no existe (consultas de Prisma).
//   - P2010 con 42P01 («relation … does not exist»): lo mismo en una consulta cruda ($queryRaw).
// Se mira la forma del error y no `instanceof`, para que funcione igual con el cliente doblado de
// las pruebas.
export function esTablaSinMigrar(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (e.code === "P2021") return true;
  if (e.code !== "P2010") return false;
  return e.meta?.code === "42P01" || (typeof e.message === "string" && /relation .* does not exist/i.test(e.message));
}
