"use client";

// «Conectar WhatsApp (oficial)» (2026-10-14): lanza Embedded Signup v4 con la coexistencia
// (número que sigue en la app de WhatsApp Business) y manda al servidor lo que Meta devuelve.
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §3 y §5.
//
// Lo usa Conexiones (número de una marca) y, desde el PR 2, «Mi Perfil» (el número del asesor):
// cambia el endpoint y lo que se manda junto al código.
//
// Qué pasa aquí y qué no: aquí solo se carga el SDK de Facebook, se abre el flujo de Meta y se
// juntan dos cosas que llegan por caminos distintos y en cualquier orden — el código (callback de
// FB.login) y el WABA / número (evento `message` de la sesión). El código caduca a los 30 s, así
// que en cuanto están las dos se manda al servidor, que es quien lo canjea (el App Secret nunca
// pasa por el navegador). Sin las variables de entorno el botón no se ofrece: dice qué falta.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  cancelMessage,
  embeddedSignupLoginOptions,
  parseEmbeddedSignupMessage,
} from "@/lib/whatsapp/coex/embedded-signup";
import type { EmbeddedSignupAvailability } from "@/lib/whatsapp/coex/public-config";

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FbSdk {
  init: (opts: Record<string, unknown>) => void;
  login: (cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
/** Tras recibir el código, cuánto se espera el evento con el WABA antes de rendirse. */
const FINISH_WAIT_MS = 20_000;

let sdkPromise: Promise<FbSdk> | null = null;

/** Carga el SDK una sola vez por página e inicializa con la app y la versión de Graph. */
function loadFacebookSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const ready = () => {
      if (!window.FB) return reject(new Error("El SDK de Facebook no se cargó."));
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version });
      resolve(window.FB);
    };
    if (window.FB) return ready();
    window.fbAsyncInit = ready;
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("No se pudo cargar el SDK de Facebook (¿bloqueador de anuncios o sin internet?)."));
    };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

interface ConnectResult {
  created: boolean;
  connector: { id: string; name: string; status: string };
  number: { displayPhone: string; verifiedName: string };
  subscription: { ok: true } | { ok: false; error: string };
  sync: {
    contacts: { status: string; error?: string; reason?: string };
    history: { status: string; error?: string; reason?: string };
  };
  warnings: string[];
}

type Phase = "idle" | "meta" | "saving";

