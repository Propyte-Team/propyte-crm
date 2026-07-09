// Formateo de fechas con zona horaria FIJA (America/Cancun).
// Sin timeZone, un componente cliente renderiza el día según la tz del navegador
// mientras el server lo renderiza en UTC → mismatch de hidratación (React #418/#425)
// cerca de medianoche. Todas las plazas de Propyte operan en horario Cancún, así que
// fijar la tz hace SSR == CSR y elimina el mismatch.
const TZ = "America/Cancun";

export function formatDate(d: Date | string | number, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleDateString("es-MX", { timeZone: TZ, ...opts });
}

export function formatDateTime(d: Date | string | number, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(d).toLocaleString("es-MX", { timeZone: TZ, ...opts });
}
