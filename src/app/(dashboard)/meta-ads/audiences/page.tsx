// Meta Ads — Audiencias
import { Suspense } from "react"
import { AudiencesPageContent } from "./audiences-content"

export default function MetaAdsAudiencesPage() {
  return (
    <Suspense fallback={<div className="flex h-48 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>Cargando audiencias...</div>}>
      <AudiencesPageContent />
    </Suspense>
  )
}
