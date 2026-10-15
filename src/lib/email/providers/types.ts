// Capa de proveedores de correo del asesor (#885).
//
// El botón «Correo» de la ficha y el compositor no saben qué servicio hay detrás: hablan
// con /api/email/*, y esas rutas hablan con un `EmailProvider`. Hoy solo existe Gmail
// (lib/email/providers/gmail.ts). Para sumar otro (Outlook/Microsoft 365, IMAP/SMTP…):
//
//   1. Implementar `EmailProvider` en un archivo nuevo de esta carpeta.
//   2. Registrarlo en `PROVEEDORES` (index.ts).
//   3. Darle su propia pantalla de conexión en Mi Configuración (`urlConectar`).
//
// Ni la ficha, ni el compositor, ni las rutas /api/email/* cambian.
//
// Lo que esta capa NO cubre: el correo del SISTEMA (recuperar contraseña, avisos), que
// sale por lib/email/mailer.ts con credenciales de la empresa y no por la cuenta del asesor.

export type EmailProviderId = "gmail"

/** Remitente que el proveedor acepta para esta cuenta (alias verificados incluidos). */
export interface Remitente {
  email: string
  name: string
  isPrimary: boolean
  isDefault: boolean
}

/** Conexión de UN proveedor para UN usuario. Nunca lanza: si falla, `conectado: false`. */
export interface ConexionCorreo {
  conectado: boolean
  /** Hay conexión guardada pero el proveedor ya no la acepta (token revocado/vencido). */
  requiereReconexion: boolean
  /** Cuenta conectada, para mostrarla («tu@empresa.com»). */
  cuenta?: string
}

export interface EnvioCorreo {
  userId: string
  contactId: string
  dealId?: string | null
  to: string
  subject: string
  html: string
  /** Remitente elegido; el proveedor lo valida contra `remitentes()` y si no, usa el principal. */
  from?: string
  /** Para responder dentro de un hilo existente (id propio del proveedor). */
  threadId?: string
}

export interface ResultadoEnvio {
  messageId: string
  threadId: string
  from: string
}

export interface EmailProvider {
  id: EmailProviderId
  /** Nombre para la interfaz: «Gmail». */
  nombre: string
  /** Dónde conecta el asesor su cuenta (pantalla del CRM, no la URL de OAuth). */
  urlConectar: string
  conexion(userId: string): Promise<ConexionCorreo>
  remitentes(userId: string): Promise<Remitente[]>
  /**
   * Envía Y registra el correo en el historial del contacto (actividad EMAIL_SENT). Van
   * juntos porque cómo se registra depende del proveedor (ids de hilo y de mensaje).
   * Lanza `CorreoNoConectadoError` si la cuenta no está conectada o hay que reconectarla.
   */
  enviar(envio: EnvioCorreo): Promise<ResultadoEnvio>
}

export class CorreoNoConectadoError extends Error {
  constructor(msg = "Cuenta de correo no conectada") {
    super(msg)
    this.name = "CorreoNoConectadoError"
  }
}
