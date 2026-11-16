import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function api(){const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);return context as any;}
test('monthly formatting uses a fixed layout even without a template and never writes data',()=>{
 const a=api();
 for(const bankOffset of [0,1]){
  const requests=a.castlePropertyFormatRequests({sheetId:7,bankOffset},3,['Airbnb','Owner']);
  assert.ok(requests.length>0);
  assert.ok(requests.some((r:any)=>r.repeatCell?.cell.userEnteredFormat.numberFormat?.pattern==='#,##0.00'));
  assert.ok(requests.some((r:any)=>r.updateBorders?.range.endColumnIndex===10+bankOffset));
  assert.ok(requests.every((r:any)=>!r.updateCells&&!r.copyPaste&&!r.setDataValidation));
  assert.ok(requests.filter((r:any)=>r.repeatCell).every((r:any)=>r.repeatCell.fields.startsWith('userEnteredFormat')));
 }
});
test('October formatter selects only October 2026 financial tabs and releases its lock',()=>{
 const a=api();let released=false;const batches:any[]=[];
 a.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{released=true;}})};
 a.Sheets={Spreadsheets:{batchUpdate:(batch:any)=>batches.push(batch)}};
 a.castleRead=()=>({months:{oct:{sheetId:7,bankOffset:1,lastRow:5,month:{month:'2026-10',label:'October 2026'}},sep:{sheetId:8,month:{month:'2026-09'}},bundle:{sheetId:9,bundleOnly:true,month:{month:'2026-10'}}},properties:{p:{sheetId:7,row:4,arRow:5}}});
 assert.equal(a.formatOctober2026(),1);
 assert.equal(batches.length,1);assert.equal(released,true);
 assert.ok(batches[0].requests.every((r:any)=>(r.repeatCell?.range.sheetId??r.updateBorders?.range.sheetId??r.updateDimensionProperties?.range.sheetId??r.updateSheetProperties?.properties.sheetId)===7));
 assert.ok(batches[0].requests.every((r:any)=>!r.updateCells&&!r.setDataValidation));
});
