// Meta Ads — Anuncios
import { Suspense } from "react"
import { AdsPageContent } from "./ads-content"

export default function MetaAdsAdsPage() {
  return (
    <Suspense fallback={<div className="flex h-48 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>Cargando anuncios...</div>}>
      <AdsPageContent />
    </Suspense>
  )
}
