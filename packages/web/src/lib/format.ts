/** Money in Ethiopian Birr, tabular numerals. */
export function fmtBirr(n: number | string | null | undefined): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `ETB ${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** Quintals / weights with 1 decimal. */
export function fmtQ(n: number | string | null | undefined): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return safe.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtInt(n: number | string | null | undefined): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return safe.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtPct(n: number | string | null | undefined, digits = 1): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `${safe.toFixed(digits)}%`;
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function fmtDate(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Human elapsed duration, e.g. "13h 24m". */
export function fmtElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

/** Remaining countdown, e.g. "01:24:10". */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number): string => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
