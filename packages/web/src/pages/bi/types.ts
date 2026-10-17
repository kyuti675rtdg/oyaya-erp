/** Shared response shapes for GET /api/v1/bi/* (aggregation only). */

export interface BiEnvelope<K, C> {
  kpis: K;
  charts: C;
  generatedAt: string;
}

export interface DayPoint {
  day: string;
  key: string;
}

export interface ProductionKpis {
  dailyOutputQ: number;
  avgExtractionPct: number | null;
  duketYieldPct: number | null;
  yieldTargetPct: number;
  downtimeHours7d: number;
  shiftPerformancePct: number | null;
}
export interface ProductionCharts {
  outputTrend: Array<DayPoint & { outputQ: number; extractionPct: number | null }>;
  downtimeByReason: Array<{ reason: string; hours: number }>;
}
export type ProductionBi = BiEnvelope<ProductionKpis, ProductionCharts>;

export interface QualityKpis {
  passRatePct: number | null;
  openCapas: number;
  overdueCapas: number;
  inspectionsToday: number;
}
export interface QualityCharts {
  passRateTrend: Array<DayPoint & { passRate: number | null; tests: number }>;
  capaAging: Array<{ bucket: string; count: number }>;
  defectPareto: Array<{ severity: string; count: number }>;
}
export type QualityBi = BiEnvelope<QualityKpis, QualityCharts>;

export interface ProcurementKpis {
  intakeTodayQ: number;
  pendingPOs: number;
  payablesBirr: number;
  supplierCount: number;
}
export interface ProcurementCharts {
  intakeTrend: Array<DayPoint & { soft: number; hard: number; foreign: number }>;
  wheatMix: Array<{ category: string; quintals: number }>;
  priceTrend: Array<{ week: string; price: number }>;
}
export type ProcurementBi = BiEnvelope<ProcurementKpis, ProcurementCharts>;

export interface InventoryKpis {
  dryPoolQ: number;
  dryPoolCapacityQ: number;
  tankUtilizationPct: number;
  finishedGoodsQ: number;
  stockValueBirr: number;
}
export interface InventoryCharts {
  stockLevels: Array<{ name: string; quintals: number; capacity: number }>;
  finishedGoodsByProduct: Array<{ product: string; quintals: number }>;
  movementTrend: Array<DayPoint & { in: number; out: number }>;
}
export type InventoryBi = BiEnvelope<InventoryKpis, InventoryCharts>;

export interface SalesKpis {
  revenueMTD: number;
  ordersPending: number;
  otifPct: number | null;
  receivablesBirr: number;
}
export interface SalesCharts {
  revenueTrend: Array<{ month: string; revenue: number }>;
  salesByProduct: Array<{ product: string; quintals: number }>;
}
export type SalesBi = BiEnvelope<SalesKpis, SalesCharts>;

export interface FinanceKpis {
  cashBalance: number;
  cashInMTD: number;
  cashOutMTD: number;
  receivablesBirr: number;
  payablesBirr: number;
  profitMTD: number;
}
export interface FinanceCharts {
  cashFlow: Array<{ week: string; inflow: number; outflow: number }>;
  expenseBreakdown: Array<{ supplier: string; amount: number }>;
}
export type FinanceBi = BiEnvelope<FinanceKpis, FinanceCharts>;

export interface HrKpis {
  headcount: number;
  attendanceToday: number;
  attendancePct: number | null;
  overtimeHoursMTD: number;
  payrollCostMTD: number;
  payrollPeriod: string | null;
}
export interface HrCharts {
  headcountByDept: Array<{ department: string; count: number }>;
  attendanceTrend: Array<DayPoint & { present: number }>;
}
export type HrBi = BiEnvelope<HrKpis, HrCharts>;
