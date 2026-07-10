// Valida credenciales contra la API real del proveedor SIN persistir nada.
// Devuelve {ok, accountName?, detail?}. NUNCA loguear el objeto de error completo.
import { providerById } from "./registry";

export interface TestResult {
  ok: boolean;
  accountName?: string;
  detail?: string;
}

export async function testConnection(
  provider: string,
  creds: Record<string, string>
): Promise<TestResult> {
  const def = providerById(provider);
  if (!def || def.testKind === "none") {
    return { ok: false, detail: "Este proveedor no admite conexión de pull en v1." };
  }
  try {
    switch (def.testKind) {
      case "meta": {
        const res = await fetch(
          `https://graph.facebook.com/v24.0/${encodeURIComponent(creds.pageId)}?fields=name,id`,
          { headers: { Authorization: `Bearer ${creds.pageAccessToken}` } }
        );
        const data = (await res.json()) as { name?: string; error?: { message?: string } };
        if (!res.ok || data.error) return { ok: false, detail: data.error?.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: data.name };
      }
      case "tiktok": {
        const res = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=%5B%22${encodeURIComponent(creds.advertiserId)}%22%5D`,
          { headers: { "Access-Token": creds.accessToken } }
        );
        const data = (await res.json()) as { code?: number; message?: string; data?: { list?: Array<{ advertiser_name?: string }> } };
        if (!res.ok || data.code !== 0) return { ok: false, detail: data.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: data.data?.list?.[0]?.advertiser_name };
      }
      case "googleAds": {
        // Validación ligera: refrescar el access token OAuth. Confirma client/refresh válidos.
        const body = new URLSearchParams({
          client_id: creds.clientId, client_secret: creds.clientSecret,
          refresh_token: creds.refreshToken, grant_type: "refresh_token",
        });
        const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
        const data = (await res.json()) as { access_token?: string; error_description?: string };
        if (!res.ok || !data.access_token) return { ok: false, detail: data.error_description ?? `HTTP ${res.status}` };
        return { ok: true, accountName: `Customer ${creds.customerId}` };
      }
      case "linkedin": {
        const res = await fetch(
          `https://api.linkedin.com/rest/adAccounts/${encodeURIComponent(creds.adAccountId)}`,
          { headers: { Authorization: `Bearer ${creds.accessToken}`, "LinkedIn-Version": "202401" } }
        );
        const data = (await res.json()) as { name?: string; message?: string };
        if (!res.ok) return { ok: false, detail: data.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: data.name ?? `Account ${creds.adAccountId}` };
      }
      default:
        return { ok: false, detail: "Tipo de prueba no soportado." };
    }
  } catch (e) {
    return { ok: false, detail: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
