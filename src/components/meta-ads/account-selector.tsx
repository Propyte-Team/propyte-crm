// Account selector for Meta Ads — Design System v2
"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"

interface MetaAccount {
  id: string
  accountId: string
  name: string
  currency: string
}

interface AccountSelectorProps {
  accounts: MetaAccount[]
  currentAccountId?: string
}

export function AccountSelector({ accounts, currentAccountId }: AccountSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const current = currentAccountId || accounts[0]?.id || ""

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("account", e.target.value)
    router.push(`${pathname}?${params.toString()}`)
  }

  if (accounts.length <= 1) return null

  return (
    <select
      value={current}
      onChange={handleChange}
      className="rounded-md px-3 py-1.5 text-[13px] font-medium outline-none transition-colors"
      style={{
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-default)",
      }}
    >
      {accounts.map((acc) => (
        <option key={acc.id} value={acc.id}>
          {acc.name} ({acc.accountId})
        </option>
      ))}
    </select>
  )
}
