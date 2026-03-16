// ============================================================
// Prompts para Claude Vision / Claude PDF
// Especializados en materiales inmobiliarios de México
// ============================================================

export const PROMPTS = {
  /**
   * Extrae datos de una lista de precios en PDF o imagen.
   * Diseñado para manejar los formatos más comunes del mercado MX.
   */
  PRICE_LIST: `Eres un experto en bienes raíces en México. Analiza esta lista de precios de un desarrollo inmobiliario y extrae TODAS las unidades en formato JSON.

Para cada unidad extrae:
- unitNumber: número o identificador de la unidad (ej: "A-101", "Torre 2-503", "Lote 15")
- unitType: tipo de unidad. Clasifica en: "1 REC", "2 REC", "3 REC", "PENTHOUSE", "CASA", "TERRENO", "MACROLOTE", "LOCAL"
- area_m2: superficie en metros cuadrados (número)
- price: precio (número, sin formato). Si hay precio de lista y precio con descuento, usa el precio de lista
- currency: "MXN" o "USD"
- floor: piso o nivel (número o null)
- status: estado de la unidad. Clasifica en: "DISPONIBLE", "APARTADA", "VENDIDA", "NO_DISPONIBLE"
  - Sinónimos comunes: "Disp"/"Libre"/"Available" = DISPONIBLE, "Apart"/"Reserv"/"Separada" = APARTADA, "Vend"/"Sold"/"Escriturada" = VENDIDA
- bedrooms: número de recámaras (si se puede inferir del tipo)
- bathrooms: número de baños (si está disponible)
- view: vista (si está disponible)
- extras: información adicional relevante (terraza, estacionamiento, bodega, etc.)

IMPORTANTE:
- Si una fila está tachada o marcada como vendida de alguna forma, status = "VENDIDA"
- Si hay celdas con color rojo/gris = probablemente VENDIDA o NO_DISPONIBLE
- Si hay celdas con color verde/blanco = probablemente DISPONIBLE
- Detecta automáticamente si los precios están en MXN o USD
- Si hay múltiples tipos de cambio o precios en ambas monedas, usa el precio en la moneda principal

Responde SOLO con JSON válido, sin markdown ni explicaciones:
{
  "units": [...],
  "metadata": {
    "developmentName": "nombre del desarrollo si aparece",
    "totalUnits": número_total,
    "priceListDate": "fecha si aparece (ISO)",
    "currency": "moneda principal",
    "notes": "observaciones relevantes"
  }
}`,

  /**
   * Extrae datos de un brochure comercial.
   */
  BROCHURE: `Eres un experto en bienes raíces en México. Analiza este brochure/presentación comercial de un desarrollo inmobiliario y extrae la siguiente información en formato JSON.

Extrae:
- name: nombre del desarrollo
- developerName: nombre del desarrollador/empresa
- location: ubicación (dirección, zona, ciudad)
- description: descripción del proyecto (máx 500 caracteres)
- amenities: lista de amenidades (array de strings)
- deliveryDate: fecha estimada de entrega (si aparece)
- constructionProgress: porcentaje de avance de obra (si aparece)
- status: "PREVENTA", "CONSTRUCCION", o "ENTREGA_INMEDIATA" (inferir del contenido)
- commissionRate: tasa de comisión para brokers (si aparece)
- priceRange: { min: número, max: número, currency: "MXN"|"USD" }
- unitTypes: tipos de unidades disponibles
- totalUnits: total de unidades (si se menciona)
- virtualTourUrl: URL de recorrido virtual (si aparece)
- contactInfo: datos de contacto del desarrollador

IMPORTANTE:
- Si no encuentras un dato, usa null
- Extrae amenidades en español, una por item
- Si hay render de fachada en el brochure, describe brevemente en "facadeDescription"

Responde SOLO con JSON válido:
{
  "development": { ... },
  "confidence": 0.0-1.0
}`,

  /**
   * Clasifica una imagen de desarrollo inmobiliario.
   */
  IMAGE_CLASSIFY: `Clasifica esta imagen de un desarrollo inmobiliario en UNA de estas categorías:
- RENDER_EXTERIOR: render 3D del exterior del edificio/desarrollo
- RENDER_INTERIOR: render 3D de un interior (departamento, casa, amenidad)
- FLOOR_PLAN: plano arquitectónico o distribución
- AMENITY: imagen de amenidad (alberca, gym, roof garden, etc.)
- PHOTO: fotografía real (del sitio, avance de obra, etc.)
- MAP: mapa de ubicación o masterplan

También genera una descripción breve (1 línea) en español de lo que muestra la imagen.

Responde SOLO con JSON:
{
  "category": "RENDER_EXTERIOR",
  "description": "Render de fachada principal del edificio de 12 niveles con acabados de madera"
}`,

  /**
   * Extrae datos de una tabla de disponibilidad en Excel.
   * Se usa como prompt para que Claude mapee columnas automáticamente.
   */
  EXCEL_COLUMN_MAPPER: `Dado los siguientes headers de una hoja de cálculo de un desarrollo inmobiliario:

HEADERS: {headers}

PRIMERAS 3 FILAS DE EJEMPLO: {sampleRows}

Mapea cada header a nuestro schema. Los campos destino son:
- unitNumber (identificador de unidad)
- unitType (tipo: depto, casa, terreno, etc.)
- area_m2 (superficie)
- price (precio)
- currency (MXN/USD)
- floor (piso)
- status (disponible/apartada/vendida)
- bedrooms (recámaras)
- bathrooms (baños)
- view (vista)
- extras (info adicional)
- SKIP (ignorar esta columna)

Responde SOLO con JSON:
{
  "mapping": {
    "Columna Original": "campo_destino",
    ...
  },
  "statusMapping": {
    "valor_original": "DISPONIBLE|APARTADA|VENDIDA|NO_DISPONIBLE",
    ...
  },
  "currencyDetected": "MXN" | "USD",
  "notes": "observaciones"
}`,
} as const;
