import type { CaptureType } from "@prisma/client";

export interface TargetFieldSpec { captureType: CaptureType; enumValues?: string[]; }

export const NATIVE_TARGET_FIELDS: Record<string, TargetFieldSpec> = {
  firstName: { captureType: "FULL_NAME" },
  lastName: { captureType: "TEXT" },
  email: { captureType: "EMAIL" },
  phone: { captureType: "PHONE" },
  // Columna real de Contact (String?). Se whitelistea para el playbook de
  // reclutamiento: la ciudad decide a qué plaza se canaliza al candidato, así que
  // merece una columna consultable y no una llave dentro del Json `custom`.
  residenceCity: { captureType: "TEXT" },
  budgetMin: { captureType: "MONEY" },
  budgetMax: { captureType: "MONEY" },
  preferredZone: { captureType: "ZONE" },
  propertyType: { captureType: "ENUM", enumValues: ["DEPARTAMENTO","CASA","TERRENO","MACROLOTE","LOCAL_COMERCIAL","OTRO"] },
  purchaseTimeline: { captureType: "ENUM", enumValues: ["IMMEDIATE","ONE_TO_THREE_MONTHS","THREE_TO_SIX_MONTHS","SIX_PLUS_MONTHS"] },
  paymentMethod: { captureType: "ENUM", enumValues: ["CONTADO","CREDITO_HIPOTECARIO","FINANCIAMIENTO_DIRECTO","MIXTO"] },
  purchaseModality: { captureType: "ENUM", enumValues: ["PREVENTA","ENTREGA_INMEDIATA","REVENTA","ABIERTO"] },
  rentalStrategy: { captureType: "ENUM", enumValues: ["LONG_TERM","AIRBNB","BOTH","NA"] },
  investmentProfile: { captureType: "ENUM", enumValues: ["END_USER","INVESTOR_RENTAL","INVESTOR_FLIP","INVESTOR_LAND","MIXED"] },
  contactType: { captureType: "ENUM", enumValues: ["LEAD","PROSPECTO","CLIENTE","INVERSIONISTA","BROKER_EXTERNO","REFERIDO","EMPLEO","COMPRADOR","REFERIDOR"] },
};

export function isCustomTarget(f: string): boolean { return f.startsWith("custom."); }
export function isNativeTarget(f: string): boolean { return Object.prototype.hasOwnProperty.call(NATIVE_TARGET_FIELDS, f); }
