/**
 * Castle monthly AR bridge. Deploy as a web app executing as the sheet owner.
 * The public deployment URL grants access to this one spreadsheet; it is not a login.
 * Enable the advanced Sheets service (included in appsscript.json).
 * GET only reads. POST validates every change, then submits one atomic Sheets batch.
 */
var CASTLE_SPREADSHEET_ID = '1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY';
var CASTLE_MAX_CENTS = 999999999999;
var CASTLE_REQUEST_PREFIX = 'castle_request_';
var CASTLE_HEADERS = ['Account Manager', 'Property Name', '', 'Amount', 'Platform Payout Time', 'Payout Bundle Amount', 'Bank Received Time', 'Bank Received Amount', 'Verify By System', 'Verify By Daisy'];

function doGet(e) {
  var parameters = e && e.parameter || {};
  var callback = parameters.callback || '';
  try {
    if (callback && !/^castleCallback_[a-zA-Z0-9_]+$/.test(callback)) {
      return castleOutput(castleError('BAD_REQUEST', 'Invalid callback name.'));
    }
    var result;
    if (parameters.action === 'read') result = { ok: true, snapshot: castleRead().snapshot };
    else if (parameters.action === 'status') {
      castleRequestId(parameters.requestId);
      result = castleStatus(parameters.requestId);
    } else result = castleError('BAD_REQUEST', 'GET supports only read and status. Changes require POST.');
    return castleOutput(result, callback);
  } catch (error) {
    return castleOutput(castleCaught(error), callback);
  }
}

