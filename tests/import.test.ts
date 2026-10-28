import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { buildImportPreview, inferColumns, type ImportSheet } from '../src/import.ts';
import { createExportSheets, readSpreadsheet } from '../src/excel.ts';
import type { Month, Snapshot } from '../src/types.ts';

const month: Month = {
  id: 'm', label: 'November 2026', month: '2026-11', properties: [
    { id: 'p1', name: 'Castle View', manager: 'Sam', totalCents: 50000, payments: [
      { id: 'a1', type: 'Airbnb', amountCents: 1000, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false },
      { id: 'a2', type: 'Airbnb', amountCents: null, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false },
      { id: 'v1', type: 'Vrbo', amountCents: 500, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: true },
    ] },
    { id: 'p2', name: 'Harbor House', manager: 'Alex', totalCents: 20000, payments: [] },
  ],
};
const sheet = (rows: unknown[][]): ImportSheet => ({ name: 'Import', rows: rows.map(row => row.map(value => ({ value }))) });
const options = { headerRow: 0, nameColumn: 0, amountColumn: 1, destination: 'total' as const, sumDuplicates: false };

test('blank amounts preserve existing values while explicit zero writes zero', () => {
  const result = buildImportPreview(month, sheet([['Property', 'Amount'], ['Castle View', ''], ['Harbor House', 0]]), options);
  assert.deepEqual(result.changes, [{ kind: 'setTotal', propertyId: 'p2', amountCents: 0 }]);
  assert.equal(result.rows[0].status, 'skipped');
  assert.equal(result.rows[1].status, 'ready');
});

test('normalizes spacing and case but never guesses an unmatched name', () => {
  const result = buildImportPreview(month, sheet([['Property', 'Amount'], ['  CASTLE   View ', '$1,234.56'], ['Harbour House', 12]]), options);
  assert.deepEqual(result.changes, [{ kind: 'setTotal', propertyId: 'p1', amountCents: 123456 }]);
  assert.equal(result.rows[1].status, 'unmatched');
});

test('duplicate source rows cannot silently overwrite and explicit sum creates one change', () => {
  const input = sheet([['Property', 'Amount'], ['Castle View', 20], ['castle view', '(5.25)']]);
  const blocked = buildImportPreview(month, input, options);
  assert.equal(blocked.changes.length, 0);
  assert.ok(blocked.rows.every(row => row.status === 'invalid'));
  const summed = buildImportPreview(month, input, { ...options, sumDuplicates: true });
  assert.deepEqual(summed.changes, [{ kind: 'setTotal', propertyId: 'p1', amountCents: 1475 }]);
  assert.deepEqual(summed.rows.map(row => row.proposedCents), [1475, 1475]);
});

test('duplicate sums obey the same amount limits as individual values', () => {
  const result = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', '9999999999.99'], ['Castle View', '9999999999.99']]), { ...options, sumDuplicates: true });
  assert.equal(result.changes.length, 0);
  assert.ok(result.rows.every(row => row.status === 'invalid'));
});

test('negative totals are excluded while other valid properties remain importable', () => {
  const result = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', -10], ['Harbor House', 20]]), options);
  assert.deepEqual(result.changes, [{ kind: 'setTotal', propertyId: 'p2', amountCents: 2000 }]);
  assert.equal(result.rows[0].status, 'invalid');
  assert.match(result.rows[0].reason, /total.*negative/i);
  assert.equal(result.rows[0].proposedCents, undefined);
  assert.equal(result.readyCount, 1);
});

test('payment refunds remain valid negative amounts', () => {
  const result = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', -10]]), { ...options, destination: 'Airbnb1' });
  assert.deepEqual(result.changes, [{ kind: 'updatePayment', paymentId: 'a1', fields: { amountCents: -1000 } }]);
  assert.equal(result.rows[0].status, 'ready');
});