export function WhatsAppCoexConnect({
  availability,
  endpoint,
  buttonLabel,
  description,
  extraBody,
  beforeLaunch,
  onConnected,
}: {
  availability: EmbeddedSignupAvailability;
  endpoint: string;
  buttonLabel: string;
  description?: ReactNode;
  /** Lo que se manda junto al código (p. ej. `{ brandId }`). */
  extraBody?: Record<string, unknown>;
  /** Controles antes de lanzar (p. ej. el selector de marca). */
  beforeLaunch?: ReactNode;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  // Lo que va llegando del flujo de Meta. Ref y no estado: llegan por callbacks fuera de React.
  const pending = useRef<{
    code: string | null;
    finish: { wabaId: string; phoneNumberId: string | null; coexistence: boolean } | null;
    done: boolean;
  }>({ code: null, finish: null, done: true });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listener = useRef<((e: MessageEvent) => void) | null>(null);
  const extraRef = useRef(extraBody);
  extraRef.current = extraBody;

  const cleanup = useCallback(() => {
    if (listener.current) window.removeEventListener("message", listener.current);
    listener.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const finishWith = useCallback(
    (message: string) => {
      pending.current.done = true;
      cleanup();
      setPhase("idle");
      setError(message);
    },
    [cleanup],
  );

  const submit = useCallback(async () => {
    const p = pending.current;
    if (p.done || !p.code || !p.finish) return;
    p.done = true;
    cleanup();
    if (!p.finish.coexistence) {
      setPhase("idle");
      setError(
        "En el flujo de Meta se eligió un número nuevo en vez del número de la app de WhatsApp Business. " +
          "Este botón es para números que ya usan la app; vuelve a intentarlo y elige «conectar tu cuenta de WhatsApp Business».",
      );
      return;
    }
    setPhase("saving");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: p.code,
          wabaId: p.finish.wabaId,
          phoneNumberId: p.finish.phoneNumberId,
          ...(extraRef.current ?? {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo conectar el número.");
        return;
      }
      setResult(data.data as ConnectResult);
      onConnected();
    } catch {
      setError("Error de red al guardar la conexión. Vuelve a intentarlo.");
    } finally {
      p.code = null;
      setPhase("idle");
    }
  }, [cleanup, endpoint, onConnected]);

  const launch = useCallback(async () => {
    if (!availability.ok || phase !== "idle") return;
    setError(null);
    setResult(null);
    cleanup();
    pending.current = { code: null, finish: null, done: false };
    setPhase("meta");

    let FB: FbSdk;
    try {
      FB = await loadFacebookSdk(availability.config.appId, availability.config.graphVersion);
    } catch (err) {
      finishWith(err instanceof Error ? err.message : "No se pudo cargar el SDK de Facebook.");
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupMessage(event.origin, event.data);
      if (parsed.kind === "ignore" || pending.current.done) return;
      if (parsed.kind === "finish") {
        pending.current.finish = { wabaId: parsed.wabaId, phoneNumberId: parsed.phoneNumberId, coexistence: parsed.coexistence };
        void submit();
      } else if (parsed.kind === "cancel") {
        finishWith(cancelMessage(parsed));
      } else {
        finishWith(parsed.errorMessage ? `Meta mostró un error: ${parsed.errorMessage}` : "El flujo de Meta terminó con un error.");
      }
    };
    listener.current = onMessage;
    window.addEventListener("message", onMessage);

    // El callback de FB.login no puede ser `async` (el SDK lo rechaza): el trabajo va aparte.
    FB.login((response) => {
      if (pending.current.done) return;
      const code = response?.authResponse?.code;
      if (!code) {
        finishWith("Se cerró la ventana de Meta sin terminar. No se conectó nada.");
        return;
      }
      pending.current.code = code;
      if (pending.current.finish) {
        void submit();
        return;
      }
      timer.current = setTimeout(() => {
        if (!pending.current.done) finishWith("Meta no devolvió la cuenta de WhatsApp a tiempo. Vuelve a intentarlo.");
      }, FINISH_WAIT_MS);
    }, embeddedSignupLoginOptions(availability.config.configId));
  }, [availability, phase, cleanup, finishWith, submit]);

  if (!availability.ok) {
    return (
      <div className="mt-1.5 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground">{buttonLabel} · no disponible</p>
        <p className="mt-0.5">
          Falta configurar en el servidor: <span className="font-mono">{availability.missing.join(", ")}</span>.
          Ver docs/whatsapp-coexistencia-meta-setup.md.
        </p>
      </div>
    );
  }

  const busy = phase !== "idle";
  return (
    <div className="mt-1.5 rounded-md border border-dashed p-2 text-[12px]">
      {beforeLaunch}
      <button
        type="button"
        className="mt-1 w-full rounded-md bg-foreground px-3 py-1.5 text-left text-[12px] font-medium text-background disabled:opacity-60"
        onClick={() => void launch()}
        disabled={busy}
      >
        {phase === "meta" ? "Completa el flujo en la ventana de Meta…" : phase === "saving" ? "Conectando con el CRM…" : buttonLabel}
      </button>
      {description && <div className="mt-1 text-[10px] text-muted-foreground">{description}</div>}
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="mt-1 space-y-0.5 text-[11px]">
          <p className="text-green-700">
            {result.created ? "Conectado" : "Conexión actualizada"}: {result.number.displayPhone}
            {result.number.verifiedName ? ` (${result.number.verifiedName})` : ""}.
          </p>
          {!result.subscription.ok && <p className="text-destructive">{result.subscription.error}</p>}
          {result.sync.history.status === "requested" && (
            <p className="text-muted-foreground">
              Sincronizando contactos e historial: deja abierta la app de WhatsApp Business en el teléfono unos minutos.
            </p>
          )}
          {result.sync.contacts.status === "failed" && (
            <p className="text-destructive">No se pudieron pedir los contactos: {result.sync.contacts.error}</p>
          )}
          {result.sync.history.status === "failed" && (
            <p className="text-destructive">No se pudo pedir el historial: {result.sync.history.error}</p>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="text-amber-700">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
