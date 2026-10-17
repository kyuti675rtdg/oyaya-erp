import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  /** Render a cell. Defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  /** Use tabular numerals (JetBrains Mono) for numeric columns. */
  mono?: boolean;
  className?: string;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  keyOf,
  emptyTitle = 'No records found',
  emptySub,
  onRowClick
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf?: (row: T, index: number) => string;
  emptyTitle?: string;
  emptySub?: string;
  /** Optional: makes rows clickable (adds pointer cursor + click handler). */
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line dark:border-slate-600 bg-alabaster dark:bg-slate-800/60 px-6 py-10 text-center">
        <p className="font-semibold text-slate-700 dark:text-slate-200">{emptyTitle}</p>
        {emptySub ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{emptySub}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid-table overflow-x-auto rounded-xl border border-line bg-white dark:bg-slate-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf ? keyOf(row, i) : (row.id ?? String(i))}
              className={`border-t border-line hover:bg-alabaster ${
                onRowClick ? 'cursor-pointer' : ''
              }`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 align-middle ${c.mono ? 'tnum' : ''} ${c.className ?? ''}`}
                >
                  {c.render
                    ? c.render(row)
                    : String((row as Record<string, unknown>)[c.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
