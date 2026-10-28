import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Execute the production Apps Script with only its remote Google boundaries replaced.
// The fixture is deliberately a sheet-shaped data model, including source formulas.
type Cell = string | number | boolean | Date;
const header: Cell[] = ['Account Manager', 'Property Name', '', 'Amount', 'Platform Payout Time', 'Payout Bundle Amount', 'Bank Received Time', 'Bank Received Amount', 'Verify By System', 'Verify By Daisy'];
const row = (...values: Cell[]) => Array.from({ length: 10 }, (_, i) => values[i] ?? '');
function harness() {
  const data: Cell[][] = [row('AM FILTER', new Date('2026-11-01T04:00:00Z')), row('Blank'), [...header], row('TeamB', 'Mtl 404 Le Bijou', 'Total Payment', 442.04), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 442.04), [...header], row('TeamA', 'Mtl 2429 Rue Allard Unit 1', 'Total Payment', 243.38), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 243.38), [...header], row('TeamB', 'Tor Unit 918-251 Jarvis St', 'Total Payment', 370.48), row('', '', 'Airbnb Payment', 116.86), row('', '', 'Airbnb Payment', 130.81), row('', '', 'Airbnb Payment', 77.19), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 45.62)];
  const formulas = data.map(() => row());
  formulas[9][3] = '=D4-D5-D6-D7-D8-D9';
  formulas[17][3] = '=D12-SUM(D13:D17)';
  formulas[25][3] = '=D20-SUM(D21:D25)';
  const state = { data, formulas, maxRows: 30, writes: 0, locked: false, failWrite: false, failReadAfterWrite: false, hiddenRows: new Set<number>(), standardFilter: true };
  const properties = new Map<string, string>();
  const cache = new Map<string, string>();
  const sheet = {
    getName: () => 'Nov, 2026', getSheetId: () => 0, getLastRow: () => data.length, getMaxRows: () => state.maxRows,
    getFilter: () => state.standardFilter ? { remove: () => { state.standardFilter = false; } } : null,
    showRows: (first: number, count: number) => {
      assert.ok(first >= 3 && count > 0 && first + count - 1 <= data.length);
      for (let row = first; row < first + count; row++) state.hiddenRows.delete(row);
    },
    hideRows: (first: number, count: number) => {
      assert.ok(first >= 3 && count > 0 && first + count - 1 <= data.length);
      for (let row = first; row < first + count; row++) state.hiddenRows.add(row);
    },
    getRange: (r: number | string, c = 1, rows = 1, columns = 1): any => {
      if (typeof r === 'string') {
        assert.equal(r, 'A2');
        return { getDisplayValue: () => String(data[1]?.[0] ?? '') };
      }
      return {
        getValues: () => { if (state.failReadAfterWrite && state.writes) throw new Error('Read unavailable'); return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => data[r - 1 + y]?.[c - 1 + x] ?? '')); },
        getFormulas: () => Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => formulas[r - 1 + y]?.[c - 1 + x] ?? '')),
        getDisplayValues: () => Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => String(data[r - 1 + y]?.[c - 1 + x] ?? ''))),
      };
    },
  };
  const spreadsheet = { getSheetByName: (name: string) => name === sheet.getName() ? sheet : null, getSheets: () => [sheet, { getName: () => 'Private notes', getRange: () => { throw new Error('Unrelated sheet read'); } }], getSpreadsheetTimeZone: () => 'America/New_York' };
  const context = vm.createContext({
    Date, JSON, Math, Number, String, Object, Array, Error, RegExp, Boolean, isFinite,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: (id: string) => { assert.equal(id, '1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY'); return spreadsheet; }, flush() {} },
    ContentService: { MimeType: { JSON: 'application/json', JAVASCRIPT: 'application/javascript' }, createTextOutput: (value: string) => ({ value, mime: '', setMimeType(mime: string) { this.mime = mime; return this; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_: string, value: string) => [...createHash('sha256').update(value).digest()], formatDate: (date: Date, zone: string, format: string) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const get = (type: string) => parts.find(part => part.type === type)!.value; return format === 'yyyy-MM' ? `${get('year')}-${get('month')}` : `${get('year')}-${get('month')}-${get('day')}`; } },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (state.locked) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key) ?? null, setProperty: (key: string, value: string) => properties.set(key, value), getProperties: () => Object.fromEntries(properties), deleteProperty: (key: string) => properties.delete(key) }) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => cache.get(key) ?? null, put: (key: string, value: string) => cache.set(key, value), remove: (key: string) => cache.delete(key) }) },
    Sheets: { Spreadsheets: { batchUpdate: (body: { requests: any[] }, id: string) => {
      assert.equal(id, '1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY');
      assert.equal(state.locked, true, 'write must hold a script lock');
      if (state.failWrite) throw new Error('Backend rejected batch');
      for (const request of body.requests) {
        if (request.appendDimension) { state.maxRows += request.appendDimension.length; continue; }
        const gridRange = request.repeatCell?.range ?? request.setDataValidation?.range;
        if (gridRange) assert.ok(gridRange.endRowIndex <= state.maxRows, 'batch ranges must remain inside the expanded sheet grid');
        if (!request.updateCells) continue;
        const update = request.updateCells;
        assert.equal(update.range?.sheetId ?? update.start?.sheetId, 0);
        const startRow = update.range?.startRowIndex ?? update.start?.rowIndex;
        const startColumn = update.range?.startColumnIndex ?? update.start?.columnIndex;
        update.rows.forEach((entry: any, y: number) => entry.values.forEach((cell: any, x: number) => {
          const r = startRow + y, c = startColumn + x;
          while (data.length <= r) { data.push(row()); formulas.push(row()); }
          if (!update.fields.includes('userEnteredValue')) return;
          const value = cell.userEnteredValue;
          formulas[r][c] = value?.formulaValue ?? '';
          if (value?.formulaValue) { const match = value.formulaValue.match(/^=D(\d+)-SUM\(D(\d+):D(\d+)\)$/); data[r][c] = match ? Number(data[+match[1] - 1][3]) - data.slice(+match[2] - 1, +match[3]).reduce((sum, item) => sum + Number(item[3]), 0) : ''; }
          else if (value?.numberValue !== undefined && cell.userEnteredFormat?.numberFormat?.type === 'DATE') data[r][c] = new Date(Date.UTC(1899, 11, 30 + value.numberValue, 12));
          else data[r][c] = value?.numberValue ?? value?.stringValue ?? value?.boolValue ?? '';
        }));
      }
      state.writes += 1;
      return {};
    } } },
  });
  const source = new URL('../apps-script/Code.gs', import.meta.url);
  vm.runInContext(existsSync(source) ? readFileSync(source, 'utf8') : '', context);
  const get = (parameter: Record<string, string> = {}) => {
    assert.equal(typeof context.doGet, 'function', 'Apps Script must expose doGet');
    return context.doGet({ parameter });
  };
  const read = () => JSON.parse(get({ action: 'read' }).value);
  const post = (body: any, form = false) => {
    assert.equal(typeof context.doPost, 'function', 'Apps Script must expose doPost');
    return JSON.parse(context.doPost(form ? { parameter: { payload: JSON.stringify(body) } } : { postData: { contents: JSON.stringify(body), type: 'text/plain' } }).value);
  };
  return { state, context, get, read, post, cache, properties, sheet, spreadsheet };
}

