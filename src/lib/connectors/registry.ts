// Registro único de proveedores de conexión. Alimenta UI (panel + wizard) y servidor.
// Agregar una plataforma = agregar una entrada aquí.
export type ProviderGroup = "meta" | "tiktok" | "google" | "linkedin" | "pinterest";
export type PullKind = "webhook" | "cron" | "none"; // none = push-only (v2), deshabilitado para pull
export type TestKind = "meta" | "tiktok" | "googleAds" | "linkedin" | "none";

export interface CredField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
}
export interface WizardStep {
  title: string;
  body: string;
  link?: string;
}
export interface ProviderDef {
  id: string; // valor del enum ConnectorProvider
  label: string;
  group: ProviderGroup;
  groupLabel: string;
  pull: PullKind;
  testKind: TestKind;
  credFields: CredField[];
  wizardSteps: WizardStep[];
  webhookPath?: string; // si pull === "webhook"
  note?: string;        // ej. para push-only
}

const META_CRED: CredField[] = [
  { key: "pageId", label: "Page ID" },
  { key: "pageAccessToken", label: "Page Access Token (long-lived)", secret: true },
  { key: "appSecret", label: "App Secret", secret: true },
  { key: "verifyToken", label: "Verify Token (lo inventas tú)" },
];

const META_STEPS: WizardStep[] = [
  { title: "Abre tu app de Meta", body: "Entra a tu app y selecciona la página del negocio.", link: "https://developers.facebook.com/apps" },
  { title: "Genera un Page Access Token", body: "Con permiso leads_retrieval (long-lived)." },
  { title: "Pega token, Page ID, App Secret y Verify Token", body: "El Verify Token lo inventas tú; lo pondrás igual en el webhook de Meta." },
  { title: "Prueba y guarda", body: "Validamos el token contra la API y guardamos cifrado." },
];

export const PROVIDERS: ProviderDef[] = [
  {
    id: "META", label: "Facebook · Lead Ads", group: "meta", groupLabel: "Meta",
    pull: "webhook", testKind: "meta", credFields: META_CRED, wizardSteps: META_STEPS,
    webhookPath: "/api/connectors/meta/webhook",
  },
  {
    id: "INSTAGRAM", label: "Instagram · Lead Ads / DM", group: "meta", groupLabel: "Meta",
    pull: "webhook", testKind: "meta", credFields: META_CRED, wizardSteps: META_STEPS,
    webhookPath: "/api/connectors/meta/webhook",
  },
  {
    id: "TIKTOK", label: "TikTok · Lead Gen", group: "tiktok", groupLabel: "TikTok",
    pull: "cron", testKind: "tiktok",
    credFields: [
      { key: "advertiserId", label: "Advertiser ID" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
    wizardSteps: [
      { title: "Abre TikTok for Business", body: "Entra a tu Business Center.", link: "https://business.tiktok.com" },
      { title: "Obtén Advertiser ID y Access Token", body: "Desde el developer portal de TikTok (app con scope Lead Gen)." },
      { title: "Pega y prueba", body: "Validamos contra la API y guardamos cifrado." },
    ],
  },
  {
    id: "GOOGLE_ADS", label: "Google Ads · Lead Form", group: "google", groupLabel: "Google",
    pull: "webhook", testKind: "googleAds",
    webhookPath: "/api/connectors/google/webhook",
    credFields: [
      { key: "customerId", label: "Customer ID" },
      { key: "developerToken", label: "Developer Token", secret: true },
      { key: "clientId", label: "OAuth Client ID" },
      { key: "clientSecret", label: "OAuth Client Secret", secret: true },
      { key: "refreshToken", label: "Refresh Token", secret: true },
      { key: "webhookKey", label: "Webhook Key (Lead Form)", help: "La 'key' que pones en el Lead Form para firmar el webhook.", secret: true },
    ],
    wizardSteps: [
      { title: "Crea el Lead Form en Google Ads", body: "En el formulario, define una Webhook URL + Key.", link: "https://ads.google.com" },
      { title: "Pega tus credenciales de API", body: "Customer ID, Developer Token y OAuth (para la validación de la cuenta)." },
      { title: "Pega la Webhook Key", body: "Debe coincidir con la del Lead Form." },
      { title: "Prueba y guarda", body: "Validamos la cuenta y guardamos cifrado." },
    ],
  },
  {
    id: "LINKEDIN", label: "LinkedIn · Lead Gen Forms", group: "linkedin", groupLabel: "LinkedIn",
    pull: "cron", testKind: "linkedin",
    credFields: [
      { key: "adAccountId", label: "Ad Account ID" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
    wizardSteps: [
      { title: "Abre LinkedIn Campaign Manager", body: "Selecciona la cuenta publicitaria.", link: "https://www.linkedin.com/campaignmanager" },
      { title: "Genera un Access Token", body: "Con scope r_marketing_leadgen_automation." },
      { title: "Pega Ad Account ID y Token", body: "" },
      { title: "Prueba y guarda", body: "Validamos contra la API y guardamos cifrado." },
    ],
  },
  {
    id: "YOUTUBE", label: "YouTube", group: "google", groupLabel: "Google",
    pull: "none", testKind: "none", credFields: [], wizardSteps: [],
    note: "Sin leads propios — se gestiona vía Google Ads. Push de conversiones en v2.",
  },
  {
    id: "PINTEREST", label: "Pinterest", group: "pinterest", groupLabel: "Pinterest",
    pull: "none", testKind: "none", credFields: [], wizardSteps: [],
    note: "Pull de leads limitado. Push de conversiones (Conversions API) en v2.",
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
export function pullProviders(): ProviderDef[] {
  return PROVIDERS.filter((p) => p.pull !== "none");
}
