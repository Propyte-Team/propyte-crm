import { PrismaClient } from "@prisma/client";

// Singleton de Prisma para evitar múltiples instancias en desarrollo (hot reload)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