test('A2 edits filter entire manager blocks and switching teams restores prior hidden rows', () => {
  const app = harness();
  assert.equal(typeof app.context.onEdit, 'function', 'Apps Script must expose the sheet edit trigger');
  const event = { range: { getSheet: () => app.sheet, getA1Notation: () => 'A2' } };
  app.state.data[1][0] = '  tEaMa  ';
  const originalData = structuredClone(app.state.data);
  const originalFormulas = structuredClone(app.state.formulas);
  app.context.onEdit(event);
  assert.deepEqual([...app.state.hiddenRows], [3, 4, 5, 6, 7, 8, 9, 10, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.equal(app.state.standardFilter, false);
  assert.deepEqual(app.state.data, originalData);
  assert.deepEqual(app.state.formulas, originalFormulas);
  assert.equal(app.read().snapshot.months[0].properties.length, 3, 'the web app still reads hidden properties');
  app.state.data[1][0] = 'TeamB';
  app.context.onEdit(event);
  assert.deepEqual([...app.state.hiddenRows], [11, 12, 13, 14, 15, 16, 17, 18]);
});

test('All or an empty selection restores every data row and removes the standard filter', () => {
  for (const selection of ['  ALL  ', '', '  ']) {
    const app = harness();
    assert.equal(typeof app.context.filterAccountManagers, 'function');
    app.state.hiddenRows.add(3);
    app.state.hiddenRows.add(26);
    app.state.data[1][0] = selection;
    app.context.filterAccountManagers();
    assert.deepEqual([...app.state.hiddenRows], []);
    assert.equal(app.state.standardFilter, false);
  }
});

test('the edit trigger ignores other tabs, other cells, and calls without an edit range', () => {
  const app = harness();
  assert.equal(typeof app.context.onEdit, 'function');
  app.state.hiddenRows.add(3);
  for (const event of [undefined, {}, { range: { getSheet: () => app.sheet, getA1Notation: () => 'B2' } }, { range: { getSheet: () => ({ getName: () => 'Dec, 2026' }), getA1Notation: () => 'A2' } }]) {
    app.context.onEdit(event);
  }
  assert.deepEqual([...app.state.hiddenRows], [3]);
  assert.equal(app.state.standardFilter, true);
});

test('sections missing AR end at the next header or the final row', () => {
  const app = harness();
  assert.equal(typeof app.context.filterAccountManagers, 'function');
  app.state.data[1][0] = 'TeamA';
  app.state.data[2][0] = ' ACCOUNT MANAGER ';
  app.state.data[9][2] = '';
  app.state.data[17][2] = ' ar ';
  app.state.data[25][2] = '';
  app.context.filterAccountManagers();
  assert.deepEqual([...app.state.hiddenRows], [3, 4, 5, 6, 7, 8, 9, 10, 19, 20, 21, 22, 23, 24, 25, 26]);
});

test('manual filtering safely skips a missing tab or a sheet without data rows', () => {
  const app = harness();
  assert.equal(typeof app.context.filterAccountManagers, 'function');
  app.spreadsheet.getSheetByName = () => null;
  assert.doesNotThrow(() => app.context.filterAccountManagers());
  app.spreadsheet.getSheetByName = () => app.sheet;
  app.state.data.splice(2);
  assert.doesNotThrow(() => app.context.filterAccountManagers());
  assert.equal(app.state.standardFilter, true);
});

test('read parses repeated property blocks, integer cents, blank amounts, and zero independently', () => {
  const app = harness(); const result = app.read();
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.months.map((month: any) => [month.id, month.label, month.month]), [['0', 'Nov, 2026', '2026-11']]);
  const properties = result.snapshot.months[0].properties;
  assert.equal(properties.length, 3);
  assert.deepEqual(properties.map((property: any) => [property.id, property.totalCents]), [['0:4', 44204], ['0:12', 24338], ['0:20', 37048]]);
  assert.equal(properties[0].payments[0].amountCents, null);
  assert.equal(properties[0].payments[4].amountCents, 0);
  assert.equal(properties[2].payments[0].amountCents, 11686);
  assert.equal(properties[2].sourceArCents, 4562);
  assert.equal(app.state.writes, 0);
});

test('date serialization uses spreadsheet timezone and revisions include direct edits and formulas', () => {
  const app = harness(); app.state.data[4][4] = new Date('2026-11-04T02:00:00Z');
  const original = app.read().snapshot;
  assert.equal(original.months[0].properties[0].payments[0].payoutDate, '2026-11-03');
  app.state.formulas[9][3] = '=SUM(D4)-SUM(D5:D9)';
  const formulaRevision = app.read().snapshot.revision;
  assert.notEqual(formulaRevision, original.revision);
  app.state.data[4][7] = 0;
  assert.notEqual(app.read().snapshot.revision, formulaRevision);
});

test('payment rows are parsed dynamically when a block contains an extra Airbnb payment', () => {
  const app = harness();
  app.state.data.splice(7, 0, row('', '', 'Airbnb Payment', 19.99));
  app.state.formulas.splice(7, 0, row());
  const properties = app.read().snapshot.months[0].properties;
  assert.equal(properties[0].payments.length, 6);
  assert.equal(properties[0].payments[3].amountCents, 1999);
  assert.equal(properties[0].payments[3].id, '0:8');
  assert.equal(properties[1].id, '0:13');
});

test('malformed source currency fails visibly instead of silently dropping money', () => {
  const app = harness(); app.state.data[4][3] = '$1,200';
  assert.equal(app.read().error.code, 'SOURCE_DATA');
});

test('GET restricts JSONP callback names and cannot mutate data', () => {
  const app = harness();
  assert.match(app.get({ action: 'read', callback: 'castleCallback_test_1' }).value, /^castleCallback_test_1\(/);
  assert.equal(JSON.parse(app.get({ action: 'read', callback: 'alert(1)//' }).value).error.code, 'BAD_REQUEST');
  assert.equal(JSON.parse(app.get({ action: 'write' }).value).error.code, 'BAD_REQUEST');
  assert.equal(app.state.writes, 0);
});

test('a form POST updates exact cells in a single batch and stores an idempotent acknowledgement', () => {
  const app = harness(); const revision = app.read().snapshot.revision;
  const body = { requestId: 'save_valid_001', revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 50001 }, { kind: 'updatePayment', paymentId: '0:5', fields: { amountCents: 0, bundleCents: 12345, bankCents: 12345, payoutDate: '2026-11-12', bankDate: '2026-11-13', verifiedByDaisy: true } }] };
  const saved = app.post(body, true);
  assert.equal(saved.ok, true);
  assert.equal(app.state.data[3][3], 500.01);
  assert.equal(app.state.data[4][3], 0);
  assert.equal(app.state.data[4][5], 123.45);
  assert.equal(app.state.data[4][9], true);
  assert.equal(saved.snapshot.months[0].properties[0].payments[0].bankDate, '2026-11-13');
  assert.equal(app.state.formulas[9][3], '=D4-D5-D6-D7-D8-D9');
  assert.equal(app.state.data[0][0], 'AM FILTER');
  assert.equal(app.state.writes, 1);
  assert.equal(app.post(body).ok, true);
  assert.equal(app.state.writes, 1);
  app.cache.clear();
  const status = JSON.parse(app.get({ action: 'status', requestId: body.requestId }).value);
  assert.equal(status.ok, true);
  assert.equal(status.snapshot.months[0].properties[0].totalCents, 50001);
});

