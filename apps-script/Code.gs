/**
 * Castle monthly AR bridge. Deploy as a web app executing as the sheet owner.
 * The public deployment URL grants access to this one spreadsheet; it is not a login.
 * Enable the advanced Sheets service (included in appsscript.json).
 * GET only reads. POST validates every change, then submits one atomic Sheets batch.
 */
var CASTLE_SPREADSHEET_ID = '1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY';
var CASTLE_MAX_CENTS = 999999999999;
var CASTLE_REQUEST_PREFIX = 'castle_request_';
var CASTLE_FOLLOWUP_HEADERS = ['Follow-up status', 'Follow-up note', 'Follow-up updated at', 'Follow-up attachment 1', 'Follow-up attachment 2', 'Follow-up attachment 3'];
var CASTLE_STATUS_HEADERS = ['Month sheet ID', 'Month', 'Property name', 'Account manager', 'Follow-up status', 'Follow-up note', 'Follow-up updated at', 'Follow-up attachment 1', 'Follow-up attachment 2', 'Follow-up attachment 3'];
var CASTLE_FOLLOWUP_STATUSES = ['not_contacted', 'contact_attempted', 'awaiting_response', 'owner_responded', 'payment_promised', 'follow_up_needed', 'resolved'];
var CASTLE_HEADERS = ['Account Manager', 'Property Name', '', 'Amount', 'Platform Payout Time', 'Payout Bundle Amount', 'Bank Received Time', 'Bank Received Amount', 'Verify By System', 'Verify By Daisy'];

// Keep the spreadsheet's A2 manager selector alongside the web-app bridge.
const SHEET_NAME = 'Nov, 2026';
const SELECTOR_CELL = 'A2';
const FIRST_DATA_ROW = 3;

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();

  if (
    sheet.getName() !== SHEET_NAME ||
    e.range.getA1Notation() !== SELECTOR_CELL
  ) return;

  filterAccountManagers();
}

