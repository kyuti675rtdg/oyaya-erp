// Oyaya Flour Factory ERP — database seed.
// Run with: npx ts-node prisma/seed.ts   (NOT part of the tsc build)
// Idempotent: every row is inserted via find-or-create / upsert.
import { AccountType, PieceStage, PrismaClient, StorageKind } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { ALL_PERMISSION_CODES } from '../src/lib/permissions';

const prisma = new PrismaClient();

interface RoleSeed {
  name: string;
  /** 'ALL' expands to every permission code; otherwise "module:action" pairs. */
  grants: string[];
}

const ROLES: RoleSeed[] = [
  { name: 'Owner / CEO', grants: ['ALL'] },
  {
    name: 'System Administrator',
    grants: ['ALL'],
  },
  {
    name: 'Quality / Lab Head',
    grants: [
      'procurement:view',
      'procurement:approve',
      'qc:view',
      'qc:manage',
      'qc:approve',
      'capa:view',
      'capa:manage',
      'capa:approve',
      'hygiene:view',
      'hygiene:manage',
      'pest:view',
      'pest:manage',
      'traceability:view',
      'dashboard:view',
      'production:view',
    ],
  },
  {
    name: 'Lab Technician',
    grants: [
      'procurement:view',
      'procurement:manage',
      'production:view',
      'qc:view',
      'qc:manage',
      'capa:view',
      'capa:manage',
    ],
  },
  {
    name: 'Production Manager',
    grants: [
      'storage:view',
      'storage:manage',
      'production:view',
      'production:manage',
      'production:approve',
      'capa:view',
      'capa:manage',
      'capa:approve',
      'hygiene:view',
      'pest:view',
      'maintenance:view',
      'maintenance:manage',
      'fg:view',
      'fg:manage',
      'warehouse:view',
      'traceability:view',
      'dashboard:view',
    ],
  },
  {
    name: 'Machine & Washing Operators',
    grants: ['storage:view', 'storage:manage', 'production:view', 'production:manage', 'capa:view'],
  },
  {
    name: 'Storekeeper (Raw & FG)',
    grants: [
      'procurement:view',
      'procurement:manage',
      'storage:view',
      'fg:view',
      'fg:manage',
      'warehouse:view',
      'warehouse:manage',
      'sales:view',
      'sales:manage',
      'payroll:view',
    ],
  },
  {
    name: 'Sanitation Supervisor & Pest Inspector',
    grants: [
      'hygiene:view',
      'hygiene:manage',
      'pest:view',
      'pest:manage',
      'maintenance:view',
      'maintenance:manage',
    ],
  },
  {
    name: 'Sales & Distribution Officer',
    grants: [
      'master:view',
      'warehouse:view',
      'sales:view',
      'sales:manage',
      'fleet:view',
      'dashboard:view',
    ],
  },
  {
    name: 'Finance & Accounting Officer',
    grants: [
      'procurement:view',
      'sales:view',
      'finance:view',
      'finance:manage',
      'finance:approve',
      'payroll:view',
      'hr:view',
      'dashboard:view',
    ],
  },
  {
    name: 'HR & Payroll Officer',
    grants: [
      'payroll:view',
      'payroll:manage',
      'payroll:approve',
      'hr:view',
      'hr:manage',
      'hr:approve',
      'dashboard:view',
      'attendance:view',
    ],
  },
  {
    name: 'Security / Gate Officer',
    grants: ['procurement:view', 'sales:view', 'payroll:view', 'attendance:view'],
  },
  {
    name: 'Drivers & Floor Laborers',
    grants: ['sales:view', 'payroll:view', 'attendance:view', 'attendance:manage'],
  },
];

interface QcThresholdSeed {
  code: string;
  category: string;
  param: string;
  minValue?: number;
  maxValue?: number;
}

const QC_THRESHOLDS: QcThresholdSeed[] = [
  { code: 'intake.gluten.min', category: 'intake', param: 'gluten', minValue: 20 },
  { code: 'intake.moisture.max', category: 'intake', param: 'moisture', maxValue: 13.5 },
  { code: 'intake.impurity.max', category: 'intake', param: 'impurity', maxValue: 6 },
  { code: 'intake.hectoliter.min', category: 'intake', param: 'hectoliter', minValue: 74 },
  { code: 'intake.germination.max', category: 'intake', param: 'germination', maxValue: 1 },
  { code: 'inprocess.impurity.max', category: 'inprocess', param: 'impurity', maxValue: 3.0 },
  {
    code: 'inprocess.wheatMoistureBefore',
    category: 'inprocess',
    param: 'wheatMoistureBefore',
    minValue: 10.0,
    maxValue: 13.3,
  },
  {
    code: 'inprocess.wheatMoistureAfter',
    category: 'inprocess',
    param: 'wheatMoistureAfter',
    minValue: 15.0,
    maxValue: 16.5,
  },
  { code: 'inprocess.flourMoisture.max', category: 'inprocess', param: 'flourMoisture', maxValue: 14.0 },
  { code: 'inprocess.wetGluten', category: 'inprocess', param: 'wetGluten', minValue: 30, maxValue: 33 },
  { code: 'inprocess.dryGluten', category: 'inprocess', param: 'dryGluten', minValue: 0.8, maxValue: 1.6 },
  { code: 'inprocess.ash.max', category: 'inprocess', param: 'ash', maxValue: 0.7 },
  { code: 'inprocess.color.min', category: 'inprocess', param: 'color', minValue: 70 },
  {
    code: 'inprocess.granulation',
    category: 'inprocess',
    param: 'granulation',
    minValue: 75,
    maxValue: 80,
  },
];

