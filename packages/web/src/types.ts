// Shared entity types for the Oyaya ERP frontend.
// Field names mirror the Prisma schema / backend JSON exactly.
// Prisma Decimal values serialize as strings over JSON — money/quantity fields
// are typed `number | string` and must go through Number() before arithmetic.

export type Dec = number | string;

export interface Supplier {
  id: string;
  name: string;
  type: 'INDIVIDUAL_FARMER' | 'ASSOCIATION' | 'TRADER';
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  region?: string | null;
  tin?: string | null;
  licenseNo?: string | null;
  wheatTypes?: string[];
  paymentTerms?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  rating?: number | null;
  isActive?: boolean;
  _count?: { intakes: number; purchaseOrders: number };
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
  capacityQt?: Dec | null;
  ownership: string;
  status?: string | null;
  purchaseDate?: string | null;
  purchaseCostBirr?: Dec | null;
  notes?: string | null;
  isActive: boolean;
  _count?: { fleetTrips: number; fuelLogs: number };
}

/* ── Module 16: Fleet & Logistics ─────────────────────────────────────── */

export interface VehicleContract {
  id: string;
  vehicleId: string;
  vendor: string;
  contractType: 'RENTAL_DAILY' | 'RENTAL_MONTHLY' | 'OWNED';
  rateBirr: Dec;
  startDate: string;
  endDate?: string | null;
  terms?: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  vehicle?: Vehicle;
}

export interface DriverAssignment {
  id: string;
  vehicleId: string;
  driverName: string;
  licenseNo?: string | null;
  licenseExpiry?: string | null;
  assignedFrom: string;
  assignedTo?: string | null;
  status: 'ACTIVE' | 'ENDED';
  notes?: string | null;
  vehicle?: Vehicle;
}

export interface FleetTrip {
  id: string;
  vehicleId: string;
  driverName?: string | null;
  routeFrom?: string | null;
  routeTo?: string | null;
  cargoType?: 'FLOUR' | 'WHEAT' | 'BRAN' | 'OTHER' | null;
  cargoQt?: Dec | null;
  departureAt?: string | null;
  arrivalAt?: string | null;
  odometerStart?: Dec | null;
  odometerEnd?: Dec | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  dispatchId?: string | null;
  notes?: string | null;
  vehicle?: Vehicle;
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  loggedAt: string;
  liters: Dec;
  costBirr: Dec;
  odometer?: Dec | null;
  station?: string | null;
  vehicle?: Vehicle;
}

export interface FleetExpense {
  id: string;
  vehicleId: string;
  expenseDate: string;
  category: 'TOLL' | 'REPAIR_PARTS' | 'INSURANCE' | 'WASHING' | 'OTHER';
  amountBirr: Dec;
  description?: string | null;
  vehicle?: Vehicle;
}

export interface FleetMaintenanceRecord {
  id: string;
  vehicleId: string;
  serviceType: 'PREVENTIVE' | 'CORRECTIVE' | 'INSPECTION';
  description: string;
  serviceDate: string;
  costBirr: Dec;
  odometer?: Dec | null;
  nextDueDate?: string | null;
  performedBy?: string | null;
  status: 'SCHEDULED' | 'COMPLETED';
  vehicle?: Vehicle;
}

export interface FleetUtilization {
  id?: string; // = vehicleId, for table row identity
  vehicleId: string;
  plateNo: string;
  vehicleType: string | null;
  ownership: string;
  status: string;
  tripCount: number;
  completedTripCount: number;
  totalKm: number;
  cargoQt: number;
  fuelLiters: number;
  fuelCostBirr: number;
  kmPerLiter: number | null;
  activeDays: number;
  periodDays: number;
  utilizationPct: number;
}

export interface FleetSummary {
  id?: string; // = vehicleId, for table row identity
  vehicleId: string;
  plateNo: string;
  vehicleType: string | null;
  ownership: string;
  tripCount: number;
  totalKm: number;
  fuelLiters: number;
  fuelCostBirr: number;
  expenseCostBirr: number;
  maintenanceCostBirr: number;
  totalCostBirr: number;
  kmPerLiter: number | null;
  costPerKmBirr: number | null;
  birrPerLiter: number | null;
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
  grossKg?: Dec | null;
  tareKg?: Dec | null;
  netKg?: Dec | null;
  moistureQuick?: Dec | null;
  purchaseOrderId?: string | null;
  purchaseOrder?: { id: string; poNo: string } | null;
  status: 'PENDING_LAB' | 'FLAGGED' | 'ACCEPTED' | 'REJECTED';
  flaggedReasons: string[];
  decision?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  returnNote?: string | null;
}

export type POStatus = 'DRAFT' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  poNo: string;
  supplierId: string;
  supplier?: { id: string; name: string } | null;
  wheatCategory: WheatCategory;
  quantityQ: Dec;
  pricePerQBirr: Dec;
  totalBirr: Dec;
  deliveryDate?: string | null;
  terms?: string | null;
  status: POStatus;
  receivedQ: Dec;
  approvedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  intakes?: WheatIntake[];
  _count?: { intakes: number };
}