function filterAccountManagers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const selection = String(
    sheet.getRange(SELECTOR_CELL).getDisplayValue()
  ).trim().toLowerCase();

  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  // Remove the old standard filter to avoid conflicts.
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  // Restore visibility before applying a new selection.
  sheet.showRows(
    FIRST_DATA_ROW,
    lastRow - FIRST_DATA_ROW + 1
  );

  // All dropdown or empty A2 means show everything.
  if (selection === '' || selection === 'all') return;

  const values = sheet.getRange(
    FIRST_DATA_ROW, 1,
    lastRow - FIRST_DATA_ROW + 1, 3
  ).getDisplayValues();

  const sections = [];
  let start = -1;
  let team = '';

  function saveSection(endIndex) {
    if (start < 0) return;

    sections.push({
      firstRow: FIRST_DATA_ROW + start,
      lastRow: FIRST_DATA_ROW + endIndex,
      team: team
    });
  }

  for (let i = 0; i < values.length; i++) {
    const colA = String(values[i][0]).trim().toLowerCase();
    const colC = String(values[i][2]).trim().toLowerCase();

    if (colA === 'account manager') {
      // Close any previous incomplete section.
      if (start >= 0) saveSection(i - 1);

      start = i;
      team = i + 1 < values.length
        ? String(values[i + 1][0]).trim().toLowerCase()
        : '';
    }

    if (colC === 'ar' && start >= 0) {
      saveSection(i);
      start = -1;
      team = '';
    }
  }

  // Include the final section if AR is missing.
  if (start >= 0) {
    saveSection(values.length - 1);
  }

  // Hide entire sections belonging to other teams.
  sections.forEach(section => {
    if (section.team !== selection) {
      sheet.hideRows(
        section.firstRow,
        section.lastRow - section.firstRow + 1
      );
    }
  });
}

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
    var maxColumns = sheet.getMaxColumns();
    var range = sheet.getRange(1, 1, lastRow, Math.min(17, maxColumns));
    var values = range.getValues(), formulas = range.getFormulas();
    if (!values.some(castleHeader)) return;
    var bankOffset=castleText(values.filter(castleHeader)[0][6])==='bank details'?1:0;
    if(values.filter(castleHeader).some(function(row){return (castleText(row[6])==='bank details'?1:0)!==bankOffset;}))castleThrow('SOURCE_DATA',label+': use the same Bank Details column layout for every property header.');
    var id = String(sheet.getSheetId());
    var month = { id: id, label: label, month: monthKey, properties: [] };
    var meta = { bankOffset:bankOffset, sheetId: Number(id), lastRow: lastRow, maxRows: sheet.getMaxRows(), maxColumns: maxColumns, month: month };
    monthIndex[id] = meta;
    source.push({ id: id, label: label, values: values, formulas: formulas });
    for (var index = 0; index < values.length; index++) {
      if (!castleHeader(values[index])) continue;
      var totalIndex = index + 1, total = values[totalIndex];
      if (!total || castleText(total[2]) !== 'total payment' || !String(total[1] || '').trim()) castleThrow('SOURCE_DATA', label + ': expected a named Total Payment row after header row ' + (index + 1) + '.');
      var propertyId = id + ':' + (totalIndex + 1);
      var property = { id: propertyId, name: String(total[1]).trim(), manager: String(total[0] || '').trim(), totalCents: castleSourceCents(total[3], false, label + '!D' + (totalIndex + 1)), payments: [] };
      var followupHeaders = values[index].slice(10+bankOffset, 16+bankOffset), followupValues = total.slice(10+bankOffset, 16+bankOffset);
      if (CASTLE_FOLLOWUP_HEADERS.every(function (header, offset) { return followupHeaders[offset] === header; })) {
        var followup = { status: followupValues[0] || 'not_contacted', note: followupValues[1] || '', updatedAt: followupValues[2] || '', attachments: [] };
        followupValues.slice(3).forEach(function (value) {
          if (!value) return;
          try { followup.attachments.push(JSON.parse(value)); } catch (_) { castleThrow('SOURCE_DATA', label + ': invalid follow-up attachment JSON.'); }
        });
        try { castleValidateFollowUp(followup); } catch (_) { castleThrow('SOURCE_DATA', label + ': invalid follow-up metadata.'); }
        property.followUp = followup;
      }
      propertyIndex[propertyId] = { bankOffset:bankOffset, sheetId: Number(id), row: totalIndex + 1, property: property, followupHeaders: followupHeaders, followupValues: followupValues, followupFormulas: formulas[totalIndex].slice(10+bankOffset, 16+bankOffset), followupHeaderFormulas: formulas[index].slice(10+bankOffset, 16+bankOffset) };
      var foundAr = false;
      for (var paymentIndexRow = totalIndex + 1; paymentIndexRow < values.length; paymentIndexRow++) {
        var paymentRow = values[paymentIndexRow], rowNumber = paymentIndexRow + 1;
        var rowType = castleText(paymentRow[2]).replace(/\s+/g, ' ');
        if (rowType === 'ar') {
          propertyIndex[propertyId].arRow = rowNumber;
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
          bankDetails: bankOffset ? String(paymentRow[6] || '').trim() : '',
          bankDate: castleSourceDate(paymentRow[6+bankOffset], timezone, label + '!' + (bankOffset?'H':'G') + rowNumber),
          bankCents: castleSourceCents(paymentRow[7+bankOffset], true, label + '!' + (bankOffset?'I':'H') + rowNumber),
          verifiedBySystem: paymentRow[8+bankOffset] === '' ? undefined : paymentRow[8+bankOffset] === true || castleText(paymentRow[8+bankOffset]) === 'true',
          verifiedByDaisy: paymentRow[9+bankOffset] === true || castleText(paymentRow[9+bankOffset]) === 'true'
        };
        property.payments.push(payment);
        paymentIndex[paymentId] = { bankOffset:bankOffset, sheetId: Number(id), row: rowNumber, payment: payment };
      }
      if (!foundAr) castleThrow('SOURCE_DATA', label + ': property ' + property.name + ' is missing its AR row.');
      // Use the first established block, not a possibly unformatted recent addition.
      if (!meta.formatTemplate) {
        meta.formatTemplate = {
          headerRow: totalIndex, totalRow: totalIndex + 1, arRow: index + 1,
          payments: property.payments.map(function (payment) { return { row: paymentIndex[payment.id].row, type: payment.type }; })
        };
      }
      month.properties.push(property);
    }
    months.push(month);
  });
  // Manager work is independent of monthly financial tabs.
  var statusSheet = book.getSheetByName('Status');
  var status = { sheetId: null, lastRow: 0, maxRows: 0, maxColumns: 0, rows: Object.create(null) };
  if (statusSheet) {
    status.sheetId = statusSheet.getSheetId();
    status.lastRow = statusSheet.getLastRow();
    status.maxRows = statusSheet.getMaxRows();
    status.maxColumns = statusSheet.getMaxColumns();
    if (status.lastRow) {
      var statusRange = statusSheet.getRange(1, 1, status.lastRow, Math.min(10, status.maxColumns));
      var statusValues = statusRange.getValues(), statusFormulas = statusRange.getFormulas();
      source.push({ id: String(status.sheetId), values: statusValues, formulas: statusFormulas });
      if (!CASTLE_STATUS_HEADERS.every(function (header, i) { return statusValues[0][i] === header && !statusFormulas[0][i]; })) castleThrow('SOURCE_DATA', 'Status tab has unrelated headers. Preserve its contents and use an empty Status tab for follow-ups.');
      statusValues.slice(1).forEach(function (row, i) {
        if (!row.some(function (cell) { return cell !== ''; }) && !statusFormulas[i + 1].some(Boolean)) return;
        if (row[0] === '' || !String(row[2] || '').trim() || statusFormulas[i + 1].some(Boolean)) castleThrow('SOURCE_DATA', 'Status: invalid or formula-based record on row ' + (i + 2) + '.');
        var key = castleStatusKey(row[0], row[2]);
        if (status.rows[key]) castleThrow('SOURCE_DATA', 'Status: duplicate property and month record on row ' + (i + 2) + '.');
        var followup = { status: row[4] || 'not_contacted', note: row[5] || '', updatedAt: row[6] || '', attachments: [] };
        row.slice(7, 10).forEach(function (cell) { if (cell) { try { followup.attachments.push(JSON.parse(cell)); } catch (_) { castleThrow('SOURCE_DATA', 'Status: invalid attachment JSON.'); } } });
        try { castleValidateFollowUp(followup); } catch (_) { castleThrow('SOURCE_DATA', 'Status: invalid follow-up data.'); }
        status.rows[key] = { row: i + 2, followUp: followup };
      });
    }
  }
  var propertyKeys = Object.create(null);
  Object.keys(propertyIndex).forEach(function (id) {
    var target = propertyIndex[id], key = castleStatusKey(target.sheetId, target.property.name);
    target.legacyFollowUp = target.property.followUp;
    if (propertyKeys[key]) castleThrow('SOURCE_DATA', 'Duplicate property names in a month cannot be linked safely to Status.');
    propertyKeys[key] = true;
    if (status.rows[key]) target.property.followUp = status.rows[key].followUp;
  });
  var managerData = castleReadManagers(book, months, source);
  months.sort(function (a, b) { return b.month.localeCompare(a.month) || a.id.localeCompare(b.id); });
  return {
    managerData: managerData,
    snapshot: { bankStatementSchema: 1, managerHierarchy: 1, bankDetailsSchema: 1, managerDeletion: 1, managerProfiles: 1, managerSchema: 1, managers: managerData.managers.records, tasks: managerData.tasks.records, managerUpdates: managerData.updates.records, revision: castleHash(JSON.stringify({ timezone: timezone, sheets: source })), months: months, updatedAt: new Date().toISOString(), spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + CASTLE_SPREADSHEET_ID + '/edit' },
    months: monthIndex, properties: propertyIndex, payments: paymentIndex, status: status,
    sheetIds: book.getSheets().map(function (sheet) { return sheet.getSheetId(); })
  };
}

