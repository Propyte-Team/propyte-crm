// Opciones del select "Asesor" (AdvisorSelect). Puro para poder probarlo sin React.
//
// Por qué existe `self` (2026-10-10): la lista sale de /api/users filtrada a roles
// de asesor, así que un ADMIN —quien lleva marketing— no podía asignarse un
// lead a sí mismo desde la ficha del contacto, aunque updateContact acepta
// cualquier usuario como assignedToId. Con `self`, quien está viendo la ficha
// siempre aparece en la lista. Sin `self` las opciones son las mismas de siempre.

export interface AdvisorOptionUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface AdvisorOption {
  value: string;
  label: string;
}

function labelOf(u: AdvisorOptionUser): string {
  return u.name ?? u.email ?? u.id;
}

export function buildAdvisorOptions(
  advisors: AdvisorOptionUser[],
  self?: AdvisorOptionUser | null
): AdvisorOption[] {
  const options = advisors.map((a) => ({ value: a.id, label: labelOf(a) }));
  // Si ya es asesor, ya está en la lista: no se duplica.
  if (!self || advisors.some((a) => a.id === self.id)) return options;
  // Primero y marcado "(yo)": se lee bien como acción en la lista y como estado
  // cuando queda seleccionado ("Asesor: Ana Pérez (yo)").
  const selfName = self.name ?? self.email;
  return [{ value: self.id, label: selfName ? `${selfName} (yo)` : "Asignarme a mí" }, ...options];
}
