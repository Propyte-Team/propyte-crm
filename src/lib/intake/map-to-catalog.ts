import type { IntakePayload, Tipologia } from "./schema";

const ALLOWED_AMENITY_COLUMNS = new Set([
  "amenidad_alberca_comunitaria", "amenidad_alberca_privada", "amenidad_gym", "amenidad_coworking",
  "amenidad_rooftop", "amenidad_elevador", "amenidad_area_ninos", "amenidad_cancha", "amenidad_salon_eventos",
  "amenidad_spa", "amenidad_seguridad_24h", "amenidad_acceso_controlado", "amenidad_lobby", "amenidad_pet_zone",
  "amenidad_jardin_comunitario", "amenidad_yoga", "amenidad_fire_pit", "amenidad_concierge", "amenidad_cctv",
  "amenidad_bodega", "amenidad_restaurante",
]);

function blankToNull(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}

export function mapPayloadToDevelopment(p: IntakePayload): Record<string, unknown> {
  const precios = p.tipologias
    .map((t) => t.precioDesde)
    .filter((x): x is number => typeof x === "number" && x > 0);

  const dev: Record<string, unknown> = {
    nombre_desarrollo: p.generales.nombre.trim(),
    tipo_desarrollo: p.generales.tipo,
    avance_obra_porcentaje: p.generales.avancePct ?? null,
    ext_fecha_entrega_texto: blankToNull(p.generales.fechaEntrega),
    unidades_totales: p.generales.unidadesTotales ?? null,
    unidades_disponibles: p.generales.unidadesDisponibles ?? null,
    pais: "México",
    estado: blankToNull(p.ubicacion.estado),
    municipio: blankToNull(p.ubicacion.municipio),
    ciudad: blankToNull(p.ubicacion.ciudad),
    colonia: blankToNull(p.ubicacion.colonia),
    calle: blankToNull(p.ubicacion.calle),
    ext_numero_exterior: blankToNull(p.ubicacion.numeroExt),
    link_maps: blankToNull(p.ubicacion.linkMaps),
    latitud: p.ubicacion.lat ?? null,
    longitud: p.ubicacion.lng ?? null,
    playa_distancia_valor: p.ubicacion.playaDistanciaValor ?? null,
    playa_distancia_unidad: p.ubicacion.playaDistanciaUnidad ?? null,
    ext_descripcion_es: blankToNull(p.descripciones.descripcionEs),
    ext_descripcion_corta_es: blankToNull(p.descripciones.descripcionCortaEs),
    concepto_diseno: blankToNull(p.descripciones.conceptoDiseno),
    tour_virtual_desarrollo: blankToNull(p.multimedia.tourVirtual),
    brochure_pdf: blankToNull(p.multimedia.brochureUrl),
    amenidades_adicionales: p.amenidades.adicionales.length ? p.amenidades.adicionales : null,
    ext_content_es: p.faq.length
      ? { faq: p.faq.map((f) => ({ question: f.pregunta, answer: f.respuesta })) }
      : null,
    ext_precio_min_mxn: precios.length ? Math.min(...precios) : null,
    ext_precio_max_mxn: precios.length ? Math.max(...precios) : null,
    ext_moneda: "MXN",
    ext_publicado: false,
    web_status: "draft",
    last_source: "intake-form",
    ext_detection_source: "intake-form",
  };

  for (const [k, v] of Object.entries(p.amenidades.flags)) {
    if (ALLOWED_AMENITY_COLUMNS.has(k)) dev[k] = !!v;
  }
  return dev;
}

export function mapTypologyToUnit(
  t: Tipologia,
  devId: string,
  devName: string
): Record<string, unknown> {
  return {
    id_desarrollo: devId,
    titulo_unidad: `${devName} — Tipo ${t.etiqueta} · ${t.recamaras} rec`,
    subtitulo_unidad: `Departamento · ${t.m2} m²`,
    tipo_unidad: "Departamento",
    ext_tipologia: t.etiqueta,
    recamaras: t.recamaras,
    banos_completos: t.banosCompletos,
    medios_banos: t.mediosBanos,
    superficie_total_m2: t.m2,
    superficie_construida_m2: t.m2,
    precio_mxn: t.precioDesde ?? null,
    precio_desde: t.precioDesde ?? null,
    moneda_principal: t.moneda,
    estado_unidad: t.estado,
    es_preventa: t.estado === "Preventa",
    es_nueva_unidad: true,
    ext_publicado: false,
    web_status: "draft",
    last_source: "intake-form",
  };
}

export function mergeFillGaps(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  for (const [k, v] of Object.entries(incoming)) {
    if (isEmpty(v) && !isEmpty(existing[k])) out[k] = existing[k];
  }
  return out;
}