// Shared manager records use IDs; monthly column A remains a readable name.
var CASTLE_MANAGER_TABLES = {
  managers: {title:'Account Managers', fields:['id','name','email','notes','active','profileImage','role','parentManagerId']},
  tasks: {title:'Manager Tasks', fields:['id','managerId','title','description','dueDate','status','propertyKey','updatedAt']},
  updates: {title:'Manager Updates', fields:['id','managerId','text','taskId','propertyKey','createdAt']},
  assignments: {title:'Manager Assignments', fields:['id','propertyKey','managerId']}
};
function castleManagerName(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function castleDefaultManagerProfile(name) {
  var key=String(name||'').replace(/\s+/g,'').toLowerCase();
  return key==='teama'?'team-a':key==='teamb'?'team-b':'';
}
function castleValidateManagerProfile(value) {
  if(value===''||value==='team-a'||value==='team-b')return;
  if(typeof value!=='string'||value.length>45000)castleThrow('VALIDATION','Invalid profile image. Use a PNG, JPEG, or WebP image.');
  var match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0||!(match[1]==='png'?match[2].indexOf('iVBORw0KGgo')===0:match[1]==='jpeg'?match[2].indexOf('/9j/')===0:match[2].indexOf('UklGR')===0))castleThrow('VALIDATION','Invalid profile image. Use a PNG, JPEG, or WebP image.');
}
function castleReadManagers(book, months, source) {
  var tables = {};
  Object.keys(CASTLE_MANAGER_TABLES).forEach(function(key) {
    var definition=CASTLE_MANAGER_TABLES[key], sheet=book.getSheetByName(definition.title);
    var table={sheetId:sheet?sheet.getSheetId():null,maxRows:sheet?sheet.getMaxRows():0,maxColumns:sheet?sheet.getMaxColumns():0,records:[],lastRow:0};
    tables[key]=table;
    if(!sheet || !sheet.getLastRow())return;
    table.lastRow=sheet.getLastRow();
    var range=sheet.getRange(1,1,table.lastRow,Math.min(table.maxColumns,definition.fields.length));
    var values=range.getValues(), formulas=range.getFormulas();
    source.push({id:String(table.sheetId),values:values,formulas:formulas});
    var legacyProfiles=key==='managers'&&!values[0][5]&&!formulas[0][5];
    var legacyHierarchy=key==='managers'&&!values[0][6]&&!values[0][7]&&!formulas[0][6]&&!formulas[0][7];
    var headers=legacyProfiles?definition.fields.slice(0,5):legacyHierarchy?definition.fields.slice(0,6):definition.fields;
    if(!headers.every(function(f,i){return values[0][i]===f&&!formulas[0][i];})||(legacyProfiles&&values.slice(1).some(function(row,i){return (row[5]!==''&&row[5]!==undefined)||!!formulas[i+1][5];})))castleThrow('SOURCE_DATA',definition.title+': incompatible headers. Preserve this tab and use an empty tab with this name.');
    if(key==='managers'&&values.some(function(row,i){return row.slice(headers.length).some(function(v){return v!==''&&v!==undefined;})||formulas[i].slice(headers.length).some(Boolean);}))castleThrow('SOURCE_DATA','Account Managers: migration columns are occupied. Preserve their contents before adding role and parentManagerId.');
    var ids=Object.create(null);
    values.slice(1).forEach(function(row,i){
      if(!row.some(function(v){return v!=='';})&&!formulas[i+1].some(Boolean))return;
      if(formulas[i+1].some(Boolean)||!row[0]||ids[row[0]])castleThrow('SOURCE_DATA',definition.title+': invalid or duplicate record.');
      ids[row[0]]=true;var record={};definition.fields.forEach(function(f,j){record[f]=row[j]===undefined?'':row[j];});
      if(key==='tasks'&&record.dueDate instanceof Date)record.dueDate=Utilities.formatDate(record.dueDate,book.getSpreadsheetTimeZone(),'yyyy-MM-dd');
      ['updatedAt','createdAt'].forEach(function(f){if(record[f] instanceof Date)record[f]=record[f].toISOString();});
      try {
        castleManagerText(record.id,'Record ID',100,true);
        if(key==='managers'){
          if(legacyHierarchy){record.role='account_manager';record.parentManagerId='';}
          if(record.role==='')record.role='account_manager';
          if(legacyProfiles)record.profileImage=castleDefaultManagerProfile(record.name);
          castleValidateManagerProfile(record.profileImage);
          castleName(record.name,'Manager name');castleManagerText(record.email,'Email',254,false);castleManagerText(record.notes,'Notes',5000,false);
          if(record.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))throw new Error('Invalid email.');
        }else{
          castleManagerText(record.managerId,'Manager ID',100,key!=='assignments');castleManagerText(record.propertyKey,'Listing reference',500,key==='assignments');
          if(key==='tasks'){
            castleManagerText(record.title,'Task title',200,true);castleManagerText(record.description,'Description',5000,false);
            if(typeof record.dueDate!=='string'||!castleDateValid(record.dueDate)||['open','in_progress','completed'].indexOf(record.status)<0)throw new Error('Invalid task date or status.');
          }else if(key==='updates'){castleManagerText(record.text,'Update',5000,true);castleManagerText(record.taskId,'Task ID',100,false);}
          ['updatedAt','createdAt'].forEach(function(f){if(record[f]!==undefined&&(typeof record[f]!=='string'||(record[f]&&!Number.isFinite(Date.parse(record[f])))))throw new Error('Invalid timestamp.');});
        }
      } catch(error) {castleThrow('SOURCE_DATA',definition.title+': invalid record on row '+(i+2)+'. '+error.message);}
      if(key==='managers'&&typeof record.active!=='boolean')castleThrow('SOURCE_DATA','Account Managers: active must be TRUE or FALSE.');
      table.records.push(record);
    });
  });
  var managers=tables.managers.records, bootstrap=!tables.managers.lastRow;
  var names=Object.create(null);managers.forEach(function(m){var key=castleManagerName(m.name);if(!key||names[key])castleThrow('SOURCE_DATA','Account Managers: duplicate or empty manager name.');names[key]=m;});
  months.forEach(function(month){month.properties.forEach(function(p){
    var key=castleManagerName(p.manager),m=names[key];
    if(key&&!m&&bootstrap){m={id:'manager-'+castleHash(key).slice(0,32),name:p.manager.trim().replace(/\s+/g,' '),email:'',notes:'',active:true,role:'account_manager',parentManagerId:'',profileImage:castleDefaultManagerProfile(p.manager)};managers.push(m);names[key]=m;}
    // Column A is authoritative for direct spreadsheet assignment edits. Unknown
    // names stay visible for repair, but never enter a persisted catalog silently.
    p.managerId=m?m.id:'';if(m)p.manager=m.name;
  });});
  ['tasks','updates','assignments'].forEach(function(key){tables[key].records.forEach(function(r){if(r.managerId&&!managers.some(function(m){return m.id===r.managerId;}))castleThrow('SOURCE_DATA',CASTLE_MANAGER_TABLES[key].title+': record refers to an unknown manager.');});});
  castleValidateManagerHierarchy(managers,'SOURCE_DATA');
  return tables;
}
function castleManagerText(value,label,max,required) {
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))castleThrow('VALIDATION',label+' is invalid (maximum '+max+' characters).');
  return value.trim();
}
function castleManagerLookup(managers,name,currentId) {
  if(name==='')return null;
  var m=managers.filter(function(m){return castleManagerName(m.name)===castleManagerName(name);})[0];
  if(!m)castleThrow('VALIDATION','Choose a registered account manager.');
  if(!m.active&&m.id!==currentId)castleThrow('VALIDATION','This account manager is inactive.');
  return m;
}
function castleManagerTableRequests(current,tables) {
  var requests=[],used=current.sheetIds.slice();
  Object.keys(CASTLE_MANAGER_TABLES).forEach(function(key){
    var definition=CASTLE_MANAGER_TABLES[key],table=tables[key],id=table.sheetId,count=Math.max(100,table.records.length+1);
    if(id===null){id=1000;while(used.indexOf(id)>=0)id++;used.push(id);requests.push({addSheet:{properties:{sheetId:id,title:definition.title,gridProperties:{rowCount:count,columnCount:definition.fields.length,frozenRowCount:1}}}});}
    else{
      if(table.maxRows<count)requests.push({appendDimension:{sheetId:id,dimension:'ROWS',length:count-table.maxRows}});
      if(table.maxColumns<definition.fields.length)requests.push({appendDimension:{sheetId:id,dimension:'COLUMNS',length:definition.fields.length-table.maxColumns}});
    }
    var rows=[definition.fields].concat(table.records.map(function(record){return definition.fields.map(function(f){return record[f]===undefined?'':record[f];});}));
    // Preserve linked records; clear trailing cells after deleting unused managers.
    // Compact blank spreadsheet rows without leaving duplicate trailing records.
    while(rows.length<table.lastRow)rows.push(definition.fields.map(function(){return '';}));
    requests.push({updateCells:{start:{sheetId:id,rowIndex:0,columnIndex:0},rows:rows.map(function(row){return {values:row.map(castleValue)};}),fields:'userEnteredValue'}});
  });
  return requests;
}
function castleBuildRequests(changes,current) {
  var tables=JSON.parse(JSON.stringify(current.managerData)),managers=tables.managers.records,financial=[],seen={},now=new Date().toISOString();
  var properties=current.snapshot.months.reduce(function(all,m){m.properties.forEach(function(p){all[castleStatusKey(m.id,p.name)]=p;});return all;},{});
  changes.forEach(function(c){
    if(!c||typeof c!=='object')castleThrow('VALIDATION','Every change must be an object.');
    if(c.kind==='deleteManager'){
      castleKeys(c,['kind','managerId']);castleManagerText(c.managerId,'Manager ID',100,true);castleUnique(seen,'managers:'+c.managerId);
      var deleteIndex=managers.map(function(m){return m.id;}).indexOf(c.managerId);
      if(deleteIndex<0)castleThrow('VALIDATION','Account manager not found.');
      if(Object.keys(properties).some(function(key){return properties[key].managerId===c.managerId;})||['tasks','updates'].some(function(key){return tables[key].records.some(function(r){return r.managerId===c.managerId;});})||tables.assignments.records.some(function(r){return r.managerId===c.managerId&&!properties[r.propertyKey];}))castleThrow('VALIDATION','This manager has linked listings, tasks, or updates. Mark them inactive to preserve their history.');
      if(managers.some(function(m){return m.parentManagerId===c.managerId;}))castleThrow('VALIDATION','Reassign this manager?s assistants before deleting them.');
      managers.splice(deleteIndex,1);return;
    }
    if(c.kind!=='saveManager'&&c.kind!=='saveTask'&&c.kind!=='addManagerUpdate'){financial.push(JSON.parse(JSON.stringify(c)));return;}
    castleKeys(c,['kind',c.kind==='saveManager'?'manager':c.kind==='saveTask'?'task':'update']);
    var key=c.kind==='saveManager'?'managers':c.kind==='saveTask'?'tasks':'updates';
    var record=JSON.parse(JSON.stringify(c.manager||c.task||c.update||{})),fields=CASTLE_MANAGER_TABLES[key].fields;
    castleKeys(record,fields);castleManagerText(record.id,'Record ID',100,true);castleUnique(seen,key+':'+record.id);
    var records=tables[key].records,index=records.map(function(r){return r.id;}).indexOf(record.id),old=index<0?null:records[index];
    if(key==='managers'){
      record.role=record.role===undefined?(old&&old.role||'account_manager'):record.role;
      record.parentManagerId=record.parentManagerId===undefined?(old&&old.parentManagerId||''):record.parentManagerId;
      if(record.role==='account_manager')record.parentManagerId='';
      var parent=managers.filter(function(m){return m.id===record.parentManagerId;})[0];
      if(record.role==='assistant'&&parent&&!parent.active&&(!old||old.parentManagerId!==parent.id))castleThrow('VALIDATION','Choose an active parent Account Manager.');
      if(record.profileImage===undefined)record.profileImage=old?old.profileImage:'';
      castleValidateManagerProfile(record.profileImage);
      record.name=castleName(record.name,'Account manager').replace(/\s+/g,' ');
      record.email=castleManagerText(record.email,'Email',254,false);record.notes=castleManagerText(record.notes,'Notes',5000,false);
      if(typeof record.active!=='boolean')castleThrow('VALIDATION','Manager active must be true or false.');
      if(record.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))castleThrow('VALIDATION','Enter a valid email address.');
      if(managers.some(function(m){return m.id!==record.id&&castleManagerName(m.name)===castleManagerName(record.name);}))castleThrow('VALIDATION','An account manager with this name already exists.');
    }else{
      var manager=managers.filter(function(m){return m.id===record.managerId;})[0];
      if(!manager)castleThrow('VALIDATION','Choose a registered account manager.');
      if(!manager.active&&(!old||old.managerId!==manager.id))castleThrow('VALIDATION','This account manager is inactive.');
      castleManagerText(record.propertyKey,'Listing reference',500,false);
      if(record.propertyKey&&!properties[record.propertyKey])castleThrow('VALIDATION','The linked listing no longer exists.');
      if(key==='tasks'){
        record.title=castleManagerText(record.title,'Task title',200,true);record.description=castleManagerText(record.description,'Description',5000,false);
        if(typeof record.dueDate!=='string'||!castleDateValid(record.dueDate))castleThrow('VALIDATION','Choose a valid due date.');
        if(['open','in_progress','completed'].indexOf(record.status)<0)castleThrow('VALIDATION','Choose a valid task status.');record.updatedAt=now;
      }else{
        if(old)castleThrow('VALIDATION','This update already exists.');
        record.text=castleManagerText(record.text,'Update',5000,true);castleManagerText(record.taskId,'Task ID',100,false);
        if(record.taskId&&!tables.tasks.records.some(function(t){return t.id===record.taskId&&t.managerId===record.managerId;}))castleThrow('VALIDATION','Choose a task assigned to this manager.');record.createdAt=now;
      }
    }
    if(index<0)records.push(record);else records[index]=record;
  });
  castleValidateManagerHierarchy(managers,'VALIDATION');
  // Validate and canonicalize every assignment against records, including imports.
  financial.forEach(function(c){
    if(c.kind!=='addProperty'&&c.kind!=='updateFollowUp')return;
    var target=c.kind==='updateFollowUp'?current.properties[c.propertyId]:null;
    var manager=castleManagerLookup(managers,c.manager,target&&target.property.managerId);
    if(c.kind==='addProperty'&&!manager)castleThrow('VALIDATION','Choose a registered account manager.');
    c.manager=manager?manager.name:'';
  });
  // Rename monthly and Status display names through the existing atomic path.
  Object.keys(current.properties).forEach(function(id){
    var p=current.properties[id].property,m=managers.filter(function(m){return m.id===p.managerId;})[0];
    if(m&&m.name!==p.manager&&!financial.some(function(c){return c.kind==='updateFollowUp'&&c.propertyId===id;})){
      var f=p.followUp||{status:'not_contacted',note:'',attachments:[]};
      financial.push({kind:'updateFollowUp',propertyId:id,manager:m.name,status:f.status,note:f.note,attachments:f.attachments});
    }
  });
  var assignments=tables.assignments.records;
  function assign(key,managerId){var existing=assignments.filter(function(a){return a.propertyKey===key;})[0];if(existing)existing.managerId=managerId;else assignments.push({id:'assignment-'+castleHash(key).slice(0,32),propertyKey:key,managerId:managerId});}
  Object.keys(properties).forEach(function(key){assign(key,properties[key].managerId||'');});
  financial.forEach(function(c){if(c.kind==='addProperty'||c.kind==='updateFollowUp'){
    var target=c.kind==='updateFollowUp'?current.properties[c.propertyId]:null;
    if(c.kind==='updateFollowUp'&&!target)return; // The financial validator gives the precise error.
    var key=target?castleStatusKey(target.sheetId,target.property.name):castleStatusKey(c.monthId,c.name);
    var m=managers.filter(function(m){return m.name===c.manager;})[0];assign(key,m?m.id:'');
  }});
  var requests=castleFinancialRequests(financial,current);
  // Avoid migrating on unrelated financial writes; first manager/assignment write
  // persists the read-only bootstrap in the same transaction as the user's change.
  if(changes.some(function(c){return ['deleteManager','saveManager','saveTask','addManagerUpdate','addProperty','updateFollowUp'].indexOf(c.kind)>=0;}))requests=requests.concat(castleManagerTableRequests({sheetIds:current.sheetIds.concat(requests.filter(function(r){return !!r.addSheet;}).map(function(r){return r.addSheet.properties.sheetId;}))},tables));
  return requests;
}

