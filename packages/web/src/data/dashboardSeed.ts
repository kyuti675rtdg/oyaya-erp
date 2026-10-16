/**
 * dashboardSeed.ts — Realistic fallback dataset for the Executive Dashboard.
 *
 * Every widget on the dashboard tries the live backend API first. When the API
 * is unreachable, errors, or returns no data (e.g. a fresh database), the
 * dashboard renders this seed so the layout is never blank. Any widget
 * displaying seed data carries a subtle "Demo data" badge.
 */

export const SEED_KPIS = {
  wheat: { value: 1250, unit: 'Qt', trendPct: 12 },
  flour: { value: 980, unit: 'Qt', trendPct: 8 },
  stock: { value: 5420, unit: 'Qt', trendPct: 6 },
  batches: { value: 3, unit: 'Batches', trendPct: 0 },
  quality: { value: 98.5, unit: '%', trendPct: 2 }
};

export const SEED_PRODUCTION_CHART = {
  labels: ['Apr 6', 'Apr 7', 'Apr 8', 'Apr 9', 'Apr 10', 'Apr 11', 'Apr 12'],
  wheatReceived: [780, 920, 990, 930, 1120, 1060, 1250],
  flourProduced: [600, 640, 740, 690, 880, 820, 980]
};

export const SEED_PRODUCT_OUTPUT = [
  { name: 'Duket (Normal)', value: 420, pct: 42.9, color: '#7C3AED' },
  { name: 'Duket (Special)', value: 180, pct: 18.4, color: '#3B82F6' },
  { name: 'Furishka', value: 160, pct: 16.3, color: '#10B981' },
  { name: 'Fino', value: 140, pct: 14.3, color: '#F59E0B' },
  { name: 'Fernacho', value: 80, pct: 8.2, color: '#14B8A6' }
];
export const SEED_TOTAL_FLOUR = 980;

export const SEED_STOCK_LEVELS = [
  { label: 'Dry Storage', balance: 5420, capacity: 7000, color: '#7C3AED', tile: 'bg-violet-100 text-violet-600' },
  { label: 'Tank A (Wet)', balance: 120, capacity: 180, color: '#3B82F6', tile: 'bg-blue-100 text-blue-600' },
  { label: 'Tank B (Wet)', balance: 85, capacity: 120, color: '#10B981', tile: 'bg-teal-100 text-teal-600' },
  { label: 'Tank C (Wet)', balance: 140, capacity: 160, color: '#F59E0B', tile: 'bg-amber-100 text-amber-600' }
];

export interface SeedIntake {
  date: string;
  supplier: string;
  wheatType: string;
  qty: number;
  status: 'Received' | 'Pending';
}

export const SEED_PROCUREMENT: SeedIntake[] = [
  { date: 'Apr 12, 2025', supplier: 'Debre Berhan Farmers', wheatType: 'Soft', qty: 400, status: 'Received' },
  { date: 'Apr 11, 2025', supplier: 'Alemu Trading PLC', wheatType: 'Hard', qty: 350, status: 'Received' },
  { date: 'Apr 10, 2025', supplier: 'Selam Agricultural Coop', wheatType: 'Foreign', qty: 300, status: 'Received' },
  { date: 'Apr 09, 2025', supplier: 'Addis Grain Traders', wheatType: 'Soft', qty: 250, status: 'Received' },
  { date: 'Apr 08, 2025', supplier: 'Girma Farmers Group', wheatType: 'Hard', qty: 200, status: 'Pending' }
];

export interface SeedActivity {
  title: string;
  sub: string;
  time: string;
  icon: 'truck' | 'check' | 'factory' | 'card' | 'tank';
}

export const SEED_ACTIVITIES: SeedActivity[] = [
  { title: 'New wheat delivery received', sub: 'Supplier: Debre Berhan Farmers', time: '10:15 AM', icon: 'truck' },
  { title: 'Quality test passed', sub: 'Batch: WB-2025-1045', time: '09:42 AM', icon: 'check' },
  { title: 'Production batch completed', sub: 'Batch: PB-2025-0087', time: '08:30 AM', icon: 'factory' },
  { title: 'Payment voucher generated', sub: 'Supplier: Alemu Trading PLC', time: 'Yesterday', icon: 'card' },
  { title: 'Tank B filled', sub: 'Batch: WB-2025-1045', time: 'Yesterday', icon: 'tank' }
];

export const SEED_PERFORMANCE = {
  totalProduction: { value: 28450, unit: 'Qt', trendPct: 12 },
  extractionRate: { value: 82.4, unit: '%', trendPct: 3 },
  duketYield: { value: 78.6, unit: '%', trendPct: 2 },
  downtime: { value: 4.2, unit: '%', trendPct: -1, invert: true }
};

export interface SeedQualityPoint {
  label: string;
  gluten: number;
  moisture: number;
  impurity: number;
  hectoliter: number;
}

export const SEED_QUALITY_TREND: SeedQualityPoint[] = [
  { label: 'Apr 6', gluten: 28, moisture: 72, impurity: 18, hectoliter: 12 },
  { label: 'Apr 7', gluten: 30, moisture: 68, impurity: 20, hectoliter: 14 },
  { label: 'Apr 8', gluten: 29, moisture: 70, impurity: 17, hectoliter: 13 },
  { label: 'Apr 9', gluten: 31, moisture: 66, impurity: 19, hectoliter: 15 },
  { label: 'Apr 10', gluten: 30, moisture: 69, impurity: 16, hectoliter: 14 },
  { label: 'Apr 11', gluten: 32, moisture: 67, impurity: 18, hectoliter: 16 },
  { label: 'Apr 12', gluten: 31, moisture: 65, impurity: 17, hectoliter: 15 }
];

export const SEED_PRODUCT_LINES = [
  { name: 'Duket (Normal & Special)', packaging: '50kg • 25kg • 10kg • 5kg', stock: 600, tone: 'violet' },
  { name: 'Furishka (Silage)', packaging: '50kg • 25kg', stock: 160, tone: 'emerald' },
  { name: 'Fino & Fernacho (Feed)', packaging: '50kg • 25kg', stock: 220, tone: 'amber' }
] as const;
