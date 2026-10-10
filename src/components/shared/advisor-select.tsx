"use client";

import { useEffect, useState } from "react";
import { buildAdvisorOptions, type AdvisorOptionUser } from "./advisor-options";

export function AdvisorSelect({
  value,
  onChange,
  allowUnassigned = false,
  disabled = false,
  self = null,
}: {
  value: string | null;
  onChange: (id: string | null) => void | Promise<void>;
  allowUnassigned?: boolean;
  disabled?: boolean;
  /** Usuario en sesión: siempre seleccionable aunque su rol no sea de asesor (ver advisor-options.ts). */
  self?: AdvisorOptionUser | null;
}) {
  const [advisors, setAdvisors] = useState<AdvisorOptionUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/users?role=ASESOR,ASESOR_SR,ASESOR_JR,TEAM_LEADER&isActive=true&basic=true")
      .then((r) => r.json())
      .then((j) => setAdvisors(j.data ?? []))
      .catch(() => setAdvisors([]));
  }, []);

  return (
    <select
      className="form-input max-w-[200px] text-[13px]"
      value={value ?? ""}
      disabled={disabled || busy}
      onChange={async (e) => {
        const v = e.target.value || null;
        setBusy(true);
        try {
          await onChange(v);
        } finally {
          setBusy(false);
        }
      }}
    >
      {allowUnassigned && <option value="">Sin asignar</option>}
      {!allowUnassigned && value == null && (
        <option value="" disabled>
          Seleccionar…
        </option>
      )}
      {buildAdvisorOptions(advisors, self).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
