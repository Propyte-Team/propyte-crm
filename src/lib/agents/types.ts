// ============================================================
// Agent System — Tipos compartidos
// Sistema de agentes para sincronización Drive/Dropbox → CRM
// ============================================================

// ---- Configuración de carpetas monitoreadas ----

export type StorageProvider = "GOOGLE_DRIVE" | "DROPBOX";

export type SyncStatus = "PENDING" | "CRAWLING" | "PARSING" | "MAPPING" | "UPLOADING" | "COMPLETED" | "FAILED";

export type FileCategory =
  | "PRICE_LIST"      // Lista de precios (PDF/Excel)
  | "BROCHURE"        // Brochure comercial (PDF)
  | "RENDER"          // Render exterior/interior (imagen)
  | "FLOOR_PLAN"      // Plano arquitectónico (imagen/PDF)
  | "PHOTO"           // Foto real (imagen)
  | "AVAILABILITY"    // Tabla de disponibilidad (Excel/CSV)
  | "VIDEO"           // Recorrido virtual
  | "MAP"             // Mapa de ubicación
  | "UNKNOWN";

// ---- Archivos descubiertos por el Crawler ----

export interface CrawledFile {
  id: string;                    // ID del archivo en Drive/Dropbox
  name: string;
  mimeType: string;
  size: number;                  // bytes
  modifiedAt: Date;
  downloadUrl?: string;
  localPath?: string;            // Path temporal después de descarga
  parentFolderName: string;      // Nombre de la carpeta padre
  category: FileCategory;        // Clasificación automática por extensión/nombre
  provider: StorageProvider;
}

export interface CrawlResult {
  folderId: string;
  folderName: string;
  provider: StorageProvider;
  files: CrawledFile[];
  totalFiles: number;
  newFiles: number;              // Archivos nuevos desde último sync
  modifiedFiles: number;         // Archivos modificados
  crawledAt: Date;
}

// ---- Datos extraídos por el Parser ----

export interface ParsedUnit {
  unitNumber: string;
  unitType?: string;             // "1 REC", "2 REC", "PENTHOUSE", etc.
  area_m2?: number;
  price?: number;
  currency?: "MXN" | "USD";
  floor?: number;
  status?: "DISPONIBLE" | "APARTADA" | "VENDIDA" | "NO_DISPONIBLE";
  bedrooms?: number;
  bathrooms?: number;
  view?: string;                 // "Mar", "Jardín", "Calle"
  extras?: string;               // Info adicional (terraza, estacionamiento, etc.)
}

export interface ParsedDevelopment {
  name?: string;
  developerName?: string;
  location?: string;
  description?: string;
  amenities?: string[];
  deliveryDate?: string;         // ISO date string o texto libre
  constructionProgress?: number; // 0-100
  status?: "PREVENTA" | "CONSTRUCCION" | "ENTREGA_INMEDIATA";
  commissionRate?: number;
  brochureUrl?: string;
  virtualTourUrl?: string;
}

export interface ParsedImage {
  sourceFileId: string;
  category: "RENDER_EXTERIOR" | "RENDER_INTERIOR" | "FLOOR_PLAN" | "AMENITY" | "PHOTO" | "MAP";
  description: string;           // Auto-generada por Claude Vision
  optimizedUrl?: string;         // URL después de optimización y upload
  originalUrl?: string;
  width?: number;
  height?: number;
}

export interface ParseResult {
  folderId: string;
  development: ParsedDevelopment;
  units: ParsedUnit[];
  images: ParsedImage[];
  warnings: string[];            // Problemas detectados (datos incompletos, etc.)
  confidence: number;            // 0-1, confianza general del parsing
  parsedAt: Date;
}

// ---- Datos mapeados listos para el CRM ----

export interface MappedDevelopment {
  // Datos para el modelo Development de Prisma
  name: string;
  developerName: string;
  developmentType: "PROPIO" | "MASTERBROKER" | "CORRETAJE";
  location: string;
  plaza: "PDC" | "TULUM" | "MERIDA";
  totalUnits: number;
  availableUnits: number;
  soldUnits: number;
  reservedUnits: number;
  priceMin: number;
  priceMax: number;
  currency: "MXN" | "USD";
  commissionRate: number;
  status: "PREVENTA" | "CONSTRUCCION" | "ENTREGA_INMEDIATA" | "VENDIDO" | "SUSPENDIDO";
  constructionProgress: number;
  deliveryDate?: Date;
  brochureUrl?: string;
  virtualTourUrl?: string;
  amenities: string[];
  description: string;
}

export interface MappedUnit {
  unitNumber: string;
  unitType: "DEPTO_1REC" | "DEPTO_2REC" | "DEPTO_3REC" | "PENTHOUSE" | "CASA" | "TERRENO" | "MACROLOTE" | "LOCAL";
  area_m2: number;
  price: number;
  currency: "MXN" | "USD";
  floor?: number;
  status: "DISPONIBLE" | "APARTADA" | "VENDIDA" | "NO_DISPONIBLE";
}

export interface MapResult {
  folderId: string;
  development: MappedDevelopment;
  units: MappedUnit[];
  isUpdate: boolean;             // true si el desarrollo ya existe en el CRM
  existingDevelopmentId?: string; // ID del desarrollo existente si es update
  changes?: DevelopmentChanges;  // Resumen de cambios si es update
  mappedAt: Date;
}

export interface DevelopmentChanges {
  priceChanges: number;          // Cantidad de unidades con cambio de precio
  statusChanges: number;         // Unidades que cambiaron de status
  newUnits: number;              // Unidades nuevas detectadas
  removedUnits: number;          // Unidades que ya no aparecen
  alerts: string[];              // Alertas importantes (ej: precio bajó >20%)
}

// ---- Resultado del Upload ----

export interface UploadResult {
  folderId: string;
  developmentId: string;
  action: "CREATED" | "UPDATED";
  unitsCreated: number;
  unitsUpdated: number;
  imagesUploaded: number;
  uploadedAt: Date;
  errors: string[];
}

// ---- Sync Job (pipeline completo) ----

export interface SyncJob {
  id: string;
  folderId: string;
  folderName: string;
  provider: StorageProvider;
  status: SyncStatus;
  triggeredBy: "CRON" | "WEBHOOK" | "MANUAL";
  crawlResult?: CrawlResult;
  parseResult?: ParseResult;
  mapResult?: MapResult;
  uploadResult?: UploadResult;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

// ---- Configuración de carpeta monitoreada ----

export interface MonitoredFolder {
  id: string;
  provider: StorageProvider;
  folderId: string;              // ID de la carpeta en Drive/Dropbox
  folderName: string;
  developmentName?: string;      // Nombre del desarrollo (si ya está mapeado)
  developmentId?: string;        // ID del desarrollo en CRM (si existe)
  plaza: "PDC" | "TULUM" | "MERIDA";
  developmentType: "PROPIO" | "MASTERBROKER" | "CORRETAJE";
  isActive: boolean;
  lastSyncAt?: Date;
  lastSyncStatus?: SyncStatus;
  syncInterval: number;          // minutos entre syncs automáticos
}
