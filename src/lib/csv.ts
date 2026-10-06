// CSV for spreadsheets (Excel, Numbers, Google Sheets). Values that start with
// = + - @ (or a tab/carriage return) are prefixed with an apostrophe so a
// customer name like "=HYPERLINK(...)" can't run as a formula when the owner
// opens the file (CSV/formula injection). Rows end with CRLF (RFC 4180).
export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Starts a download of `content` in the browser. */
export function downloadFile(filename: string, content: string, type: string) {
  // A byte-order mark makes Excel read UTF-8 accents (é, ñ) correctly.
  const bom = type.startsWith("text/csv") ? "﻿" : "";
  const url = URL.createObjectURL(new Blob([bom + content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