function castleStatusKey(sheetId, name) {
  return JSON.stringify([String(sheetId), String(name).trim().toLowerCase()]);
}

function castleStatusRequests(current, changes) {
  var status = current.status, requests = [], sheetId = status.sheetId, nextRow = Math.max(2, status.lastRow + 1);
  if (sheetId === null) {
    sheetId = 1;
    while (current.sheetIds.indexOf(sheetId) >= 0) sheetId++;
    requests.push({ addSheet: { properties: { sheetId: sheetId, title: 'Status', gridProperties: { rowCount: Math.max(100, Object.keys(current.properties).length + 1), columnCount: 10, frozenRowCount: 1 } } } });
  } else if (status.maxColumns < 10) {
    requests.push({ appendDimension: { sheetId: sheetId, dimension: 'COLUMNS', length: 10 - status.maxColumns } });
  }
  if (!status.lastRow) CASTLE_STATUS_HEADERS.forEach(function (header, i) { requests.push(castleCell(sheetId, 1, i + 1, header)); });
  Object.keys(current.properties).forEach(function (id) {
    var target = current.properties[id], key = castleStatusKey(target.sheetId, target.property.name);
    var existing = status.rows[key], update = changes[id];
    // Move legacy records in the same atomic batch. Status wins if both exist.
    var value = update || (!existing && target.legacyFollowUp);
    if (value) {
      var row = existing ? existing.row : nextRow++;
      var values = [String(target.sheetId), current.months[String(target.sheetId)].month.label, target.property.name, update ? update.manager : target.property.manager, value.status, value.note, value.updatedAt || ''];
      for (var i = 0; i < 3; i++) values.push(value.attachments[i] ? JSON.stringify(value.attachments[i]) : '');
      values.forEach(function (cell, i) { requests.push(castleCell(sheetId, row, i + 1, cell)); });
    }
    if (target.legacyFollowUp) CASTLE_FOLLOWUP_HEADERS.forEach(function (header, i) {
      if (target.followupHeaders[i] === header && !target.followupHeaderFormulas[i] && !target.followupFormulas[i]) {
        requests.push(castleCell(target.sheetId, target.row - 1, i + 11 + (target.bankOffset||0), ''));
        requests.push(castleCell(target.sheetId, target.row, i + 11 + (target.bankOffset||0), ''));
      }
    });
  });
  if (status.sheetId !== null && nextRow - 1 > status.maxRows) requests.unshift({ appendDimension: { sheetId: sheetId, dimension: 'ROWS', length: nextRow - 1 - status.maxRows } });
  return requests;
}

