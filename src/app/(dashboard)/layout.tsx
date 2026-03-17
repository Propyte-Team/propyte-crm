// Layout del dashboard: estructura con sidebar, topbar y área de contenido principal
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6" style={{ background: "var(--bg-surface)" }}>
          {children}
        </main>
      </div>
    </div>
  )
}
