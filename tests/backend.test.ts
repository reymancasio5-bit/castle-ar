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
  const status = {exists:false, id:1, data:[] as Cell[][], formulas:[] as Cell[][], maxRows:100, maxColumns:10};
  const data: Cell[][] = [row('AM FILTER', new Date('2026-11-01T04:00:00Z')), row('Blank'), [...header], row('TeamB', 'Mtl 404 Le Bijou', 'Total Payment', 442.04), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 442.04), [...header], row('TeamA', 'Mtl 2429 Rue Allard Unit 1', 'Total Payment', 243.38), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Airbnb Payment'), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 243.38), [...header], row('TeamB', 'Tor Unit 918-251 Jarvis St', 'Total Payment', 370.48), row('', '', 'Airbnb Payment', 116.86), row('', '', 'Airbnb Payment', 130.81), row('', '', 'Airbnb Payment', 77.19), row('', '', 'Vrbo Payment'), row('', '', 'Owner Payment', 0), row('', '', 'AR', 45.62)];
  const formulas = data.map(() => row());
  formulas[9][3] = '=D4-D5-D6-D7-D8-D9';
  formulas[17][3] = '=D12-SUM(D13:D17)';
  formulas[25][3] = '=D20-SUM(D21:D25)';
  const formats: Record<string, any>[][] = data.map(() => Array.from({ length: 10 }, () => ({})));
  const validations: Record<string, any>[][] = data.map(() => Array.from({ length: 10 }, () => ({})));
  // Original property is styled; later blocks intentionally have no formatting.
  for (let r = 2; r <= 9; r++) {
    formats[r][0] = { borders: { left: { style: 'SOLID' }, right: { style: 'SOLID' } } };
    formats[r][1] = { borders: { left: { style: 'SOLID' } } };
    formats[r][9] = { borders: { right: { style: 'SOLID' } } };
  }
  for (let c = 0; c < 10; c++) {
    formats[2][c] = { ...formats[2][c], borders: { ...formats[2][c].borders, top: { style: 'SOLID' } }, textFormat: { fontFamily: 'Calibri', fontSize: 12, bold: true }, horizontalAlignment: 'CENTER' };
    formats[9][c] = { ...formats[9][c], borders: { ...formats[9][c].borders, bottom: { style: 'SOLID' } } };
  }
  formats[3][1].horizontalAlignment = 'CENTER';
  formats[3][3].numberFormat = { type: 'NUMBER', pattern: '#,##0.##' };
  for (let r = 4; r <= 7; r++) {
    formats[r][4].numberFormat = { type: 'DATE', pattern: 'mmm d' };
    formats[r][6].numberFormat = { type: 'DATE', pattern: 'mmm d' };
  }
  formats[7][2].textFormat = { fontFamily: 'Arial', fontSize: 8, bold: true };
  formats[8][2].textFormat = { fontFamily: 'Arial', fontSize: 9, bold: true };
  const state = { data, formulas, formats, validations, maxRows: 30, maxColumns: 10, writes: 0, locked: false, failWrite: false, failReadAfterWrite: false, hiddenRows: new Set<number>(), standardFilter: true };
  const properties = new Map<string, string>();
  const cache = new Map<string, string>();
  const sheet = {
    getName: () => 'Nov, 2026', getSheetId: () => 0, getLastRow: () => data.length, getMaxRows: () => state.maxRows, getMaxColumns: () => state.maxColumns,
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
  const statusSheet = {getName:()=> 'Status',getSheetId:()=>status.id,getLastRow:()=>status.data.length,getMaxRows:()=>status.maxRows,getMaxColumns:()=>status.maxColumns,getRange:(r:number,c:number,rows:number,columns:number)=>({getValues:()=>Array.from({length:rows},(_,y)=>Array.from({length:columns},(_,x)=>status.data[r-1+y]?.[c-1+x]??'')),getFormulas:()=>Array.from({length:rows},(_,y)=>Array.from({length:columns},(_,x)=>status.formulas[r-1+y]?.[c-1+x]??''))})};
  const spreadsheet = { getSheetByName: (name: string) => name === sheet.getName() ? sheet : name === 'Status' && status.exists ? statusSheet : null, getSheets: () => [sheet, ...(status.exists?[statusSheet]:[]), { getSheetId:()=>99, getName: () => 'Private notes', getRange: () => { throw new Error('Unrelated sheet read'); } }], getSpreadsheetTimeZone: () => 'America/New_York' };
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
        if(request.addSheet){assert.equal(status.exists,false);status.exists=true;status.id=request.addSheet.properties.sheetId;status.maxRows=request.addSheet.properties.gridProperties.rowCount;continue;}
        if(request.appendDimension?.sheetId===status.id){if(request.appendDimension.dimension==='ROWS')status.maxRows+=request.appendDimension.length;else status.maxColumns+=request.appendDimension.length;continue;}
        if((request.updateCells?.range?.sheetId??request.updateCells?.start?.sheetId)===status.id){
          const u=request.updateCells;const r=u.range?.startRowIndex??u.start?.rowIndex;const c=u.range?.startColumnIndex??u.start?.columnIndex;
          assert.ok(status.exists && r<status.maxRows && c<status.maxColumns);
          u.rows.forEach((entry:any,y:number)=>entry.values.forEach((cell:any,x:number)=>{status.data[r+y]??=row();status.formulas[r+y]??=row();status.data[r+y][c+x]=cell.userEnteredValue?.stringValue??cell.userEnteredValue?.numberValue??'';status.formulas[r+y][c+x]='';}));continue;
        }
        if (request.appendDimension) { if (request.appendDimension.dimension === 'COLUMNS') state.maxColumns += request.appendDimension.length; else state.maxRows += request.appendDimension.length; continue; }
        if (request.insertDimension) {
          const { startIndex, endIndex } = request.insertDimension.range;
          const count = endIndex - startIndex;
          data.splice(startIndex, 0, ...Array.from({ length: count }, () => row()));
          formulas.splice(startIndex, 0, ...Array.from({ length: count }, () => row()));
          formats.splice(startIndex, 0, ...Array.from({ length: count }, () => Array.from({ length: 10 }, () => ({}))));
          validations.splice(startIndex, 0, ...Array.from({ length: count }, () => Array.from({ length: 10 }, () => ({}))));
          for (const cells of formulas) cells.forEach((value, c) => {
            if (typeof value === 'string') cells[c] = value.replace(/(\$?[A-Z]+\$?)(\d+)/g, (_, column, n) => column + (+n > startIndex ? +n + count : +n));
          });
          state.maxRows += count;
          continue;
        }
        if (request.copyPaste) {
          const { source, destination, pasteType } = request.copyPaste;
          assert.equal(pasteType, 'PASTE_FORMAT', 'formatting must never copy source values or formulas');
          assert.equal(source.sheetId, 0);
          assert.equal(destination.sheetId, 0);
          assert.ok(destination.endRowIndex <= state.maxRows, 'expand the sheet before copying formats');
          for (let r = destination.startRowIndex; r < destination.endRowIndex; r++) {
            formats[r] ??= Array.from({ length: 10 }, () => ({}));
            for (let c = destination.startColumnIndex; c < destination.endColumnIndex; c++) {
              const sourceRow = source.startRowIndex + (r - destination.startRowIndex) % (source.endRowIndex - source.startRowIndex);
              const sourceColumn = source.startColumnIndex + (c - destination.startColumnIndex) % (source.endColumnIndex - source.startColumnIndex);
              formats[r][c] = structuredClone(formats[sourceRow][sourceColumn]);
            }
          }
          continue;
        }
        const gridRange = request.repeatCell?.range ?? request.setDataValidation?.range;
        if (gridRange) assert.ok(gridRange.endRowIndex <= state.maxRows, 'batch ranges must remain inside the expanded sheet grid');
        if (request.setDataValidation) {
          for (let r = gridRange.startRowIndex; r < gridRange.endRowIndex; r++) {
            validations[r] ??= Array.from({ length: 10 }, () => ({}));
            for (let c = gridRange.startColumnIndex; c < gridRange.endColumnIndex; c++) validations[r][c] = structuredClone(request.setDataValidation.rule);
          }
        }
        if (request.repeatCell?.fields === 'userEnteredFormat.numberFormat') {
          for (let r = gridRange.startRowIndex; r < gridRange.endRowIndex; r++) {
            formats[r] ??= Array.from({ length: 10 }, () => ({}));
            for (let c = gridRange.startColumnIndex; c < gridRange.endColumnIndex; c++) formats[r][c].numberFormat = structuredClone(request.repeatCell.cell.userEnteredFormat.numberFormat);
          }
        }
        if (!request.updateCells) continue;
        const update = request.updateCells;
        assert.equal(update.range?.sheetId ?? update.start?.sheetId, 0);
        const startRow = update.range?.startRowIndex ?? update.start?.rowIndex;
        const startColumn = update.range?.startColumnIndex ?? update.start?.columnIndex;
        update.rows.forEach((entry: any, y: number) => entry.values.forEach((cell: any, x: number) => {
          const r = startRow + y, c = startColumn + x;
          while (data.length <= r) { data.push(row()); formulas.push(row()); }
          formats[r] ??= Array.from({ length: 10 }, () => ({}));
          if (!update.fields.includes('userEnteredValue')) return;
          const value = cell.userEnteredValue;
          formulas[r][c] = value?.formulaValue ?? '';
          if (value?.formulaValue) { const match = value.formulaValue.match(/^=D(\d+)-SUM\(D(\d+):D(\d+)\)$/); const direct = value.formulaValue.match(/^=D(\d+)$/); data[r][c] = direct ? Number(data[+direct[1] - 1][3]) : match ? Number(data[+match[1] - 1][3]) - data.slice(+match[2] - 1, +match[3]).reduce((sum, item) => sum + Number(item[3]), 0) : ''; }
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
  return { status, state, context, get, read, post, cache, properties, sheet, spreadsheet };
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

test('owner payment labels tolerate extra whitespace while preserving zero and blank amounts', () => {
  for (const [amount, expected] of [[0, 0], ['0', 0], ['', null]] as const) {
    const app = harness();
    app.state.data[8][2] = 'Owner  Payment'; // Exact label from Nov, 2026!C9.
    app.state.data[16][2] = ' Owner\u00a0 Payment ';
    app.state.data[24][2] = 'OWNER\t\nPAYMENT';
    for (const index of [8, 16, 24]) app.state.data[index][3] = amount;
    const originalData = structuredClone(app.state.data);
    const result = app.read();
    assert.equal(result.ok, true, result.error?.message);
    assert.deepEqual(result.snapshot.months[0].properties.map((property: any) => {
      const owner = property.payments.find((payment: any) => payment.type === 'Owner');
      return [owner?.id, owner?.amountCents];
    }), [['0:9', expected], ['0:17', expected], ['0:25', expected]]);
    assert.deepEqual(app.state.data, originalData, 'reading normalizes labels without rewriting the sheet');
    assert.equal(app.state.writes, 0);
  }
});

test('unrecognized payment labels still report a source error when the amount is zero', () => {
  const app = harness();
  app.state.data[8][2] = 'Transfer Payment';
  app.state.data[8][3] = 0;
  const result = app.read();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SOURCE_DATA');
  assert.match(result.error.message, /unrecognized payment row 9/);
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
  assert.deepEqual(added.payments.map((payment: any) => payment.type), []);
  assert.equal(app.state.formulas[28][3], '=D28');
  assert.equal(app.state.formulas[9][3], '=D4-D5-D6-D7-D8-D9');
  assert.ok(app.state.maxRows >= 30);
  assert.equal(app.state.writes, 1);
});

test('import creates property and initial payments in one atomic save', () => {
  const app = harness();
  const result = app.post({ requestId: 'import_new_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'Imported house', manager: 'Team B', totalCents: 37048, initialPayments: [{ index: 0, amountCents: 11686, payoutDate: '2026-10-09', bundleCents: 38140 }, { index: 1, amountCents: 13081, payoutDate: '2026-10-13', bundleCents: 60217 }, { index: 2, amountCents: 7719, payoutDate: '2026-10-19', bundleCents: 661041 }] }] });
  assert.equal(result.ok, true);
  const property = result.snapshot.months[0].properties[3];
  assert.equal(property.totalCents, 37048);
  assert.equal(property.payments[0].amountCents, 11686);
  assert.equal(property.payments[0].payoutDate, '2026-10-09');
  assert.equal(property.payments[2].bundleCents, 661041);
  assert.equal(property.payments[0].bankCents, null);
  assert.equal(property.totalCents - property.payments.reduce((sum: number, p: any) => sum + (p.amountCents ?? 0), 0), 4562);
  assert.equal(app.state.writes, 1);
});

test('invalid initial payments reject creation without any writes', () => {
  for (const initialPayments of [[{ index: 5, amountCents: 100 }], [{ index: 0, amountCents: 100, payoutDate: '2026-02-30' }], [{ index: 0, amountCents: 100, bankCents: 100 }], [{ index: 0, amountCents: 100 }, { index: 0, amountCents: 200 }]]) {
    const app = harness();
    const result = app.post({ requestId: 'import_invalid_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'Imported house', manager: 'Team B', totalCents: 37048, initialPayments }] });
    assert.equal(result.error.code, 'VALIDATION');
    assert.equal(app.state.writes, 0);
  }
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
  assert.deepEqual(added.snapshot.months[0].properties.slice(3).map((property: any) => property.id), ['0:28', '0:31']);
  assert.equal(app.state.data.length, 32);
});

test('new properties inherit the first property borders, fonts, alignment, and date formats', () => {
  const app = harness();
  const originalValues = structuredClone(app.state.data);
  const originalFormulas = structuredClone(app.state.formulas);
  const originalFormats = structuredClone(app.state.formats);
  const result = app.post({ requestId: 'formatted_properties_001', revision: app.read().snapshot.revision, changes: [
    { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamC', totalCents: 25000 },
    { kind: 'addProperty', monthId: '0', name: 'Zero House', manager: 'TeamA', totalCents: 0 },
  ] });
  assert.equal(result.ok, true, result.error?.message);
  for (const firstIndex of [26, 29]) {
    assert.deepEqual(app.state.formats.slice(firstIndex, firstIndex + 3), [originalFormats[2], originalFormats[3], originalFormats[9]]);
    assert.equal(app.state.formats[firstIndex][0].borders.top.style, 'SOLID');
    assert.equal(app.state.formats[firstIndex][0].textFormat.bold, true);
    assert.equal(app.state.formats[firstIndex + 1][1].horizontalAlignment, 'CENTER');
    assert.equal(app.state.formats[firstIndex + 2][9].borders.bottom.style, 'SOLID');
  }
  assert.equal(app.state.data[27][1], 'New House');
  assert.equal(app.state.data[30][3], 0);
  assert.equal(app.state.formulas[28][3], '=D28');
  assert.deepEqual(app.state.data.slice(0, 26), originalValues);
  assert.deepEqual(app.state.formulas.slice(0, 26), originalFormulas);
  assert.deepEqual(app.state.formats.slice(0, 26), originalFormats);
  assert.equal(app.state.writes, 1, 'formats and values belong to the same atomic save');
});

test('format copying matches payment roles when the template has extra payment rows', () => {
  const app = harness();
  app.state.data.splice(7, 0, row('', '', 'Airbnb Payment', 19.99));
  app.state.formulas.splice(7, 0, row());
  app.state.formats.splice(7, 0, Array.from({ length: 10 }, () => ({ textFormat: { italic: true } })));
  const result = app.post({ requestId: 'variable_format_001', revision: app.read().snapshot.revision, changes: [
    { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamC', totalCents: 0 },
  ] });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.snapshot.months[0].properties[3].id, '0:29');
  assert.equal(app.state.formats[29][9].borders.bottom.style, 'SOLID');
  assert.equal(app.state.formulas[29][3], '=D29');
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

test('bulk Airbnb rows insert atomically, preserve lower edits, and expand AR with repeated targets', () => {
  const app = harness();
  const before = app.read().snapshot;
  const body = { requestId: 'bulk-existing-01', revision: before.revision, changes: [
    { kind: 'appendPayments', propertyId: '0:4', payments: [{ amountCents: 1000, payoutDate: '2026-11-03', bundleCents: 1000 }] },
    { kind: 'appendPayments', propertyId: '0:12', payments: [{ amountCents: 2000 }] },
    { kind: 'appendPayments', propertyId: '0:4', payments: [{ amountCents: 500 }] },
    { kind: 'updatePayment', paymentId: '0:21', fields: { amountCents: 12000, bundleCents: 12000 } },
  ] };
  const result = app.post(body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(app.state.writes, 1);
  const properties = result.snapshot.months[0].properties;
  assert.equal(properties[0].payments.length, 7);
  assert.equal(properties[1].payments.length, 6);
  assert.equal(properties[2].payments[0].amountCents, 12000);
  assert.equal(app.state.formulas[11][3], '=D4-SUM(D5:D11)');
  assert.equal(app.state.formulas[20][3], '=D14-SUM(D15:D20)');
  assert.equal(app.state.formulas[28][3], '=D23-SUM(D24:D28)');
  assert.match(String(app.state.formulas[23][8]), /F24/);
  assert.equal(app.state.data[9][2], 'Airbnb Payment');
  assert.equal(app.state.data[9][9], false);
  assert.equal(app.state.validations[9][9].condition.type, 'BOOLEAN');
  assert.equal(app.state.formats[9][0].borders.left.style, 'SOLID');
  assert.match(String(app.state.formulas[9][8]), /F10/);
  assert.equal(app.post(body).ok, true);
  assert.equal(app.state.writes, 1);
});

test('new properties support more than three Airbnb payouts with existing slots intact', () => {
  const app = harness();
  const result = app.post({ requestId: 'bulk-new-property', revision: app.read().snapshot.revision, changes: [
    { kind: 'addProperty', monthId: '0', name: 'Bulk property', manager: 'TeamA', totalCents: 10000,
      initialPayments: [0, 1, 2].map(index => ({ index, amountCents: 1000 })),
      additionalPayments: [{ amountCents: 2000 }, { amountCents: 3000 }] },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties.at(-1);
  assert.equal(property.payments.length, 5);
  assert.equal(property.payments.filter((p: any) => p.type === 'Airbnb').length, 5);
  assert.equal(property.sourceArCents, 2000);
  assert.equal(app.state.formulas[33][3], '=D28-SUM(D29:D33)');
});

test('bulk payment validation rejects invalid fields and aggregate overflow without writes', () => {
  for (const payments of [[], [{ amountCents: 1, type: 'Other' }], [{ amountCents: 1.5 }], [{ amountCents: 1, payoutDate: '2026-02-30' }], [{ amountCents: 1, bankCents: 1 }], Array.from({ length: 501 }, () => ({ amountCents: 1 }))]) {
    const app = harness();
    const result = app.post({ requestId: 'bulk-validation', revision: app.read().snapshot.revision, changes: [{ kind: 'appendPayments', propertyId: '0:4', payments }] });
    assert.equal(result.error.code, 'VALIDATION');
    assert.equal(app.state.writes, 0);
  }
  const app = harness();
  const result = app.post({ requestId: 'bulk-aggregate', revision: app.read().snapshot.revision, changes: ['0:4', '0:12'].map(propertyId => ({ kind: 'appendPayments', propertyId, payments: Array.from({ length: 251 }, () => ({ amountCents: 1 })) })) });
  assert.equal(result.error.code, 'VALIDATION');
  assert.equal(app.state.writes, 0);
});

test('mixed new blocks and existing appends retain every property and enforce combined payment limit', () => {
  const app = harness();
  const result = app.post({ requestId: 'bulk-mixed-save', revision: app.read().snapshot.revision, changes: [
    { kind: 'appendPayments', propertyId: '0:4', payments: [{ amountCents: -100 }] },
    { kind: 'addProperty', monthId: '0', name: 'First new', manager: 'TeamA', totalCents: 1000, additionalPayments: [{ amountCents: 300 }] },
    { kind: 'addProperty', monthId: '0', name: 'Second new', manager: 'TeamA', totalCents: 1000, initialPayments: [{ index: 0, amountCents: 100 }], additionalPayments: [{ amountCents: 200 }] },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const properties = result.snapshot.months[0].properties;
  assert.equal(properties.length, 5);
  assert.equal(properties[3].name, 'First new');
  assert.equal(properties[4].name, 'Second new');
  assert.equal(properties[3].sourceArCents, 700);
  assert.equal(properties[4].sourceArCents, 700);
  assert.equal(properties[0].payments.at(-1).amountCents, -100);
  const limited = harness();
  const rejected = limited.post({ requestId: 'bulk-combined-limit', revision: limited.read().snapshot.revision, changes: [
    { kind: 'addProperty', monthId: '0', name: 'Too many', manager: 'TeamA', totalCents: 1000, initialPayments: [{ index: 0, amountCents: 1 }], additionalPayments: Array.from({ length: 500 }, () => ({ amountCents: 1 })) },
  ] });
  assert.equal(rejected.error.code, 'VALIDATION');
  assert.equal(limited.state.writes, 0);
});

test('exactly 500 appended payouts are supported in one atomic batch', () => {
  const app = harness();
  const result = app.post({ requestId: 'bulk-limit-boundary', revision: app.read().snapshot.revision, changes: [{ kind: 'appendPayments', propertyId: '0:4', payments: Array.from({ length: 500 }, () => ({ amountCents: 1 })) }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshot.months[0].properties[0].payments.length, 505);
  assert.equal(result.snapshot.months[0].properties[0].sourceArCents, 43704);
  assert.equal(app.state.writes, 1);
});

test('sparse semantic payment slots create only actual rows after Owner and retain zero and refunds', () => {
  const app = harness();
  const result = app.post({ requestId: 'compact-sparse-import', revision: app.read().snapshot.revision, changes: [{
    kind: 'addProperty', monthId: '0', name: 'Sparse import', manager: 'TeamA', totalCents: 10000,
    initialPayments: [{ index: 3, amountCents: -500, payoutDate: '2026-11-02' }, { index: 2, amountCents: 0, bundleCents: 0 }, { index: 4, amountCents: 2000 }],
    additionalPayments: [{ amountCents: -100 }],
  }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties.at(-1);
  assert.deepEqual(property.payments.map((p: any) => [p.type, p.amountCents]), [['Owner', 2000], ['Airbnb', 0], ['Vrbo', -500], ['Airbnb', -100]]);
  assert.equal(property.payments[1].bundleCents, 0);
  assert.equal(property.payments[2].payoutDate, '2026-11-02');
  assert.equal(property.sourceArCents, 8600);
  assert.equal(app.state.data.length, 33);
  assert.equal(app.state.formulas[32][3], '=D28-SUM(D29:D32)');
  assert.equal(app.state.formats[28][2].textFormat.fontSize, 9);
  assert.equal(app.state.formats[30][2].textFormat.fontSize, 8);
  for (let r = 28; r <= 31; r++) {
    assert.equal(app.state.data[r][9], false);
    assert.equal(app.state.validations[r][9].condition.type, 'BOOLEAN');
    assert.match(String(app.state.formulas[r][8]), new RegExp('F' + (r + 1)));
  }
});

test('typed payment appends support manual Vrbo and Owner imports with matching formats', () => {
  const app = harness();
  const created = app.post({ requestId: 'typed-create-property', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'Typed imports', manager: 'TeamA', totalCents: 10000, additionalPayments: [{ type: 'Vrbo', amountCents: 1000 }] }] });
  assert.equal(created.ok, true, JSON.stringify(created));
  const result = app.post({ requestId: 'typed-append-payment', revision: created.snapshot.revision, changes: [{ kind: 'appendPayments', propertyId: '0:28', payments: [{ type: 'Vrbo', amountCents: 2000 }, { type: 'Owner', amountCents: 500 }, { amountCents: 100 }] }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties.at(-1);
  assert.deepEqual(property.payments.map((p: any) => [p.type, p.amountCents]), [['Vrbo', 1000], ['Vrbo', 2000], ['Owner', 500], ['Airbnb', 100]]);
  assert.equal(property.sourceArCents, 6400);
  assert.equal(app.state.formats[28][2].textFormat.fontSize, 8);
  assert.equal(app.state.formats[29][2].textFormat.fontSize, 8);
  assert.equal(app.state.formats[30][2].textFormat.fontSize, 9);
  assert.equal(app.state.formulas[32][3], '=D28-SUM(D29:D32)');
});

test('an empty first template allows future payment insertion and no default Owner is created', () => {
  for (const keepOtherProperties of [false, true]) {
    const app = harness();
    for (const grid of [app.state.data, app.state.formulas, app.state.formats, app.state.validations]) {
      grid.splice(4, 5);
      if (!keepOtherProperties) grid.splice(5);
    }
    app.state.formulas[4][3] = '=D4';
    app.state.data[4][3] = 442.04;
    if (keepOtherProperties) app.state.formats[10][2] = { textFormat: { italic: true } };
    const before = app.read();
    assert.equal(before.ok, true);
    assert.equal(before.snapshot.months[0].properties[0].payments.length, 0);
    const result = app.post({ requestId: 'empty-template-insert', revision: before.snapshot.revision, changes: [
      { kind: 'appendPayments', propertyId: '0:4', payments: [{ type: 'Vrbo', amountCents: 1000 }] },
      { kind: 'addProperty', monthId: '0', name: 'No placeholders', manager: 'TeamA', totalCents: 2000, initialPayments: [{ index: 2, amountCents: 0 }] },
      { kind: 'addProperty', monthId: '0', name: 'Bare property', manager: 'TeamA', totalCents: 3000 },
    ] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const properties = result.snapshot.months[0].properties;
    assert.deepEqual(properties[0].payments.map((p: any) => p.type), ['Vrbo']);
    assert.equal(properties[0].sourceArCents, 43204);
    assert.deepEqual(properties.at(-2).payments.map((p: any) => [p.type, p.amountCents]), [['Airbnb', 0]]);
    assert.deepEqual(properties.at(-1).payments, []);
    assert.equal(properties.at(-1).sourceArCents, 3000);
    assert.equal(app.state.validations[4][9].condition.type, 'BOOLEAN');
    if (keepOtherProperties) assert.equal(app.state.formats[4][2].textFormat.italic, true);
  }
});

test('follow-ups persist literal notes and images, update manager, and move with inserted rows', () => {
  const app = harness();
  const attachment = { name: 'receipt.png', dataUrl: 'data:image/png;base64,aGVsbG8=' };
  const before = app.read().snapshot;
  const body = { requestId: 'followup-save-001', revision: before.revision, changes: [
    { kind: 'appendPayments', propertyId: '0:4', payments: [{ amountCents: 100 }] },
    { kind: 'updateFollowUp', propertyId: '0:12', manager: 'TeamC', status: 'payment_promised', note: '=literal note\nCall Friday', attachments: [attachment] },
  ] };
  const result = app.post(body);
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties[1];
  assert.equal(property.manager, 'TeamC');
  assert.equal(property.followUp.status, 'payment_promised');
  assert.equal(property.followUp.note, '=literal note\nCall Friday');
  assert.deepEqual(property.followUp.attachments, [attachment]);
  assert.ok(!Number.isNaN(Date.parse(property.followUp.updatedAt)));
  assert.equal(app.state.maxColumns, 10);
  assert.equal(app.status.data[0][4], 'Follow-up status');
  assert.equal(app.status.formulas[1][5], '');
  assert.equal(app.state.writes, 1);
  assert.equal(app.post(body).ok, true);
  assert.equal(app.state.writes, 1);
  app.status.data[1][5] = 'Changed directly';
  const conflict = app.post({ ...body, requestId: 'followup-stale-001', revision: result.snapshot.revision });
  assert.equal(conflict.error.code, 'CONFLICT');
});

test('follow-ups reject unsafe or excessive input and protect unrelated columns', () => {
  const valid = { kind: 'updateFollowUp', propertyId: '0:4', manager: '', status: 'not_contacted', note: '', attachments: [] };
  for (const invalid of [{ status: 'other' }, { manager: '=bad' }, { note: 'a'.repeat(5001) }, { attachments: [{ name: 'bad.svg', dataUrl: 'data:image/svg+xml;base64,aGVsbG8=' }] }, { attachments: [{ name: 'bad.png', dataUrl: 'https://example.com/x.png' }] }, { attachments: [{ name: 'bad.png', dataUrl: 'data:image/png;base64,???' }] }, { attachments: Array(4).fill({ name: 'x', dataUrl: 'data:image/png;base64,AAAA' }) }, { attachments: [{ name: 'x', dataUrl: 'data:image/png;base64,' + 'A'.repeat(45000) }] }]) {
    const app = harness();
    const result = app.post({ requestId: 'followup-invalid', revision: app.read().snapshot.revision, changes: [{ ...valid, ...invalid }] });
    assert.equal(result.error.code, 'VALIDATION');
    assert.equal(app.state.writes, 0);
  }
  for (const targetRow of [2, 3]) {
    const app = harness();
    app.state.maxColumns = 16;
    app.state.data[targetRow][10] = 'Private unrelated information';
    const read = app.read();
    assert.equal(read.snapshot.months[0].properties[0].followUp, undefined);
    const result = app.post({ requestId: 'followup-protected', revision: read.snapshot.revision, changes: [valid] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(app.state.data[targetRow][10], 'Private unrelated information');
  }
});

test('follow-ups can clear attachments and unassign managers without changing financial cells', () => {
  const app = harness();
  const original = structuredClone(app.state.data.map(cells => cells.slice(1, 10)));
  const change = { kind: 'updateFollowUp', propertyId: '0:4', manager: 'TeamA', status: 'awaiting_response', note: 'Waiting', attachments: [{ name: 'proof.webp', dataUrl: 'data:image/webp;base64,AAAA' }] };
  const saved = app.post({ requestId: 'followup-clear-first', revision: app.read().snapshot.revision, changes: [change, { ...change, propertyId: '0:12' }] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(app.state.maxColumns, 10, 'monthly columns are never expanded');
  const result = app.post({ requestId: 'followup-clear-second', revision: saved.snapshot.revision, changes: [{ ...change, manager: '', status: 'resolved', note: '', attachments: [] }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties[0];
  assert.equal(property.manager, '');
  assert.equal(property.followUp.status, 'resolved');
  assert.equal(property.followUp.note, '');
  assert.deepEqual(property.followUp.attachments, []);
  assert.deepEqual(app.state.data.map(cells => cells.slice(1, 10)), original);
  assert.deepEqual(app.status.data[1].slice(7, 10), ['', '', '']);
  assert.equal(app.state.maxColumns, 10);
});

test('follow-up protection includes formulas with blank displayed values', () => {
  for (const r of [2, 3]) {
    const app = harness();
    app.state.maxColumns = 16;
    app.state.formulas[r][14] = '=IF(TRUE,"","")';
    const result = app.post({ requestId: 'followup-formula-protect', revision: app.read().snapshot.revision, changes: [{ kind: 'updateFollowUp', propertyId: '0:4', manager: '', status: 'not_contacted', note: '', attachments: [] }] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(app.state.formulas[r][14], '=IF(TRUE,"","")');
  }
});


test('legacy follow-ups migrate together to an existing empty Status tab and clear only owned cells',()=>{
 const app=harness();app.status.exists=true;app.status.maxRows=1;app.status.maxColumns=6;app.state.maxColumns=16;
 const headers=['Follow-up status','Follow-up note','Follow-up updated at','Follow-up attachment 1','Follow-up attachment 2','Follow-up attachment 3'];
 const attachment={name:'receipt.png',dataUrl:'data:image/png;base64,aGVsbG8='};
 for(const r of [3,11]){app.state.data[r-1].push(...headers);app.state.data[r].push('awaiting_response','Old note','2026-10-31T12:00:00Z',JSON.stringify(attachment),'','');}
 const before=app.read();assert.equal(before.snapshot.months[0].properties[1].followUp.note,'Old note');assert.equal(app.state.writes,0);
 const result=app.post({requestId:'migrate-status-001',revision:before.snapshot.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamC',status:'resolved',note:'New note',attachments:[]}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(app.status.data.length,3);assert.equal(app.status.maxColumns,10);assert.equal(app.status.maxRows,3);
 assert.equal(result.snapshot.months[0].properties[0].followUp.note,'New note');assert.deepEqual(result.snapshot.months[0].properties[1].followUp.attachments,[attachment]);
 for(const r of [2,3,10,11])assert.deepEqual(app.state.data[r].slice(10,16),Array(6).fill(''));
 assert.equal(app.state.writes,1);
});

test('Status records take precedence over old metadata and are updated without duplicates',()=>{
 const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamC',status:'resolved',note:'Current',attachments:[]};
 const saved=app.post({requestId:'status-precedence-1',revision:app.read().snapshot.revision,changes:[change]});assert.equal(saved.ok,true);
 app.state.maxColumns=16;app.state.data[2].push(...app.context.CASTLE_FOLLOWUP_HEADERS);app.state.data[3].push('not_contacted','Outdated','','','','');
 const before=app.read();assert.equal(before.snapshot.months[0].properties[0].followUp.note,'Current');
 const result=app.post({requestId:'status-precedence-2',revision:before.snapshot.revision,changes:[{...change,note:'Updated'}]});assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(app.status.data.length,2);assert.equal(app.status.data[1][5],'Updated');assert.equal(app.state.data[3][11],'');
});

test('Status protects unrelated data and duplicate or formula-based records',()=>{
 for(const scenario of ['header','duplicate','formula']){
  const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamC',status:'resolved',note:'Current',attachments:[]};
  const saved=app.post({requestId:'status-protect-1',revision:app.read().snapshot.revision,changes:[change]});assert.equal(saved.ok,true);
  if(scenario==='header')app.status.data[0][0]='Private records';
  if(scenario==='duplicate')app.status.data.push([...app.status.data[1]]);
  if(scenario==='formula')app.status.formulas[1][5]='=A1';
  const result=app.read();assert.equal(result.error.code,'SOURCE_DATA');assert.equal(app.state.writes,1);
 }
});

test('failed Status save leaves legacy metadata and manager intact',()=>{
 const app=harness();app.state.maxColumns=16;app.state.data[2].push(...app.context.CASTLE_FOLLOWUP_HEADERS);app.state.data[3].push('not_contacted','Keep me','','','','');
 const before=app.read().snapshot;const original=structuredClone(app.state.data);app.state.failWrite=true;
 const result=app.post({requestId:'status-failure-001',revision:before.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamC',status:'resolved',note:'New',attachments:[]}]});
 assert.equal(result.ok,false);assert.deepEqual(app.state.data,original);assert.equal(app.status.exists,false);
});

test('Status identifies properties by month sheet ID and name, independently of row positions',()=>{
 const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamC',status:'resolved',note:'November only',attachments:[]};
 const saved=app.post({requestId:'status-month-001',revision:app.read().snapshot.revision,changes:[change]});assert.equal(saved.ok,true);
 const original=app.spreadsheet.getSheets;app.spreadsheet.getSheets=()=>[...original(),{...app.sheet,getSheetId:()=>2,getName:()=> 'Dec, 2026'}];
 const read=app.read();assert.equal(read.ok,true,JSON.stringify(read));
 assert.equal(read.snapshot.months.find((m:any)=>m.id==='0').properties[0].followUp.note,'November only');
 assert.equal(read.snapshot.months.find((m:any)=>m.id==='2').properties[0].followUp,undefined);
});
