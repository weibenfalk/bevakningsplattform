/**
 * CSV-hjälpare. En cell som börjar med =, +, - eller @ (eller tabb/radbrytning) kan tolkas som en formel
 * i Excel och Sheets, så textceller får ett inledande citattecken. Tal lämnas orörda.
 */
const FORMULA_START = ['=', '+', '-', '@', '\t', '\r'];

function cell(value: unknown): string {
  let text = String(value ?? '');
  if (typeof value === 'string' && FORMULA_START.some((c) => text.startsWith(c))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: object[], columns: string[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c])).join(','))].join('\n');
}
