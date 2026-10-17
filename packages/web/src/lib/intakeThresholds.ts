/**
 * Intake lab thresholds (domain constants).
 * Shared by the Intake page and the Incoming Inspection lab workspace.
 */
export type LabParamKey = 'glutenPct' | 'moisturePct' | 'impurityPct' | 'hectoliterPct' | 'germinationPct';

export interface IntakeThreshold {
  key: LabParamKey;
  label: string;
  unit: string;
  hint: string;
  /** 'min' fails when value < threshold; 'max' fails when value > threshold. */
  mode: 'min' | 'max';
  threshold: number;
}

export const INTAKE_THRESHOLDS: IntakeThreshold[] = [
  { key: 'glutenPct', label: 'Gluten', unit: '%', hint: 'Accept: ≥ 20%', mode: 'min', threshold: 20 },
  { key: 'moisturePct', label: 'Moisture', unit: '%', hint: 'Accept: ≤ 13.5%', mode: 'max', threshold: 13.5 },
  { key: 'impurityPct', label: 'Impurity', unit: '%', hint: 'Accept: ≤ 6%', mode: 'max', threshold: 6 },
  { key: 'hectoliterPct', label: 'Hectoliter weight', unit: ' kg/hl', hint: 'Accept: ≥ 74', mode: 'min', threshold: 74 },
  { key: 'germinationPct', label: 'Germination', unit: '%', hint: 'Accept: ≤ 1%', mode: 'max', threshold: 1 }
];

/** Empty string-keyed lab param state. */
export function emptyLabParams(): Record<string, string> {
  return { glutenPct: '', moisturePct: '', impurityPct: '', hectoliterPct: '', germinationPct: '' };
}

/** True when a numeric reading breaches the threshold. */
export function paramBreached(t: IntakeThreshold, value: number): boolean {
  return t.mode === 'min' ? value < t.threshold : value > t.threshold;
}

/** Thresholds breached by the given numeric readings (only finite values considered). */
export function breachesOf(values: Record<string, number>): IntakeThreshold[] {
  return INTAKE_THRESHOLDS.filter((t) => Number.isFinite(values[t.key]) && paramBreached(t, values[t.key]));
}

export type LabVerdict = 'PASS' | 'FAIL' | 'UNTESTED';

/** Overall verdict for a tested intake row; UNTESTED when any parameter is missing. */
export function intakeLabVerdict(row: Partial<Record<LabParamKey, number | string | null>>): LabVerdict {
  const values: Record<string, number> = {};
  for (const t of INTAKE_THRESHOLDS) {
    const v = Number(row[t.key]);
    if (!Number.isFinite(v)) return 'UNTESTED';
    values[t.key] = v;
  }
  return breachesOf(values).length === 0 ? 'PASS' : 'FAIL';
}
