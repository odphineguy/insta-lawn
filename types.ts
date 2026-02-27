// ─── DesertVision AI — Type Definitions ───────────────────────────────

export type LineItemCategory =
  | "Site Prep"
  | "Hardscape"
  | "Artificial Turf"
  | "Irrigation"
  | "Trees"
  | "Tree Services"
  | "Plants"
  | "Lighting"
  | "Water Features"
  | "Finishing";

export type Season = "spring" | "summer" | "fall" | "winter";

export interface LineItem {
  category: LineItemCategory;
  description: string;
  quantity: number;
  unit: string;            // "sq ft" | "ton" | "each" | "lump sum" | "linear ft" | "kit"
  unitPrice: number;
  totalPrice: number;
}

export interface RebateInfo {
  city: string;
  eligible: boolean;
  estimatedRebate: number;
  program: string;
  notes: string;
  existingGrassSqFt: number;
}

export interface MaintenanceQuote {
  frequency: "weekly" | "bi-weekly" | "monthly";
  serviceType: "full-service" | "desert-only" | "mow-edge-blow";
  perVisitCost: number;
  monthlyCost: number;
  annualCost: number;
  includedServices: string[];
}

export interface LandscapeProposal {
  clientName: string;
  address: string;

  // ── Area Breakdown (sq ft) ──
  totalLotSqFt: number;
  buildingFootprintSqFt?: number;
  poolAndDeckSqFt?: number;
  drivewayAndWalksSqFt?: number;
  patioSqFt?: number;
  existingGrassSqFt?: number;
  renovatableAreaSqFt: number;

  // ── Regional & Seasonal Context ──
  regionalMultiplier: number;   // 1.0–1.2× based on ZIP/area
  season?: Season;

  // ── What AI found on the property ──
  existingFeatures: string[];

  // ── The proposal ──
  items: LineItem[];
  totalEstimate: number;
  netEstimateAfterRebate?: number;

  // ── Rebate calculation ──
  rebateInfo?: RebateInfo;

  // ── Optional maintenance quote ──
  maintenanceQuote?: MaintenanceQuote;

  // ── AI observations ──
  recommendations: string[];
  visualObservations: string;
  imageAnalyzed: boolean;
  confidenceLevel: string;  // "high" (drone image) | "medium" (satellite) | "low" (no image, zip-code estimate)
}
