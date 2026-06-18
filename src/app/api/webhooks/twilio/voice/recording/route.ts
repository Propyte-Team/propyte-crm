// Recording status callback de Twilio → guarda recordingUrl en la Activity.
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { handleRecording } from "@/lib/twilio/voice";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/voice/recording`;
  if (!(await validateTwilioSignature(url, params))) return NextResponse.json({ error: "Firma inválida" }, { status: 403 });
  if (params.CallSid && params.RecordingUrl) {
    await handleRecording({ CallSid: params.CallSid, RecordingUrl: params.RecordingUrl });
  }
  return NextResponse.json({ ok: true });
}
