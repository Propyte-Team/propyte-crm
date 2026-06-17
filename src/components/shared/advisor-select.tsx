"use client";

import { useEffect, useState } from "react";

interface Advisor {
  id: string;
  name: string | null;
  email: string | null;
}

export function AdvisorSelect({
  value,
  onChange,
  allowUnassigned = false,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void | Promise<void>;
  allowUnassigned?: boolean;
  disabled?: boolean;
}) {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
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
      {advisors.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name ?? a.email ?? a.id}
        </option>
      ))}
    </select>
  );
}
