import { useState } from 'react';
import { Button } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'C'];

/**
 * Oversized numeric keypad for shop-floor tablet use (gloved / flour-dusted hands).
 * Appends digits to the bound value; 'C' clears, and a backspace key deletes.
 */
export function NumPad({
  value,
  onChange,
  label = 'Quantity'
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [flash, setFlash] = useState(false);

  const press = (k: string) => {
    if (k === 'C') {
      onChange('');
      return;
    }
    if (k === '.' && value.includes('.')) return;
    const next = (value + k).replace(/^0(?=\d)/, '');
    onChange(next);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  };

  const backspace = () => onChange(value.slice(0, -1));

  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div
        className={`tnum mb-3 flex min-h-[64px] items-center justify-end rounded-lg border bg-alabaster px-4 text-3xl font-bold text-ink transition-colors ${
          flash ? 'border-harvest' : 'border-line'
        }`}
        aria-live="polite"
      >
        {value === '' ? <span className="text-slate-300">0</span> : value}
      </div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="touch flex items-center justify-center rounded-lg border border-line bg-alabaster text-2xl font-bold text-ink active:bg-harvest-light"
            aria-label={k === 'C' ? 'Clear' : `Digit ${k}`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={backspace} className="text-lg">
          Backspace
        </Button>
        <Button type="button" variant="secondary" onClick={() => onChange('')} className="text-lg">
          Clear all
        </Button>
      </div>
    </div>
  );
}
