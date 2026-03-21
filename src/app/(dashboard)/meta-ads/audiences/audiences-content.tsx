// Audiences content wrapper — handles useSearchParams
"use client"

import { useSearchParams } from "next/navigation"
import { AudienceList } from "@/components/meta-ads/audience-list"

const DEFAULT_ACCOUNT = "act_1201682720552407"

export function AudiencesPageContent() {
  const searchParams = useSearchParams()
  const accountId = searchParams.get("account") || DEFAULT_ACCOUNT

  return <AudienceList accountId={accountId} />
}
