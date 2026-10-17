/**
 * Export utilities (Module 17): lightweight CSV download + print-based PDF.
 * No heavy dependencies — PDF goes through the browser's print dialog
 * (choose "Save as PDF" as the destination).
 */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download an array of row objects as CSV. Keys of the first row become the header. */
export function exportToCSV(rows: Array<Record<string, unknown>>, filename: string): void {
  const safe = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  if (rows.length === 0) {
    downloadText('No data\n', safe, 'text/csv;charset=utf-8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))
  ];
  // BOM so Excel opens Ethiopic/UTF-8 content correctly.
  downloadText(`\uFEFF${lines.join('\n')}`, safe, 'text/csv;charset=utf-8');
}

function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Open a print preview window containing a styled table and trigger the
 * browser print dialog. Use columns/rows, or row objects (keys → columns).
 */
export function exportToPDF(
  title: string,
  columns: string[],
  rows: Array<Record<string, unknown> | Array<unknown>>
): void {
  const cols =
    columns.length > 0
      ? columns
      : rows.length > 0 && !Array.isArray(rows[0])
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];
  const body = rows
    .map((r) => {
      const cells: unknown[] = Array.isArray(r) ? r : cols.map((c) => (r as Record<string, unknown>)[c]);
      return `<tr>${cells.map((c) => `<td>${escHtml(c === null || c === undefined ? '' : String(c))}</td>`).join('')}</tr>`;
    })
    .join('');
  const date = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f1f5f9; text-align: left; padding: 8px 10px; border: 1px solid #e2e8f0; font-weight: 700; }
  td { padding: 7px 10px; border: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  @media print { body { margin: 12px; } }
</style></head>
<body>
  <h1>${escHtml(title)}</h1>
  <div class="meta">Oyaya Flour Mill ERP · Business Intelligence · Generated ${escHtml(date)}</div>
  <table><thead><tr>${cols.map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
  <tbody>${body || '<tr><td colspan="' + cols.length + '">No data</td></tr>'}</tbody></table>
</body></html>`;
  const win = window.open('', '_blank', 'noopener,width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new window a moment to render before printing.
  setTimeout(() => {
    win.print();
  }, 400);
}
