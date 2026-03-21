// Ads content wrapper — handles useSearchParams
"use client"

import { useSearchParams } from "next/navigation"
import { AdGallery } from "@/components/meta-ads/ad-gallery"

const DEFAULT_ACCOUNT = "act_1201682720552407"

export function AdsPageContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get("account") || DEFAULT_ACCOUNT

  return <AdGallery accountId={accountId} />
}