test('explicit duplicate summing validates the final total rather than negative source rows', () => {
  const positive = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', -10], ['Castle View', 20]]), { ...options, sumDuplicates: true });
  assert.deepEqual(positive.changes, [{ kind: 'setTotal', propertyId: 'p1', amountCents: 1000 }]);
  assert.ok(positive.rows.every(row => row.status === 'ready' && row.proposedCents === 1000));
  const negative = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', -20], ['Castle View', 10]]), { ...options, sumDuplicates: true });
  assert.equal(negative.changes.length, 0);
  assert.ok(negative.rows.every(row => row.status === 'invalid' && row.proposedCents === undefined));
});

test('500 ready changes are allowed and 501 block with a split-file instruction', () => {
  const properties = Array.from({ length: 501 }, (_, index) => ({ id: `property-${index}`, name: `Property ${index}`, manager: '', totalCents: 0, payments: [] }));
  const largeMonth: Month = { ...month, properties };
  const rows = properties.map(property => [property.name, 1]);
  assert.equal(buildImportPreview(largeMonth, sheet(rows.slice(0, 500)), { ...options, headerRow: null }).changes.length, 500);
  assert.throws(() => buildImportPreview(largeMonth, sheet(rows), { ...options, headerRow: null }), /500.*split|split.*500/i);
});

test('a malformed duplicate cannot produce a partial summed total', () => {
  const result = buildImportPreview(month, sheet([['Name', 'Amount'], ['Castle View', 20], ['Castle View', 'not an amount']]), { ...options, sumDuplicates: true });
  assert.equal(result.changes.length, 0);
  assert.ok(result.rows.every(row => row.status === 'invalid'));
});

test('header selection preserves source row numbers and column indexes', () => {
  const input = sheet([['Monthly report'], [], ['Amount', 'Property', 'Amount'], [99, 'Castle View', 123.45]]);
  const result = buildImportPreview(month, input, { ...options, headerRow: 2, nameColumn: 1, amountColumn: 2 });
  assert.equal(result.rows[0].sourceRow, 4);
  assert.equal(result.changes[0].kind, 'setTotal');
  assert.deepEqual(result.changes, [{ kind: 'setTotal', propertyId: 'p1', amountCents: 12345 }]);
});

test('no-header mode includes the first row and targets the chosen payment slot', () => {
  const result = buildImportPreview(month, sheet([['Castle View', 12.34]]), { ...options, headerRow: null, destination: 'Airbnb2' });
  assert.deepEqual(result.changes, [{ kind: 'updatePayment', paymentId: 'a2', fields: { amountCents: 1234 } }]);
  assert.equal(result.rows[0].sourceRow, 1);
});

test('totals, invalid types, spreadsheet errors and uncached formulas never become amounts', () => {
  const input = sheet([['Name', 'Amount'], ['Total', 88], ['Castle View', true], ['Harbor House', 15]]);
  input.rows[3][1] = { value: undefined, formula: 'SUM(A1:A2)' };
  const result = buildImportPreview(month, input, options);
  assert.deepEqual(result.rows.map(row => row.status), ['skipped', 'invalid', 'invalid']);
  assert.equal(result.changes.length, 0);
  const error = sheet([['Castle View', 7]]);
  error.rows[0][1] = { value: 7, error: '#DIV/0!' };
  assert.equal(buildImportPreview(month, error, { ...options, headerRow: null }).changes.length, 0);
  error.rows[0][1] = { value: 46000, isDate: true };
  assert.equal(buildImportPreview(month, error, { ...options, headerRow: null }).changes.length, 0);
});

test('ambiguous destination names and missing payment slots remain invalid', () => {
  const duplicateMonth = { ...month, properties: [...month.properties, { ...month.properties[0], id: 'p3' }] };
  assert.equal(buildImportPreview(duplicateMonth, sheet([['Castle View', 1]]), { ...options, headerRow: null }).changes.length, 0);
  const missing = buildImportPreview(month, sheet([['Castle View', 1]]), { ...options, headerRow: null, destination: 'Airbnb3' });
  assert.equal(missing.rows[0].status, 'invalid');
  assert.equal(missing.changes.length, 0);
});

test('column suggestions identify meaningful headers beyond a title row', () => {
  const input = sheet([['November report'], [], ['Balance', 'Villa Name']]);
  assert.deepEqual(inferColumns(input), { headerRow: 2, nameColumn: 1, amountColumn: 0 });
});