function doPost(e) {
  var body, fingerprint, lock, locked = false, journaled = false;
  try {
    var payload = e && e.parameter && e.parameter.payload;
    if (payload === undefined) payload = e && e.postData && e.postData.contents;
    if (typeof payload !== 'string' || payload.length > 200000) castleThrow('BAD_REQUEST', 'A JSON payload of at most 200 KB is required.');
    try { body = JSON.parse(payload); } catch (_) { castleThrow('BAD_REQUEST', 'The request is not valid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) castleThrow('BAD_REQUEST', 'A request object is required.');
    castleRequestId(body.requestId);
    fingerprint = castleHash(JSON.stringify(body));
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10000);
    if (!locked) {
      var busy = castleError('BUSY', 'Another save is in progress. Wait for it to finish, then try again.');
      // This lets a cross-origin form caller see the error without replacing an active journal.
      if (!castleRecord(body.requestId)) castleCacheResult(body.requestId, busy);
      return castleOutput(busy);
    }
    var existing = castleRecord(body.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return castleOutput(castleError('REQUEST_ID_REUSED', 'This request ID was already used for a different save.'));
      return castleOutput(castleStatus(body.requestId));
    }
    castleKeys(body, ['requestId', 'revision', 'changes']);
    if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)) castleThrow('VALIDATION', 'A valid sheet revision is required.');
    if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 500) castleThrow('VALIDATION', 'Provide between 1 and 500 changes.');
    var current = castleRead();
    if (current.snapshot.revision !== body.revision) castleThrow('CONFLICT', 'The sheet changed since you loaded it. Refresh and review your changes before saving.');
    var requests = castleBuildRequests(body.changes, current);
    castlePruneJournal();
    castleStore(body.requestId, { fingerprint: fingerprint, state: 'pending', at: Date.now() });
    journaled = true;
    CacheService.getScriptCache().remove(CASTLE_REQUEST_PREFIX + body.requestId);
    // Google validates the entire batch before applying any request. A transport
    // failure can still leave the client unsure whether the whole batch committed.
    try {
      Sheets.Spreadsheets.batchUpdate({ requests: requests }, CASTLE_SPREADSHEET_ID);
    } catch (_) {
      var uncertain = castleError('WRITE_UNCONFIRMED', 'Google did not confirm the save. The batch may have been saved in full. Refresh the sheet and check the values before submitting a new save.');
      castleStore(body.requestId, { fingerprint: fingerprint, state: 'error', result: uncertain, at: Date.now() });
      return castleOutput(uncertain);
    }
    // Commit the receipt before refreshing so a read outage cannot repeat an append.
    castleStore(body.requestId, { fingerprint: fingerprint, state: 'saved', at: Date.now() });
    var result;
    try { result = { ok: true, snapshot: castleRead().snapshot }; }
    catch (_) { result = castleError('SAVED_REFRESH_FAILED', 'Your changes were saved, but the updated sheet could not be loaded. Refresh to view them; do not submit the same changes again.'); }
    if (result.ok) castleCacheResult(body.requestId, result);
    return castleOutput(result);
  } catch (error) {
    var failure = castleCaught(error);
    if (journaled) failure = castleError('WRITE_UNCONFIRMED', 'The save could not be confirmed. Refresh the sheet and check the values before submitting a new save.');
    if (body && typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) && locked && !journaled) {
      try { castleStore(body.requestId, { fingerprint: fingerprint, state: 'error', result: failure, at: Date.now() }); } catch (_) { /* No source changes have been made. */ }
    }
    return castleOutput(failure);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function castleRead() {
  var book = SpreadsheetApp.openById(CASTLE_SPREADSHEET_ID);
  var timezone = book.getSpreadsheetTimeZone();
  var months = [], source = [], monthIndex = Object.create(null), propertyIndex = Object.create(null), paymentIndex = Object.create(null);
  book.getSheets().forEach(function (sheet) {
    var label = sheet.getName(), monthKey = castleMonth(label);
    if (!monthKey) return; // Never read unrelated tabs.
    var lastRow = sheet.getLastRow();
    if (!lastRow) return;
    var range = sheet.getRange(1, 1, lastRow, 10);
    var values = range.getValues(), formulas = range.getFormulas();
    if (!values.some(castleHeader)) return;
    var id = String(sheet.getSheetId());
    var month = { id: id, label: label, month: monthKey, properties: [] };
    var meta = { sheetId: Number(id), lastRow: lastRow, maxRows: sheet.getMaxRows(), month: month };
    monthIndex[id] = meta;
    source.push({ id: id, label: label, values: values, formulas: formulas });
    for (var index = 0; index < values.length; index++) {
      if (!castleHeader(values[index])) continue;
      var totalIndex = index + 1, total = values[totalIndex];
      if (!total || castleText(total[2]) !== 'total payment' || !String(total[1] || '').trim()) castleThrow('SOURCE_DATA', label + ': expected a named Total Payment row after header row ' + (index + 1) + '.');
      var propertyId = id + ':' + (totalIndex + 1);
      var property = { id: propertyId, name: String(total[1]).trim(), manager: String(total[0] || '').trim(), totalCents: castleSourceCents(total[3], false, label + '!D' + (totalIndex + 1)), payments: [] };
      propertyIndex[propertyId] = { sheetId: Number(id), row: totalIndex + 1, property: property };
      var foundAr = false;
      for (var paymentIndexRow = totalIndex + 1; paymentIndexRow < values.length; paymentIndexRow++) {
        var paymentRow = values[paymentIndexRow], rowNumber = paymentIndexRow + 1;
        var rowType = castleText(paymentRow[2]);
        if (rowType === 'ar') {
          var ar = castleSourceCents(paymentRow[3], true, label + '!D' + rowNumber);
          if (ar !== null) property.sourceArCents = ar;
          foundAr = true;
          index = paymentIndexRow;
          break;
        }
        var type = { 'airbnb payment': 'Airbnb', 'vrbo payment': 'Vrbo', 'owner payment': 'Owner' }[rowType];
        if (!type) castleThrow('SOURCE_DATA', label + ': unrecognized payment row ' + rowNumber + '. Expected Airbnb Payment, Vrbo Payment, Owner Payment, or AR.');
        var paymentId = id + ':' + rowNumber;
        var payment = {
          id: paymentId, type: type,
          amountCents: castleSourceCents(paymentRow[3], true, label + '!D' + rowNumber),
          payoutDate: castleSourceDate(paymentRow[4], timezone, label + '!E' + rowNumber),
          bundleCents: castleSourceCents(paymentRow[5], true, label + '!F' + rowNumber),
          bankDate: castleSourceDate(paymentRow[6], timezone, label + '!G' + rowNumber),
          bankCents: castleSourceCents(paymentRow[7], true, label + '!H' + rowNumber),
          verifiedByDaisy: paymentRow[9] === true || castleText(paymentRow[9]) === 'true'
        };
        property.payments.push(payment);
        paymentIndex[paymentId] = { sheetId: Number(id), row: rowNumber, payment: payment };
      }
      if (!foundAr || !property.payments.length) castleThrow('SOURCE_DATA', label + ': property ' + property.name + ' is missing payment rows or its AR row.');
      month.properties.push(property);
    }
    months.push(month);
  });
  if (!months.length) castleThrow('SOURCE_DATA', 'No recognized monthly AR sheet was found. Use a month tab such as Nov, 2026 with the expected A:J headers.');
  months.sort(function (a, b) { return b.month.localeCompare(a.month) || a.id.localeCompare(b.id); });
  return {
    snapshot: { revision: castleHash(JSON.stringify({ timezone: timezone, sheets: source })), months: months, updatedAt: new Date().toISOString(), spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + CASTLE_SPREADSHEET_ID + '/edit' },
    months: monthIndex, properties: propertyIndex, payments: paymentIndex
  };
}

