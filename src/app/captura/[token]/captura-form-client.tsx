"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AMENITY_OPTIONS: { key: string; label: string }[] = [
  { key: "amenidad_alberca_comunitaria", label: "Alberca" },
  { key: "amenidad_gym", label: "Gimnasio" },
  { key: "amenidad_coworking", label: "Coworking" },
  { key: "amenidad_rooftop", label: "Rooftop" },
  { key: "amenidad_elevador", label: "Elevador" },
  { key: "amenidad_area_ninos", label: "Área de niños" },
  { key: "amenidad_cancha", label: "Canchas" },
  { key: "amenidad_seguridad_24h", label: "Seguridad 24h" },
];

type Tipologia = { etiqueta: string; recamaras: string; banosCompletos: string; mediosBanos: string; m2: string; precioDesde: string };

const emptyTipologia: Tipologia = { etiqueta: "", recamaras: "", banosCompletos: "", mediosBanos: "0", m2: "", precioDesde: "" };

export default function CapturaFormClient({ token, label, isUpdate }: { token: string; label: string; isUpdate: boolean }) {
  const storageKey = `captura:${token}`;
  const [generales, setGenerales] = useState({ nombre: "", desarrollador: "", tipo: "vertical", etapa: "", avancePct: "", fechaEntrega: "", unidadesTotales: "", unidadesDisponibles: "" });
  const [ubicacion, setUbicacion] = useState({ estado: "", municipio: "", ciudad: "", colonia: "", calle: "", numeroExt: "", playaDistanciaValor: "", playaDistanciaUnidad: "", linkMaps: "" });
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [adicionales, setAdicionales] = useState("");
  const [descripciones, setDescripciones] = useState({ descripcionEs: "", descripcionCortaEs: "", conceptoDiseno: "" });
  const [tipologias, setTipologias] = useState<Tipologia[]>([{ ...emptyTipologia }]);
  const [multimedia, setMultimedia] = useState({ tourVirtual: "", brochureUrl: "" });
  const [faq, setFaq] = useState<{ pregunta: string; respuesta: string }[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Autosave / restore
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        s.generales && setGenerales(s.generales);
        s.ubicacion && setUbicacion(s.ubicacion);
        s.flags && setFlags(s.flags);
        typeof s.adicionales === "string" && setAdicionales(s.adicionales);
        s.descripciones && setDescripciones(s.descripciones);
        s.tipologias && setTipologias(s.tipologias);
        s.multimedia && setMultimedia(s.multimedia);
        s.faq && setFaq(s.faq);
      } catch { /* ignore */ }
    }
  }, [storageKey]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ generales, ubicacion, flags, adicionales, descripciones, tipologias, multimedia, faq }));
  }, [storageKey, generales, ubicacion, flags, adicionales, descripciones, tipologias, multimedia, faq]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const r = await fetch(`/api/captura/${token}/upload`, { method: "POST", body: fd });
    const j = await r.json();
    if (j.paths) setImagePaths((prev) => [...prev, ...j.paths]);
  }

  function buildPayload() {
    return {
      generales: {
        nombre: generales.nombre, desarrollador: generales.desarrollador, tipo: generales.tipo,
        etapa: generales.etapa, avancePct: generales.avancePct || undefined, fechaEntrega: generales.fechaEntrega,
        unidadesTotales: generales.unidadesTotales || undefined, unidadesDisponibles: generales.unidadesDisponibles || undefined,
      },
      ubicacion: {
        ...ubicacion,
        playaDistanciaValor: ubicacion.playaDistanciaValor || undefined,
        playaDistanciaUnidad: ubicacion.playaDistanciaUnidad || undefined,
      },
      amenidades: { flags, adicionales: adicionales.split(",").map((s) => s.trim()).filter(Boolean) },
      descripciones,
      tipologias: tipologias.map((t) => ({
        etiqueta: t.etiqueta, recamaras: t.recamaras || 0, banosCompletos: t.banosCompletos || 0,
        mediosBanos: t.mediosBanos || 0, m2: t.m2 || 0, precioDesde: t.precioDesde || undefined,
      })),
      multimedia,
      faq,
    };
  }

  async function submit() {
    setStatus("saving"); setErrorMsg("");
    const r = await fetch(`/api/captura/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: buildPayload(), imagePaths, website }),
    });
    if (r.ok) { localStorage.removeItem(storageKey); setStatus("done"); }
    else { const j = await r.json().catch(() => ({})); setErrorMsg(j.error ?? "Error al enviar"); setStatus("error"); }
  }

  if (status === "done") {
    return <div className="mx-auto max-w-md p-8 text-center"><h1 className="text-xl font-semibold">¡Gracias!</h1><p className="mt-2 text-sm text-muted-foreground">La información de <b>{label}</b> fue enviada para revisión.</p></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Captura de desarrollo</h1>
        <p className="text-sm text-muted-foreground">{label}{isUpdate ? " · (actualización)" : ""}</p>
      </header>

      {/* Honeypot oculto */}
      <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />

      <Section title="1. Generales">
        <Field label="Nombre del desarrollo *"><Input value={generales.nombre} onChange={(e) => setGenerales({ ...generales, nombre: e.target.value })} /></Field>
        <Field label="Desarrolladora"><Input value={generales.desarrollador} onChange={(e) => setGenerales({ ...generales, desarrollador: e.target.value })} /></Field>
        <Field label="Fecha de entrega (texto)"><Input value={generales.fechaEntrega} onChange={(e) => setGenerales({ ...generales, fechaEntrega: e.target.value })} placeholder="Mayo 2026" /></Field>
        <Field label="Unidades totales"><Input value={generales.unidadesTotales} onChange={(e) => setGenerales({ ...generales, unidadesTotales: e.target.value })} /></Field>
        <Field label="Unidades disponibles"><Input value={generales.unidadesDisponibles} onChange={(e) => setGenerales({ ...generales, unidadesDisponibles: e.target.value })} /></Field>
      </Section>

      <Section title="2. Ubicación">
        <Field label="Estado"><Input value={ubicacion.estado} onChange={(e) => setUbicacion({ ...ubicacion, estado: e.target.value })} /></Field>
        <Field label="Ciudad"><Input value={ubicacion.ciudad} onChange={(e) => setUbicacion({ ...ubicacion, ciudad: e.target.value })} /></Field>
        <Field label="Colonia"><Input value={ubicacion.colonia} onChange={(e) => setUbicacion({ ...ubicacion, colonia: e.target.value })} /></Field>
        <Field label="Link de Google Maps"><Input value={ubicacion.linkMaps} onChange={(e) => setUbicacion({ ...ubicacion, linkMaps: e.target.value })} /></Field>
      </Section>

      <Section title="3. Amenidades">
        <div className="grid grid-cols-2 gap-2">
          {AMENITY_OPTIONS.map((a) => (
            <label key={a.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!flags[a.key]} onChange={(e) => setFlags({ ...flags, [a.key]: e.target.checked })} />
              {a.label}
            </label>
          ))}
        </div>
        <Field label="Otras amenidades (separadas por coma)"><Input value={adicionales} onChange={(e) => setAdicionales(e.target.value)} placeholder="Sauna, Boliche, Pádel" /></Field>
      </Section>

      <Section title="4. Descripción">
        <Field label="Descripción"><textarea className="w-full rounded border p-2 text-sm" rows={4} value={descripciones.descripcionEs} onChange={(e) => setDescripciones({ ...descripciones, descripcionEs: e.target.value })} /></Field>
        <Field label="Concepto de diseño"><Input value={descripciones.conceptoDiseno} onChange={(e) => setDescripciones({ ...descripciones, conceptoDiseno: e.target.value })} /></Field>
      </Section>

      <Section title="5. Tipologías *">
        {tipologias.map((t, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 rounded border p-3">
            <Field label="Etiqueta"><Input value={t.etiqueta} onChange={(e) => updateTip(i, "etiqueta", e.target.value)} placeholder="A" /></Field>
            <Field label="Recámaras"><Input value={t.recamaras} onChange={(e) => updateTip(i, "recamaras", e.target.value)} /></Field>
            <Field label="m²"><Input value={t.m2} onChange={(e) => updateTip(i, "m2", e.target.value)} /></Field>
            <Field label="Baños completos"><Input value={t.banosCompletos} onChange={(e) => updateTip(i, "banosCompletos", e.target.value)} /></Field>
            <Field label="Medios baños"><Input value={t.mediosBanos} onChange={(e) => updateTip(i, "mediosBanos", e.target.value)} /></Field>
            <Field label="Precio desde (MXN)"><Input value={t.precioDesde} onChange={(e) => updateTip(i, "precioDesde", e.target.value)} /></Field>
          </div>
        ))}
        <Button variant="outline" onClick={() => setTipologias([...tipologias, { ...emptyTipologia }])}>+ Agregar tipología</Button>
      </Section>

      <Section title="6. Multimedia e imágenes">
        <Field label="Tour virtual (URL)"><Input value={multimedia.tourVirtual} onChange={(e) => setMultimedia({ ...multimedia, tourVirtual: e.target.value })} /></Field>
        <Field label="Brochure (URL)"><Input value={multimedia.brochureUrl} onChange={(e) => setMultimedia({ ...multimedia, brochureUrl: e.target.value })} /></Field>
        <Field label="Fotos / renders / plantas">
          <input type="file" accept="image/*" multiple onChange={(e) => uploadFiles(e.target.files)} />
          <p className="mt-1 text-xs text-muted-foreground">{imagePaths.length} imagen(es) subida(s).</p>
        </Field>
      </Section>

      <Section title="7. Preguntas frecuentes">
        {faq.map((f, i) => (
          <div key={i} className="space-y-1 rounded border p-3">
            <Input value={f.pregunta} onChange={(e) => updateFaq(i, "pregunta", e.target.value)} placeholder="Pregunta" />
            <Input value={f.respuesta} onChange={(e) => updateFaq(i, "respuesta", e.target.value)} placeholder="Respuesta" />
          </div>
        ))}
        <Button variant="outline" onClick={() => setFaq([...faq, { pregunta: "", respuesta: "" }])}>+ Agregar pregunta</Button>
      </Section>

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      <Button onClick={submit} disabled={status === "saving" || !generales.nombre || !tipologias[0]?.etiqueta} className="w-full">
        {status === "saving" ? "Enviando…" : "Enviar para revisión"}
      </Button>
    </div>
  );

  function updateTip(i: number, key: keyof Tipologia, value: string) {
    setTipologias((prev) => prev.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  }
  function updateFaq(i: number, key: "pregunta" | "respuesta", value: string) {
    setFaq((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