function castleFinancialRequests(changes, current) {
  var requests = [], targets = {}, appendRows = {}, addedNames = {}, insertions = {}, paymentCount = 0, followupChanges = Object.create(null);
  function queuePayments(key, target, payments) {
    if (!Array.isArray(payments) || !payments.length) castleThrow('VALIDATION', 'Provide at least one payment.');
    paymentCount += payments.length;
    if (paymentCount > 500) castleThrow('VALIDATION', 'A save supports at most 500 imported payments.');
    payments.forEach(function (payment) {
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)) castleThrow('VALIDATION', 'Invalid payment.');
      castleKeys(payment, ['type', 'amountCents', 'payoutDate', 'bundleCents', 'bankDetails']);
      if (payment.type !== undefined && ['Airbnb', 'Vrbo', 'Owner'].indexOf(payment.type) < 0) castleThrow('VALIDATION', 'Payment type must be Airbnb, Vrbo, or Owner.');
      castleCents(payment.amountCents, false, false);
      if (payment.bankDetails !== undefined) castleValidateBankDetails(payment.bankDetails,current.months[String(target.sheetId)].bankOffset);
      if (payment.bundleCents !== undefined) castleCents(payment.bundleCents, false, false);
      if (payment.payoutDate !== undefined && (typeof payment.payoutDate !== 'string' || (payment.payoutDate !== '' && !castleDateValid(payment.payoutDate)))) castleThrow('VALIDATION', 'Payout dates must be valid YYYY-MM-DD values.');
    });
    if (!insertions[key]) insertions[key] = { sheetId: target.sheetId, row: target.row, arRow: target.arRow, payments: [] };
    insertions[key].payments = insertions[key].payments.concat(payments);
  }
  changes.forEach(function (change) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) castleThrow('VALIDATION', 'Every change must be an object.');
    var target;
    if (change.kind === 'updateFollowUp') {
      castleKeys(change, ['kind', 'propertyId', 'manager', 'status', 'note', 'attachments']);
      target = current.properties[change.propertyId];
      if (!target) castleThrow('VALIDATION', 'Unknown property ID. Refresh the sheet.');
      castleUnique(targets, 'followup:' + change.propertyId);
      var manager = change.manager === '' ? '' : castleName(change.manager, 'Account manager');
      castleValidateFollowUp(change);
      requests.push(castleCell(target.sheetId, target.row, 1, manager));
      followupChanges[change.propertyId] = { manager: manager, status: change.status, note: change.note, attachments: change.attachments, updatedAt: new Date().toISOString() };
    } else if (change.kind === 'setTotal') {
      castleKeys(change, ['kind', 'propertyId', 'amountCents']);
      target = current.properties[change.propertyId];
      if (!target) castleThrow('VALIDATION', 'Unknown property ID. Refresh the sheet.');
      castleCents(change.amountCents, false, true);
      castleUnique(targets, 'total:' + change.propertyId);
      requests.push(castleCell(target.sheetId, target.row, 4, change.amountCents / 100));
     } else if (change.kind === 'reconcileBank') {
      castleKeys(change, ['kind','paymentId','account','bundleCents','bankDate']);
      target = current.payments[change.paymentId];
      if (!target || !target.bankOffset) castleThrow('VALIDATION','Bank reconciliation requires a payment with Bank Details in column G.');
      var p = target.payment;
      var accountMatch = String(p.bankDetails || '').match(/(?:checking|chequing|savings)\s+([\d -]+)/i);
      var account = accountMatch ? accountMatch[1].replace(/\D/g,'').slice(-4) : '';
      if (!/^\d{4}$/.test(change.account) || account !== change.account || p.type !== 'Airbnb' || p.bundleCents !== change.bundleCents || !(p.amountCents > 0)) castleThrow('VALIDATION','The statement does not match this payment bundle and bank account.');
      if (!castleDateValid(change.bankDate) || !p.payoutDate || p.payoutDate > change.bankDate) castleThrow('VALIDATION','The bank date must be on or after the payout date.');
      if ((p.bankCents !== null && p.bankCents !== p.amountCents) || (p.bankDate && p.bankDate !== change.bankDate)) castleThrow('CONFLICT','Existing bank values conflict with this statement. Review the payment first.');
      ['amountCents','payoutDate','bundleCents','bankDetails','bankDate','bankCents'].forEach(function(key){castleUnique(targets,'payment:'+change.paymentId+':'+key);});
      castleUnique(targets,'system:'+change.paymentId);
      requests.push(castleCell(target.sheetId,target.row,8,(Date.parse(change.bankDate+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,'date'));
      requests.push(castleCell(target.sheetId,target.row,9,p.amountCents/100));
      requests.push(castleCell(target.sheetId,target.row,10,true));
    } else if (change.kind === 'updatePayment') {
      castleKeys(change, ['kind', 'paymentId', 'fields']);
      target = current.payments[change.paymentId];
      if (!target) castleThrow('VALIDATION', 'Unknown payment ID. Refresh the sheet.');
      var fields = change.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) castleThrow('VALIDATION', 'Payment fields are required.');
      var offset=target.bankOffset||0;
      var columns = { amountCents: 4, payoutDate: 5, bundleCents: 6, bankDetails:7, bankDate: 7+offset, bankCents: 8+offset, verifiedByDaisy: 10+offset };
      castleKeys(fields, Object.keys(columns));
      Object.keys(fields).forEach(function (key) {
        castleUnique(targets, 'payment:' + change.paymentId + ':' + key);
        var value = fields[key];
        if(key==='bankDetails'){castleValidateBankDetails(value,offset);requests.push(castleCell(target.sheetId,target.row,7,value.trim()));
        } else if (key === 'verifiedByDaisy') {
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
      if ('bundleCents' in fields || 'bankCents' in fields || 'amountCents' in fields || 'payoutDate' in fields || 'bankDate' in fields || 'bankDetails' in fields) {
        // Only managed verification is updated; unrelated values and AR formulas survive.
        var verificationKey = 'system:' + change.paymentId;
        if (!targets[verificationKey]) {
          // Verification must be invalidated when evidence fields change.
          var sourceChanged = ['amountCents','payoutDate','bundleCents','bankDetails','bankDate','bankCents'].some(function(key){return key in fields && fields[key] !== target.payment[key];});
          if (target.payment.verifiedBySystem !== undefined) { if(sourceChanged) { targets[verificationKey]=true; requests.push(castleCell(target.sheetId,target.row,9+offset,false)); } }
          else { targets[verificationKey]=true; requests.push(castleCell(target.sheetId, target.row, 9+offset, castleBankFormula(target.row,offset), 'formula')); }
        }
      }
    } else if (change.kind === 'appendPayments') {
      castleKeys(change, ['kind', 'propertyId', 'payments']);
      target = current.properties[change.propertyId];
      if (!target) castleThrow('VALIDATION', 'Unknown property ID. Refresh the sheet.');
      queuePayments(change.propertyId, target, change.payments);
    } else if (change.kind === 'addProperty') {
      castleKeys(change, ['kind', 'monthId', 'name', 'manager', 'totalCents', 'initialPayments', 'additionalPayments']);
      target = current.months[change.monthId];
      if (!target) castleThrow('VALIDATION', 'Unknown month ID.');
      var name = castleName(change.name, 'Property name');
      var manager = castleName(change.manager, 'Account manager');
      castleCents(change.totalCents, false, true);
      var nameKey = change.monthId + ':' + name.toLowerCase();
      if (addedNames[nameKey] || target.month.properties.some(function (property) { return property.name.toLowerCase() === name.toLowerCase(); })) castleThrow('VALIDATION', 'This property already exists in the selected month.');
      addedNames[nameKey] = true;
      var firstRow = appendRows[change.monthId] || target.lastRow + 1;
      var totalRow = firstRow + 1;
      var initialPayments = change.initialPayments === undefined ? [] : change.initialPayments;
      if (!Array.isArray(initialPayments) || initialPayments.length > 5) castleThrow('VALIDATION', 'Initial payments must contain up to five payment slots.');
      paymentCount += initialPayments.length;
      if (paymentCount > 500) castleThrow('VALIDATION', 'A save supports at most 500 imported payments.');
      var initialSlots = {};
      initialPayments.forEach(function (payment) {
        if (!payment || typeof payment !== 'object' || Array.isArray(payment)) castleThrow('VALIDATION', 'Invalid initial payment.');
        castleKeys(payment, ['index', 'amountCents', 'payoutDate', 'bundleCents', 'bankDetails']);
        if (!Number.isInteger(payment.index) || payment.index < 0 || payment.index > 4 || initialSlots[payment.index]) castleThrow('VALIDATION', 'Initial payment slots must be unique indexes from 0 to 4.');
        castleCents(payment.amountCents, false, false);
        if (payment.bankDetails !== undefined) castleValidateBankDetails(payment.bankDetails,target.bankOffset);
        if (payment.bundleCents !== undefined) castleCents(payment.bundleCents, false, false);
        if (payment.payoutDate !== undefined && (typeof payment.payoutDate !== 'string' || (payment.payoutDate !== '' && !castleDateValid(payment.payoutDate)))) castleThrow('VALIDATION', 'Initial payout dates must be valid YYYY-MM-DD values.');
        initialSlots[payment.index] = payment;
      });
      // Slot indexes describe roles, not mandatory physical rows. Create only
      // supplied payments, including Owner only when explicitly provided.
      var orderedPayments = initialSlots[4] ? [initialSlots[4]] : [];
      [0, 1, 2, 3].forEach(function (index) { if (initialSlots[index]) orderedPayments.push(initialSlots[index]); });
      var paymentTypes = orderedPayments.map(function (payment) { return payment.index === 4 ? 'Owner' : payment.index === 3 ? 'Vrbo' : 'Airbnb'; });
      var newHeaders=CASTLE_HEADERS.slice();if(target.bankOffset)newHeaders.splice(6,0,'Bank Details');
      var rows = [newHeaders, [manager, name, 'Total Payment', change.totalCents / 100]];
      orderedPayments.forEach(function (payment, index) { rows.push(['', '', paymentTypes[index] + ' Payment', payment.amountCents / 100]); });
      rows.push(['', '', 'AR']);
      appendRows[change.monthId] = firstRow + rows.length;
      var arRow = firstRow + rows.length - 1;
      if (change.additionalPayments !== undefined) {
        if (!Array.isArray(change.additionalPayments)) castleThrow('VALIDATION', 'Additional payments must be an array.');
        if (change.additionalPayments.length) queuePayments('new:' + change.monthId + ':' + totalRow, { sheetId: target.sheetId, row: totalRow, arRow: arRow }, change.additionalPayments);
      }
      rows.forEach(function (values, offset) {
        var cells = [];
        for (var column = 0; column < 10+(target.bankOffset||0); column++) cells.push(castleValue(values[column] === undefined ? null : values[column]));
        if (offset === rows.length - 1) cells[3] = { userEnteredValue: { formulaValue: '=D' + totalRow + (orderedPayments.length ? '-SUM(D' + (totalRow + 1) + ':D' + (arRow - 1) + ')' : '') } };
        if (offset >= 2 && offset < rows.length - 1) {
          var row = firstRow + offset;
          cells[9+(target.bankOffset||0)] = castleValue(false);
          cells[8+(target.bankOffset||0)] = { userEnteredValue: { formulaValue:castleBankFormula(row,target.bankOffset) } };
        }
        requests.push({ updateCells: { start: { sheetId: target.sheetId, rowIndex: firstRow + offset - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } });
      });
      requests = requests.concat(castlePropertyFormatRequests(target, firstRow, paymentTypes));
      orderedPayments.forEach(function (payment, index) {
        var row = firstRow + 2 + index;
        requests.push(castleCell(target.sheetId, row, 4, payment.amountCents / 100));
        if(payment.bankDetails!==undefined)requests.push(castleCell(target.sheetId,row,7,payment.bankDetails.trim()));
        if (payment.bundleCents !== undefined) requests.push(castleCell(target.sheetId, row, 6, payment.bundleCents / 100));
        if (payment.payoutDate) requests.push(castleCell(target.sheetId, row, 5, (Date.parse(payment.payoutDate + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000, 'date'));
      });
      if (orderedPayments.length) requests.push({ setDataValidation: { range: { sheetId: target.sheetId, startRowIndex: totalRow, endRowIndex: arRow - 1, startColumnIndex: 9+(target.bankOffset||0), endColumnIndex: 10+(target.bankOffset||0) }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } });
    } else castleThrow('VALIDATION', 'Unknown change kind.');
  });
  if (Object.keys(followupChanges).length) requests = requests.concat(castleStatusRequests(current, followupChanges));
  Object.keys(appendRows).forEach(function (monthId) {
    var target = current.months[monthId], needed = appendRows[monthId] - 1;
    if (needed > target.maxRows) requests.unshift({ appendDimension: { sheetId: target.sheetId, dimension: 'ROWS', length: needed - target.maxRows } });
  });
  // Apply all edits and new blocks at their original coordinates, then insert
  // bottom-up. Sheets relocates lower rows and their formula references atomically.
  var appliedInsertions = [];
  Object.keys(insertions).map(function (key) { return insertions[key]; }).sort(function (a, b) {
    return a.sheetId - b.sheetId || b.arRow - a.arRow;
  }).forEach(function (insertion) {
    var first = insertion.arRow, count = insertion.payments.length, sheetId = insertion.sheetId;
    requests.push({ insertDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: first - 1, endIndex: first - 1 + count }, inheritFromBefore: true } });
    appliedInsertions.push(insertion);
    var bankOffset=current.months[String(sheetId)].bankOffset||0;
    var template = current.months[String(sheetId)].formatTemplate;
    insertion.payments.forEach(function (payment, index) {
      var row = first + index;
      var type = payment.type || 'Airbnb';
      var source = castlePaymentFormatSource(current.months[String(sheetId)], type);
      var sourceRow = source.row;
      appliedInsertions.forEach(function (applied) { if (applied.sheetId === sheetId && applied.arRow <= source.row) sourceRow += applied.payments.length; });
      requests.push({ copyPaste: {
        source: { sheetId: sheetId, startRowIndex: sourceRow - 1, endRowIndex: sourceRow, startColumnIndex: 0, endColumnIndex: 10+bankOffset },
        destination: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 10+bankOffset },
        pasteType: 'PASTE_FORMAT', pasteOrientation: 'NORMAL'
      } });
      var values = ['', '', type + ' Payment', payment.amountCents / 100, '', payment.bundleCents === undefined ? '' : payment.bundleCents / 100, '', '', '', false];
      if(bankOffset)values.splice(6,0,(payment.bankDetails||'').trim());
      values=values.map(castleValue);
      values[8+bankOffset] = { userEnteredValue: { formulaValue:castleBankFormula(row,bankOffset) } };
      requests.push({ updateCells: { start: { sheetId: sheetId, rowIndex: row - 1, columnIndex: 0 }, rows: [{ values: values }], fields: 'userEnteredValue' } });
      if (payment.payoutDate) requests.push(castleCell(sheetId, row, 5, (Date.parse(payment.payoutDate + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000, 'date'));
    });
    requests.push({ setDataValidation: { range: { sheetId: sheetId, startRowIndex: first - 1, endRowIndex: first - 1 + count, startColumnIndex: 9, endColumnIndex: 10+bankOffset }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } });
    requests.push(castleCell(sheetId, first + count, 4, '=D' + insertion.row + '-SUM(D' + (insertion.row + 1) + ':D' + (first + count - 1) + ')', 'formula'));
  });
  return requests;
}

function castlePropertyFormatRequests(month, firstRow, paymentTypes) {
  var bankOffset=month.bankOffset||0;
  var template = month.formatTemplate, used = {};
  var sourceRows = [template.headerRow, template.totalRow];
  paymentTypes.forEach(function (type) {
    var matching = template.payments.filter(function (payment) { return payment.type === type; });
    var occurrence = used[type] || 0;
    // Reuse a body row if the template has fewer slots or omits a payment type.
    var source = matching[Math.min(occurrence, matching.length - 1)] || castlePaymentFormatSource(month, type);
    sourceRows.push(source.row);
    used[type] = occurrence + 1;
  });
  sourceRows.push(template.arRow);
  return sourceRows.map(function (sourceRow, offset) {
    // Copy one matching row at a time so variable-length templates cannot spill
    // into the next property. PASTE_FORMAT preserves values, formulas, and validation.
    return { copyPaste: {
      source: { sheetId: month.sheetId, startRowIndex: sourceRow - 1, endRowIndex: sourceRow, startColumnIndex: 0, endColumnIndex: 10+bankOffset },
      destination: { sheetId: month.sheetId, startRowIndex: firstRow + offset - 1, endRowIndex: firstRow + offset, startColumnIndex: 0, endColumnIndex: 10+bankOffset },
      pasteType: 'PASTE_FORMAT', pasteOrientation: 'NORMAL'
    } };
  });
}

function castleValidateFollowUp(value) {
  if (CASTLE_FOLLOWUP_STATUSES.indexOf(value.status) < 0) castleThrow('VALIDATION', 'Invalid follow-up status.');
  if (typeof value.note !== 'string' || value.note.length > 5000) castleThrow('VALIDATION', 'Follow-up notes must contain at most 5000 characters.');
  if (!Array.isArray(value.attachments) || value.attachments.length > 3) castleThrow('VALIDATION', 'Attach at most three images.');
  value.attachments.forEach(function (attachment) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) castleThrow('VALIDATION', 'Invalid image attachment.');
    castleKeys(attachment, ['name', 'dataUrl']);
    if (typeof attachment.name !== 'string' || !attachment.name.trim() || attachment.name.length > 160) castleThrow('VALIDATION', 'Image names must contain 1 to 160 characters.');
    if (typeof attachment.dataUrl !== 'string' || attachment.dataUrl.length > 45000 || !/^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.dataUrl) || attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1).length === 0 || JSON.stringify(attachment).length > 48000) castleThrow('VALIDATION', 'Attachments must be PNG, JPEG, or WebP base64 images within the size limit.');
  });
}