interface StorageLocationSeed {
  code: string;
  name: string;
  kind: StorageKind;
  capacityQ: number;
}

const STORAGE_LOCATIONS: StorageLocationSeed[] = [
  { code: 'DRY_POOL', name: 'Dry Storage Pool', kind: StorageKind.DRY_POOL, capacityQ: 7000 },
  { code: 'TANK_A', name: 'Conditioning Tank A', kind: StorageKind.CONDITIONING_TANK, capacityQ: 180 },
  { code: 'TANK_B', name: 'Conditioning Tank B', kind: StorageKind.CONDITIONING_TANK, capacityQ: 120 },
  { code: 'TANK_C', name: 'Conditioning Tank C', kind: StorageKind.CONDITIONING_TANK, capacityQ: 160 },
  {
    code: 'FG_WH_1',
    name: 'Finished Goods Warehouse 1',
    kind: StorageKind.FG_WAREHOUSE,
    capacityQ: 10000,
  },
];

interface ProductSeed {
  name: string;
  kind: string;
}

const PRODUCTS: ProductSeed[] = [
  { name: 'Duket (Normal)', kind: 'flour' },
  { name: 'Duket (Special)', kind: 'flour' },
  { name: 'Furishka', kind: 'silage' },
  { name: 'Fino', kind: 'feed' },
  { name: 'Fernacho', kind: 'feed' },
];

const PACKAGING_SIZES: { label: string; kg: number }[] = [
  { label: '50kg', kg: 50 },
  { label: '25kg', kg: 25 },
  { label: '10kg', kg: 10 },
  { label: '5kg', kg: 5 },
];

const PIECE_RATES: { stage: PieceStage; rateBirrPerQ: number }[] = [
  { stage: PieceStage.UNLOADING, rateBirrPerQ: 25 },
  { stage: PieceStage.GRANARY_DUMPING, rateBirrPerQ: 25 },
  { stage: PieceStage.STORE_MOVEMENT, rateBirrPerQ: 25 },
  { stage: PieceStage.TRUCK_LOADING, rateBirrPerQ: 25 },
];

const CHART_OF_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Cash and Bank', type: AccountType.ASSET },
  { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET },
  { code: '1200', name: 'Wheat Inventory', type: AccountType.ASSET },
  { code: '1300', name: 'Finished Goods Inventory', type: AccountType.ASSET },
  { code: '2000', name: 'Accounts Payable', type: AccountType.LIABILITY },
  { code: '3000', name: 'Owner Equity', type: AccountType.EQUITY },
  { code: '4000', name: 'Sales Revenue', type: AccountType.REVENUE },
  { code: '5000', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
  { code: '6000', name: 'Payroll Expense', type: AccountType.EXPENSE },
  { code: '6100', name: 'Piece-Rate Labor Expense', type: AccountType.EXPENSE },
];

