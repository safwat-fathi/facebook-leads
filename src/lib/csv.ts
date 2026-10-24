// CSV export. Page names and intros come from Facebook (untrusted): a cell that starts with = + - @ (or a tab/CR) is a formula
// when the file is opened in Excel/Sheets, so such cells are prefixed with an apostrophe. Plain phone numbers are left alone.
const PHONE = /^\+\d[\d\s]{6,}$/;
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s) && !PHONE.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
export function toCsv(header: string[], data: unknown[][]): string {
  return '﻿' + [header.map(csvCell).join(','), ...data.map((r) => r.map(csvCell).join(','))].join('\n');
}
