import { parseMoney } from './domain.ts';
import { buildImportPreview, normalizePropertyName, isTotal, MAX_IMPORT_ROWS } from './import.ts';
import type { ImportCell, ImportOptions, ImportPreview, ImportSheet, PreviewRow } from './import.ts';
import type { Change, InitialPayment, Month, Payment, Property } from './types.ts';

export interface PropertyImportOptions extends ImportOptions {
  propertyName: string; manager: string; total: string; airbnbSlot: 'auto' | '1' | '2' | '3';
}
export interface PropertyPreviewRow extends PreviewRow { payoutDate?: string; bundleCents?: number; slot?: number }
export interface PropertyImportPreview extends ImportPreview { rows: PropertyPreviewRow[]; newProperty: boolean; totalCents: number; propertyName: string }
const text = (value: unknown) => value == null ? '' : String(value).trim();

function airbnbColumns(sheet: ImportSheet, headerRow: number | null) {
  const headers = headerRow === null ? [] : (sheet.rows[headerRow] ?? []).map(cell => text(cell.value).toLowerCase());
  return Object.fromEntries(['type', 'listing', 'amount', 'paid out', 'arriving by date', 'currency'].map(name => [name, headers.indexOf(name)]));
}
export function isAirbnbSheet(sheet: ImportSheet, headerRow: number | null): boolean {
  return Object.values(airbnbColumns(sheet, headerRow)).every(index => index >= 0);
}
function validName(value: string, label: string) {
  const name = value.trim();
  if (!name || name.length > 160 || /^[=+@-]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(`Enter a valid ${label} (1–160 characters, without formula markers).`);
  return name;
}
function amount(cell: ImportCell | undefined, label: string): number {
  if (!cell || cell.error || cell.isDate || /%/.test(cell.format ?? '') || (cell.formula && typeof cell.value !== 'number')) throw new Error(`${label}: enter a valid numeric amount.`);
  const cents = parseMoney(cell.value);
  if (cents === null) throw new Error(`${label}: amount is missing.`);
  return cents;
}
function payoutDate(cell: ImportCell | undefined): string {
  if (cell?.error || cell?.formula) throw new Error('Invalid payout date.');
  const raw = cell?.value instanceof Date ? cell.value.toISOString().slice(0, 10) : text(cell?.value);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : raw;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < '1900-01-01' || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error('Payout date must be a valid MM/DD/YYYY or YYYY-MM-DD date.');
  return iso;
}
const emptyPayment = (payment: Payment) => payment.amountCents === null && !payment.payoutDate && payment.bundleCents === null && !payment.bankDate && payment.bankCents === null && !payment.verifiedByDaisy;

export function buildPropertyImportPreview(month: Month, sheet: ImportSheet, options: PropertyImportOptions): PropertyImportPreview {
  if (sheet.error) throw new Error(sheet.error);
  if (sheet.rows.length > MAX_IMPORT_ROWS) throw new Error('This worksheet exceeds 10,000 rows. Split it into smaller files.');
  if (options.headerRow !== null && (!Number.isInteger(options.headerRow) || options.headerRow < 0 || options.headerRow >= sheet.rows.length)) throw new Error('Choose a valid header row.');
  const name = validName(options.propertyName, 'property name');
  const matches = month.properties.filter(property => normalizePropertyName(property.name) === normalizePropertyName(name));
  if (matches.length > 1) throw new Error('More than one database property has this name. Rename it before importing.');
  const existing = matches[0];
  const totalCents = parseMoney(options.total);
  if (totalCents === null || totalCents < 0) throw new Error('Enter a manual Total Payment of zero or more.');
  const manager = existing?.manager ?? validName(options.manager, 'property manager');
  const property: Property = existing ?? { id: 'new-import-property', name, manager, totalCents, payments: (['Airbnb', 'Airbnb', 'Airbnb', 'Vrbo', 'Owner'] as const).map((type, index) => ({ id: `new-import-payment-${index}`, type, amountCents: null, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false })) };
  let rows: PropertyPreviewRow[];
  let changes: Change[];
  if (isAirbnbSheet(sheet, options.headerRow)) {
    ({ rows, changes } = airbnbPreview(property, sheet, options));
  } else {
    const headers = airbnbColumns(sheet, options.headerRow);
    if (headers['paid out'] >= 0 || headers['arriving by date'] >= 0) throw new Error('Incomplete Airbnb headers. Keep Type, Listing, Amount, Paid out, Arriving by date and Currency in the export.');
    if (options.destination === 'total') throw new Error('Choose a payment destination. Total Payment is entered manually.');
    // Use a synthetic name column so uploaded listing names never select a database property.
    const nameColumn = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const mappedSheet = { ...sheet, rows: sheet.rows.map(row => { const cells = row.slice(); const sourceName = text(row[options.nameColumn]?.value); cells[nameColumn] = { value: isTotal(sourceName) ? sourceName : property.name }; return cells; }) };
    ({ rows, changes } = buildImportPreview({ ...month, properties: [property] }, mappedSheet, { ...options, nameColumn }));
  }
  // No property/total is saved when there are no usable payment rows.
  const usable = rows.some(row => row.status === 'ready' || row.reason === 'Already imported; unchanged.');
  if (usable && !existing) {
    const initialPayments: InitialPayment[] = changes.flatMap(change => change.kind === 'updatePayment' ? [{ index: property.payments.findIndex(payment => payment.id === change.paymentId), amountCents: change.fields.amountCents!, ...(change.fields.payoutDate !== undefined ? { payoutDate: change.fields.payoutDate } : {}), ...(change.fields.bundleCents != null ? { bundleCents: change.fields.bundleCents } : {}) }] : []);
    const additionalPayments = changes.flatMap(change => change.kind === 'appendPayments' ? change.payments : []);
    changes = [{ kind: 'addProperty', monthId: month.id, name, manager, totalCents, initialPayments, ...(additionalPayments.length ? { additionalPayments } : {}) }];
  } else if (usable && existing && existing.totalCents !== totalCents) changes.unshift({ kind: 'setTotal', propertyId: property.id, amountCents: totalCents });
  return { rows, changes, newProperty: !existing, totalCents, propertyName: property.name,
    readyCount: rows.filter(row => row.status === 'ready').length, skippedCount: rows.filter(row => row.status === 'skipped').length,
    invalidCount: rows.filter(row => row.status === 'invalid').length, unmatchedCount: rows.filter(row => row.status === 'unmatched').length };
}

function airbnbPreview(property: Property, sheet: ImportSheet, options: PropertyImportOptions): { rows: PropertyPreviewRow[]; changes: Change[] } {
  const columns = airbnbColumns(sheet, options.headerRow);
  const rows: PropertyPreviewRow[] = [];
  const groups: { payoutDate: string; bundleCents: number; currency: string; rows: PropertyPreviewRow[] }[] = [];
  let group: typeof groups[number] | undefined;
  const listings = new Set<string>();
  const currencies = new Set<string>();
  sheet.rows.slice(options.headerRow! + 1).forEach((cells, index) => {
    const sourceRow = options.headerRow! + index + 2;
    if (cells.every(cell => !text(cell.value))) return;
    const type = text(cells[columns.type]?.value).toLowerCase();
    if (type === 'payout') {
      group = { payoutDate: payoutDate(cells[columns['arriving by date']]), bundleCents: amount(cells[columns['paid out']], `Row ${sourceRow} payout bundle`), currency: text(cells[columns.currency]?.value).toUpperCase(), rows: [] };
      groups.push(group);
      rows.push({ sourceRow, name: 'Payout bundle', originalAmount: text(cells[columns['paid out']]?.value), status: 'skipped', reason: 'Bundle and arrival date are attached to the following payment; bundle is not added to collected payments.', payoutDate: group.payoutDate, bundleCents: group.bundleCents });
      return;
    }
    if (!['co-host payout', 'reservation', 'adjustment', 'resolution payout', 'resolution adjustment'].includes(type)) throw new Error(`Row ${sourceRow}: unsupported Airbnb row type “${type}”. Import a payout export with its payment details.`);
    if (!group) throw new Error(`Row ${sourceRow}: payment has no preceding Payout row.`);
    const listing = text(cells[columns.listing]?.value);
    if (!listing) throw new Error(`Row ${sourceRow}: Airbnb listing is missing.`);
    listings.add(normalizePropertyName(listing));
    if (listings.size > 1) throw new Error('This file contains multiple Airbnb listings. Export one listing at a time and select its database property.');
    const currency = text(cells[columns.currency]?.value).toUpperCase();
    if (!currency || currency !== group.currency) throw new Error(`Row ${sourceRow}: payout and payment currencies must match.`);
    currencies.add(currency);
    if (currencies.size > 1) throw new Error('Import one currency at a time.');
    const amountCents = amount(cells[columns.amount], `Row ${sourceRow} payment`);
    const row: PropertyPreviewRow = { sourceRow, name: listing, originalAmount: text(cells[columns.amount]?.value), propertyId: property.id, propertyName: property.name, amountCents, payoutDate: group.payoutDate, bundleCents: group.bundleCents, status: 'ready', reason: '' };
    group.rows.push(row); rows.push(row);
  });
  if (!groups.length || groups.some(group => !group.rows.length)) throw new Error('Every Payout row needs at least one payment detail row.');
  const payments = property.payments.filter(payment => payment.type === 'Airbnb').map(payment => ({ ...payment }));
  const changes: Change[] = [];
  let explicitSlot = options.airbnbSlot === 'auto' ? null : Number(options.airbnbSlot) - 1;
  if (explicitSlot !== null && ![0, 1, 2].includes(explicitSlot)) throw new Error('Choose a valid Airbnb payment slot.');
  for (const group of groups) {
    const amountCents = group.rows.reduce((sum, row) => sum + row.amountCents!, 0);
    if (!Number.isSafeInteger(amountCents) || Math.abs(amountCents) > 999999999999) throw new Error('Combined payment amount is too large.');
    const fields = { amountCents, payoutDate: group.payoutDate, bundleCents: group.bundleCents };
    const duplicate = payments.findIndex(payment => payment.amountCents === amountCents && payment.payoutDate === group.payoutDate && payment.bundleCents === group.bundleCents);
    let slot = explicitSlot === null ? (duplicate >= 0 ? duplicate : payments.findIndex(emptyPayment)) : explicitSlot++;
    const append = slot < 0 || !payments[slot];
    if (append) {
      slot = payments.length;
      payments.push({ id: `import-append-${slot}`, type: 'Airbnb', amountCents: null, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false });
    }
    const payment = payments[slot];
    const unchanged = payment.amountCents === amountCents && payment.payoutDate === group.payoutDate && payment.bundleCents === group.bundleCents;
    group.rows.forEach(row => { row.currentCents = payment.amountCents; row.proposedCents = amountCents; row.slot = slot + 1; row.status = unchanged ? 'skipped' : 'ready'; row.reason = unchanged ? 'Already imported; unchanged.' : `${append ? 'Append new Airbnb payment row' : 'Airbnb payment'} ${slot + 1}${group.rows.length > 1 ? `; sums ${group.rows.length} detail rows` : ''}.`; });
    if (!unchanged) {
      if (append) {
        const pending = changes.find(change => change.kind === 'appendPayments');
        if (pending?.kind === 'appendPayments') pending.payments.push(fields);
        else changes.push({ kind: 'appendPayments', propertyId: property.id, payments: [fields] });
      } else changes.push({ kind: 'updatePayment', paymentId: payment.id, fields });
      Object.assign(payment, fields);
    }
  }
  return { rows, changes };
}
