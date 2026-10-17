import { CheckCircle2, XCircle } from 'lucide-react';
import { Field, NumberInput } from './ui';
import { paramBreached } from '../lib/intakeThresholds';
import type { IntakeThreshold } from '../lib/intakeThresholds';

/**
 * Lab parameter input with a live PASS/FAIL indicator:
 * green check while the typed reading is within spec, red X when it breaches.
 */
export function LabParamField({
  threshold,
  value,
  onChange,
  disabled
}: {
  threshold: IntakeThreshold;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const num = value.trim() === '' ? NaN : Number(value);
  const entered = Number.isFinite(num);
  const breached = entered && paramBreached(threshold, num);

  const shell = !entered
    ? 'border-slate-200 bg-white'
    : breached
      ? 'border-rose-200 bg-rose-50/70'
      : 'border-emerald-200 bg-emerald-50/70';

  return (
    <div className={`rounded-xl border p-3 transition-colors ${shell}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`${threshold.label} (${threshold.unit.trim()})`} hint={threshold.hint}>
            <NumberInput
              value={value}
              onChange={(e) => onChange(e.target.value)}
              step="0.01"
              min={0}
              placeholder="0.00"
              disabled={disabled}
              aria-label={threshold.label}
            />
          </Field>
        </div>
        <span className="mt-6 shrink-0" aria-live="polite">
          {entered ? (
            breached ? (
              <XCircle size={22} className="text-rose-500" aria-label={`${threshold.label}: out of spec`} />
            ) : (
              <CheckCircle2 size={22} className="text-emerald-500" aria-label={`${threshold.label}: within spec`} />
            )
          ) : (
            <span
              className="inline-block h-[22px] w-[22px] rounded-full border border-dashed border-slate-300"
              aria-hidden="true"
            />
          )}
        </span>
      </div>
    </div>
  );
}
