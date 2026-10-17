/**
 * Module 7 (Sanitation & Hygiene Management) — shared constants and helpers
 * used by the Hygiene*.tsx pages.
 */
import type { BadgeTone } from '../components/Badge';
import type {
  AreaCleaningStatus,
  ChecklistFrequency,
  CleaningActionStatus,
  HygieneApprovalStatus,
  HygieneInspectionResult
} from '../types';

export const FACTORY_AREAS = [
  'Intake gate',
  'Dry storage',
  'Conditioning tanks',
  'Washing',
  'Milling lines',
  'Packing',
  'Finished goods warehouse',
  'Laboratory'
] as const;

export const EQUIPMENT_OPTIONS = [
  'Mill rolls',
  'Sifters',
  'Conveyors',
  'Packing machines',
  'Other'
] as const;

export const SHIFTS = ['Morning', 'Afternoon', 'Night'] as const;

/** Reusable card shell from the Dashboard spec: white, rounded, hairline border. */
export const cardShell =
  'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm';

export const FREQUENCY_LABEL: Record<ChecklistFrequency, string> = {
  PER_SHIFT: 'Per shift',
  DAILY: 'Daily',
  WEEKLY: 'Weekly'
};

export const CLEANING_STATUS_TONE: Record<AreaCleaningStatus, BadgeTone> = {
  SCHEDULED: 'neutral',
  IN_PROGRESS: 'advisory',
  DONE: 'pass'
};

export const INSPECTION_TONE: Record<HygieneInspectionResult, BadgeTone> = {
  PASS: 'pass',
  FAIL: 'critical'
};

export const ACTION_STATUS_TONE: Record<CleaningActionStatus, BadgeTone> = {
  OPEN: 'critical',
  IN_PROGRESS: 'advisory',
  VERIFIED: 'pass',
  CLOSED: 'neutral'
};

export const APPROVAL_TONE: Record<HygieneApprovalStatus, BadgeTone> = {
  PENDING: 'advisory',
  SUPERVISOR_SIGNED: 'advisory',
  APPROVED: 'pass',
  REJECTED: 'critical'
};

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isPastDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(typeof iso === 'string' && iso.length <= 10 ? `${iso}T00:00:00` : iso);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return d.getTime() < t.getTime();
}
