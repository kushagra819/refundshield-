/** Client-side file download. No backend, no dependency. */
export function downloadBlob(filename: string, mime: string, contents: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadBlob(filename, 'application/json', JSON.stringify(data, null, 2));
}

/** Minimal RFC-4180 CSV writer. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  downloadBlob(filename, 'text/csv', toCsv(rows));
}
