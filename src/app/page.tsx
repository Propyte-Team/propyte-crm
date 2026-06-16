// Raíz del CRM: sin landing. Redirige directo al login
// (o al dashboard si ya hay sesión). La landing anterior queda en el historial de git.
import { redirect } from "next/navigation"
import { getServerSession } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export default async function Home() {
  const session = await getServerSession()
  redirect(session?.user ? "/dashboard" : "/login")
}
