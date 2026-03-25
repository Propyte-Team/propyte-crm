// ============================================================
// Meta Conversions API (CAPI) — Server-side event tracking
// Sends events to Meta for better optimization & attribution
// ============================================================

import crypto from "crypto"

const API_VERSION = process.env.META_API_VERSION || "v21.0"
const PIXEL_ID = process.env.META_PIXEL_ID || "808922354003079"
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

// SHA-256 hash for user data (Meta requires hashed PII)
function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

// Normalize phone to E.164 without + (Meta format)
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  // Mexican numbers: ensure country code
  if (digits.startsWith("52")) return digits
  if (digits.startsWith("1") && digits.length === 10) return "1" + digits
  if (digits.length === 10) return "52" + digits
  return digits
}

export interface CAPIUserData {
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  externalId?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  fbc?: string | null  // _fbc cookie
  fbp?: string | null  // _fbp cookie
}

export interface CAPIEvent {
  eventName: "Lead" | "CompleteRegistration" | "Contact" | "Schedule" | "ViewContent" | "Search" | "FindLocation"
  eventTime?: number  // Unix timestamp (defaults to now)
  eventSourceUrl?: string
  actionSource: "website" | "app" | "phone_call" | "chat" | "email" | "crm" | "other"
  userData: CAPIUserData
  customData?: Record<string, unknown>
}

export async function sendCAPIEvent(event: CAPIEvent): Promise<{ events_received: number; fbtrace_id: string }> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error("META_ACCESS_TOKEN not set")

  const eventTime = event.eventTime || Math.floor(Date.now() / 1000)

  // Build hashed user_data
  const userData: Record<string, unknown> = {}

  if (event.userData.email) {
    userData.em = [sha256(event.userData.email)]
  }
  if (event.userData.phone) {
    userData.ph = [sha256(normalizePhone(event.userData.phone))]
  }
  if (event.userData.firstName) {
    userData.fn = [sha256(event.userData.firstName)]
  }
  if (event.userData.lastName) {
    userData.ln = [sha256(event.userData.lastName)]
  }
  if (event.userData.city) {
    userData.ct = [sha256(event.userData.city)]
  }
  if (event.userData.state) {
    userData.st = [sha256(event.userData.state)]
  }
  if (event.userData.country) {
    userData.country = [sha256(event.userData.country)]
  }
  if (event.userData.externalId) {
    userData.external_id = [sha256(event.userData.externalId)]
  }
  if (event.userData.clientIpAddress) {
    userData.client_ip_address = event.userData.clientIpAddress
  }
  if (event.userData.clientUserAgent) {
    userData.client_user_agent = event.userData.clientUserAgent
  }
  if (event.userData.fbc) {
    userData.fbc = event.userData.fbc
  }
  if (event.userData.fbp) {
    userData.fbp = event.userData.fbp
  }

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: eventTime,
        event_source_url: event.eventSourceUrl || "https://propyte.com",
        action_source: event.actionSource,
        user_data: userData,
        custom_data: event.customData || {},
      },
    ],
  }

  const url = `${BASE_URL}/${PIXEL_ID}/events`

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      data: JSON.stringify(payload.data),
    }),
  })

  const result = await res.json()

  if (result.error) {
    console.error("[CAPI] Error:", result.error)
    throw new Error(`CAPI Error: ${result.error.message}`)
  }

  console.log(`[CAPI] Sent ${event.eventName} — received: ${result.events_received}`)
  return result
}

// Convenience: send Lead event from CRM contact
export async function sendCAPILead(contact: {
  id: string
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  residenceCity?: string | null
  residenceCountry?: string | null
  leadSource?: string | null
}) {
  return sendCAPIEvent({
    eventName: "Lead",
    actionSource: "crm",
    userData: {
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
      city: contact.residenceCity,
      country: contact.residenceCountry,
      externalId: contact.id,
    },
    customData: {
      lead_source: contact.leadSource,
      content_name: "Financiamiento Inmobiliario",
      content_category: "Real Estate",
    },
  })
}

// Convenience: send Schedule event (appointment/follow-up)
export async function sendCAPISchedule(contact: {
  id: string
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
}, scheduledDate?: string) {
  return sendCAPIEvent({
    eventName: "Schedule",
    actionSource: "crm",
    userData: {
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
      externalId: contact.id,
    },
    customData: {
      scheduled_date: scheduledDate,
      content_name: "Cita Financiamiento",
    },
  })
}

// Convenience: send CompleteRegistration when contact status changes
export async function sendCAPIRegistration(contact: {
  id: string
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
}) {
  return sendCAPIEvent({
    eventName: "CompleteRegistration",
    actionSource: "crm",
    userData: {
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
      externalId: contact.id,
    },
    customData: {
      content_name: "CRM Registration Complete",
      status: "qualified",
    },
  })
}
