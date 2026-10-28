import type { Snapshot } from './types.ts';
import type { ImportCell, ImportSheet } from './import.ts';

interface SpreadsheetCell { v?: unknown; w?: string; f?: string; t?: string; z?: string }
interface Worksheet { [address: string]: SpreadsheetCell | string | unknown }
interface Workbook { SheetNames: string[]; Sheets: Record<string, Worksheet> }
interface SheetJS {
  read(data: ArrayBuffer, options: Record<string, unknown>): Workbook;
  writeFile(workbook: Workbook, filename: string): void;
  SSF: { is_date(format: string): boolean };
  utils: {
    decode_range(range: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(cell: { r: number; c: number }): string;
    json_to_sheet(rows: Record<string, unknown>[]): Worksheet;
    aoa_to_sheet(rows: unknown[][]): Worksheet;
    book_new(): Workbook;
    book_append_sheet(workbook: Workbook, worksheet: Worksheet, name: string): void;
  };
}
declare global { interface Window { XLSX?: SheetJS } }
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function getSheetJS(): SheetJS {
  if (typeof window === 'undefined' || !window.XLSX) throw new Error('Excel support is still loading. Please try again in a moment.');
  return window.XLSX;
}

export async function readSpreadsheet(file: File): Promise<ImportSheet[]> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Choose an .xlsx, .xls, or .csv file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds 10 MB. Save a smaller workbook and try again.');
  if (file.size === 0) throw new Error('This file is empty.');
  const xlsx = getSheetJS();
  let workbook: Workbook;
  try {
    workbook = xlsx.read(await file.arrayBuffer(), { raw: true, cellFormula: true, cellHTML: false, cellNF: true, cellDates: true, sheetRows: 10001 });
  } catch {
    throw new Error('Unable to read this workbook. Make sure it is a valid spreadsheet and remove password protection before importing.');
  }
  if (!workbook.SheetNames.length) throw new Error('No worksheets were found in this file.');
  return workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const fullRef = worksheet?.['!fullref'] ?? worksheet?.['!ref'];
    if (typeof fullRef !== 'string') return { name, rows: [] };
    const range = xlsx.utils.decode_range(fullRef);
    if (range.e.r >= 10000) return { name, rows: [], error: 'This worksheet exceeds 10,000 rows. Split it into smaller files.' };
    if ((range.e.r + 1) * (range.e.c + 1) > 500000) return { name, rows: [], error: 'This worksheet is too wide. Remove unused columns and try again.' };
    const rows: ImportCell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const cells: ImportCell[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = worksheet[xlsx.utils.encode_cell({ r, c })] as SpreadsheetCell | undefined;
        cells.push({
          value: cell?.v ?? null, formatted: cell?.w, formula: cell?.f,
          error: cell?.t === 'e' ? cell.w ?? 'Invalid cell' : undefined,
          isDate: cell?.t === 'd' || (cell?.z ? xlsx.SSF.is_date(cell.z) : false), format: cell?.z,
        });
      }
      rows.push(cells);
    }
    return { name, rows };
  });
}

export function createExportSheets(snapshot: Snapshot, monthId: string) {
  const month = snapshot.months.find(month => month.id === monthId);
  if (!month) throw new Error('The selected month is no longer available.');
  const records: Record<string, unknown>[] = [];
  let totalCents = 0;
  let paidCents = 0;
  month.properties.forEach(property => {
    const paid = property.payments.reduce((sum, payment) => sum + (payment.amountCents ?? 0), 0);
    totalCents += property.totalCents;
    paidCents += paid;
    const base = { Month: month.label, Property: property.name, Manager: property.manager, Total: property.totalCents / 100, 'Accounts receivable': (property.totalCents - paid) / 100 };
    let airbnbIndex = 0;
    if (!property.payments.length) records.push({ ...base, 'Payment type': '', 'Payment amount': null, 'Payout date': '', 'Bundled payment': null, 'Bank date': '', 'Bank amount': null, 'Verified by Daisy': false });
    property.payments.forEach(payment => {
      const label = payment.type === 'Airbnb' ? `Airbnb ${++airbnbIndex}` : payment.type;
      records.push({ ...base, 'Payment type': label, 'Payment amount': payment.amountCents === null ? null : payment.amountCents / 100, 'Payout date': payment.payoutDate, 'Bundled payment': payment.bundleCents === null ? null : payment.bundleCents / 100, 'Bank date': payment.bankDate, 'Bank amount': payment.bankCents === null ? null : payment.bankCents / 100, 'Verified by Daisy': payment.verifiedByDaisy });
    });
  });
  const summary: unknown[][] = [
    ['Castle Monthly AR', month.label], ['Properties', month.properties.length],
    ['Total expected', totalCents / 100], ['Payments recorded', paidCents / 100],
    ['Accounts receivable', (totalCents - paidCents) / 100], ['Snapshot updated', snapshot.updatedAt],
    ['Source spreadsheet', snapshot.spreadsheetUrl],
    ['Note', 'Amounts use the source spreadsheet’s currency. Property totals repeat in the detail rows; use this summary for portfolio totals.'],
  ];
  return { month, records, summary };
}

export function exportWorkbook(snapshot: Snapshot, monthId: string): void {
  const xlsx = getSheetJS();
  const { month, records, summary } = createExportSheets(snapshot, monthId);
  const workbook = xlsx.utils.book_new();
  const details = xlsx.utils.json_to_sheet(records);
  const summarySheet = xlsx.utils.aoa_to_sheet(summary);
  details['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 85 }];
  for (const [address, cell] of Object.entries(details)) {
    if (!address.startsWith('!') && typeof cell === 'object' && cell !== null && 't' in cell && cell.t === 'n') (cell as SpreadsheetCell).z = '#,##0.00;[Red](#,##0.00)';
  }
  for (const row of [3, 4, 5]) {
    const cell = summarySheet[`B${row}`] as SpreadsheetCell | undefined;
    if (cell) cell.z = '#,##0.00;[Red](#,##0.00)';
  }
  xlsx.utils.book_append_sheet(workbook, details, 'Payments');
  xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  xlsx.writeFile(workbook, `Castle-AR-${month.month.replace(/[^a-zA-Z0-9-]/g, '-')}.xlsx`);
}