function castleBuildRequests(changes, current) {
  var requests = [], targets = {}, appendRows = {}, addedNames = {};
  changes.forEach(function (change) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) castleThrow('VALIDATION', 'Every change must be an object.');
    var target;
    if (change.kind === 'setTotal') {
      castleKeys(change, ['kind', 'propertyId', 'amountCents']);
      target = current.properties[change.propertyId];
      if (!target) castleThrow('VALIDATION', 'Unknown property ID. Refresh the sheet.');
      castleCents(change.amountCents, false, true);
      castleUnique(targets, 'total:' + change.propertyId);
      requests.push(castleCell(target.sheetId, target.row, 4, change.amountCents / 100));
    } else if (change.kind === 'updatePayment') {
      castleKeys(change, ['kind', 'paymentId', 'fields']);
      target = current.payments[change.paymentId];
      if (!target) castleThrow('VALIDATION', 'Unknown payment ID. Refresh the sheet.');
      var fields = change.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) castleThrow('VALIDATION', 'Payment fields are required.');
      var columns = { amountCents: 4, payoutDate: 5, bundleCents: 6, bankDate: 7, bankCents: 8, verifiedByDaisy: 10 };
      castleKeys(fields, Object.keys(columns));
      Object.keys(fields).forEach(function (key) {
        castleUnique(targets, 'payment:' + change.paymentId + ':' + key);
        var value = fields[key];
        if (key === 'verifiedByDaisy') {
          if (typeof value !== 'boolean') castleThrow('VALIDATION', 'Daisy verification must be true or false.');
          requests.push(castleCell(target.sheetId, target.row, columns[key], value));
        } else if (key === 'payoutDate' || key === 'bankDate') {
          if (typeof value !== 'string' || (value !== '' && !castleDateValid(value))) castleThrow('VALIDATION', 'Dates must be valid YYYY-MM-DD values or empty.');
          var dateValue = value ? (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000 : null;
          requests.push(castleCell(target.sheetId, target.row, columns[key], dateValue, 'date'));
        } else {
          castleCents(value, true, false);
          requests.push(castleCell(target.sheetId, target.row, columns[key], value === null ? null : value / 100));
        }
      });
      if ('bundleCents' in fields || 'bankCents' in fields) {
        // Only managed verification is updated; unrelated values and AR formulas survive.
        var verificationKey = 'system:' + change.paymentId;
        if (!targets[verificationKey]) {
          targets[verificationKey] = true;
          requests.push(castleCell(target.sheetId, target.row, 9, '=IF(OR(F' + target.row + '="",H' + target.row + '=""),"",ROUND(F' + target.row + ',2)=ROUND(H' + target.row + ',2))', 'formula'));
        }
      }
    } else if (change.kind === 'addProperty') {
      castleKeys(change, ['kind', 'monthId', 'name', 'manager', 'totalCents']);
      target = current.months[change.monthId];
      if (!target) castleThrow('VALIDATION', 'Unknown month ID.');
      var name = castleName(change.name, 'Property name');
      var manager = castleName(change.manager, 'Account manager');
      castleCents(change.totalCents, false, true);
      var nameKey = change.monthId + ':' + name.toLowerCase();
      if (addedNames[nameKey] || target.month.properties.some(function (property) { return property.name.toLowerCase() === name.toLowerCase(); })) castleThrow('VALIDATION', 'This property already exists in the selected month.');
      addedNames[nameKey] = true;
      var firstRow = appendRows[change.monthId] || target.lastRow + 1;
      appendRows[change.monthId] = firstRow + 8;
      var totalRow = firstRow + 1;
      var rows = [CASTLE_HEADERS.slice(), [manager, name, 'Total Payment', change.totalCents / 100], ['', '', 'Airbnb Payment'], ['', '', 'Airbnb Payment'], ['', '', 'Airbnb Payment'], ['', '', 'Vrbo Payment'], ['', '', 'Owner Payment', 0], ['', '', 'AR']];
      rows.forEach(function (values, offset) {
        var cells = [];
        for (var column = 0; column < 10; column++) cells.push(castleValue(values[column] === undefined ? null : values[column]));
        if (offset === 7) cells[3] = { userEnteredValue: { formulaValue: '=D' + totalRow + '-SUM(D' + (totalRow + 1) + ':D' + (totalRow + 5) + ')' } };
        if (offset >= 2 && offset <= 6) {
          var row = firstRow + offset;
          cells[8] = { userEnteredValue: { formulaValue: '=IF(OR(F' + row + '="",H' + row + '=""),"",ROUND(F' + row + ',2)=ROUND(H' + row + ',2))' } };
        }
        requests.push({ updateCells: { start: { sheetId: target.sheetId, rowIndex: firstRow + offset - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } });
      });
      requests.push({ setDataValidation: { range: { sheetId: target.sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 5, startColumnIndex: 9, endColumnIndex: 10 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } });
      requests.push({ repeatCell: { range: { sheetId: target.sheetId, startRowIndex: totalRow - 1, endRowIndex: totalRow + 6, startColumnIndex: 3, endColumnIndex: 8 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } }, fields: 'userEnteredFormat.numberFormat' } });
    } else castleThrow('VALIDATION', 'Unknown change kind.');
  });
  Object.keys(appendRows).forEach(function (monthId) {
    var target = current.months[monthId], needed = appendRows[monthId] - 1;
    if (needed > target.maxRows) requests.unshift({ appendDimension: { sheetId: target.sheetId, dimension: 'ROWS', length: needed - target.maxRows } });
  });
  return requests;
}

