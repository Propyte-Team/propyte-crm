// Página raíz: redirige automáticamente al dashboard
import { redirect } from "next/navigation"

export default function RootPage() {
  redirect("/dashboard")
}