function castlePaymentFormatSource(month, type) {
  var payments = month.formatTemplate.payments.slice();
  // A first property can be empty. Look through other established properties
  // before falling back to the total row's body formatting.
  month.month.properties.forEach(function (property) {
    property.payments.forEach(function (payment) { payments.push({ row: Number(payment.id.split(':')[1]), type: payment.type }); });
  });
  return payments.filter(function (payment) { return payment.type === type; })[0] || payments[0] || { row: month.formatTemplate.totalRow };
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
  if(!row)return false;var headers=CASTLE_HEADERS.slice();if(castleText(row[6])==='bank details')headers.splice(6,0,'Bank Details');
  return headers.every(function(header,index){return !header||castleText(row[index])===castleText(header);});
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

function castleValidateBankDetails(value,offset){
 if(typeof value!=='string'||value.length>160||/[\u0000-\u001f\u007f]/.test(value))castleThrow('VALIDATION','Bank Details must be text up to 160 characters.');
 if(!offset)castleThrow('VALIDATION','Insert a Bank Details column at G in this monthly sheet, with Bank Details in every property header, before importing bank details.');
}
function castleBankFormula(row,offset){var column=offset?'I':'H';return '=IF(OR(F'+row+'="",'+column+row+'=""),"",ROUND(F'+row+',2)=ROUND('+column+row+',2))';}

function castleValidateManagerHierarchy(managers,code){
 managers.forEach(function(m){
  var role=m.role||'account_manager',parentId=m.parentManagerId||'';
  if(['account_manager','assistant'].indexOf(role)<0)castleThrow(code,'Choose a valid manager role.');
  if(role==='assistant'&&!managers.some(function(p){return p.id===parentId&&p.id!==m.id&&(p.role||'account_manager')==='account_manager';}))castleThrow(code,'Assistant Account Managers require a valid parent Account Manager.');
  if(role==='account_manager'&&parentId)castleThrow(code,'Account Managers cannot have a parent manager.');
 });
}