async function main(): Promise<void> {
  // ── Company ──────────────────────────────────────────────────────
  const companyName = 'Oyaya Flour Production Company PLC';
  const existingCompany = await prisma.company.findFirst({ where: { name: companyName } });
  const company = existingCompany ?? (await prisma.company.create({ data: { name: companyName } }));

  // ── Permissions ──────────────────────────────────────────────────
  const permissionByCode = new Map<string, string>();
  for (const code of ALL_PERMISSION_CODES) {
    const parts = code.split(':');
    const module = parts[0];
    const action = parts[1];
    if (!module || !action) throw new Error(`Seed failed: malformed permission code ${code}`);
    const storedCode = `${module}:${action}:all`;
    const permission = await prisma.permission.upsert({
      where: { code: storedCode },
      update: {},
      create: { code: storedCode, module, action, scope: 'all' },
    });
    permissionByCode.set(storedCode, permission.id);
  }

  // ── Roles + grants ───────────────────────────────────────────────
  for (const roleSeed of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleSeed.name },
      update: {},
      create: { name: roleSeed.name, isSystem: true },
    });

    const codes = roleSeed.grants.includes('ALL')
      ? ALL_PERMISSION_CODES.map((c) => `${c}:all`)
      : roleSeed.grants.map((g) => `${g}:all`);

    const permissionIds = codes
      .map((c) => permissionByCode.get(c))
      .filter((id): id is string => id !== undefined);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  // ── Admin user ───────────────────────────────────────────────────
  const adminRole = await prisma.role.findUnique({ where: { name: 'System Administrator' } });
  if (!adminRole) throw new Error('Seed failed: System Administrator role not found');
  // Retire the legacy email-based admin account if it exists.
  await prisma.user.deleteMany({ where: { email: 'admin@oyaya.local' } });
  await prisma.user.upsert({
    where: { email: 'admin' },
    update: { passwordHash: hashSync('admin', 10) },
    create: {
      email: 'admin',
      passwordHash: hashSync('admin', 10),
      name: 'System Administrator',
      roleId: adminRole.id,
      companyId: company.id,
    },
  });

  // ── Module 19: Module toggles (all 21 modules) ────────────────────
  const MODULE_TOGGLES = [
    { moduleKey: 'master', name: 'Master Data Management', description: 'Company info, users, roles, products, suppliers, customers', enabled: true },
    { moduleKey: 'procurement', name: 'Procurement & Vendor Management', description: 'Wheat intake, quality gate, vendor payables', enabled: true },
    { moduleKey: 'storage', name: 'Storage & Conditioning', description: 'Dry storage pool and wet conditioning tanks', enabled: true },
    { moduleKey: 'production', name: 'Production & Blending', description: 'Batches, shifts, washing, output tracking', enabled: true },
    { moduleKey: 'qc', name: 'Quality Control', description: 'Lab checks, thresholds, approvals', enabled: true },
    { moduleKey: 'capa', name: 'Nonconformity & CAPA', description: 'Corrective actions and dual sign-off', enabled: true },
    { moduleKey: 'hygiene', name: 'Sanitation & Hygiene', description: 'Equipment and area cleaning checklists', enabled: true },
    { moduleKey: 'pest', name: 'Pest & Termite Control', description: 'Inspections, treatments, alerts', enabled: true },
    { moduleKey: 'maintenance', name: 'Maintenance & Spare Parts', description: 'Machine checklists and spare parts', enabled: true },
    { moduleKey: 'fg', name: 'Finished Goods', description: 'Multi-grade inventory and packaging', enabled: true },
    { moduleKey: 'warehouse', name: 'Warehouse Management', description: 'Stock movements and transfers', enabled: true },
    { moduleKey: 'traceability', name: 'Traceability', description: 'Farm-to-bag genealogy lookup', enabled: true },
    { moduleKey: 'sales', name: 'Sales & Distribution', description: 'Orders, dispatch, invoices, receipts', enabled: true },
    { moduleKey: 'finance', name: 'Finance & Accounting', description: 'GL, payables, receivables, reports', enabled: true },
    { moduleKey: 'payroll', name: 'HR & Payroll', description: 'Employees, piece-rate, driver trips, payroll runs', enabled: true },
    { moduleKey: 'fleet', name: 'Fleet & Logistics', description: 'Vehicle registry and trip tracking', enabled: true },
    { moduleKey: 'dashboard', name: 'Dashboards & Reporting', description: 'KPI cockpits and custom reports', enabled: true },
    { moduleKey: 'settings', name: 'System Settings & Governance', description: 'RBAC, users, audit log, MFA', enabled: true },
    { moduleKey: 'apimonitor', name: 'API Management & Monitoring', description: 'Integration health and status', enabled: true },
    { moduleKey: 'support', name: 'Support & Documentation', description: 'Helpdesk tickets and SOP library', enabled: true },
  ];
  for (const m of MODULE_TOGGLES) {
    await prisma.moduleToggle.upsert({
      where: { moduleKey: m.moduleKey },
      update: { name: m.name, description: m.description },
      create: m,
    });
  }

  // ── Module 20: API integrations ──────────────────────────────────
  const API_INTEGRATIONS = [
    { name: 'AfroMessage SMS Gateway', type: 'sms', baseUrl: 'https://api.afromessage.com', enabled: true },
    { name: 'ZKTeco Biometric ADMS', type: 'biometric', baseUrl: null, enabled: true },
  ];
  for (const a of API_INTEGRATIONS) {
    await prisma.apiIntegration.upsert({
      where: { id: `seed-${a.type}` },
      update: { name: a.name, baseUrl: a.baseUrl },
      create: { id: `seed-${a.type}`, name: a.name, type: a.type, baseUrl: a.baseUrl, enabled: a.enabled },
    });
  }

  // ── Module 21: Starter documentation ─────────────────────────────
  const DOCS = [
    {
      slug: 'getting-started',
      title: 'Getting Started with Oyaya ERP',
      module: null, role: null, sortOrder: 0,
      content: '# Getting Started\n\nWelcome to the Oyaya Flour Factory ERP system.\n\n## Sign In\nUse the username and password provided by your administrator.\n\n## Navigation\nUse the sidebar to access modules. Your visible modules depend on your role.\n\n## Offline Mode\nThe app works offline. Entries you create while offline are queued and synced automatically when connectivity returns.',
    },
    {
      slug: 'procurement-sop',
      title: 'Wheat Intake SOP',
      module: 'procurement', role: null, sortOrder: 10,
      content: '# Wheat Intake Standard Operating Procedure\n\n## Steps\n1. Record truck plate number, supplier, and wheat category.\n2. Count bags (1 bag = 1 quintal).\n3. Take a lab sample and record gluten, moisture, impurity, hectoliter weight, and germination.\n4. The Quality Head reviews flagged intakes and issues the final Accept/Reject decision.\n5. On acceptance, an Accounts Payable entry is generated automatically.',
    },
    {
      slug: 'production-sop',
      title: 'Production Batch SOP',
      module: 'production', role: null, sortOrder: 20,
      content: '# Production Batch SOP\n\n## Steps\n1. Define the batch ID and target product before milling.\n2. Enter the wheat blend ratio (soft / hard / foreign percentages).\n3. Log shift start/end times and any downtime with reasons.\n4. Record output quantities per product grade each shift.\n5. The system computes extraction rate and flags Duket output below 78%.',
    },
    {
      slug: 'qc-sop',
      title: 'Quality Control SOP',
      module: 'qc', role: null, sortOrder: 30,
      content: '# Quality Control SOP\n\n## In-Process Checks\nLab technicians perform flour quality checks every 2 hours during active shifts.\n\n## Parameters\nImpurity, wheat moisture (before/after conditioning), flour moisture, wet/dry gluten, elasticity, ash, color, granulation.\n\n## Approval Gate\nBatches require quality approval before entering finished-goods inventory.',
    },
  ];
  for (const d of DOCS) {
    await prisma.docArticle.upsert({
      where: { slug: d.slug },
      update: { title: d.title, content: d.content },
      create: d,
    });
  }

  // ── QC thresholds ────────────────────────────────────────────────
  for (const t of QC_THRESHOLDS) {
    await prisma.qcThreshold.upsert({
      where: { code: t.code },
      update: {},
      create: {
        code: t.code,
        category: t.category,
        param: t.param,
        minValue: t.minValue,
        maxValue: t.maxValue,
      },
    });
  }

  // ── Storage locations ────────────────────────────────────────────
  for (const s of STORAGE_LOCATIONS) {
    await prisma.storageLocation.upsert({
      where: { code: s.code },
      update: {},
      create: { code: s.code, name: s.name, kind: s.kind, capacityQ: s.capacityQ },
    });
  }

  // ── Products ─────────────────────────────────────────────────────
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { name: p.name },
      update: {},
      create: { name: p.name, kind: p.kind, uom: 'quintal' },
    });
  }

  // ── Packaging sizes ──────────────────────────────────────────────
  for (const ps of PACKAGING_SIZES) {
    await prisma.packagingSize.upsert({
      where: { label: ps.label },
      update: {},
      create: { label: ps.label, kg: ps.kg },
    });
  }

  // ── Piece-rate config ────────────────────────────────────────────
  for (const pr of PIECE_RATES) {
    await prisma.pieceRateConfig.upsert({
      where: { stage: pr.stage },
      update: {},
      create: { stage: pr.stage, rateBirrPerQ: pr.rateBirrPerQ },
    });
  }

  // ── Driver trip rate ─────────────────────────────────────────────
  const existingTripRate = await prisma.driverTripRate.findFirst({ where: { isActive: true } });
  if (!existingTripRate) {
    await prisma.driverTripRate.create({ data: { rateBirrPerTrip: 500 } });
  }

  // ── Chart of accounts ────────────────────────────────────────────
  for (const a of CHART_OF_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: { code: a.code },
      update: {},
      create: { code: a.code, name: a.name, type: a.type },
    });
  }

  // ── Summary ──────────────────────────────────────────────────────
  const counts = {
    companies: await prisma.company.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    users: await prisma.user.count(),
    qcThresholds: await prisma.qcThreshold.count(),
    storageLocations: await prisma.storageLocation.count(),
    products: await prisma.product.count(),
    packagingSizes: await prisma.packagingSize.count(),
    pieceRateConfigs: await prisma.pieceRateConfig.count(),
    driverTripRates: await prisma.driverTripRate.count(),
    chartOfAccounts: await prisma.chartOfAccount.count(),
  };
  console.log('Oyaya ERP seed complete:', JSON.stringify(counts));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
