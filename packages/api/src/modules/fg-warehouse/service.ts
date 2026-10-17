import { Prisma } from '@prisma/client';

export const MS_PER_DAY = 86400000;
export const BYPRODUCT_MIN_Q = 50; // quintals — low-stock alert threshold
export const BYPRODUCT_STALE_DAYS = 30; // bran/shorts older than this is stale

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export function agingDays(receivedAt: Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - receivedAt.getTime()) / MS_PER_DAY));
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** Auto-compute quintals from bags × bag weight (kg). */
export function bagsToQuintals(
  bags: number,
  bagKg: Prisma.Decimal | number | string,
): Prisma.Decimal {
  return new Prisma.Decimal(bags).mul(new Prisma.Decimal(String(bagKg))).div(100);
}

/** Expiry = production date + shelf life days (date-only, UTC-safe). */
export function expiryDate(productionDate: Date, shelfLifeDays: number): Date {
  const d = new Date(productionDate);
  d.setUTCDate(d.getUTCDate() + shelfLifeDays);
  return d;
}

export interface GradeSpec {
  moistureMax: Prisma.Decimal | number | string;
  wetGlutenMin: Prisma.Decimal | number | string;
  wetGlutenMax: Prisma.Decimal | number | string;
  ashMax: Prisma.Decimal | number | string;
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

/** Evaluate one QC lab check against a flour grade spec. */
export function evaluateLabCheckAgainstGrade(
  spec: GradeSpec,
  check: { flourMoisturePct?: unknown; wetGlutenPct?: unknown; ashPct?: unknown },
): GradeParamCheck[] {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const rows: GradeParamCheck[] = [
    {
      param: 'moisture',
      label: 'Flour moisture',
      value: num(check.flourMoisturePct),
      min: null,
      max: Number(spec.moistureMax),
      unit: '%',
      pass: false,
    },
    {
      param: 'wetGluten',
      label: 'Wet gluten',
      value: num(check.wetGlutenPct),
      min: Number(spec.wetGlutenMin),
      max: Number(spec.wetGlutenMax),
      unit: '%',
      pass: false,
    },
    {
      param: 'ash',
      label: 'Ash',
      value: num(check.ashPct),
      min: null,
      max: Number(spec.ashMax),
      unit: '%',
      pass: false,
    },
  ];
  for (const r of rows) {
    if (r.value === null) {
      r.pass = false;
      continue;
    }
    r.pass =
      (r.min === null || r.value >= r.min) && (r.max === null || r.value <= r.max);
  }
  return rows;
}

export function byproductLabel(type: string): string {
  const t = String(type).toUpperCase();
  if (t === 'BRAN') return 'Bran';
  if (t === 'SHORTS') return 'Shorts / Middlings';
  return type;
}

// ─── Module 10 model accessors ─────────────────────────────────────────────
// The new models (FlourGrade, LabelPrint, ByproductStock, ByproductMovement,
// FgStockAdjustment) live in /tmp/schema-module10.prisma and reach the
// generated Prisma client when the coordinator merges the schema. Until then
// (and to keep `tsc --noEmit` green), access them through these delegates
// instead of `prisma.<model>`. Runtime behavior is identical post-merge.

export interface M10Delegate {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  createMany(args: unknown): Promise<{ count: number }>;
  update(args: unknown): Promise<Record<string, unknown>>;
  upsert(args: unknown): Promise<Record<string, unknown>>;
  delete(args: unknown): Promise<Record<string, unknown>>;
  count(args?: unknown): Promise<number>;
}

export type M10ModelName =
  | 'flourGrade'
  | 'labelPrint'
  | 'byproductStock'
  | 'byproductMovement'
  | 'fgStockAdjustment';

export function m10(tx: unknown, name: M10ModelName): M10Delegate {
  const holder = tx as unknown as Record<string, M10Delegate>;
  const d = holder[name];
  if (!d) throw new Error(`Prisma delegate '${name}' is not available — merge /tmp/schema-module10.prisma and regenerate the client.`);
  return d;
}

// ─── PackagingRun line-ops delegate ─────────────────────────────────────────
// The line/operator/startedAt/endedAt fields are added to PackagingRun by the
// Module 10 migration (/tmp/migration-module10.sql). Until the coordinator
// regenerates the client, read/write them through this loosely-typed delegate.

export interface PackagingRunRow {
  id: string;
  batchId: string;
  productId: string;
  packagingSizeId: string;
  bags: number;
  quintals: unknown;
  productionDate: Date | string;
  packedAt: Date | string;
  packedById: string | null;
  line: string | null;
  operator: string | null;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
}

export interface PackagingRunWideDelegate {
  create(args: unknown): Promise<PackagingRunRow>;
  update(args: unknown): Promise<PackagingRunRow>;
  findMany(args: unknown): Promise<PackagingRunRow[]>;
}

export function packagingRunWide(tx: unknown): PackagingRunWideDelegate {
  return (tx as unknown as { packagingRun: PackagingRunWideDelegate }).packagingRun;
}
