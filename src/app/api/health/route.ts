// #771 — comprobación de salud que de verdad toca la base, no solo «¿el proceso está vivo?».
//
// El incidente de producción de septiembre (la causa la arregló Luis en el PR #65) mostró
// que un chequeo superficial no alcanza: `/login` seguía devolviendo 200 durante los 3 días
// de caída, porque es la única pantalla que no consulta Prisma. Todo lo que sí lo tocaba
// —`/`, `/api/auth/session`, `/api/auth/csrf`, y por lo tanto todo webhook entrante—
// devolvía 500 desde el minuto uno (`Cannot find module '.prisma/client/default'`), pero
// nadie lo vio hasta que una persona abrió la página tres días después.
//
// Esta ruta hace lo mínimo que habría cortado esa caída el mismo día: un `SELECT 1` real
// contra la base. Si el cliente de Prisma no resuelve o la base no responde, esto da 500
// desde el primer minuto — no espera a que alguien note que el dashboard no carga.
//
// Pública a propósito: NO está en el matcher de `middleware.ts` (igual que
// `/api/webhooks/**`), porque la tienen que poder llamar un pipeline de despliegue o un
// monitor externo, ninguno de los dos con sesión iniciada.
//
// Lo que esta ruta NO decide (son preguntas operativas, no de código — ver #771):
//   a) que el propio despliegue la llame después de publicar y marque el release como
//      fallido si no da 200;
//   c) que algo externo la revise cada N minutos;
//   d) a quién le llega el aviso cuando falle.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up" }, { status: 200 });
  } catch (err) {
    // El detalle del error (que puede incluir rutas de módulo o, en otros casos, texto de
    // conexión) se queda en el log del servidor — la respuesta pública no lo repite.
    console.error("[health] la base no respondió:", err);
    return NextResponse.json({ ok: false, db: "down" }, { status: 500 });
  }
}
