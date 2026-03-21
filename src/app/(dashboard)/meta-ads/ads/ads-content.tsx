// Ads content wrapper — handles useSearchParams
"use client"

import { useSearchParams } from "next/navigation"
import { AdGallery } from "@/components/meta-ads/ad-gallery"

export function AdsPageContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get("account") || ""

  return <AdGallery accountId={accountId} />
}