export interface APInvoice {
  id: string;
  invoiceNo: string;
  intakeId: string;
  intake?: WheatIntake | null;
  supplierId: string;
  amountBirr: Dec;
  status: string;
  issuedAt: string;
  dueDate?: string | null;
  payments?: APPayment[];
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

export interface ConditioningTank {
  code: string;
  name: string;
  capacityQ: number;
  levelQ: number;
  note: string | null;
  status: 'Empty' | 'Filling' | 'Conditioning' | 'Ready' | 'In Use' | 'Cleaning';
  activeCycle: {
    id: string;
    batchNo: string;
    startedAt: string;
    requiredHrs: number;
    elapsedHrs: number;
    remainingHrs: number;
    completedAt: string | null;
    releasedAt: string | null;
    moistureAfter: number | null;
  } | null;
  lastFillAt: string | null;
  elapsedHrs: number | null;
  lastEvent: { event: string; occurredAt: string } | null;
}

export interface ConditioningCycle {
  id: string;
  tankCode: string;
  batchNo: string;
  blendRatio: Record<string, number> | null;
  startedAt: string;
  requiredHrs: number;
  waterAddedQ: number | null;
  moistureBefore: number | null;
  moistureAfter: number | null;
  completedAt: string | null;
  releasedAt: string | null;
  notes: string | null;
}

export interface TankBlend {
  tankCode: string;
  levelQ: number;
  blend: { soft: number; hard: number; foreign: number } | null;
  batchNo: string | null;
  history: Array<{ id: string; quintals: number; blendRatio: Record<string, number> | null; filledAt: string }>;
}

export interface DryPoolDetail {
  capacityQ: number;
  balanceQ: number;
  pct: number;
  breakdown: Record<string, number>;
  alerts: Array<{ level: 'low' | 'high' | 'info'; message: string }>;
}

export interface StorageMovementRow {
  id: string;
  locationCode: string;
  direction: string;
  quintals: number;
  wheatType: string | null;
  reference: string | null;
  notes: string | null;
  movedAt: string;
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

export type OrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'LOADING'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'OPEN'
  | 'LOADED'
  | 'INVOICED'
  | 'CLOSED';

export interface SalesOrder {
  id: string;
  orderNo: string;
  customerId: string;
  customer?: { id: string; name: string } | null;
  orderDate: string;
  requestedDate?: string | null;
  productId: string;
  quintals: Dec;
  priceBirr: Dec;
  status: OrderStatus | string;
  lines?: SalesOrderLine[];
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
  gateStatus?: string;
  gateCheckedAt?: string | null;
  sealNo?: string | null;
  gateOfficer?: string | null;
  gateNotes?: string | null;
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

// ─── Module 15: HR & Payroll ────────────────────────────────────

export type PayrollModeCode = 'FIXED' | 'PIECE_RATE' | 'TRIP_BASED';

export interface HrDepartment {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
  description?: string | null;
  isActive: boolean;
  children?: HrDepartment[];
  _count?: { employees: number; positions: number };
}

export interface HrPosition {
  id: string;
  code: string;
  title: string;
  departmentId?: string | null;
  department?: HrDepartment | null;
  grade?: string | null;
  bandMin?: Dec | null;
  bandMax?: Dec | null;
  isActive: boolean;
}

export interface HrEmployee {
  id: string;
  employeeNo: string;
  name: string;
  phone?: string | null;
  jobTitle: string;
  department?: string | null;
  departmentId?: string | null;
  departmentRef?: HrDepartment | null;
  positionId?: string | null;
  position?: HrPosition | null;
  payrollMode: PayrollModeCode;
  baseSalary?: Dec | null;
  bankName?: string | null;
  bankAccount?: string | null;
  zkPin?: string | null;
  isActive: boolean;
  hiredAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employee?: { id: string; employeeNo: string; name: string } | null;
  date: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HALF_DAY';
  checkIn?: string | null;
  checkOut?: string | null;
  workHours: Dec;
  overtimeHours: Dec;
  lateMinutes: number;
  source: 'ZKTECO' | 'MANUAL' | 'CSV';
  notes?: string | null;
}

export interface AttendanceSummary {
  employee: { id: string; employeeNo: string; name: string };
  present: number;
  late: number;
  absent: number;
  leave: number;
  overtimeHours: number;
  lateMinutes: number;
}

export interface PieceRateWork {
  id: string;
  employeeId?: string | null;
  employee?: { id: string; employeeNo: string; name: string } | null;
  laborer: string;
  stage: string;
  bags: number;
  quintals: Dec;
  rateBirrPerQ: Dec;
  payBirr: Dec;
  workDate: string;
  truckPlate?: string | null;
  notes?: string | null;
}

export interface DriverTripPay {
  id: string;
  employeeId: string;
  employee?: { id: string; employeeNo: string; name: string } | null;
  year: number;
  month: number;
  trips: number;
  rateBirrPerTrip: Dec;
  allowanceBirr: Dec;
  totalBirr: Dec;
  notes?: string | null;
}

export interface AllowanceDeductionType {
  id: string;
  code: string;
  name: string;
  kind: 'ALLOWANCE' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT';
  amount: Dec;
  appliesTo: PayrollModeCode[];
  recurrence: 'RECURRING' | 'ONE_TIME';
  isActive: boolean;
}

export interface EmployeeAllowance {
  id: string;
  employeeId: string;
  employee?: { id: string; employeeNo: string; name: string } | null;
  typeId: string;
  type?: AllowanceDeductionType | null;
  oneTimeDate?: string | null;
  overrideAmount?: Dec | null;
  isActive: boolean;
  notes?: string | null;
}

export interface HrPayrollLine {
  id: string;
  employeeId: string;
  employee?: { id: string; employeeNo: string; name: string } | null;
  mode: PayrollModeCode;
  baseBirr: Dec;
  overtimeHours: Dec;
  overtimeBirr: Dec;
  pieceQuintals: Dec;
  pieceBirr: Dec;
  trips: number;
  tripBirr: Dec;
  grossBirr: Dec;
  allowanceBirr: Dec;
  deductionBirr: Dec;
  netBirr: Dec;
}

export interface HrPayrollRun {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: 'DRAFT' | 'APPROVED' | 'POSTED';
  createdAt: string;
  createdById?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  journalEntryId?: string | null;
  lines?: HrPayrollLine[];
  _count?: { lines: number };
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employee?: HrEmployee | null;
  payrollRun?: HrPayrollRun | null;
  grossBirr: Dec;
  allowanceBirr: Dec;
  deductionBirr: Dec;
  netBirr: Dec;
  breakdown: Record<string, string | number | null>;
  generatedAt: string;
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

// ─── Module 6 expansion: Nonconformity & CAPA ─────────────────────────────

export type NcSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR';
export type NcStatus = 'OPEN' | 'UNDER_REVIEW' | 'CLOSED';
export type NcSource = 'INTAKE' | 'IN_PROCESS' | 'FLOUR' | 'HYGIENE' | 'PEST';
export type NcDecision = 'RELEASE' | 'REWORK' | 'DOWNGRADE' | 'RECYCLE_FEED' | 'REJECT_DISPOSE';
export type NcActionType = 'CORRECTIVE' | 'PREVENTIVE';
export type NcActionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';
export type NcSignoffKind = 'CLOSURE' | 'DISPOSITION';
export type NcSignoffStatus = 'PENDING' | 'COMPLETED';

export interface NcRootCause {
  id: string;
  ncId: string;
  fiveWhys: string[];
  fishbone: Record<string, string>;
  rootCause?: string | null;
  analyst?: string | null;
  analysisDate: string;
}

export interface NcAction {
  id: string;
  ncId?: string | null;
  capaId?: string | null;
  actionType: NcActionType;
  description: string;
  owner: string;
  dueDate: string;
  status: NcActionStatus;
  completedAt?: string | null;
  verificationResult?: string | null;
  verifiedAt?: string | null;
  effectivenessNote?: string | null;
  effectivenessOk?: boolean | null;
  effectivenessAt?: string | null;
  nc?: { ncNo: string } | null;
  capa?: { capaNo: string } | null;
}

export interface NcDisposition {
  id: string;
  ncId: string;
  decision: NcDecision;
  quantityQ: Dec;
  approverName?: string | null;
  approvedAt: string;
  approvedById?: string | null;
  executedAt?: string | null;
  executedBy?: string | null;
  executionNote?: string | null;
}

export interface NcSignoff {
  id: string;
  ncId: string;
  kind: NcSignoffKind;
  status: NcSignoffStatus;
  qualitySignById?: string | null;
  qualitySignedAt?: string | null;
  productionSignById?: string | null;
  productionSignedAt?: string | null;
  createdAt: string;
  nc?: {
    ncNo: string;
    description: string;
    severity: NcSeverity;
    status: NcStatus;
    disposition?: { decision: NcDecision; quantityQ: Dec } | null;
  } | null;
}

export interface Nonconformity {
  id: string;
  ncNo: string;
  source: NcSource;
  batchId?: string | null;
  batch?: { id: string; batchNo: string; productType: string } | null;
  reference?: string | null;
  description: string;
  severity: NcSeverity;
  detectedBy?: string | null;
  dateDetected: string;
  status: NcStatus;
  linkedCapaId?: string | null;
  linkedCapa?: { capaNo: string } | null;
  closedAt?: string | null;
  createdAt: string;
  rootCause?: NcRootCause | null;
  actions?: NcAction[];
  disposition?: NcDisposition | null;
  signoffs?: NcSignoff[];
}

// ─── Module 9: Maintenance & Spare Parts ──────────────────────────────

export interface MaintenanceEquipment {
  id: string;
  name: string;
  type: string;
  location: string | null;
  installDate: string | null;
  intervalDays: number;
  nextDueDate: string | null;
  lastMaintainedAt: string | null;
  status: string;
  overdue?: boolean;
  dueSoon?: boolean;
}

export interface PmChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
}

export interface PmTemplate {
  id: string;
  equipmentType: string;
  name: string;
  frequencyDays: number;
  estimatedMinutes: number;
  items: PmChecklistItem[];
}

export interface PmExecution {
  id: string;
  equipmentId: string;
  equipment?: { id: string; name: string; type: string };
  templateId: string | null;
  executedAt: string;
  executedById: string | null;
  checklist: PmChecklistItem[];
  durationMinutes: number | null;
  notes: string | null;
  nextDueDate: string | null;
}

export interface BreakdownRecord {
  id: string;
  equipmentId: string;
  equipment?: { id: string; name: string; type: string };
  reportedById: string | null;
  reportedByName: string | null;
  failureTime: string;
  symptom: string;
  category: string;
  status: string;
  downtimeMinutes: number | null;
  repairNotes: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  createdAt: string;
}

export interface SparePart {
  id: string;
  partNumber: string;
  name: string;
  compatibleTypes: string | null;
  stockQty: number;
  minLevel: number;
  locationBin: string | null;
  unit: string;
  lowStock?: boolean;
}

export interface SparePartVerification {
  id: string;
  partId: string;
  part?: { partNumber: string; name: string };
  countedQty: number;
  systemQty: number;
  variance: number;
  verifiedById: string | null;
  verifiedAt: string;
  notes: string | null;
}

export interface WorkOrderPartUsage {
  partId: string;
  partNumber: string;
  name: string;
  qty: number;
}

export interface WorkOrder {
  id: string;
  woNumber: string;
  equipmentId: string;
  equipment?: { id: string; name: string; type: string };
  kind: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  breakdownId: string | null;
  description: string;
  partsUsed: WorkOrderPartUsage[] | null;
  openedAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  verifiedById: string | null;
  notes: string | null;
  approval?: RepairApproval | null;
}

export interface RepairApproval {
  id: string;
  workOrderId: string;
  workOrder?: WorkOrder;
  technicianNote: string | null;
  techSignedAt: string | null;
  techSignedById: string | null;
  supervisorNote: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  decision: string | null;
  backInServiceAt: string | null;
  createdAt: string;
}

export interface OverdueReport {
  equipment: MaintenanceEquipment[];
  pendingBreakdowns: BreakdownRecord[];
}

export interface MaintKpis {
  totalBreakdowns: number;
  resolvedCount: number;
  openCount: number;
  totalDowntimeMinutes: number;
  mtbfMinutes: number | null;
  mttrMinutes: number | null;
  byCategory: { category: string; count: number; avgDowntimeMinutes: number }[];
  partsConsumed: { partNumber: string; name: string; qty: number }[];
}

// ─── Module 8: Pest & Termite Control Management ─────────────────────

export type PestScheduleStatus = 'SCHEDULED' | 'DONE' | 'CANCELLED';
export type PestScheduleEffectiveStatus = PestScheduleStatus | 'OVERDUE';
export type PestFrequency = 'WEEKLY' | 'MONTHLY';
export type PestType = 'RODENT' | 'INSECT' | 'TERMITE' | 'BIRD';
export type PestSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TreatmentType = 'TRAP' | 'BAIT' | 'SPRAY' | 'FUMIGATION';
export type PestEvidenceStatus = 'OPEN' | 'CLEARED';
export type FollowUpStatus = 'PENDING' | 'DONE';
export type FollowUpResult = 'CLEARED' | 'PERSISTENT' | 'ESCALATED';
export type PestAlertType = 'OVERDUE_INSPECTION' | 'PERSISTENT_INFESTATION' | 'TREATMENT_DUE';
export type PestAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type RiskCheckpointResult = 'PASS' | 'FAIL';
export type RiskCheckpointCategory = 'BAIT_STATION' | 'ENTRY_POINT' | 'GENERAL';

export interface PestScheduleEntry {
  id: string;
  area: string;
  scheduledDate: string;
  frequency: PestFrequency;
  inspector?: string | null;
  status: PestScheduleStatus;
  effectiveStatus?: PestScheduleEffectiveStatus;
  completedAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface PestRiskCheckpoint {
  id: string;
  inspectionId: string;
  checkpoint: string;
  category: RiskCheckpointCategory;
  result: RiskCheckpointResult;
  notes?: string | null;
}

export interface PestRiskInspection {
  id: string;
  area: string;
  inspectedAt: string;
  inspector?: string | null;
  overallPass: boolean;
  notes?: string | null;
  createdAt: string;
  checkpoints: PestRiskCheckpoint[];
}

export interface PestFollowUp {
  id: string;
  evidenceId: string;
  dueDate: string;
  status: FollowUpStatus;
  result?: FollowUpResult | null;
  inspector?: string | null;
  notes?: string | null;
  escalatedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  evidence?: PestEvidenceRecord;
}

export interface PestEvidenceRecord {
  id: string;
  pestType: PestType;
  location: string;
  severity: PestSeverity;
  observedAt: string;
  description?: string | null;
  treatment?: TreatmentType | null;
  chemical?: string | null;
  dosage?: string | null;
  treatedAt?: string | null;
  applicator?: string | null;
  status: PestEvidenceStatus;
  clearedAt?: string | null;
  createdAt: string;
  followUps?: PestFollowUp[];
}

export interface PestAlert {
  id: string;
  type: PestAlertType;
  severity: PestAlertSeverity;
  message: string;
  refType?: string | null;
  refId?: string | null;
  dueDate?: string | null;
  acknowledged: boolean;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export interface PestInspectionReport {
  byArea: Array<{ area: string; scheduled: number; done: number; overdue: number }>;
  byMonth: Array<{ month: string; scheduled: number; done: number }>;
  riskByArea: Array<{ area: string; inspections: number; passed: number; failed: number }>;
  totals: { schedules: number; riskInspections: number };
}

export interface PestEvidenceReport {
  byPestType: Array<{ pestType: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  byLocation: Array<{ location: string; count: number }>;
}

export interface PestTreatmentEffectiveness {
  overall: { treated: number; cleared: number; pct: number | null };
  byTreatment: Array<{ treatment: string; treated: number; cleared: number; pct: number | null }>;
}

/* ── Module 7: Sanitation & Hygiene Management ─────────────────── */

export type ChecklistFrequency = 'PER_SHIFT' | 'DAILY' | 'WEEKLY';
export type AreaCleaningStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE';
export type HygieneInspectionResult = 'PASS' | 'FAIL';
export type CleaningActionStatus = 'OPEN' | 'IN_PROGRESS' | 'VERIFIED' | 'CLOSED';
export type HygieneApprovalStatus = 'PENDING' | 'SUPERVISOR_SIGNED' | 'APPROVED' | 'REJECTED';

export interface ChecklistTaskItem {
  id: string;
  title: string;
  detail?: string | null;
  sortOrder: number;
}

export interface CleaningChecklistTemplate {
  id: string;
  name: string;
  equipment: string;
  area?: string | null;
  frequency: ChecklistFrequency;
  assignedTo?: string | null;
  isActive: boolean;
  items?: ChecklistTaskItem[];
  _count?: { items: number };
  createdAt: string;
}

export interface CleaningLogTask {
  id: string;
  title: string;
  detail?: string | null;
  done: boolean;
  doneAt?: string | null;
}

export interface AreaCleaningLog {
  id: string;
  area: string;
  logDate: string;
  shift: string;
  cleaner: string;
  templateId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  status: AreaCleaningStatus;
  notes?: string | null;
  tasks?: CleaningLogTask[];
  createdAt: string;
}

export interface InspectionCriterion {
  id: string;
  criterion: string;
  result: HygieneInspectionResult;
  notes?: string | null;
}

export interface HygieneInspection {
  id: string;
  targetType: 'AREA' | 'EQUIPMENT';
  target: string;
  inspector: string;
  inspectedAt: string;
  score?: number | null;
  overallResult?: HygieneInspectionResult | null;
  findings?: string | null;
  photosNote?: string | null;
  criteria?: InspectionCriterion[];
  createdAt: string;
}

export interface CleaningAction {
  id: string;
  action: string;
  owner: string;
  dueDate?: string | null;
  status: CleaningActionStatus;
  sourceInspectionId?: string | null;
  verificationNotes?: string | null;
  verifiedById?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
}

export interface HygieneApproval {
  id: string;
  subjectType: 'CLEANING' | 'INSPECTION';
  subjectId: string;
  subjectLabel?: string | null;
  requestedById?: string | null;
  supervisorBy?: string | null;
  supervisorAt?: string | null;
  supervisorNote?: string | null;
  qualityBy?: string | null;
  qualityAt?: string | null;
  qualityNote?: string | null;
  status: HygieneApprovalStatus;
  createdAt: string;
}

export interface HygieneReportSummary {
  from: string | null;
  to: string | null;
  cleaningCompliancePct: number;
  totalCleanings: number;
  doneCleanings: number;
  overdueCleanings: number;
  overdueCleaningIds: string[];
  inspectionPassPct: number;
  totalInspections: number;
  passedInspections: number;
  passRatesByArea: Array<{ target: string; total: number; pass: number; passPct: number }>;
  openActions: number;
}

// ─── Module 11: Warehouse & Inventory ──────────────────────────────────────

export type WhLocationType = 'RAW' | 'FG' | 'SPARE' | 'GENERAL';

export interface WhLocation {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  type: WhLocationType;
  capacityQ: number;
  isActive: boolean;
  onHandQ: number;
  utilizationPct: number | null;
}

export interface WhStockRow {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  reservedQ: number;
  availableQ: number;
}

export interface WhPutAwayLine {
  id: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  packagingKg: number | null;
  unitCostBirr: number | null;
  suggestedLocationId: string | null;
  suggestedCode: string | null;
  placedLocationId: string | null;
  placedCode: string | null;
  placedAt: string | null;
}

export interface WhPutAwayList {
  id: string;
  docNo: string;
  referenceDoc: string | null;
  status: string;
  receivedAt: string;
  itemCount: number;
  totalQ: number;
}

export interface WhPutAwayDetail extends WhPutAwayList {
  items: WhPutAwayLine[];
}

export interface WhTransferLine {
  id: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
}

export interface WhTransferList {
  id: string;
  docNo: string;
  fromCode: string;
  toCode: string;
  reason: string | null;
  status: string;
  createdAt: string;
  itemCount: number;
  totalQ: number;
}

export interface WhTransferDetail extends WhTransferList {
  fromName: string;
  toName: string;
  completedAt: string | null;
  items: WhTransferLine[];
}

export interface WhAdjustmentLine {
  id: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  unitCostBirr: number | null;
  reason: string;
}

export interface WhAdjustmentList {
  id: string;
  docNo: string;
  locationCode: string;
  status: string;
  reason: string | null;
  createdAt: string;
  itemCount: number;
  totalAbsQ: number;
}

export interface WhAdjustmentDetail extends WhAdjustmentList {
  locationName: string;
  postedAt: string | null;
  items: WhAdjustmentLine[];
}

export interface WhReservation {
  id: string;
  refNo: string;
  reference: string | null;
  productName: string;
  batchNo: string | null;
  locationCode: string;
  quintals: number;
  bags: number;
  expiresAt: string | null;
  status: string;
  createdAt: string;
}

export interface WhDispatchLine {
  id: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  locationId: string;
  locationCode: string;
  quintals: number;
  bags: number;
}

export interface WhDispatchList {
  id: string;
  docNo: string;
  reference: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  status: string;
  createdAt: string;
  dispatchedAt: string | null;
  itemCount: number;
  totalQ: number;
}

export interface WhDispatchDetail extends WhDispatchList {
  items: WhDispatchLine[];
}

export interface WhCountLine {
  id: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  systemQ: number;
  systemBags: number;
  countedQ: number | null;
  countedBags: number | null;
  recountQ: number | null;
  recountBags: number | null;
  varianceQ: number | null;
}

export interface WhCountSessionList {
  id: string;
  sessionNo: string;
  locationCode: string;
  scheduledDate: string;
  status: string;
  createdAt: string;
  lineCount: number;
  countedLines: number;
  totalAbsVariance: number;
}

export interface WhCountSessionDetail extends WhCountSessionList {
  locationName: string;
  postedAt: string | null;
  lines: WhCountLine[];
}

export interface WhValuationRow {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  avgCostBirr: number;
  valueBirr: number;
}

export interface WhMovementSummaryRow {
  movementType: string;
  lines: number;
  inQ: number;
  outQ: number;
}

export interface WhAgingRow {
  locationCode: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  daysOld: number;
  bucket: '0-30d' | '31-60d' | '61-90d' | '90d+';
}

// ─── Module 4: Production & Milling Management ─────────────────────────────

export type FlourProductType = 'DUKET_NORMAL' | 'DUKET_SPECIAL' | 'FURISHKA' | 'FINO' | 'FERNACHO';

export interface BlendRecipe {
  id: string;
  name: string;
  productType: FlourProductType;
  hardPct: Dec;
  softPct: Dec;
  foreignPct: Dec;
  isActive: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTarget {
  productType: FlourProductType;
  plannedQ: number;
}

export type PlanStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ProductionPlan {
  id: string;
  planNo: string;
  tankCode?: string | null;
  batchId?: string | null;
  targets: PlanTarget[];
  plannedWheatQ: Dec;
  scheduledDate: string;
  shift: 'MORNING' | 'NIGHT';
  status: PlanStatus;
  actualWheatQ?: Dec | null;
  actualOutputQ?: Dec | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MillingRunStatus = 'RUNNING' | 'COMPLETED' | 'STOPPED';

export interface MillingRun {
  id: string;
  runNo: string;
  planId?: string | null;
  batchId: string;
  lineMachine: string;
  startedAt: string;
  endedAt?: string | null;
  durationMin?: number | null;
  feedRateQHr?: Dec | null;
  rollSettings?: string | null;
  operator: string;
  status: MillingRunStatus;
  createdAt: string;
}

export type DowntimeCategory = 'POWER' | 'MECHANICAL' | 'ELECTRICAL' | 'PLANNED' | 'OTHER';

export interface DowntimeLog {
  id: string;
  machineLine: string;
  runId?: string | null;
  shiftRunId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  minutesLost: number;
  reasonCategory: DowntimeCategory;
  description?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
}

export interface DowntimeSummaryRow {
  id: string;
  machineLine: string;
  events: number;
  minutesLost: number;
  byCategory: Record<string, number>;
  uptimePct: number;
}

export interface FlourOutput {
  id: string;
  batchId: string;
  productType: FlourProductType;
  quintals: Dec;
  extractionPct?: Dec | null;
  belowYieldFlag: boolean;
  loggedAt: string;
}

export type YieldAlertType = 'LOW_EXTRACTION' | 'LOW_OUTPUT_VS_PLAN' | 'EXCESS_DOWNTIME';
export type YieldSeverity = 'AMBER' | 'RED';
export type YieldAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface YieldAlert {
  id: string;
  alertType: YieldAlertType;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  message: string;
  severity: YieldSeverity;
  status: YieldAlertStatus;
  acknowledgedAt?: string | null;
  ackNotes?: string | null;
  createdAt: string;
}

export interface BlendCompliance {
  recipe: BlendRecipe | null;
  actual: { hardPct: number; softPct: number; foreignPct: number };
  deviation: { hard: number; soft: number; foreign: number };
  withinTolerance: boolean;
  tolerancePct: number;
}

export interface ShiftHandover {
  id: string;
  shiftRunId: string;
  noteType: 'HANDOVER' | 'OPERATOR_NOTE';
  content: string;
  authorId?: string | null;
  createdAt: string;
}

export interface WashingLog {
  id: string;
  tankOrSilo: string;
  startedAt: string;
  endedAt?: string | null;
  durationMin?: number | null;
  downtimeMin?: number | null;
  equipmentChange?: string | null;
  operators: string[];
  batchId?: string | null;
  waterUsedL?: number | null;
  impurityBeforePct?: Dec | null;
  impurityAfterPct?: Dec | null;
  createdById?: string | null;
}

export interface DailyReportKpis {
  intakeQ: number;
  totalFlourOutputQ: number;
  weightedExtractionPct: number | null;
  batchesWorked: number;
  totalDowntimeMin: number;
  plansCompleted: number;
  openAlerts: number;
  redAlerts: number;
}

export interface DailyReportBatchRow {
  id: string;
  batchId: string;
  batchNo: string;
  productType: string;
  wheatWeighedQ: number;
  flourOutputQ: number;
  extractionPct: number | null;
  flagged: boolean;
}

export interface DailyReportShiftRow {
  id: string;
  shiftRunId: string;
  shiftDate: string;
  shift: string;
  batchNo: string | null;
  operators: string[];
  outputQ: number;
  extractionPct: number | null;
  downtimeMin: number;
}

export interface DailyProductionReport {
  date: string;
  kpis: DailyReportKpis;
  perBatch: DailyReportBatchRow[];
  perShift: DailyReportShiftRow[];
}

export interface ShiftProductionReport {
  date: string;
  shift: string;
  rows: DailyReportShiftRow[];
  totalOutputQ: number;
  totalDowntimeMin: number;
}

// ─── Module 5: Quality Assurance & Laboratory Management ────────────

export type QcVerdict = 'PASS' | 'FAIL' | 'UNTESTED';

export interface FlourQualityTest {
  id: string;
  batchId: string;
  batch?: { batchNo: string } | null;
  productLabel: string;
  sampleTime: string;
  flourMoisturePct: Dec | null;
  wetGlutenPct: Dec | null;
  dryGlutenPct: Dec | null;
  ashPct: Dec | null;
  colorScore: Dec | null;
  granulationPct: Dec | null;
  impurityPct: Dec | null;
  verdict: QcVerdict;
  outOfRange: string[];
  notes?: string | null;
}

export type SamplingKind = 'SHIFT_2H' | 'INTAKE_TRUCK' | 'FLOUR_BATCH';
export type SamplingStatus = 'PENDING' | 'COLLECTED' | 'OVERDUE' | 'SKIPPED';

export interface SamplingEntry {
  id: string;
  kind: SamplingKind;
  label: string;
  shiftRunId?: string | null;
  intakeId?: string | null;
  batchId?: string | null;
  dueAt: string;
  collectedAt?: string | null;
  collectedById?: string | null;
  status: SamplingStatus;
  notes?: string | null;
}

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface OpenCapaRef {
  id: string;
  capaNo: string;
  issueDescription: string;
  status: string;
}

export interface ReleaseChecklist {
  batchId: string;
  batchNo: string;
  status: string;
  canRelease: boolean;
  items: ReleaseChecklistItem[];
  openCapas: OpenCapaRef[];
}

export interface QcAuditEntry {
  id: string;
  action: string;
  userId?: string | null;
  changes?: unknown;
  createdAt: string;
}

export interface QcThresholdRow extends QcThreshold {
  isActive: boolean;
}

export interface QcDayCount {
  date: string;
  total: number;
  failed: number;
}

export interface QcTrendPoint {
  t: string;
  v: number;
}

export interface QcSummaryBlock {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byDay: QcDayCount[];
}

export interface QcReportSummary {
  range: { from: string; to: string };
  labChecks: QcSummaryBlock;
  flourTests: QcSummaryBlock;
  intakeTests: { total: number; passed: number; failed: number; passRate: number };
  paramTrends: Record<string, QcTrendPoint[]>;
  thresholds: Array<{
    code: string;
    category: string;
    param: string;
    minValue: number | null;
    maxValue: number | null;
    unit: string | null;
  }>;
}

/* ─── Module 10: Finished Goods & Byproduct Management ─── */

export interface PackagingSize {
  id: string;
  label: string;
  kg: number | string;
  isActive: boolean;
}

export interface FgInventoryRow {
  id: string;
  productId: string;
  productName: string;
  productKind: string;
  batchNo: string;
  packagingSizeId: string | null;
  bagLabel: string;
  bagKg: number | null;
  locationCode: string;
  bags: number;
  quintals: number;
  receivedAt: string;
  agingDays: number;
  inflowBags: number;
  inflowQ: number;
  outflowBags: number;
  outflowQ: number;
}

export interface PackagingRun {
  id: string;
  batchId: string;
  productId: string;
  productName?: string;
  packagingSizeId: string;
  bags: number;
  quintals: Dec;
  productionDate: string;
  packedAt: string;
  packedById: string | null;
  line: string | null;
  operator: string | null;
  startedAt: string | null;
  endedAt: string | null;
  product?: Product;
  batch?: ProductionBatch;
}

export interface PackingEfficiencyRow {
  id?: string;
  date: string;
  line: string;
  runs: number;
  bags: number;
  quintals: number;
  hours: number;
  bagsPerHour: number | null;
}

export interface FlourGrade {
  id: string;
  productId: string;
  gradeCode: string;
  name: string;
  moistureMax: Dec;
  wetGlutenMin: Dec;
  wetGlutenMax: Dec;
  ashMax: Dec;
  shelfLifeDays: number;
  isActive: boolean;
  notes: string | null;
  product?: Product;
}

export interface GradeParamCheck {
  param: 'moisture' | 'wetGluten' | 'ash';
  label: string;
  value: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  pass: boolean;
}

export interface GradeQualityResult {
  id: string;
  batchNo: string;
  sampleTime: string;
  params: GradeParamCheck[];
  pass: boolean;
}

export interface LabelQueueRow {
  id?: string;
  packagingRunId: string;
  batchNo: string;
  batchStatus: string;
  productId: string;
  productName: string;
  productionDate: string;
  bagLabel: string;
  bagKg: number | null;
  bagsPacked: number;
  labelsPrinted: number;
  pending: number;
}

export interface LabelPrint {
  id: string;
  packagingRunId: string | null;
  batchNo: string;
  productId: string;
  packagingSizeId: string | null;
  bagKg: Dec;
  copies: number;
  productionDate: string;
  expiryDate: string;
  status: 'PRINTED' | 'REPRINTED';
  reprintReason: string | null;
  printedAt: string;
  product?: Product;
}

export interface ByproductStockRow {
  id: string;
  type: 'BRAN' | 'SHORTS';
  typeLabel: string;
  batchNo: string | null;
  locationCode: string;
  quintals: number;
  receivedAt: string;
  agingDays: number;
}

export interface ByproductMovement {
  id: string;
  type: 'BRAN' | 'SHORTS';
  typeLabel: string;
  direction: 'IN' | 'OUT';
  quintals: number;
  reference: string | null;
  reason: string | null;
  movedAt: string;
}

export interface ByproductAlert {
  kind: 'LOW_STOCK' | 'STALE';
  type: string;
  typeLabel: string;
  detail: string;
  quintals?: number;
  agingDays?: number;
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface AgingLot {
  id: string;
  productId: string;
  productName: string;
  batchNo: string;
  packagingSizeId: string | null;
  bagLabel: string;
  bagKg: number | null;
  locationCode: string;
  bags: number;
  quintals: number;
  receivedAt: string;
  agingDays: number;
  bucket: AgingBucket;
  expiryDate: string;
  daysToExpiry: number;
  status: 'OK' | 'NEAR_EXPIRY' | 'EXPIRED';
}

export interface FefoSuggestion {
  productId: string;
  productName: string;
  batchNo: string;
  bagLabel: string;
  locationCode: string;
  agingDays: number;
  quintals: number;
}

export interface FgStockAdjustment {
  id: string;
  productId: string;
  batchNo: string;
  packagingSizeId: string | null;
  locationCode: string;
  bagsDelta: number;
  quintalsDelta: Dec;
  reason: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  product?: Product;
}

export interface StockPositionProduct {
  id?: string;
  productId: string;
  productName: string;
  totalBags: number;
  totalQuintals: number;
  locations: string[];
  sizes: { bagLabel: string; bags: number; quintals: number }[];
  lowStock: boolean;
}

export interface ByproductBalanceType {
  id?: string;
  type: string;
  typeLabel: string;
  inflowQ: number;
  outflowQ: number;
  netQ: number;
  onHandQ: number;
}

// ─── Module 14: Finance & Accounting expansion ──────────────────
// (Dec is declared once at the top of this file; no duplicate needed.)

export interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: string | null;
  isActive: boolean;
}

export interface LedgerRow {
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  memo?: string | null;
  module: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerReport {
  account: { id: string; code: string; name: string; type: string };
  openingBalance: number;
  lines: LedgerRow[];
  totals: { debit: number; credit: number; closingBalance: number };
}

export type VoucherKind = 'PAYMENT' | 'RECEIPT';
export type VoucherStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'CANCELLED';

export interface FinanceVoucher {
  id: string;
  voucherNo: string;
  kind: VoucherKind;
  counterparty: string;
  amountBirr: Dec;
  method: string;
  reference?: string | null;
  cashBankAccountId?: string | null;
  cashBankAccount?: CashBankAccount | null;
  debitAccountCode: string;
  creditAccountCode: string;
  memo?: string | null;
  status: VoucherStatus;
  approvedById?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  createdById?: string | null;
  createdAt: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  glAccountCode?: string | null;
  isActive: boolean;
}

export type ClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface ExpenseClaim {
  id: string;
  claimNo: string;
  title: string;
  categoryId: string;
  category?: ExpenseCategory | null;
  amountBirr: Dec;
  glAccountCode: string;
  status: ClaimStatus;
  notes?: string | null;
  approvedAt?: string | null;
  createdAt: string;
}

export interface CashBankAccount {
  id: string;
  name: string;
  kind: 'CASH' | 'BANK';
  bankName?: string | null;
  accountNo?: string | null;
  glAccountCode: string;
  isActive: boolean;
  balance?: number;
  glAccountName?: string;
  createdAt: string;
}

export interface CashTransfer {
  id: string;
  transferNo: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccount?: CashBankAccount | null;
  toAccount?: CashBankAccount | null;
  amountBirr: Dec;
  transferDate: string;
  memo?: string | null;
  createdAt: string;
}

export interface ArRow {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  issuedAt: string;
  daysOpen: number;
  bucket: string;
}

export interface ArReport {
  rows: ArRow[];
  summary: {
    totalInvoiced: number;
    totalPaid: number;
    totalOutstanding: number;
    buckets: Record<string, { count: number; total: number }>;
  };
}

export interface ApRow {
  id: string;
  invoiceNo: string;
  supplierId: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  issuedAt: string;
  dueDate?: string | null;
  daysOpen: number;
  bucket: string;
}

export interface ApSummary {
  rows: ApRow[];
  summary: { totalInvoiced: number; totalPaid: number; totalOutstanding: number; openCount: number };
}

export interface FinancePayrollRun {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  lineCount: number;
  totalBirr: number;
  journalPosted: boolean;
  journalEntryId?: string | null;
  journalEntryNo?: string | null;
}

// ─── Sales & Distribution — Module 13 expansion ───

export interface SalesOrderLine {
  id: string;
  orderId: string;
  productId: string;
  product?: { id: string; name: string } | null;
  packagingSizeId?: string | null;
  packagingSize?: { id: string; label: string; kg: Dec } | null;
  bags: number;
  quintals: Dec;
  priceBirr: Dec;
}

export interface PackagingSize {
  id: string;
  label: string;
  kg: Dec;
  isActive: boolean;
}

export interface PriceTier {
  minBags: number;
  discountPct?: number;
  priceBirr?: number;
}

export interface SalesAgreementLine {
  id: string;
  agreementId: string;
  productId: string;
  product?: { id: string; name: string } | null;
  packagingSizeId?: string | null;
  packagingSize?: { id: string; label: string } | null;
  priceBirr: Dec;
  tiers?: PriceTier[] | null;
}

export interface SalesAgreement {
  id: string;
  agreementNo: string;
  customerId: string;
  customer?: { id: string; name: string } | null;
  name: string;
  validFrom: string;
  validTo: string;
  discountPct: Dec;
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | string;
  notes?: string | null;
  lines?: SalesAgreementLine[];
}

export interface AdvanceApplication {
  id: string;
  advanceId: string;
  invoiceId: string;
  amountBirr: Dec;
  appliedAt: string;
  invoice?: { id: string; invoiceNo: string } | null;
}

export interface AdvancePayment {
  id: string;
  customerId: string;
  amountBirr: Dec;
  appliedAmountBirr?: Dec;
  status?: string;
  paidAt: string;
  applications?: AdvanceApplication[];
}

export interface AdvanceBalance {
  balance: { total: number; applied: number; available: number };
  advances: AdvancePayment[];
}

export interface TruckLoadItem {
  id: string;
  loadId: string;
  orderId: string;
  order?: SalesOrder | null;
  bags: number;
  quintals: Dec;
}

export interface TruckLoad {
  id: string;
  loadNo: string;
  vehicleId?: string | null;
  vehicle?: { id: string; plateNo: string } | null;
  route: string;
  capacityQuintals: Dec;
  status: 'BUILDING' | 'READY' | 'LOADED' | 'DISPATCHED' | 'CANCELLED' | string;
  notes?: string | null;
  createdAt: string;
  items?: TruckLoadItem[];
}

export interface DeliveryTrip {
  id: string;
  tripNo: string;
  vehicleId: string;
  vehicle?: { id: string; plateNo: string } | null;
  driverName?: string | null;
  area: string;
  status: 'PLANNED' | 'DEPARTED' | 'ARRIVED' | 'POD_CONFIRMED' | 'CANCELLED' | string;
  departedAt?: string | null;
  arrivedAt?: string | null;
  podReceivedAt?: string | null;
  podSignedBy?: string | null;
  dispatchId?: string | null;
  dispatch?: Dispatch | null;
  notes?: string | null;
  createdAt: string;
}

export interface AgentStockSettlement {
  id: string;
  placementId: string;
  bags: number;
  quintals: Dec;
  amountBirr: Dec;
  settledAt: string;
  notes?: string | null;
}

export interface AgentStockPlacement {
  id: string;
  placementNo: string;
  customerId: string;
  customer?: { id: string; name: string } | null;
  productId: string;
  product?: { id: string; name: string } | null;
  packagingSizeId?: string | null;
  packagingSize?: { id: string; label: string } | null;
  bags: number;
  quintals: Dec;
  unitPriceBirr: Dec;
  status: 'PLACED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'RETURNED' | string;
  placedAt: string;
  settledAt?: string | null;
  notes?: string | null;
  settlements?: AgentStockSettlement[];
}

export interface SalesInvoiceLine {
  id: string;
  invoiceId: string;
  orderId?: string | null;
  productId: string;
  product?: { id: string; name: string } | null;
  packagingSizeId?: string | null;
  packagingSize?: { id: string; label: string } | null;
  bags: number;
  quintals: Dec;
  unitPriceBirr: Dec;
  lineTotalBirr: Dec;
}

export interface CashReceiptRow {
  id: string;
  receiptNo: string;
  customerId: string;
  invoiceId?: string | null;
  amountBirr: Dec;
  receivedAt: string;
}

export interface SalesInvoice {
  id: string;
  invoiceNo: string;
  dispatchId?: string | null;
  customerId: string;
  amountBirr: Dec;
  status: 'PLACEMENT' | 'INVOICED' | 'PAID' | string;
  invoicedAt?: string | null;
  createdAt: string;
  source?: string;
  orderIds?: string[];
  lines?: SalesInvoiceLine[];
  receipts?: CashReceiptRow[];
  applications?: AdvanceApplication[];
}

export interface CashReconciliation {
  id: string;
  reconDate: string;
  expectedBirr: Dec;
  collectedBirr: Dec;
  varianceBirr: Dec;
  status: 'BALANCED' | 'VARIANCE_OPEN' | 'RESOLVED' | string;
  depositRef?: string | null;
  depositedAt?: string | null;
  notes?: string | null;
}

export interface SalesSummaryReport {
  byProduct: Array<{ productId: string; productName: string; quintals: number; bags: number }>;
  byCustomer: Array<{ customerId: string; customerName: string; orders: number; quintals: number }>;
  byDestination: Array<{ area: string; dispatches: number }>;
  byInvoiceStatus: Array<{ status: string; count: number; amountBirr: number }>;
  byPackSize: Array<{ packSizeId: string | null; label: string; bags: number }>;
  revenueByMonth: Array<{ month: string; amountBirr: number }>;
}

export interface DeliveryPerformanceReport {
  totals: { dispatches: number; onTime: number; late: number; noDate: number };
  onTimePct: number;
  rows: Array<{
    id: string;
    exitNoteNo: string;
    plateNo: string | null;
    area: string;
    dispatchedAt: string;
    requestedDate: string | null;
    verdict: 'ON_TIME' | 'LATE' | 'NO_DATE';
    gateStatus: string;
    status: string;
    quintals: number;
  }>;
}

export interface AgentSettlementReportRow {
  id: string;
  placementNo: string;
  agentName: string;
  productName: string;
  placedQuintals: number;
  placedBags: number;
  unitPriceBirr: number;
  settledQuintals: number;
  settledAmountBirr: number;
  outstandingQuintals: number;
  status: string;
  placedAt: string;
}

// ─── Module 19: Support & Documentation Center ──────────────────────

export interface SopDocument {
  id: string;
  docNo: string;
  docType: 'MANUAL' | 'SOP';
  title: string;
  module: string | null;
  version: string;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'ARCHIVED';
  effectiveDate: string | null;
  reviewDate: string | null;
  summary: string | null;
  content: string;
  approverId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KbArticle {
  id: string;
  title: string;
  category: 'faq' | 'troubleshooting' | 'howto' | 'guide';
  tags: string[];
  content: string;
  faq: boolean;
  pinned: boolean;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  targetRoles: string[];
  urgent: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  authorId: string;
  reads?: { id: string }[];
  createdAt: string;
}

export interface TechSupportRecord {
  id: string;
  recordNo: string;
  title: string;
  category: 'network' | 'hardware' | 'software' | 'training' | 'other';
  description: string;
  resolution: string | null;
  durationMins: number | null;
  technicianId: string;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  type: 'info' | 'warning' | 'alert' | 'success';
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface SmsLogEntry {
  id: string;
  to: string;
  message: string;
  trigger: string | null;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED';
  attempts: number;
  providerId: string | null;
  sentAt: string | null;
  createdAt: string;
}
