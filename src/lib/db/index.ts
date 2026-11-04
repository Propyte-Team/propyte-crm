import { PrismaClient } from "@prisma/client";

// Singleton de Prisma. Se guarda en globalThis SIEMPRE (también en producción): en Vercel cada
// instancia serverless reutiliza el cliente entre invocaciones calientes y no abre un pool nuevo
// por petición; en dev evita duplicarlo con el hot reload. Cada PrismaClient abre su propio pool,
// así que un segundo cliente son más conexiones contra el límite de 15 del pooler (#974).
// El tamaño del pool se fija en DATABASE_URL (?connection_limit=), ver docs/infra/pool-bd.md.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;

export default prisma;
