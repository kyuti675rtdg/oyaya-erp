// Central API endpoint map (all paths relative to /api/v1).
// Must mirror packages/api route mounts exactly.
export const E = {
  login: '/auth/login',
  me: '/auth/me',
  health: '/health',

  dashboardKpis: '/dashboard/kpis',

  suppliers: '/master/suppliers',
  customers: '/master/customers',
  products: '/master/products',
  storageLocations: '/master/storage-locations',

  intakes: '/procurement/intakes',
  intakesFlagged: '/procurement/intakes?status=FLAGGED',
  intakeDecision: (id: string) => `/procurement/intakes/${id}/decision`,
  apInvoices: '/procurement/ap-invoices',
  apPay: (id: string) => `/procurement/ap-invoices/${id}/pay`,
  purchaseOrders: '/procurement/purchase-orders',
  purchaseOrder: (id: string) => `/procurement/purchase-orders/${id}`,
  poApprove: (id: string) => `/procurement/purchase-orders/${id}/approve`,
  poCancel: (id: string) => `/procurement/purchase-orders/${id}/cancel`,

  tanks: '/storage/tanks',
  tankFills: (tankCode: string) => `/storage/tanks/${tankCode}/fills`,
  tankReady: (tankCode: string) => `/storage/tanks/${tankCode}/mark-ready`,
  tankEmpty: (tankCode: string) => `/storage/tanks/${tankCode}/empty`,
  tankCycle: (tankCode: string) => `/storage/tanks/${tankCode}/cycle`,
  tankCycleStart: (tankCode: string) => `/storage/tanks/${tankCode}/conditioning/start`,
  tankCycleWater: (tankCode: string) => `/storage/tanks/${tankCode}/conditioning/water`,
  tankCycleComplete: (tankCode: string) => `/storage/tanks/${tankCode}/conditioning/complete`,
  tankRelease: (tankCode: string) => `/storage/tanks/${tankCode}/release`,
  tankCleaning: (tankCode: string) => `/storage/tanks/${tankCode}/cleaning`,
  tankEvents: (tankCode: string) => `/storage/tanks/${tankCode}/events`,
  cycles: '/storage/cycles',
  blends: '/storage/blends',
  dryPool: '/storage/dry-pool',
  dryPoolDetail: '/storage/dry-pool/detail',
  dryPoolAdjust: '/storage/dry-pool/adjust',
  movementsFiltered: '/storage/movements/filtered',

  washings: '/production/washing',

  batches: '/production/batches',
  batch: (id: string) => `/production/batches/${id}`,

  shifts: '/production/shifts',
  shift: (id: string) => `/production/shifts/${id}`,
  shiftOutputs: (id: string) => `/production/shifts/${id}/outputs`,

  qcThresholds: '/qc/thresholds',
  labChecks: '/qc/lab-checks',

  capas: '/capa',
  capa: (id: string) => `/capa/${id}`,
  capaSignoff: (id: string) => `/capa/${id}/signoff`,
  capaClose: (id: string) => `/capa/${id}/close`,

  salesOrders: '/sales/orders',
  advances: '/sales/advances',
  dispatches: '/sales/dispatches',
  dispatch: (id: string) => `/sales/dispatches/${id}`,
  salesReconciliation: '/sales/reconciliation/gaps',

  journals: '/finance/entries',
  trialBalance: '/finance/reports/trial-balance',
  incomeStatement: '/finance/reports/income-statement',
  balanceSheet: '/finance/reports/balance-sheet',

  payrollRuns: '/payroll/runs',
  payrollRun: (id: string) => `/payroll/runs/${id}`,
  pieceRateLogs: '/payroll/piece-logs',
  pieceRates: '/payroll/piece-rates',
  driverTripRate: '/payroll/driver-trip-rate',

  vehicles: '/fleet/vehicles',

  syncBatch: '/sync/batch',

  // Module 19: Module Manager
  moduleToggles: '/module-manager',
  moduleToggle: (id: string) => `/module-manager/${id}/toggle`,

  // Module 20: API Monitor
  apiIntegrations: '/api-monitor',
  apiIntegration: (id: string) => `/api-monitor/${id}`,
  apiHealthCheck: (id: string) => `/api-monitor/${id}/check`,
  apiHealthHistory: (id: string) => `/api-monitor/${id}/health`,

  // Module 21: Support & Docs
  tickets: '/support/tickets',
  ticket: (id: string) => `/support/tickets/${id}`,
  ticketComments: (id: string) => `/support/tickets/${id}/comments`,
  docs: '/support/docs',
  doc: (slug: string) => `/support/docs/${slug}`,
} as const;