test('revision conflicts reject the whole batch without modifying source data', () => {
  const app = harness(); const revision = app.read().snapshot.revision;
  app.state.data[3][3] = 400;
  const result = app.post({ requestId: 'stale_save_001', revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 20 }] });
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(app.state.writes, 0);
  assert.equal(app.state.data[3][3], 400);
});

test('backend accepts the client maximum of 999999999999 cents without rounding away a cent', () => {
  const app = harness();
  const result = app.post({ requestId: 'maximum_amount_001', revision: app.read().snapshot.revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 999999999999 }] });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.months[0].properties[0].totalCents, 999999999999);
});

test('all change validation completes before the first mutation', () => {
  const badChanges = [
    { kind: 'setTotal', propertyId: '0:4', amountCents: 1.1 },
    { kind: 'setTotal', propertyId: '0:999', amountCents: 1 },
    { kind: 'setTotal', propertyId: '__proto__', amountCents: 1 },
    { kind: 'setTotal', propertyId: '0:4', amountCents: -1 },
    { kind: 'updatePayment', paymentId: '0:5', fields: { payoutDate: '2026-02-30' } },
    { kind: 'updatePayment', paymentId: '0:5', fields: { bankCents: '10' } },
    { kind: 'updatePayment', paymentId: '0:5', fields: { verifiedByDaisy: 'true' } },
    { kind: 'updatePayment', paymentId: '0:5', fields: { type: 'Owner' } },
    { kind: 'updatePayment', paymentId: '0:5', fields: { bankCents: 1000000000000 } },
    { kind: 'addProperty', monthId: '0', name: '=IMPORTXML("secret")', manager: 'TeamA', totalCents: 0 },
    { kind: 'addProperty', monthId: '9', name: 'House', manager: 'TeamA', totalCents: 0 },
  ];
  for (const change of badChanges) {
    const app = harness();
    const result = app.post({ requestId: 'validation_001', revision: app.read().snapshot.revision, changes: [{ kind: 'setTotal', propertyId: '0:12', amountCents: 123 }, change] });
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(result.error.code, 'VALIDATION', JSON.stringify(change));
    assert.equal(app.state.writes, 0);
    assert.equal(app.state.data[11][3], 243.38);
  }
});

