// El Dashboard se retiró (#890, 2026-10-15): la página de inicio del CRM es «Hoy».
// Esta ruta se queda solo para que los marcadores y enlaces viejos a /dashboard lleguen a
// /hoy en vez de dar 404.
import { redirect } from "next/navigation";

export default function DashboardRetirado() {
  redirect("/hoy");
}
