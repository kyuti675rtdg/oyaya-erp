// Shared entity types for the Oyaya ERP frontend.
// Field names mirror the Prisma schema / backend JSON exactly.
// Prisma Decimal values serialize as strings over JSON — money/quantity fields
// are typed `number | string` and must go through Number() before arithmetic.

export type Dec = number | string;

export interface Supplier {
  id: string;
  name: string;
  type: 'INDIVIDUAL_FARMER' | 'ASSOCIATION' | 'TRADER';
  phone?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
}

export interface Product {
  id: string;
  name: string;
  kind: string;
  uom: string;
}

export interface Vehicle {
  id: string;
  plateNo: string;
  vehicleType?: string | null;
  ownership: string;
  isActive: boolean;
}

export type WheatCategory = 'SOFT' | 'HARD' | 'FOREIGN';

export interface IntakeLabResult {
  glutenPct: Dec | null;
  moisturePct: Dec | null;
  impurityPct: Dec | null;
  hectoliterPct: Dec | null;
  germinationPct: Dec | null;
}

export interface WheatIntake extends IntakeLabResult {
  id: string;
  intakeNo: string;
  deliveryDate: string;
  supplierId: string;
  supplier?: { id: string; name: string } | null;
  truckPlate: string;
  wheatCategory: WheatCategory;
  wheatOrigin?: string | null;
  bagCount: number;
  quintals: Dec;
  status: 'PENDING_LAB' | 'FLAGGED' | 'ACCEPTED' | 'REJECTED';
  flaggedReasons: string[];
  decision?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

export interface ConditioningTank {
  code: string;
  name: string;
  capacityQ: number;
  levelQ: number;
  note: string | null;
  lastFillAt: string | null;
  elapsedHrs: number | null;
  lastEvent: { event: string; occurredAt: string } | null;
}

export interface ProductionBatch {
  id: string;
  batchNo: string;
  productType: 'HARD_FLOUR' | 'SOFT_FLOUR';
  blendSoftPct: Dec;
  blendHardPct: Dec;
  blendForeignPct: Dec;
  blendSoftQ: Dec;
  blendHardQ: Dec;
  blendForeignQ: Dec;
  wheatWeighedQ: Dec;
  status: string;
  createdAt: string;
  sources?: Array<{ intakeId: string; quintals: Dec; intake?: WheatIntake | null }>;
  shifts?: ShiftRun[];
  labChecks?: LabCheck[];
  capas?: Capa[];
  packRuns?: unknown[];
}

export type ShiftType = 'MORNING' | 'NIGHT';

export interface ShiftProduct {
  id: string;
  name: string;
  kind: string;
}

export interface ShiftOutput {
  id: string;
  shiftRunId: string;
  productId: string;
  product: ShiftProduct;
  quintals: Dec;
  extractionPct: Dec | null;
  belowYieldFlag: boolean;
}

export interface ShiftRun {
  id: string;
  batchId: string;
  shift: ShiftType;
  shiftDate: string;
  startedAt: string;
  endedAt?: string | null;
  operators: string[];
  downtimeMin?: number | null;
  downtimeReason?: string | null;
  outputs?: ShiftOutput[];
}

export interface LabCheck {
  id: string;
  shiftRunId: string;
  batchId: string;
  sampleTime: string;
  impurityPct: Dec | null;
  wheatMoistureBefore: Dec | null;
  wheatMoistureAfter: Dec | null;
  flourMoisturePct: Dec | null;
  wetGlutenPct: Dec | null;
  glutenElasticity?: string | null;
  dryGlutenPct: Dec | null;
  ashPct: Dec | null;
  colorScore: Dec | null;
  granulationPct: Dec | null;
  outOfRange: string[];
}

export interface Capa {
  id: string;
  capaNo: string;
  batchId: string;
  dateIdentified: string;
  issueDescription: string;
  identifiedById?: string | null;
  correctionType?: string | null;
  correctionDetail?: string | null;
  performedBy?: string | null;
  disposition?: 'BLENDED_ELSEWHERE' | 'FULLY_RECYCLED' | null;
  qualitySignById?: string | null;
  productionSignById?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
  batch?: { batchNo: string } | null;
}

export interface SalesOrder {
  id: string;
  orderNo: string;
  customerId: string;
  orderDate: string;
  requestedDate?: string | null;
  productId: string;
  quintals: Dec;
  priceBirr: Dec;
  status: 'OPEN' | 'LOADED' | 'INVOICED' | 'CLOSED';
}

export interface DispatchLine {
  id: string;
  orderId?: string | null;
  order?: { id: string; orderNo: string } | null;
  productId: string;
  product?: { id: string; name: string } | null;
  batchNo?: string | null;
  bags: number;
  quintals: Dec;
}

export interface Dispatch {
  id: string;
  exitNoteNo: string;
  vehicleId: string;
  vehicle?: { id: string; plateNo: string } | null;
  area: string;
  dispatchedAt: string;
  loadingLabor?: string | null;
  status: string;
  lines: DispatchLine[];
}

export interface JournalLine {
  id: string;
  debit: Dec;
  credit: Dec;
  account: { code: string; name: string };
}

export interface JournalEntry {
  id: string;
  entryNo: string;
  entryDate: string;
  memo?: string | null;
  module: string;
  referenceType?: string | null;
  referenceId?: string | null;
  lines: JournalLine[];
}

export interface PayrollRun {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: 'DRAFT' | 'POSTED';
  createdAt: string;
  lines?: PayrollLine[];
}

export interface PayrollLine {
  id: string;
  employeeId: string;
  employee?: { id: string; name: string } | null;
  mode: 'FIXED' | 'PIECE_RATE' | 'TRIP_BASED';
  baseBirr: Dec;
  overtimeHours: Dec;
  overtimeBirr: Dec;
  pieceQuintals: Dec;
  pieceBirr: Dec;
  trips: number;
  tripBirr: Dec;
  grossBirr: Dec;
}

export interface QcThreshold {
  id: string;
  code: string;
  category: string;
  param: string;
  minValue: Dec | null;
  maxValue: Dec | null;
  unit?: string | null;
}

export interface StorageLocation {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacityQ: Dec;
  isActive: boolean;
}

export interface PieceRateConfig {
  id: string;
  stage: 'UNLOADING' | 'GRANARY_DUMPING' | 'STORE_MOVEMENT' | 'TRUCK_LOADING';
  rateBirrPerQ: Dec;
  isActive: boolean;
}

export interface DriverTripRate {
  id: string;
  rateBirrPerTrip: Dec;
  isActive: boolean;
}

export interface APPayment {
  id: string;
  voucherNo: string;
  apInvoiceId: string;
  amountBirr: Dec;
  method: string;
  reference?: string | null;
  paidAt: string;
}

export interface APInvoice {
  id: string;
  invoiceNo: string;
  intakeId: string;
  amountBirr: Dec;
  status: string;
  intake?: (WheatIntake & { supplier?: { id: string; name: string } | null }) | null;
  payments: APPayment[];
}

export interface ReconRow {
  customerId: string;
  customerName: string;
  invoiced: number;
  received: number;
  advances: number;
  outstanding: number;
  gap: number;
  flagged: boolean;
}

export interface ReconReport {
  rows: ReconRow[];
  totals: { invoiced: number; received: number; gap: number };
}

export interface FlatKpis {
  dryPool: { capacityQ: number; balanceQ: number };
  tanks: Array<{ code: string; capacityQ: number; levelQ: number; lastFillAt: string | null; elapsedHrs: number | null }>;
  extractionToday: number | null;
  openCapas: number;
  pendingLabIntakes: number;
  monthRevenue: number;
  cashReceivedMonth: number;
  unreconciledGap: number;
  activeEmployees: number;
  qcCompliancePct: number | null;
}
