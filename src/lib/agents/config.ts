// ============================================================
// Agent System — Configuración
// ============================================================

export const AGENT_CONFIG = {
  // Google Drive
  drive: {
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  },

  // Dropbox
  dropbox: {
    accessToken: process.env.DROPBOX_ACCESS_TOKEN || "",
    refreshToken: process.env.DROPBOX_REFRESH_TOKEN || "",
    clientId: process.env.DROPBOX_CLIENT_ID || "",
    clientSecret: process.env.DROPBOX_CLIENT_SECRET || "",
  },

  // Claude API para parsing
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: "claude-sonnet-4-6-20250514" as const,
    maxTokens: 4096,
  },

  // Storage para imágenes procesadas
  storage: {
    bucket: process.env.STORAGE_BUCKET || "propyte-assets",
    region: process.env.STORAGE_REGION || "us-east-1",
  },

  // Sync
  sync: {
    defaultIntervalMinutes: 15,
    maxRetries: 3,
    retryBackoffMs: 5000,
    tempDir: "/tmp/propyte-sync",
  },

  // Clasificación de archivos por extensión
  fileClassification: {
    priceList: {
      extensions: [".xlsx", ".xls", ".csv"],
      namePatterns: ["precio", "price", "lista", "inventario", "disponibilidad", "availability"],
    },
    brochure: {
      extensions: [".pdf"],
      namePatterns: ["brochure", "folleto", "presentacion", "comercial", "ficha"],
    },
    render: {
      extensions: [".jpg", ".jpeg", ".png", ".webp"],
      namePatterns: ["render", "fachada", "exterior", "interior", "amenidad", "amenity"],
    },
    floorPlan: {
      extensions: [".jpg", ".jpeg", ".png", ".pdf"],
      namePatterns: ["plano", "planta", "floor", "layout", "distribucion"],
    },
    video: {
      extensions: [".mp4", ".mov", ".avi", ".webm"],
      namePatterns: ["recorrido", "tour", "video", "walkthrough"],
    },
  },
} as const;

// Extensiones de imagen soportadas
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"]);

// Extensiones de documento soportadas
export const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);

// Extensiones de hoja de cálculo soportadas
export const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".ods"]);

// MIME types para Google Drive
export const DRIVE_MIME_TYPES = {
  folder: "application/vnd.google-apps.folder",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  document: "application/vnd.google-apps.document",
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