test('duplicate targets and reused request IDs with different bodies are rejected', () => {
  const app = harness(); const revision = app.read().snapshot.revision;
  const duplicate = app.post({ requestId: 'duplicate_001', revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 1 }, { kind: 'setTotal', propertyId: '0:4', amountCents: 2 }] });
  assert.equal(duplicate.error.code, 'VALIDATION');
  const body = { requestId: 'idempotent_001', revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 1 }] };
  assert.equal(app.post(body).ok, true);
  assert.equal(app.post({ ...body, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 2 }] }).error.code, 'REQUEST_ID_REUSED');
  assert.equal(app.state.writes, 1);
});

test('addProperty appends a complete source block, expands the grid, and preserves existing formulas', () => {
  const app = harness();
  const result = app.post({ requestId: 'add_property_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamC', totalCents: 10001 }] });
  assert.equal(result.ok, true);
  const added = result.snapshot.months[0].properties[3];
  assert.equal(added.id, '0:28');
  assert.equal(added.name, 'New House');
  assert.deepEqual(added.payments.map((payment: any) => payment.type), ['Airbnb', 'Airbnb', 'Airbnb', 'Vrbo', 'Owner']);
  assert.equal(added.payments[0].amountCents, null);
  assert.equal(app.state.formulas[33][3], '=D28-SUM(D29:D33)');
  assert.equal(app.state.formulas[9][3], '=D4-D5-D6-D7-D8-D9');
  assert.ok(app.state.maxRows >= 34);
  assert.equal(app.state.writes, 1);
});

