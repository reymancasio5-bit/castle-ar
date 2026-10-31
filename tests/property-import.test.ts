import test from 'node:test';
import assert from 'node:assert/strict';
import * as importer from '../src/property-import.ts';
import type { Month } from '../src/types.ts';
import type { ImportSheet } from '../src/import.ts';

const month: Month = { id: 'm', label: 'September 2026', month: '2026-09', properties: [{ id: 'p', name: 'Jarvis', manager: 'Team B', totalCents: 37048, payments: [0, 1, 2].map(i => ({ id: `a${i}`, type: 'Airbnb', amountCents: null, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false })) }] };
const sheet = (rows: unknown[][]): ImportSheet => ({ name: 'CSV', rows: rows.map(row => row.map(value => ({ value }))) });
const data = sheet([['Date', 'Arriving by date', 'Type', 'Listing', 'Currency', 'Amount', 'Paid out'], ['10/02/2026', '10/09/2026', 'Payout', '', 'CAD', '', '381.40'], ['10/02/2026', '', 'Co-Host payout', 'Airbnb listing title', 'CAD', '116.86', '']]);
const options = { headerRow: 0, nameColumn: 3, amountColumn: 5, destination: 'Airbnb1' as const, sumDuplicates: false, propertyName: 'Jarvis', manager: '', total: '370.48', airbnbSlot: 'auto' as const };

test('maps Airbnb detail amount and payout header to selected database property, keeping manual total', () => {
  const result = importer.buildPropertyImportPreview(month, data, options);
  assert.deepEqual(result.changes, [{ kind: 'updatePayment', paymentId: 'a0', fields: { amountCents: 11686, payoutDate: '2026-10-09', bundleCents: 38140 } }]);
  assert.equal(result.rows.find(row => row.status === 'ready')?.propertyName, 'Jarvis');
  const changedTotal = importer.buildPropertyImportPreview(month, data, { ...options, total: '400' });
  assert.ok(changedTotal.changes.some(c => c.kind === 'setTotal' && c.amountCents === 40000));
});

test('creates a new property with manual total and initial payment in one mutation', () => {
  const result = importer.buildPropertyImportPreview(month, data, { ...options, propertyName: 'New house', manager: 'Team C' });
  assert.deepEqual(result.changes, [{ kind: 'addProperty', monthId: 'm', name: 'New house', manager: 'Team C', totalCents: 37048, initialPayments: [{ index: 0, amountCents: 11686, payoutDate: '2026-10-09', bundleCents: 38140 }] }]);
  assert.throws(() => importer.buildPropertyImportPreview(month, data, { ...options, propertyName: 'New house' }), /manager/i);
  assert.throws(() => importer.buildPropertyImportPreview(month, data, { ...options, total: '' }), /total/i);
});

test('successive imports fill separate slots and repeat imports do not double count', () => {
  const updated = structuredClone(month);
  Object.assign(updated.properties[0].payments[0], { amountCents: 11686, payoutDate: '2026-10-09', bundleCents: 38140 });
  assert.equal(importer.buildPropertyImportPreview(updated, data, options).changes.length, 0);
  const second = structuredClone(data);
  second.rows[1][1].value = '10/13/2026'; second.rows[1][6].value = '602.17'; second.rows[2][5].value = '130.81';
  assert.deepEqual(importer.buildPropertyImportPreview(updated, second, options).changes, [{ kind: 'updatePayment', paymentId: 'a1', fields: { amountCents: 13081, payoutDate: '2026-10-13', bundleCents: 60217 } }]);
});

test('invalid dates, missing payout headers and multiple listings block Airbnb import', () => {
  const badDate = structuredClone(data); badDate.rows[1][1].value = '02/30/2026';
  assert.throws(() => importer.buildPropertyImportPreview(month, badDate, options), /date/i);
  const orphan = structuredClone(data); orphan.rows.splice(1, 1);
  assert.throws(() => importer.buildPropertyImportPreview(month, orphan, options), /payout/i);
  const mixed = structuredClone(data); mixed.rows.push(structuredClone(mixed.rows[2])); mixed.rows[3][3].value = 'Another listing';
  assert.throws(() => importer.buildPropertyImportPreview(month, mixed, options), /listing/i);
});

test('full slots block automatic import while explicit replacement is available', () => {
  const full = structuredClone(month); full.properties[0].payments.forEach(p => { p.amountCents = 100; });
  assert.throws(() => importer.buildPropertyImportPreview(full, data, options), /slot/i);
  assert.equal(importer.buildPropertyImportPreview(full, data, { ...options, airbnbSlot: '1' }).changes[0].kind, 'updatePayment');
});

test('an incomplete Airbnb header cannot silently downgrade to a plain amount import', () => {
  const malformed = structuredClone(data); malformed.rows[0][1].value = 'Missing arrival header';
  assert.throws(() => importer.buildPropertyImportPreview(month, malformed, options), /header/i);
});

test('plain spreadsheets exclude total rows when summing into a selected property', () => {
  const plain = sheet([['Property', 'Amount'], ['Source listing', 12], ['Total', 12]]);
  const result = importer.buildPropertyImportPreview(month, plain, { ...options, nameColumn: 0, amountColumn: 1, sumDuplicates: true });
  assert.deepEqual(result.changes, [{ kind: 'updatePayment', paymentId: 'a0', fields: { amountCents: 1200 } }]);
});

test('one invalid detail prevents a partial payout sum', () => {
  const bad = structuredClone(data); bad.rows.push(structuredClone(bad.rows[2])); bad.rows[3][5].value = 'invalid';
  assert.throws(() => importer.buildPropertyImportPreview(month, bad, options), /amount/i);
});

test('a single payout sums detail amounts while retaining the bundle once', () => {
  const grouped = structuredClone(data); grouped.rows.push(structuredClone(grouped.rows[2])); grouped.rows[3][5].value = '-6.86';
  assert.deepEqual(importer.buildPropertyImportPreview(month, grouped, options).changes, [{ kind: 'updatePayment', paymentId: 'a0', fields: { amountCents: 11000, payoutDate: '2026-10-09', bundleCents: 38140 } }]);
});
