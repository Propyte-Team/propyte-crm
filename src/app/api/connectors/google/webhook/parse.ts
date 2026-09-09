// Utilidades de parseo para Google Ads Lead Form webhook.
// Separado de route.ts para cumplir restricciones de Next.js route segments.

export interface GoogleLeadPayload {
  lead_id?: string;
  google_key?: string;
  api_version?: string;
  /**
   * #739: Google lo manda en `true` cuando alguien usa el botón "enviar datos de prueba"
   * de la interfaz de Lead Form. El campo estaba documentado por Google y ausente aquí, así
   * que cada prueba de conexión entraba a la base como un prospecto real.
   */
  is_test?: boolean;
  form_id?: number | string;
  campaign_id?: number | string;
  user_column_data?: Array<{ column_id?: string; string_value?: string }>;
}

export function parseGoogleLeadForm(payload: GoogleLeadPayload): {
  externalLeadId: string;
  external: Record<string, unknown>;
} {
  const external: Record<string, unknown> = {};
  for (const f of payload.user_column_data ?? []) {
    if (f.column_id && f.string_value != null) external[f.column_id] = f.string_value;
  }
  return { externalLeadId: String(payload.lead_id ?? ""), external };
}
