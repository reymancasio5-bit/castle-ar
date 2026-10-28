import { parseMoney } from './domain.ts';
import type { Change, Month, Property } from './types.ts';

export interface ImportCell { value: unknown; formatted?: string; formula?: string; error?: string; isDate?: boolean; format?: string }
export interface ImportSheet { name: string; rows: ImportCell[][]; error?: string }
export type ImportDestination = 'total' | 'Airbnb1' | 'Airbnb2' | 'Airbnb3' | 'Vrbo' | 'Owner';
export interface ImportOptions { headerRow: number | null; nameColumn: number; amountColumn: number; destination: ImportDestination; sumDuplicates: boolean }
export interface PreviewRow {
  sourceRow: number; name: string; originalAmount: string; propertyName?: string; propertyId?: string;
  currentCents?: number | null; amountCents?: number; proposedCents?: number; status: 'ready' | 'skipped' | 'unmatched' | 'invalid'; reason: string;
}
export interface ImportPreview { rows: PreviewRow[]; changes: Change[]; readyCount: number; skippedCount: number; invalidCount: number; unmatchedCount: number }
export const MAX_IMPORT_ROWS = 10000;
const MAX_IMPORT_CHANGES = 500;
export const destinations: { value: ImportDestination; label: string }[] = [
  { value: 'total', label: 'Total expected' }, { value: 'Airbnb1', label: 'Airbnb · payment 1' },
  { value: 'Airbnb2', label: 'Airbnb · payment 2' }, { value: 'Airbnb3', label: 'Airbnb · payment 3' },
  { value: 'Vrbo', label: 'Vrbo payment' }, { value: 'Owner', label: 'Owner payment' },
];
export const normalizePropertyName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const asText = (value: unknown) => value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
const isBlank = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '');
const isTotal = (name: string) => /^(?:grand\s+total|sub\s*total|total|totals|accounts?\s+receivable|balance\s+forward)\s*:?$/i.test(name.trim());

function paymentFor(property: Property, destination: ImportDestination) {
  if (destination === 'total') return undefined;
  if (destination.startsWith('Airbnb')) return property.payments.filter(payment => payment.type === 'Airbnb')[Number(destination.slice(-1)) - 1];
  return property.payments.find(payment => payment.type === destination);
}

export function inferColumns(sheet: ImportSheet): Pick<ImportOptions, 'headerRow' | 'nameColumn' | 'amountColumn'> {
  const nameHeader = /^(?:property(?:\s+name)?|villa(?:\s+name)?|customer(?:\s+name)?|account(?:\s+name)?|name|listing(?:\s+name)?)$/i;
  const amountHeader = /^(?:amount|balance|total(?:\s+(?:expected|amount|due))?|outstanding(?:\s+(?:amount|balance))?|accounts?\s+receivable|ar|payment(?:\s+amount)?)$/i;
  let fallback = { headerRow: 0, nameColumn: 0, amountColumn: 1 };
  for (let row = 0; row < Math.min(sheet.rows.length, 30); row++) {
    const values = sheet.rows[row].map(cell => asText(cell.value).trim());
    const nameColumn = values.findIndex(value => nameHeader.test(value));
    const amountColumn = values.findIndex(value => amountHeader.test(value));
    if (nameColumn >= 0) {
      fallback = { headerRow: row, nameColumn, amountColumn: amountColumn >= 0 ? amountColumn : nameColumn === 0 ? 1 : 0 };
      if (amountColumn >= 0) return fallback;
    }
  }
  return fallback;
}

