// Verify Token del webhook de Meta Lead Ads (E6): se genera en vez de pedírselo al usuario.
// Criptográfico (crypto.getRandomValues, disponible en navegador y en Node) y hexadecimal para que
// se pueda pegar en Meta sin caracteres raros. El webhook lo compara en tiempo constante contra
// `credentials.verifyToken` de las cuentas META activas, así que el formato es libre.
export function generarVerifyToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** URL completa del webhook para pegar en Meta (host = el que está usando la persona). */
export function urlDeWebhook(origen: string, path: string): string {
  return `${origen.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
