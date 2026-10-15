// Raíz del CRM: sin landing. Redirige directo al login
// (o a «Hoy» si ya hay sesión; el Dashboard se retiró en #890). La landing anterior queda en el historial de git.
import { redirect } from "next/navigation"
import { getServerSession } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export default async function Home() {
  const session = await getServerSession()
  redirect(session?.user ? "/hoy" : "/login")
}
