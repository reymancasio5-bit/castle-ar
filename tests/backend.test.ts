import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('assistant partial property rename preserves manager through the real validator',()=>{
 const app=harness();vm.runInContext(readFileSync('apps-script/Assistant.gs','utf8'),app.context);
 const current=vm.runInContext('castleRead()',app.context),p=current.snapshot.months[0].properties[0];
 const propose=(app.context as any).castleAiProposal;
 const result=propose([{kind:'updateProperty',propertyId:p.id,name:'Assistant renamed house'}],current);
 assert.equal(result.changes[0].manager,p.manager);
 assert.equal(app.read().snapshot.months[0].properties[0].name,p.name,'proposal must not write');
 const saved=app.post({requestId:'assistant-reviewed-rename',revision:result.revision,changes:result.changes});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.months[0].properties[0].manager,p.manager);
});

test('delete manager persists removal, rejects linked records and stale revisions',()=>{
 const app=harness();const before=app.read().snapshot;
 const linked=app.post({requestId:'delete-linked',revision:before.revision,changes:[{kind:'deleteManager',managerId:before.managers[0].id}]});
 assert.equal(linked.ok,false);assert.match(linked.error.message,/linked/i);
 const manager={id:'unused',name:'Unused Manager',email:'',notes:'',active:true,profileImage:''};
 const added=app.post({requestId:'delete-create',revision:before.revision,changes:[{kind:'saveManager',manager}]});assert.equal(added.ok,true);
 const removed=app.post({requestId:'delete-unused',revision:added.snapshot.revision,changes:[{kind:'deleteManager',managerId:manager.id}]});
 assert.equal(removed.ok,true,removed.error?.message);assert.equal(removed.snapshot.managerDeletion,1);
 assert.ok(!app.read().snapshot.managers.some((m:any)=>m.id===manager.id));
 assert.equal(app.post({requestId:'delete-stale',revision:added.snapshot.revision,changes:[{kind:'deleteManager',managerId:manager.id}]}).error.code,'CONFLICT');
 for(const kind of ['saveTask','addManagerUpdate']){
  const manager={id:'history-'+kind,name:'History '+kind,email:'',notes:'',active:true,profileImage:''};
  const initial=app.read().snapshot;
  const record=kind==='saveTask'?{kind,task:{id:'linked-task',managerId:manager.id,title:'Review',description:'',dueDate:'2026-11-10',status:'open',propertyKey:''}}:{kind,update:{id:'linked-update',managerId:manager.id,text:'History',taskId:'',propertyKey:''}};
  const saved=app.post({requestId:'delete-history-'+kind,revision:initial.revision,changes:[{kind:'saveManager',manager},record]});assert.equal(saved.ok,true,saved.error?.message);
  const blocked=app.post({requestId:'delete-block-'+kind,revision:saved.snapshot.revision,changes:[{kind:'deleteManager',managerId:manager.id}]});assert.equal(blocked.ok,false);assert.match(blocked.error.message,/linked/i);
 }
});