function castleCell(sheetId, row, column, value, type) {
  var cell = type === 'formula' ? { userEnteredValue: { formulaValue: value } } : castleValue(value);
  var fields = 'userEnteredValue';
  if (type === 'date') { cell.userEnteredFormat = { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } }; fields += ',userEnteredFormat.numberFormat'; }
  return { updateCells: { start: { sheetId: sheetId, rowIndex: row - 1, columnIndex: column - 1 }, rows: [{ values: [cell] }], fields: fields } };
}

function castleValue(value) {
  if (value === null || value === '') return {};
  var key = typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue';
  var entered = {}; entered[key] = value;
  return { userEnteredValue: entered };
}

function castleHeader(row) {
  return row && CASTLE_HEADERS.every(function (header, index) { return !header || castleText(row[index]) === castleText(header); });
}

function castleMonth(label) {
  var match = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(20\d{2})$/i.exec(label.trim());
  if (!match) return null;
  var index = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  return match[2] + '-' + String(index).padStart(2, '0');
}

function castleSourceCents(value, nullable, location) {
  if (value === '' || value === null || value === undefined) {
    if (nullable) return null;
    castleThrow('SOURCE_DATA', location + ': total payment is blank. Enter a number, including 0 if appropriate.');
  }
  if (typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !isFinite(value) || Math.abs(value * 100) > CASTLE_MAX_CENTS) castleThrow('SOURCE_DATA', location + ': expected a numeric amount in the sheet currency.');
  return Math.round((value + (value < 0 ? -1 : 1) * Number.EPSILON) * 100);
}

