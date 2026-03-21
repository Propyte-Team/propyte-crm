// Audiences content wrapper — handles useSearchParams
"use client"

import { useSearchParams } from "next/navigation"
import { AudienceList } from "@/components/meta-ads/audience-list"

export function AudiencesPageContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get("account") || ""

  return <AudienceList accountId={accountId} />
}