test('rejects oversized sheets and conflicting column mappings before preview', () => {
  assert.throws(() => buildImportPreview(month, sheet([['Castle View', 1]]), { ...options, nameColumn: 1 }), /different/i);
  const input: ImportSheet = { name: 'Big', rows: Array.from({ length: 10001 }, () => []) };
  assert.throws(() => buildImportPreview(month, input, options), /10,000/);
});

test('export produces numeric amounts, preserves zero/blank, and computes summary independently', () => {
  const snapshot: Snapshot = { revision: 'r', months: [month], updatedAt: '2026-11-01', spreadsheetUrl: 'https://example.com' };
  const result = createExportSheets(snapshot, 'm');
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].Total, 500);
  assert.equal(result.records[0]['Payment amount'], 10);
  assert.equal(result.records[1]['Payment amount'], null);
  assert.equal(result.records[0]['Accounts receivable'], 485);
  assert.deepEqual(result.summary.find(row => row[0] === 'Total expected'), ['Total expected', 700]);
  assert.deepEqual(result.summary.find(row => row[0] === 'Accounts receivable'), ['Accounts receivable', 685]);
  assert.throws(() => createExportSheets(snapshot, 'missing'), /month/i);
});

// These fixtures are written and read by the real vendored library, including its XLS codecs.
interface FixtureSheetJS {
  write(workbook: unknown, options: { type: string; bookType: string }): ArrayBuffer;
  utils: { aoa_to_sheet(rows: unknown[][]): Record<string, unknown>; book_new(): unknown; book_append_sheet(workbook: unknown, sheet: unknown, name: string): void };
}
const fixtureXlsx = runInThisContext(readFileSync(new URL('../public/vendor/xlsx.full.min.js', import.meta.url), 'utf8') + '\nXLSX;') as FixtureSheetJS;
Object.defineProperty(globalThis, 'window', { value: { XLSX: fixtureXlsx }, configurable: true });
function fixtureFile(type: 'xlsx' | 'xls', sheets: { name: string; rows: unknown[][] }[]) {
  const workbook = fixtureXlsx.utils.book_new();
  sheets.forEach(sheet => fixtureXlsx.utils.book_append_sheet(workbook, fixtureXlsx.utils.aoa_to_sheet(sheet.rows), sheet.name));
  return new File([new Uint8Array(fixtureXlsx.write(workbook, { type: 'array', bookType: type }))], `fixture.${type}`);
}

for (const type of ['xlsx', 'xls'] as const) test(`reads real ${type} files with multiple worksheets and preserves zero amounts`, async () => {
  const sheets = await readSpreadsheet(fixtureFile(type, [
    { name: 'Instructions', rows: [['Read this first']] },
    { name: 'Amounts', rows: [['Property', 'Amount'], ['Castle View', 0], ['Harbor House', 12.34]] },
  ]));
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Instructions', 'Amounts']);
  const result = buildImportPreview(month, sheets[1], options);
  assert.deepEqual(result.changes, [{ kind: 'setTotal', propertyId: 'p1', amountCents: 0 }, { kind: 'setTotal', propertyId: 'p2', amountCents: 1234 }]);
});

test('CSV keeps IDs as text and handles quoted commas and blank versus zero', async () => {
  const sheets = await readSpreadsheet(new File(['\uFEFFProperty,Amount\r\n001,"1,234.56"\r\nCastle View,\r\nHarbor House,0\r\n'], 'fixture.csv'));
  assert.equal(sheets[0].rows[1][0].value, '001');
  assert.equal(sheets[0].rows[1][1].value, '1,234.56');
  assert.deepEqual(buildImportPreview(month, sheets[0], options).changes, [{ kind: 'setTotal', propertyId: 'p2', amountCents: 0 }]);
});

test('oversized, empty and unsupported uploads fail before parsing', async () => {
  await assert.rejects(readSpreadsheet(new File([], 'empty.xlsx')), /empty/i);
  await assert.rejects(readSpreadsheet(new File(['hello'], 'image.png')), /xlsx/i);
  await assert.rejects(readSpreadsheet(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.xlsx')), /10 MB/i);
});
