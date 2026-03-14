// ============================================================
// Motor de cálculo de comisiones Propyte
// Alineado con los enums de Prisma (DealType, LeadSourceCategory, UserRole)
// ============================================================

import type { DealType, LeadSourceCategory } from "@prisma/client";

// Rol participante en la comisión (mapea a campos del Deal en Prisma)
type CommissionRole =
  | "ASESOR"       // commissionAdvisor
  | "TEAM_LEADER"  // commissionTL
  | "GERENTE"      // commissionGerente
  | "DIRECTOR"     // commissionDirector
  | "BROKER_EXT"   // commissionBrokerExt
  | "EMPRESA";     // diferencia entre total y distribuido

// Resultado del cálculo de comisión por participante
export interface CommissionSplit {
  role: CommissionRole;
  percentage: number;
  amount: number;
  label: string;
}

// Resultado completo del cálculo
export interface CommissionResult {
  dealValue: number;
  totalCommissionPercentage: number;
  totalCommissionAmount: number;
  splits: CommissionSplit[];
  currency: string;
}

// Datos mínimos del deal necesarios para calcular
export interface DealForCommission {
  estimatedValue: number;
  dealType: DealType;
  leadSourceCategory: LeadSourceCategory;
  currency?: string;
}

// --- Porcentajes base de comisión total por tipo de operación ---
const BASE_COMMISSION_RATE: Record<DealType, number> = {
  NATIVA_CONTADO: 0.1303,         // 13.03% máximo (Nativa contado, lead Propyte)
  NATIVA_FINANCIAMIENTO: 0.1001,  // 10.01% máximo (Nativa financiamiento)
  MACROLOTE: 0.09,                // 9% máximo (Macrolotes)
  CORRETAJE: 0.06,                // 6% comisión estándar
  MASTERBROKER: 0.05,             // 5% del valor de ventas + IVA
};

// --- Distribución de la comisión total entre roles según fuente del lead ---
interface DistributionScheme {
  asesor: number;
  teamLeader: number;
  gerente: number;
  director: number;
  brokerExt: number;
}

const DISTRIBUTION_BY_SOURCE: Record<LeadSourceCategory, DistributionScheme> = {
  // Lead generado por Propyte (marketing, walk-in, website)
  PROPYTE_LEAD: {
    asesor: 0.30,
    teamLeader: 0.05,
    gerente: 0.05,
    director: 0.05,
    brokerExt: 0.00,
  },
  // Lead traído por broker externo o referidor
  BROKER_LEAD: {
    asesor: 0.20,
    teamLeader: 0.05,
    gerente: 0.05,
    director: 0.05,
    brokerExt: 0.25,
  },
  // Lead propio del asesor (contacto directo)
  ASESOR_LEAD: {
    asesor: 0.40,
    teamLeader: 0.05,
    gerente: 0.05,
    director: 0.05,
    brokerExt: 0.00,
  },
};

// Etiquetas en español para cada rol de comisión
const ROLE_LABELS: Record<CommissionRole, string> = {
  ASESOR: "Asesor de ventas",
  TEAM_LEADER: "Team Leader",
  GERENTE: "Gerente de plaza",
  DIRECTOR: "Director Comercial",
  BROKER_EXT: "Broker/Referidor externo",
  EMPRESA: "Propyte (empresa)",
};

/**
 * Calcula la distribución de comisiones para un negocio cerrado.
 * Usa las tablas de comisión configuradas según tipo de operación y fuente del lead.
 *
 * @param deal - Datos del negocio con tipo y fuente
 * @returns Resultado con el desglose de comisiones por rol
 */
export function calculateCommission(deal: DealForCommission): CommissionResult {
  const baseRate = BASE_COMMISSION_RATE[deal.dealType];
  const totalCommissionAmount = deal.estimatedValue * baseRate;
  const distribution = DISTRIBUTION_BY_SOURCE[deal.leadSourceCategory];
  const currency = deal.currency ?? "MXN";

  const splits: CommissionSplit[] = [];

  // Mapeo de roles a sus porcentajes de distribución
  const roleMappings: Array<{
    role: CommissionRole;
    distributionKey: keyof DistributionScheme;
  }> = [
    { role: "ASESOR", distributionKey: "asesor" },
    { role: "TEAM_LEADER", distributionKey: "teamLeader" },
    { role: "GERENTE", distributionKey: "gerente" },
    { role: "DIRECTOR", distributionKey: "director" },
    { role: "BROKER_EXT", distributionKey: "brokerExt" },
  ];

  // Sumar porcentajes distribuidos para calcular la parte de la empresa
  let distributedPercentage = 0;

  for (const mapping of roleMappings) {
    const percentage = distribution[mapping.distributionKey];

    if (percentage === 0) continue;

    distributedPercentage += percentage;

    splits.push({
      role: mapping.role,
      percentage,
      amount: roundCurrency(totalCommissionAmount * percentage),
      label: ROLE_LABELS[mapping.role],
    });
  }

  // El resto es para la empresa
  const companyPercentage = 1 - distributedPercentage;
  if (companyPercentage > 0) {
    splits.push({
      role: "EMPRESA",
      percentage: companyPercentage,
      amount: roundCurrency(totalCommissionAmount * companyPercentage),
      label: ROLE_LABELS.EMPRESA,
    });
  }

  return {
    dealValue: deal.estimatedValue,
    totalCommissionPercentage: baseRate,
    totalCommissionAmount: roundCurrency(totalCommissionAmount),
    splits,
    currency,
  };
}

/**
 * Calcula los montos de comisión para guardar en los campos del Deal de Prisma.
 * Retorna un objeto listo para usar en prisma.deal.update().
 */
export function calculateDealCommissions(deal: DealForCommission) {
  const result = calculateCommission(deal);

  const findAmount = (role: CommissionRole): number =>
    result.splits.find((s) => s.role === role)?.amount ?? 0;

  return {
    commissionTotal: result.totalCommissionAmount,
    commissionAdvisor: findAmount("ASESOR"),
    commissionTL: findAmount("TEAM_LEADER"),
    commissionGerente: findAmount("GERENTE"),
    commissionDirector: findAmount("DIRECTOR"),
    commissionBrokerExt: findAmount("BROKER_EXT"),
  };
}

/**
 * Redondea un valor monetario a 2 decimales.
 */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