export function buildImportPreview(month: Month, sheet: ImportSheet, options: ImportOptions): ImportPreview {
  if (sheet.error) throw new Error(sheet.error);
  if (sheet.rows.length > MAX_IMPORT_ROWS) throw new Error('This worksheet exceeds 10,000 rows. Split it into smaller files.');
  if (options.nameColumn === options.amountColumn) throw new Error('Choose different columns for the property name and amount.');
  if (!Number.isInteger(options.nameColumn) || !Number.isInteger(options.amountColumn) || options.nameColumn < 0 || options.amountColumn < 0) throw new Error('Choose a property column and an amount column.');
  if (options.headerRow !== null && (!Number.isInteger(options.headerRow) || options.headerRow < 0 || options.headerRow >= sheet.rows.length)) throw new Error('Choose a header row within this worksheet.');
  if (!destinations.some(destination => destination.value === options.destination)) throw new Error('Choose a supported destination.');
  const byName = new Map<string, Property[]>();
  month.properties.forEach(property => {
    const key = normalizePropertyName(property.name);
    byName.set(key, [...(byName.get(key) ?? []), property]);
  });
  const startRow = options.headerRow === null ? 0 : options.headerRow + 1;
  const rows: PreviewRow[] = sheet.rows.slice(startRow).map((cells, index) => {
    const nameCell = cells[options.nameColumn];
    const amountCell = cells[options.amountColumn];
    const name = asText(nameCell?.value).trim();
    const result: PreviewRow = { sourceRow: startRow + index + 1, name, originalAmount: amountCell?.formatted ?? asText(amountCell?.value), status: 'skipped', reason: 'Blank amount; existing value stays unchanged.' };
    if (isTotal(name)) return { ...result, reason: 'Summary / total row is excluded.' };
    if (isBlank(amountCell?.value) && !amountCell?.formula && !amountCell?.error) return result;
    if (!name) return { ...result, status: 'invalid', reason: 'Property name is missing.' };
    if (nameCell?.error || nameCell?.isDate) return { ...result, status: 'invalid', reason: 'Property name contains an error or date.' };
    const matches = byName.get(normalizePropertyName(name)) ?? [];
    if (!matches.length) return { ...result, status: 'unmatched', reason: 'No exact property name match in this month.' };
    if (matches.length > 1) return { ...result, status: 'invalid', reason: 'More than one property has this name. Rename it before importing.' };
    const property = matches[0];
    result.propertyId = property.id;
    result.propertyName = property.name;
    const payment = paymentFor(property, options.destination);
    result.currentCents = options.destination === 'total' ? property.totalCents : payment?.amountCents;
    if (options.destination !== 'total' && !payment) return { ...result, status: 'invalid', reason: 'This property has no payment slot for the selected destination.' };
    if (amountCell?.error) return { ...result, status: 'invalid', reason: `Spreadsheet error: ${amountCell.error}.` };
    if (amountCell?.isDate || /%/.test(amountCell?.format ?? '')) return { ...result, status: 'invalid', reason: 'Dates and percentages are not amounts.' };
    if (amountCell?.formula && (typeof amountCell.value !== 'number' || !Number.isFinite(amountCell.value))) return { ...result, status: 'invalid', reason: 'Formula has no saved numeric result. Recalculate and save the workbook first.' };
    if (typeof amountCell?.value !== 'string' && typeof amountCell?.value !== 'number') return { ...result, status: 'invalid', reason: 'Enter a numeric amount.' };
    try {
      const amountCents = parseMoney(amountCell.value);
      if (amountCents === null || !Number.isSafeInteger(amountCents)) throw new Error('Invalid amount');
      result.amountCents = amountCents;
      result.status = 'ready';
      result.reason = amountCell.formula ? 'Ready; uses the formula’s saved result.' : 'Ready to replace this amount.';
    } catch {
      result.status = 'invalid';
      result.reason = 'Invalid amount. Use 1,234.56, -123.45, or (123.45).';
    }
    return result;
  });

  const grouped = new Map<string, PreviewRow[]>();
  rows.forEach(row => {
    if (row.propertyId && row.status !== 'skipped') {
      const group = grouped.get(row.propertyId);
      if (group) group.push(row);
      else grouped.set(row.propertyId, [row]);
    }
  });
  const changes: Change[] = [];
  grouped.forEach(group => {
    if (group.length > 1 && !options.sumDuplicates) {
      group.forEach(row => { row.status = 'invalid'; row.reason = 'Duplicate property rows. Enable “Sum duplicate rows” to combine them.'; });
      return;
    }
    if (group.some(row => row.status !== 'ready')) {
      if (group.length > 1) group.forEach(row => { if (row.status === 'ready') { row.status = 'invalid'; row.reason = 'Another row for this property is invalid; a partial sum will not be imported.'; } });
      return;
    }
    const amountCents = group.reduce((total, row) => total + (row.amountCents ?? 0), 0);
    let validAmount = Number.isSafeInteger(amountCents);
    try { validAmount = validAmount && parseMoney((amountCents / 100).toFixed(2)) === amountCents; }
    catch { validAmount = false; }
    if (!validAmount) {
      group.forEach(row => { row.status = 'invalid'; row.reason = 'Combined amount is too large.'; });
      return;
    }
    if (options.destination === 'total' && amountCents < 0) {
      group.forEach(row => { row.status = 'invalid'; row.reason = 'Total expected cannot be negative. Correct the amount or choose a payment destination for a refund.'; });
      return;
    }
    group.forEach(row => { row.proposedCents = amountCents; });
    if (group.length > 1) group.forEach(row => { row.reason = `Ready; ${group.length} rows will be summed into one amount.`; });
    const property = month.properties.find(property => property.id === group[0].propertyId)!;
    if (options.destination === 'total') changes.push({ kind: 'setTotal', propertyId: property.id, amountCents });
    else changes.push({ kind: 'updatePayment', paymentId: paymentFor(property, options.destination)!.id, fields: { amountCents } });
  });
  if (changes.length > MAX_IMPORT_CHANGES) throw new Error(`This import has ${changes.length} ready property amounts. Each import supports up to 500 changes. Split the file into batches of 500 properties or fewer and import each batch separately.`);
  return {
    rows, changes, readyCount: rows.filter(row => row.status === 'ready').length,
    skippedCount: rows.filter(row => row.status === 'skipped').length,
    invalidCount: rows.filter(row => row.status === 'invalid').length,
    unmatchedCount: rows.filter(row => row.status === 'unmatched').length,
  };
}