test('multiple appended properties get distinct source rows and duplicate names fail atomically', () => {
  const app = harness();
  const change = { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamC', totalCents: 0 };
  const revision = app.read().snapshot.revision;
  const rejected = app.post({ requestId: 'duplicate_names_001', revision, changes: [change, { ...change, name: ' new house ' }] });
  assert.equal(rejected.error.code, 'VALIDATION');
  assert.equal(app.state.data.length, 26);
  const added = app.post({ requestId: 'multiple_add_001', revision, changes: [change, { ...change, name: 'Other House' }] });
  assert.equal(added.ok, true);
  assert.deepEqual(added.snapshot.months[0].properties.slice(3).map((property: any) => property.id), ['0:28', '0:36']);
  assert.equal(app.state.data.length, 42);
});

test('clearing a payment preserves blank-versus-zero semantics and rejects duplicate payment fields', () => {
  const app = harness();
  const revision = app.read().snapshot.revision;
  const rejected = app.post({ requestId: 'duplicate_fields_001', revision, changes: [{ kind: 'updatePayment', paymentId: '0:21', fields: { amountCents: null } }, { kind: 'updatePayment', paymentId: '0:21', fields: { amountCents: 0 } }] });
  assert.equal(rejected.error.code, 'VALIDATION');
  const result = app.post({ requestId: 'clear_payment_001', revision, changes: [{ kind: 'updatePayment', paymentId: '0:21', fields: { amountCents: null, payoutDate: '', bankCents: 0 } }] });
  assert.equal(result.ok, true);
  const payment = result.snapshot.months[0].properties[2].payments[0];
  assert.equal(payment.amountCents, null);
  assert.equal(payment.bankCents, 0);
  assert.equal(payment.payoutDate, '');
});

test('unknown request status is pending and a locked writer reports busy without mutation', () => {
  const app = harness();
  assert.deepEqual(JSON.parse(app.get({ action: 'status', requestId: 'pending_001' }).value), { ok: true, pending: true });
  app.state.locked = true;
  const result = app.post({ requestId: 'busy_001', revision: app.read().snapshot.revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 1 }] });
  assert.equal(result.error.code, 'BUSY');
  assert.equal(app.state.writes, 0);
});

test('ambiguous write failures are durable and never cause a blind replay', () => {
  const app = harness(); const body = { requestId: 'failed_batch_001', revision: app.read().snapshot.revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 1 }] };
  app.state.failWrite = true;
  const result = app.post(body);
  assert.equal(result.error.code, 'WRITE_UNCONFIRMED');
  app.state.failWrite = false;
  assert.equal(app.post(body).error.code, 'WRITE_UNCONFIRMED');
  assert.equal(app.state.writes, 0);
});

test('a successful batch with a failed refresh remains acknowledged and is never repeated', () => {
  const app = harness(); const body = { requestId: 'refresh_failure_001', revision: app.read().snapshot.revision, changes: [{ kind: 'setTotal', propertyId: '0:4', amountCents: 1 }] };
  app.state.failReadAfterWrite = true;
  const result = app.post(body);
  assert.equal(result.error.code, 'SAVED_REFRESH_FAILED');
  app.state.failReadAfterWrite = false;
  const status = JSON.parse(app.get({ action: 'status', requestId: body.requestId }).value);
  assert.equal(status.ok, true);
  assert.equal(status.snapshot.months[0].properties[0].totalCents, 1);
  assert.equal(app.post(body).ok, true);
  assert.equal(app.state.writes, 1);
});