test('manager profiles migrate legacy headers and persist replacement and removal',()=>{
 const app=harness();const initial=app.read().snapshot;assert.equal(initial.managerProfiles,1);
 let saved=app.post({requestId:'profile-init',revision:initial.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(saved.ok,true,saved.error?.message);
 const table=[...app.tables.values()].find(t=>t.name==='Account Managers')!;
 table.data=table.data.map(row=>row.slice(0,5));table.maxColumns=5;
 let before=app.read();assert.equal(before.ok,true,before.error?.message);assert.equal(before.snapshot.managers[0].profileImage,'team-b');
 const png='data:image/png;base64,iVBORw0KGgo=';
 for(const [index,profileImage] of [png,''].entries()){
  saved=app.post({requestId:'profile-save-'+index,revision:before.snapshot.revision,changes:[{kind:'saveManager',manager:{...before.snapshot.managers[0],profileImage}}]});
  assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.managers[0].profileImage,profileImage);assert.equal(table.data[0][5],'profileImage');before=app.read();
 }
 assert.equal(before.snapshot.managers[0].profileImage,'');
 const invalid=app.post({requestId:'profile-unsafe',revision:before.snapshot.revision,changes:[{kind:'saveManager',manager:{...before.snapshot.managers[0],profileImage:'https://example.com/image.png'}}]});assert.equal(invalid.ok,false);assert.match(invalid.error.message,/profile/i);
});

test('legacy profile migration rejects an occupied unlabelled column',()=>{
 const app=harness();const initial=app.read().snapshot;
 const saved=app.post({requestId:'profile-occupied-init',revision:initial.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(saved.ok,true);
 const table=[...app.tables.values()].find(t=>t.name==='Account Managers')!;table.data[0][5]='';table.data[1][5]='Do not overwrite';
 const result=app.read();assert.equal(result.ok,false);assert.equal(result.error.code,'SOURCE_DATA');assert.equal(table.data[1][5],'Do not overwrite');
});

test('existing blank Account Managers tab is reused and initialized on first save',()=>{
 const app=harness();const table={name:'Account Managers',data:[] as any[][],maxRows:1000,maxColumns:26};
 app.tables.set(777,table);
 const before=app.read();assert.equal(before.ok,true,before.error?.message);assert.equal(table.data.length,0);
 const manager={...before.snapshot.managers[0],email:'manager@example.com',notes:'Contact owner'};
 const saved=app.post({requestId:'existing-blank-manager-tab',revision:before.snapshot.revision,changes:[{kind:'saveManager',manager}]});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(app.tables.get(777),table);
 assert.deepEqual(table.data[0],['id','name','email','notes','active','profileImage','role','parentManagerId']);
 assert.equal(table.data.find(row=>row[0]===manager.id)?.[2],'manager@example.com');
 assert.equal([...app.tables.values()].filter(t=>t.name==='Account Managers').length,1);
 assert.deepEqual([...app.tables.values()].map(t=>t.name).sort(),['Account Managers','Manager Assignments','Manager Tasks','Manager Updates']);
});

test('manager catalog migrates on write, rejects typos, and rename preserves task/listing identity',()=>{
 const app=harness();const first=app.read().snapshot;
 assert.equal(first.managerSchema,1);assert.equal(first.managers.length,2);assert.equal(app.tables.size,0);
 const manager=first.managers[0];
 const task={id:'task-1',managerId:manager.id,title:'Call owner',description:'',dueDate:'2026-11-10',status:'open',propertyKey:''};
 const saved=app.post({requestId:'manager-task-001',revision:first.revision,changes:[{kind:'saveTask',task}]});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.tasks.length,1);assert.equal(app.tables.size,4);
 const renamed=app.post({requestId:'manager-rename-001',revision:saved.snapshot.revision,changes:[{kind:'saveManager',manager:{...manager,name:'Alice'}}]});
 assert.equal(renamed.ok,true,renamed.error?.message);assert.equal(renamed.snapshot.tasks[0].managerId,manager.id);
 assert.ok(renamed.snapshot.months[0].properties.some((p:any)=>p.managerId===manager.id&&p.manager==='Alice'));
 const invalid=app.post({requestId:'manager-typo-001',revision:renamed.snapshot.revision,changes:[{kind:'addProperty',monthId:'0',name:'Typo test',manager:'Alcie',totalCents:0}]});
 assert.equal(invalid.ok,false);assert.match(invalid.error.message,/registered/i);
 const badDate=app.post({requestId:'manager-date-001',revision:renamed.snapshot.revision,changes:[{kind:'saveTask',task:{...task,dueDate:'2026-02-30'}}]});
 assert.equal(badDate.ok,false);assert.match(badDate.error.message,/date/i);
});

test('inactive managers retain existing assignments but cannot receive new tasks or properties',()=>{
 const app=harness();const before=app.read().snapshot;const manager=before.managers.find((m:any)=>m.name==='TeamB');
 const saved=app.post({requestId:'inactive-manager-01',revision:before.revision,changes:[{kind:'saveManager',manager:{...manager,active:false}}]});
 assert.equal(saved.ok,true,saved.error?.message);
 const followup=app.post({requestId:'inactive-followup-01',revision:saved.snapshot.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamB',status:'resolved',note:'Done',attachments:[]}]});
 assert.equal(followup.ok,true,followup.error?.message);
 for(const change of [{kind:'addProperty',monthId:'0',name:'House',manager:'TeamB',totalCents:0},{kind:'saveTask',task:{id:'t',managerId:manager.id,title:'Call',description:'',dueDate:'2026-11-01',status:'open',propertyKey:''}}]){
  const result=app.post({requestId:'inactive-'+change.kind,revision:followup.snapshot.revision,changes:[change]});assert.equal(result.ok,false);assert.match(result.error.message,/inactive/i);
 }
});

test('unknown spreadsheet names do not enter persisted catalog and malformed task rows are rejected',()=>{
 const app=harness();const initial=app.read().snapshot;
 const saved=app.post({requestId:'catalog-init-001',revision:initial.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(saved.ok,true);
 app.state.data[3][0]='Typo manager';const read=app.read();assert.equal(read.ok,true);assert.equal(read.snapshot.managers.length,2);assert.equal(read.snapshot.months[0].properties[0].managerId,'');
 const taskTable=[...app.tables.values()].find(t=>t.name==='Manager Tasks')!;
 taskTable.data.push(['bad','missing-manager','Title','','not-a-date','open','','']);
 const invalid=app.read();assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'SOURCE_DATA');
});

test('bootstrap handles manager names that coincide with object prototype keys',()=>{
 const app=harness();app.state.data[3][0]='constructor';const result=app.read();assert.equal(result.ok,true,result.error?.message);
 assert.ok(result.snapshot.managers.some((m:any)=>m.name==='constructor'));assert.ok(result.snapshot.months[0].properties[0].managerId);
});

test('tasks survive without monthly tabs, normalize Sheet dates, and reject stale task revisions',()=>{
 const app=harness();const initial=app.read().snapshot;const task={id:'due',managerId:initial.managers[0].id,title:'Review',description:'',dueDate:'2026-11-10',status:'open',propertyKey:''};
 const saved=app.post({requestId:'task-no-month-init',revision:initial.revision,changes:[{kind:'saveTask',task}]});assert.equal(saved.ok,true);
 const table=[...app.tables.values()].find(t=>t.name==='Manager Tasks')!;table.data[1][4]=new Date('2026-11-10T05:00:00Z');
 app.state.data.splice(0);app.state.formulas.splice(0);
 const next=app.read();assert.equal(next.ok,true,next.error?.message);assert.equal(next.snapshot.months.length,0);assert.equal(next.snapshot.tasks[0].dueDate,'2026-11-10');
 const stale=app.post({requestId:'task-stale-revision',revision:saved.snapshot.revision,changes:[{kind:'saveTask',task:{...task,status:'completed'}}]});assert.equal(stale.error.code,'CONFLICT');
 const complete=app.post({requestId:'task-no-month-save',revision:next.snapshot.revision,changes:[{kind:'saveTask',task:{...task,status:'completed'}}]});assert.equal(complete.ok,true,complete.error?.message);assert.equal(complete.snapshot.tasks[0].status,'completed');
});

test('blank rows in managed tabs do not duplicate records on subsequent saves',()=>{
 const app=harness();const initial=app.read().snapshot;
 const first=app.post({requestId:'blank-row-init',revision:initial.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(first.ok,true);
 const table=[...app.tables.values()].find(t=>t.name==='Account Managers')!;table.data.splice(1,0,[]);
 const before=app.read();assert.equal(before.ok,true);
 const result=app.post({requestId:'blank-row-save',revision:before.snapshot.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(result.ok,true,result.error?.message);assert.equal(result.snapshot.managers.length,2);
});

// Execute the production Apps Script with only its remote Google boundaries replaced.
// The fixture is deliberately a sheet-shaped data model, including source formulas.
type Cell = string | number | boolean | Date;
const header: Cell[] = ['Account Manager', 'Property Name', '', 'Amount', 'Platform Payout Time', 'Payout Bundle Amount', 'Bank Received Time', 'Bank Received Amount', 'Verify By System', 'Verify By Daisy'];
const row = (...values: Cell[]) => Array.from({ length: 10 }, (_, i) => values[i] ?? '');
function harness() {
  const batches:any[][]=[];
  const tables = new Map<number, {name:string;data:any[][];maxRows:number;maxColumns:number}>();
  const tableSheet=(id:number,t:any)=>({getName:()=>t.name,getSheetId:()=>id,getLastRow:()=>t.data.length,getMaxRows:()=>t.maxRows,getMaxColumns:()=>t.maxColumns,getRange:(r:number,c:number,n:number,w:number)=>({getValues:()=>Array.from({length:n},(_,y)=>Array.from({length:w},(_,x)=>t.data[r-1+y]?.[c-1+x]??'')),getFormulas:()=>Array.from({length:n},()=>Array(w).fill(''))})});
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
  const spreadsheet = { getSheetByName: (name: string) => name === sheet.getName() ? sheet : name === 'Status' && status.exists ? statusSheet : (()=>{const entry=[...tables].find(([,t])=>t.name===name);return entry?tableSheet(...entry):null;})(), getSheets: () => [...[...tables].map(([id,t])=>tableSheet(id,t)),sheet, ...(status.exists?[statusSheet]:[]), { getSheetId:()=>99, getName: () => 'Private notes', getRange: () => { throw new Error('Unrelated sheet read'); } }], getSpreadsheetTimeZone: () => 'America/New_York' };
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
      batches.push(structuredClone(body.requests));
      for (const request of body.requests) {
        if(request.addSheet && request.addSheet.properties.title!=='Status'){const p=request.addSheet.properties;tables.set(p.sheetId,{name:p.title,data:[],maxRows:p.gridProperties.rowCount,maxColumns:p.gridProperties.columnCount});continue;}
        const auxiliaryRange=request.copyPaste?.destination??request.repeatCell?.range??request.setDataValidation?.range??request.updateDimensionProperties?.range??request.updateBorders?.range;
        if(auxiliaryRange&&tables.has(auxiliaryRange.sheetId))continue;
        const dimension=request.insertDimension??request.deleteDimension;
        if(dimension&&tables.has(dimension.range.sheetId)){const t=tables.get(dimension.range.sheetId)!,r=dimension.range,count=r.endIndex-r.startIndex;if(request.insertDimension){t.data.splice(r.startIndex,0,...Array.from({length:count},()=>[]));t.maxRows+=count;}else{t.data.splice(r.startIndex,count);t.maxRows-=count;}continue;}
        const tableId=request.appendDimension?.sheetId??request.updateCells?.start?.sheetId??request.updateCells?.range?.sheetId;
        if(tables.has(tableId)){const t=tables.get(tableId)!;if(request.appendDimension){if(request.appendDimension.dimension==='ROWS')t.maxRows+=request.appendDimension.length;else t.maxColumns+=request.appendDimension.length;}else{const u=request.updateCells,r=u.start?.rowIndex??u.range?.startRowIndex,c=u.start?.columnIndex??u.range?.startColumnIndex;u.rows.forEach((row:any,y:number)=>row.values.forEach((cell:any,x:number)=>{assert.ok(r+y<t.maxRows&&c+x<t.maxColumns);t.data[r+y]??=[];t.data[r+y][c+x]=cell.userEnteredFormat?.numberFormat?.type==='DATE'&&cell.userEnteredValue?.numberValue!==undefined?new Date(Date.UTC(1899,11,30+cell.userEnteredValue.numberValue,12)):cell.userEnteredValue?.stringValue??cell.userEnteredValue?.boolValue??cell.userEnteredValue?.numberValue??'';}));}continue;}
        if(request.addSheet){assert.equal(status.exists,false);status.exists=true;status.id=request.addSheet.properties.sheetId;status.maxRows=request.addSheet.properties.gridProperties.rowCount;continue;}
        if(request.appendDimension?.sheetId===status.id){if(request.appendDimension.dimension==='ROWS')status.maxRows+=request.appendDimension.length;else status.maxColumns+=request.appendDimension.length;continue;}
        if((request.updateCells?.range?.sheetId??request.updateCells?.start?.sheetId)===status.id){
          const u=request.updateCells;const r=u.range?.startRowIndex??u.start?.rowIndex;const c=u.range?.startColumnIndex??u.start?.columnIndex;
          assert.ok(status.exists && r<status.maxRows && c<status.maxColumns);
          u.rows.forEach((entry:any,y:number)=>entry.values.forEach((cell:any,x:number)=>{status.data[r+y]??=row();status.formulas[r+y]??=row();status.data[r+y][c+x]=cell.userEnteredValue?.stringValue??cell.userEnteredValue?.numberValue??'';status.formulas[r+y][c+x]='';}));continue;
        }
        if (request.appendDimension) { if (request.appendDimension.dimension === 'COLUMNS') state.maxColumns += request.appendDimension.length; else state.maxRows += request.appendDimension.length; continue; }
        if (request.deleteDimension) {
          const {startIndex,endIndex,sheetId}=request.deleteDimension.range;
          assert.equal(sheetId,0);const count=endIndex-startIndex;
          data.splice(startIndex,count);formulas.splice(startIndex,count);formats.splice(startIndex,count);validations.splice(startIndex,count);state.maxRows-=count;
          for(const cells of formulas)cells.forEach((value,c)=>{if(typeof value==='string')cells[c]=value.replace(/(\$?[A-Z]+\$?)(\d+)/g,(_,column,n)=>+n>endIndex?column+(+n-count):+n>startIndex?'#REF!':column+n);});
          continue;
        }
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
  return { batches, tables, status, state, context, get, read, post, cache, properties, sheet, spreadsheet };
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
    { kind: 'updatePayment', paymentId: '0:5', fields: { type: 'Invalid' } },
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
  const result = app.post({ requestId: 'add_property_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamA', totalCents: 10001 }] });
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
  const result = app.post({ requestId: 'import_new_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'Imported house', manager: 'TeamB', totalCents: 37048, initialPayments: [{ index: 0, amountCents: 11686, payoutDate: '2026-10-09', bundleCents: 38140 }, { index: 1, amountCents: 13081, payoutDate: '2026-10-13', bundleCents: 60217 }, { index: 2, amountCents: 7719, payoutDate: '2026-10-19', bundleCents: 661041 }] }] });
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
    const result = app.post({ requestId: 'import_invalid_001', revision: app.read().snapshot.revision, changes: [{ kind: 'addProperty', monthId: '0', name: 'Imported house', manager: 'TeamB', totalCents: 37048, initialPayments }] });
    assert.equal(result.error.code, 'VALIDATION');
    assert.equal(app.state.writes, 0);
  }
});

test('multiple appended properties get distinct source rows and duplicate names fail atomically', () => {
  const app = harness();
  const change = { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamA', totalCents: 0 };
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
    { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamA', totalCents: 25000 },
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
    { kind: 'addProperty', monthId: '0', name: 'New House', manager: 'TeamA', totalCents: 0 },
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
      { kind: 'addProperty', monthId: '0', name: 'No placeholders', manager: 'TeamB', totalCents: 2000, initialPayments: [{ index: 2, amountCents: 0 }] },
      { kind: 'addProperty', monthId: '0', name: 'Bare property', manager: 'TeamB', totalCents: 3000 },
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
    { kind: 'updateFollowUp', propertyId: '0:12', manager: 'TeamA', status: 'payment_promised', note: '=literal note\nCall Friday', attachments: [attachment] },
  ] };
  const result = app.post(body);
  assert.equal(result.ok, true, JSON.stringify(result));
  const property = result.snapshot.months[0].properties[1];
  assert.equal(property.manager, 'TeamA');
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
 const result=app.post({requestId:'migrate-status-001',revision:before.snapshot.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamA',status:'resolved',note:'New note',attachments:[]}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(app.status.data.length,3);assert.equal(app.status.maxColumns,10);assert.equal(app.status.maxRows,3);
 assert.equal(result.snapshot.months[0].properties[0].followUp.note,'New note');assert.deepEqual(result.snapshot.months[0].properties[1].followUp.attachments,[attachment]);
 for(const r of [2,3,10,11])assert.deepEqual(app.state.data[r].slice(10,16),Array(6).fill(''));
 assert.equal(app.state.writes,1);
});

test('Status records take precedence over old metadata and are updated without duplicates',()=>{
 const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamA',status:'resolved',note:'Current',attachments:[]};
 const saved=app.post({requestId:'status-precedence-1',revision:app.read().snapshot.revision,changes:[change]});assert.equal(saved.ok,true);
 app.state.maxColumns=16;app.state.data[2].push(...app.context.CASTLE_FOLLOWUP_HEADERS);app.state.data[3].push('not_contacted','Outdated','','','','');
 const before=app.read();assert.equal(before.snapshot.months[0].properties[0].followUp.note,'Current');
 const result=app.post({requestId:'status-precedence-2',revision:before.snapshot.revision,changes:[{...change,note:'Updated'}]});assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(app.status.data.length,2);assert.equal(app.status.data[1][5],'Updated');assert.equal(app.state.data[3][11],'');
});

test('Status protects unrelated data and duplicate or formula-based records',()=>{
 for(const scenario of ['header','duplicate','formula']){
  const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamA',status:'resolved',note:'Current',attachments:[]};
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
 const result=app.post({requestId:'status-failure-001',revision:before.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamA',status:'resolved',note:'New',attachments:[]}]});
 assert.equal(result.ok,false);assert.deepEqual(app.state.data,original);assert.equal(app.status.exists,false);
});

test('Status identifies properties by month sheet ID and name, independently of row positions',()=>{
 const app=harness();const change={kind:'updateFollowUp',propertyId:'0:4',manager:'TeamA',status:'resolved',note:'November only',attachments:[]};
 const saved=app.post({requestId:'status-month-001',revision:app.read().snapshot.revision,changes:[change]});assert.equal(saved.ok,true);
 const original=app.spreadsheet.getSheets;app.spreadsheet.getSheets=()=>[...original(),{...app.sheet,getSheetId:()=>2,getName:()=> 'Dec, 2026'}];
 const read=app.read();assert.equal(read.ok,true,JSON.stringify(read));
 assert.equal(read.snapshot.months.find((m:any)=>m.id==='0').properties[0].followUp.note,'November only');
 assert.equal(read.snapshot.months.find((m:any)=>m.id==='2').properties[0].followUp,undefined);
});

test('Bank Details layout preserves shifted dates amounts and verification for edits and inserts',()=>{
 const app=harness();app.state.maxColumns=11;
 for(const [i,cells] of app.state.data.entries()){cells.splice(6,0,cells[0]==='Account Manager'?'Bank Details':'');app.state.formulas[i].splice(6,0,'');app.state.formats[i].splice(6,0,{});app.state.validations[i].splice(6,0,{});}
 app.state.data[4][6]='Checking 5864';app.state.data[4][7]='2026-11-01';app.state.data[4][8]=25;app.state.data[4][10]=true;
 const first=app.read();assert.equal(first.ok,true,first.error?.message);assert.equal(first.snapshot.months.length,1);
 const payment=first.snapshot.months[0].properties[0].payments[0];assert.equal(payment.bankDetails,'Checking 5864');assert.equal(payment.bankCents,2500);assert.equal(payment.verifiedByDaisy,true);
 const saved=app.post({requestId:'bank-edit',revision:first.snapshot.revision,changes:[{kind:'updatePayment',paymentId:payment.id,fields:{bankDetails:'Checking 1111',bankDate:'2026-11-02',bankCents:3000,bundleCents:3000,verifiedByDaisy:false}},{kind:'appendPayments',propertyId:'0:4',payments:[{amountCents:500,bankDetails:'Checking 5864'}]},{kind:'addProperty',monthId:'0',name:'Bank Test',manager:'TeamA',totalCents:2000,initialPayments:[{index:0,amountCents:700,bankDetails:'Savings 2222'}]}]});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(app.state.data[4][6],'Checking 1111');assert.equal(app.state.data[4][8],30);assert.equal(app.state.data[4][10],false);assert.match(app.state.formulas[4][9],/I5/);
 assert.ok(saved.snapshot.months[0].properties[0].payments.some((p:any)=>p.bankDetails==='Checking 5864'&&p.amountCents===500));
 assert.equal(saved.snapshot.months[0].properties.find((p:any)=>p.name==='Bank Test').payments[0].bankDetails,'Savings 2222');
});

test('bank details cannot overwrite legacy bank date columns',()=>{
 const app=harness(),before=app.read().snapshot;
 const result=app.post({requestId:'bank-legacy-block',revision:before.revision,changes:[{kind:'updatePayment',paymentId:'0:5',fields:{bankDetails:'Checking 5864'}}]});
 assert.equal(result.ok,false);assert.match(result.error.message,/column at G/i);assert.equal(app.state.writes,0);
});

test('assistant managers require a primary manager and survive legacy migration and reassignment',()=>{
 const app=harness();let before=app.read().snapshot;const parent=before.managers[0];
 const assistant={id:'assistant',name:'Assistant',email:'',notes:'',active:true,role:'assistant',parentManagerId:parent.id};
 let saved=app.post({requestId:'assistant-create',revision:before.revision,changes:[{kind:'saveManager',manager:assistant}]});assert.equal(saved.ok,true,saved.error?.message);
 assert.equal(saved.snapshot.managerHierarchy,1);assert.equal(saved.snapshot.managers.find((m:any)=>m.id===assistant.id).parentManagerId,parent.id);
 for(const invalid of [{...assistant,parentManagerId:''},{...assistant,parentManagerId:assistant.id},{...parent,role:'assistant',parentManagerId:before.managers[1].id}]){
  const result=app.post({requestId:'assistant-invalid-'+invalid.id+'-'+invalid.parentManagerId,revision:saved.snapshot.revision,changes:[{kind:'saveManager',manager:invalid}]});assert.equal(result.ok,false);
 }
 const deleted=app.post({requestId:'assistant-parent-delete',revision:saved.snapshot.revision,changes:[{kind:'deleteManager',managerId:parent.id}]});assert.equal(deleted.ok,false);
 saved=app.post({requestId:'assistant-reassign',revision:saved.snapshot.revision,changes:[{kind:'saveManager',manager:{...assistant,parentManagerId:before.managers[1].id}}]});assert.equal(saved.ok,true,saved.error?.message);
 assert.equal(app.read().snapshot.managers.find((m:any)=>m.id===assistant.id).parentManagerId,before.managers[1].id);
});

test('assistant schema upgrades six-column manager records without overwriting unrelated columns',()=>{
 const app=harness();let initial=app.read().snapshot;
 const saved=app.post({requestId:'hierarchy-legacy-init',revision:initial.revision,changes:[{kind:'saveManager',manager:initial.managers[0]}]});assert.equal(saved.ok,true);
 const table=[...app.tables.values()].find(t=>t.name==='Account Managers')!;
 table.data=table.data.map(row=>row.slice(0,6));table.maxColumns=8;
 initial=app.read().snapshot;assert.equal(initial.managers[0].role,'account_manager');
 table.data[1][6]='Preserve me';assert.equal(app.read().ok,false);table.data[1][6]='';
 const next=app.post({requestId:'hierarchy-legacy-save',revision:initial.revision,changes:[{kind:'saveManager',manager:{id:'helper',name:'Helper',email:'',notes:'',active:true,role:'assistant',parentManagerId:initial.managers[0].id}}]});
 assert.equal(next.ok,true,next.error?.message);assert.equal(table.data[0][6],'role');assert.equal(table.data[0][7],'parentManagerId');
});

test('bank reconciliation copies D to I, writes H date and J TRUE, preserves Daisy and rejects mismatches',()=>{
 const app=harness();
 app.state.data.forEach((r:any[],i:number)=>{r.splice(6,0,i===2||i===10||i===18?'Bank Details':'');app.state.formulas[i].splice(6,0,'');});app.state.maxColumns=11;
 Object.assign(app.state.data[20],{3:1138.21,4:'2026-09-09',5:6824.51,6:'Checking 5864',10:true});
 const before=app.read();assert.equal(before.ok,true,before.error?.message);
 const change={kind:'reconcileBank',paymentId:'0:21',account:'5864',bundleCents:682451,bankDate:'2026-09-09'};
 const bad=app.post({requestId:'bank-mismatch-01',revision:before.snapshot.revision,changes:[{...change,bundleCents:10}]});assert.equal(bad.ok,false);assert.equal(app.state.writes,0);
 const saved=app.post({requestId:'bank-reconcile-01',revision:before.snapshot.revision,changes:[change]});assert.equal(saved.ok,true,saved.error?.message);
 assert.equal(app.state.data[20][8],1138.21);assert.equal(app.state.data[20][9],true);assert.equal(app.state.data[20][10],true);assert.equal(saved.snapshot.months[0].properties[2].payments[0].bankDate,'2026-09-09');
 assert.equal(saved.snapshot.months[0].properties[2].payments[0].verifiedBySystem,true);
 const stale=app.post({requestId:'bank-stale-01',revision:before.snapshot.revision,changes:[change]});assert.equal(stale.ok,false);
});

test('editing account after bank reconciliation invalidates J even for a single-row bundle',()=>{
 const app=harness();app.state.data.forEach((r:any[],i:number)=>{r.splice(6,0,i===2||i===10||i===18?'Bank Details':'');app.state.formulas[i].splice(6,0,'');});app.state.maxColumns=11;
 Object.assign(app.state.data[20],{3:100,4:'2026-09-09',5:100,6:'Checking 5864'});
 const before=app.read().snapshot;
 const saved=app.post({requestId:'bank-invalidate-init',revision:before.revision,changes:[{kind:'reconcileBank',paymentId:'0:21',account:'5864',bundleCents:10000,bankDate:'2026-09-09'}]});assert.equal(saved.ok,true);
 const edited=app.post({requestId:'bank-invalidate-edit',revision:saved.snapshot.revision,changes:[{kind:'updatePayment',paymentId:'0:21',fields:{bankDetails:'Checking 7524'}}]});assert.equal(edited.ok,true,edited.error?.message);
 assert.equal(app.state.data[20][9],false);assert.equal(app.state.formulas[20][9],'');
});

test('a no-op edit cannot suppress invalidation by another edit in the same save',()=>{
 const app=harness();app.state.data.forEach((r:any[],i:number)=>{r.splice(6,0,i===2||i===10||i===18?'Bank Details':'');app.state.formulas[i].splice(6,0,'');});app.state.maxColumns=11;
 Object.assign(app.state.data[20],{3:100,4:'2026-09-09',5:100,6:'Checking 5864',7:'2026-09-09',8:100,9:true});
 const before=app.read().snapshot;
 const edited=app.post({requestId:'bank-noop-batch',revision:before.revision,changes:[{kind:'updatePayment',paymentId:'0:21',fields:{amountCents:10000}},{kind:'updatePayment',paymentId:'0:21',fields:{bankDetails:'Checking 7524'}}]});assert.equal(edited.ok,true,edited.error?.message);assert.equal(app.state.data[20][9],false);
});

test('property metadata edits preserve follow-up and linked task identity',()=>{
 const app=harness();const initial=app.read().snapshot;const p=initial.months[0].properties[0];
 const saved=app.post({requestId:'rename-record-test',revision:initial.revision,changes:[{kind:'updateProperty',propertyId:p.id,name:'Renamed House',manager:'TeamA'},{kind:'setTotal',propertyId:p.id,amountCents:90000}]});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.months[0].properties[0].name,'Renamed House');assert.equal(saved.snapshot.months[0].properties[0].manager,'TeamA');assert.equal(saved.snapshot.months[0].properties[0].totalCents,90000);
});
test('deleting one payment removes its row and preserves neighboring properties',()=>{
 const app=harness();const before=app.read().snapshot;
 const result=app.post({requestId:'delete-payment-test',revision:before.revision,changes:[{kind:'deletePayment',paymentId:'0:21'}]});assert.equal(result.ok,true,result.error?.message);
 assert.equal(result.snapshot.months[0].properties[2].payments.length,4);assert.equal(result.snapshot.months[0].properties[2].payments[0].amountCents,13081);assert.equal(result.snapshot.months[0].properties[0].name,before.months[0].properties[0].name);assert.equal(app.state.formulas[24][3],'=D20-SUM(D21:D24)');
});
test('deleting a property removes its entire block and rejects stale edits',()=>{
 const app=harness();const before=app.read().snapshot;
 const result=app.post({requestId:'delete-property-test',revision:before.revision,changes:[{kind:'deleteProperty',propertyId:'0:4'}]});assert.equal(result.ok,true,result.error?.message);
 assert.equal(result.snapshot.months[0].properties.length,2);assert.equal(result.snapshot.months[0].properties[0].name,before.months[0].properties[1].name);
 const stale=app.post({requestId:'delete-property-stale',revision:before.revision,changes:[{kind:'deleteProperty',propertyId:'0:4'}]});assert.equal(stale.error.code,'CONFLICT');
});

test('rename carries Status and task links; delete detaches history and removes Status',()=>{
 const app=harness();let before=app.read().snapshot;const key=JSON.stringify(['0','mtl 404 le bijou']);
 let saved=app.post({requestId:'record-links-setup',revision:before.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamB',status:'awaiting_response',note:'Keep this note',attachments:[]},{kind:'saveTask',task:{id:'linked-edit',managerId:before.managers[0].id,title:'Follow up',description:'',dueDate:'2026-11-10',status:'open',propertyKey:key}}]});assert.equal(saved.ok,true,saved.error?.message);
 saved=app.post({requestId:'record-links-rename',revision:saved.snapshot.revision,changes:[{kind:'updateProperty',propertyId:'0:4',name:'New Name',manager:'TeamA'}]});assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.months[0].properties[0].followUp.note,'Keep this note');assert.equal(saved.snapshot.tasks[0].propertyKey,JSON.stringify(['0','new name']));
 saved=app.post({requestId:'record-links-delete',revision:saved.snapshot.revision,changes:[{kind:'deleteProperty',propertyId:'0:4'}]});assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.tasks[0].propertyKey,'');assert.equal(saved.snapshot.tasks[0].title,'Follow up');assert.ok(!app.status.data.some((row:any[])=>row[2]==='New Name'));
});
test('last payment deletion leaves a valid total-only AR formula',()=>{
 const app=harness();let before=app.read().snapshot;
 for(let i=0;i<5;i++){const saved=app.post({requestId:'delete-last-payment-'+i,revision:before.revision,changes:[{kind:'deletePayment',paymentId:'0:5'}]});assert.equal(saved.ok,true,saved.error?.message);before=saved.snapshot;}
 assert.equal(before.months[0].properties[0].payments.length,0);assert.equal(app.state.formulas[4][3],'=D4');assert.equal(before.months[0].properties[1].name,'Mtl 2429 Rue Allard Unit 1');
});
test('duplicate property names and mixed deletion requests are rejected before writes',()=>{
 for(const changes of [[{kind:'updateProperty',propertyId:'0:4',name:'Mtl 2429 Rue Allard Unit 1',manager:'TeamA'}],[{kind:'deletePayment',paymentId:'0:5'},{kind:'setTotal',propertyId:'0:4',amountCents:1}],[{kind:'deleteProperty',propertyId:'missing'}]]){
 const app=harness();const result=app.post({requestId:'invalid-record-action',revision:app.read().snapshot.revision,changes});assert.equal(result.ok,false);assert.equal(app.state.writes,0);
 }
});
test('payment type and bank details can be edited without changing amounts',()=>{
 const app=harness();const before=app.read().snapshot;
 const saved=app.post({requestId:'payment-channel-edit',revision:before.revision,changes:[{kind:'updatePayment',paymentId:'0:21',fields:{type:'Owner'}}]});assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.months[0].properties[2].payments[0].type,'Owner');assert.equal(saved.snapshot.months[0].properties[2].payments[0].amountCents,11686);
});

test('rename refuses an orphan Status name collision without corrupting the sheet',()=>{
 const app=harness();const setup=app.post({requestId:'orphan-status-setup',revision:app.read().snapshot.revision,changes:[{kind:'updateFollowUp',propertyId:'0:4',manager:'TeamB',status:'not_contacted',note:'Original',attachments:[]}]});assert.equal(setup.ok,true);
 app.status.data.push(['0','November 2026','Historical House','TeamB','not_contacted','History','','','','']);app.status.formulas.push(Array(10).fill(''));
 const before=app.read();assert.equal(before.ok,true,before.error?.message);const writes=app.state.writes;
 const result=app.post({requestId:'orphan-status-rename',revision:before.snapshot.revision,changes:[{kind:'updateProperty',propertyId:'0:4',name:'Historical House',manager:'TeamB'}]});assert.equal(result.ok,false);assert.equal(app.state.writes,writes);
});

test('deleting the last property keeps an empty month available for a new import',()=>{
 const app=harness();let before=app.read().snapshot;
 for(let i=0;i<3;i++){const result=app.post({requestId:'delete-month-final-'+i,revision:before.revision,changes:[{kind:'deleteProperty',propertyId:before.months[0].properties[0].id}]});assert.equal(result.ok,true,result.error?.message);before=result.snapshot;}
 assert.equal(before.months.length,1);assert.equal(before.months[0].properties.length,0);
 const created=app.post({requestId:'recreate-empty-month',revision:before.revision,changes:[{kind:'addProperty',monthId:'0',name:'Replacement House',manager:'TeamA',totalCents:10000}]});assert.equal(created.ok,true,created.error?.message);assert.equal(created.snapshot.months[0].properties[0].name,'Replacement House');
});

test('bank reconciliation matches F and G, ignores later or blank E, copies D into I',()=>{
 for(const payoutDate of ['2026-09-17','']){
  const app=harness();app.state.data.forEach((r:any[],i:number)=>{r.splice(6,0,i===2||i===10||i===18?'Bank Details':'');app.state.formulas[i].splice(6,0,'');});app.state.maxColumns=11;
  Object.assign(app.state.data[20],{3:594.20,4:payoutDate,5:944.03,6:'Checking 5864'});
  const before=app.read().snapshot;
  const saved=app.post({requestId:'bank-ignore-platform-date',revision:before.revision,changes:[{kind:'reconcileBank',paymentId:'0:21',account:'5864',bundleCents:94403,bankDate:'2026-09-10'}]});
  assert.equal(saved.ok,true,saved.error?.message);assert.equal(app.state.data[20][8],594.20);assert.equal(app.state.data[20][9],true);assert.equal(app.state.data[20][4],payoutDate);assert.equal(app.state.data[20][5],944.03);assert.equal(saved.snapshot.months[0].properties[2].payments[0].bankDate,'2026-09-10');
 }
});


test('bundle-only import creates a companion sheet without AR and round-trips bank matching',()=>{
 const app=harness();const initial=app.read().snapshot;const original=structuredClone(app.state.data);
 const saved=app.post({requestId:'bundle-create-001',revision:initial.revision,changes:[{kind:'addProperty',bundleOnly:true,monthId:'0',name:'Castle direct',manager:'TeamA',totalCents:0,initialPayments:[{index:0,amountCents:20000,bundleCents:50000,bankDetails:'Checking 5864',payoutDate:'2026-11-05'}]}]});
 assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.snapshot.bundleMatchingSchema,1);
 assert.equal(saved.snapshot.months.length,1);
 const property=saved.snapshot.months[0].properties.find((p:any)=>p.bundleOnly);assert.ok(property);assert.equal(property.sourceArCents,undefined);
 assert.deepEqual(app.state.data,original);
 const table=[...app.tables.values()].find(t=>t.name==='Nov, 2026 - Bundle Matching')!;assert.ok(table);
 assert.ok(!table.data.some(row=>row[2]==='AR'||row[2]==='Total Payment'));
 const matched=app.post({requestId:'bundle-match-001',revision:saved.snapshot.revision,changes:[{kind:'reconcileBank',paymentId:property.payments[0].id,account:'5864',bundleCents:50000,bankDate:'2026-11-06'}]});
 assert.equal(matched.ok,true,matched.error?.message);
 assert.equal(matched.snapshot.months[0].properties.find((p:any)=>p.bundleOnly).payments[0].verifiedBySystem,true);
 const rejected=app.post({requestId:'bundle-total-001',revision:matched.snapshot.revision,changes:[{kind:'setTotal',propertyId:property.id,amountCents:10}]});assert.equal(rejected.ok,false);
 const appended=app.post({requestId:'bundle-append-001',revision:matched.snapshot.revision,changes:[{kind:'appendPayments',propertyId:property.id,payments:[{amountCents:5000,bundleCents:5000,bankDetails:'Checking 5864'}]}]});assert.equal(appended.ok,true,appended.error?.message);
 const rows=appended.snapshot.months[0].properties.find((p:any)=>p.bundleOnly).payments;assert.equal(rows.length,2);
 const deleted=app.post({requestId:'bundle-delete-001',revision:appended.snapshot.revision,changes:[{kind:'deletePayment',paymentId:rows[1].id}]});assert.equal(deleted.ok,true,deleted.error?.message);
 assert.deepEqual(app.state.data,original);
});


test('bundle tabs support bulk first import, manager rename, full deletion and reimport',()=>{
 const app=harness();let snapshot=app.read().snapshot;const original=structuredClone(app.state.data);
 const save=(requestId:string,changes:any[])=>{const result=app.post({requestId,revision:snapshot.revision,changes});assert.equal(result.ok,true,result.error?.message);snapshot=result.snapshot;};
 save('bundle-many-create',[{kind:'addProperty',bundleOnly:true,monthId:'0',name:'Mtl 404 Le Bijou',manager:'TeamA',totalCents:0,additionalPayments:Array.from({length:5},(_,i)=>({amountCents:10000+i,bundleCents:20000+i,bankDetails:'Checking 5864'}))}]);
 let bundle=snapshot.months[0].properties.find((p:any)=>p.bundleOnly);assert.equal(bundle.payments.length,5);assert.equal(snapshot.months[0].properties.filter((p:any)=>p.name===bundle.name).length,2);
 const manager=snapshot.managers.find((m:any)=>m.name==='TeamA');
 save('bundle-manager-rename',[{kind:'saveManager',manager:{...manager,name:'Renamed Team'}}]);
 bundle=snapshot.months[0].properties.find((p:any)=>p.bundleOnly);assert.equal(bundle.manager,'Renamed Team');assert.equal(bundle.followUp,undefined);
 save('bundle-remove-property',[{kind:'deleteProperty',propertyId:bundle.id}]);assert.ok(!snapshot.months[0].properties.some((p:any)=>p.bundleOnly));
 save('bundle-reimport-property',[{kind:'addProperty',bundleOnly:true,monthId:'0',name:'Another direct payout',manager:'Renamed Team',totalCents:0,initialPayments:[{index:0,amountCents:5000}]}]);
 assert.equal(snapshot.months[0].properties.filter((p:any)=>p.bundleOnly).length,1);
 assert.equal([...app.tables.values()].filter(t=>t.name.endsWith(' - Bundle Matching')).length,1);
 assert.equal(app.state.data[3][1],original[3][1]);assert.deepEqual(app.state.formulas[9],['','','','=D4-D5-D6-D7-D8-D9','','','','','','']);
});


test('bundle properties get enclosing borders on create, append and subsequent imports',()=>{
 const app=harness();let snapshot=app.read().snapshot;
 const save=(id:string,changes:any[])=>{const result=app.post({requestId:id,revision:snapshot.revision,changes});assert.equal(result.ok,true,result.error?.message);snapshot=result.snapshot;};
 const check=(property:any)=>{
  const [sheetId,totalRow]=property.id.split(':').map(Number);
  const endRow=totalRow+property.payments.length+1;
  const borders=app.batches.at(-1)!.flatMap(r=>r.updateBorders?[r.updateBorders]:[]);
  const outer=borders.find(b=>b.range.sheetId===sheetId&&b.range.startRowIndex===totalRow-2&&b.range.endRowIndex===endRow&&b.range.startColumnIndex===0&&b.range.endColumnIndex===11&&b.top&&b.bottom);
  assert.ok(outer,'border encloses header, property, every payment and end row across A:K');
  for(const side of ['top','bottom','left','right'])assert.equal(outer[side].style,'SOLID');
  assert.ok(borders.some(b=>b.range.sheetId===sheetId&&b.range.startRowIndex===totalRow-2&&b.range.endRowIndex===endRow&&b.range.endColumnIndex===1&&b.right?.style==='SOLID'),'account-manager column separator');
  assert.ok(borders.every(b=>b.range.sheetId!==0),'AR formatting is untouched');
 };
 save('border-first-create',[{kind:'addProperty',bundleOnly:true,monthId:'0',name:'Border first',manager:'TeamA',totalCents:0,additionalPayments:[{amountCents:100},{amountCents:200}]}]);
 let property=snapshot.months[0].properties.find((p:any)=>p.bundleOnly);check(property);
 save('border-append-payment',[{kind:'appendPayments',propertyId:property.id,payments:[{amountCents:300}]}]);property=snapshot.months[0].properties.find((p:any)=>p.bundleOnly);check(property);
 save('border-second-create',[{kind:'addProperty',bundleOnly:true,monthId:'0',name:'Border second',manager:'TeamA',totalCents:0,initialPayments:[{index:0,amountCents:400}]}]);
 check(snapshot.months[0].properties.find((p:any)=>p.name==='Border second'));
 assert.equal(snapshot.months[0].properties.find((p:any)=>p.name==='Border first').payments.length,3);
});