function castleSourceDate(value, timezone, location) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  if (typeof value === 'string' && castleDateValid(value.trim())) return value.trim();
  castleThrow('SOURCE_DATA', location + ': use a sheet date or a YYYY-MM-DD date.');
}

function castleDateValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  var date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function castleCents(value, nullable, nonnegative) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > CASTLE_MAX_CENTS || (nonnegative && value < 0)) castleThrow('VALIDATION', 'Amounts must be whole cents within the supported range; totals cannot be negative.');
}

function castleName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || /^[=+@-]/.test(value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) castleThrow('VALIDATION', label + ' must be 1–160 characters and cannot begin with a formula marker or contain control characters.');
  return value.trim();
}

function castleKeys(value, allowed) {
  if (Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; })) castleThrow('VALIDATION', 'The request contains an unsupported field.');
}

function castleUnique(targets, key) {
  if (targets[key]) castleThrow('VALIDATION', 'The same target field occurs more than once in this save.');
  targets[key] = true;
}

function castleRequestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) castleThrow('BAD_REQUEST', 'A request ID with 8–100 letters, digits, underscores, or hyphens is required.');
}

function castleRecord(requestId) {
  var raw = PropertiesService.getScriptProperties().getProperty(CASTLE_REQUEST_PREFIX + requestId);
  return raw ? JSON.parse(raw) : null;
}

function castleStore(requestId, record) {
  PropertiesService.getScriptProperties().setProperty(CASTLE_REQUEST_PREFIX + requestId, JSON.stringify(record));
}

function castleStatus(requestId) {
  var record = castleRecord(requestId);
  var cached = CacheService.getScriptCache().get(CASTLE_REQUEST_PREFIX + requestId);
  if (!record) return cached ? JSON.parse(cached) : { ok: true, pending: true };
  if (record.state === 'error') return record.result;
  if (record.state === 'saved') {
    if (cached) return JSON.parse(cached);
    try { return { ok: true, snapshot: castleRead().snapshot }; }
    catch (_) { return castleError('SAVED_REFRESH_FAILED', 'Your changes were saved, but the sheet could not be refreshed. Reload later to view the saved values.'); }
  }
  if (Date.now() - record.at > 7 * 60 * 1000) return castleError('WRITE_UNCONFIRMED', 'This save has no final confirmation. Refresh the sheet and check the values before submitting another save.');
  return { ok: true, pending: true };
}

function castleCacheResult(requestId, result) {
  var json = JSON.stringify(result);
  // Cache is best effort. Durable compact receipts below survive cache eviction.
  try { if (json.length < 25000) CacheService.getScriptCache().put(CASTLE_REQUEST_PREFIX + requestId, json, 21600); } catch (_) {}
}

function castlePruneJournal() {
  var properties = PropertiesService.getScriptProperties(), all = properties.getProperties();
  var keys = Object.keys(all).filter(function (key) { return key.indexOf(CASTLE_REQUEST_PREFIX) === 0; });
  keys.sort(function (a, b) { return JSON.parse(all[a]).at - JSON.parse(all[b]).at; });
  keys.forEach(function (key, index) {
    var record = JSON.parse(all[key]);
    if (Date.now() - record.at > 7 * 86400000 || index < keys.length - 799) properties.deleteProperty(key);
  });
}

function castleHash(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function castleText(value) { return String(value === null || value === undefined ? '' : value).trim().toLowerCase(); }
function castleError(code, message) { return { ok: false, error: { code: code, message: message } }; }
function castleThrow(code, message) { var error = new Error(message); error.castleCode = code; throw error; }
function castleCaught(error) { return castleError(error && error.castleCode || 'SERVER_ERROR', error && error.castleCode ? error.message : 'The sheet service could not complete the request. Try again shortly.'); }
function castleOutput(result, callback) {
  var json = JSON.stringify(result).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return ContentService.createTextOutput(callback ? callback + '(' + json + ');' : json).setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
