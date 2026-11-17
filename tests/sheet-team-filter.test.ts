import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function setup(selection='Team A'){
 const rows=[['AM FILTER'],[selection],['Account Manager','Property Name','','Amount'],['Team B','House B','Total Payment',100],['','','Airbnb Payment',50],['','','AR',50],[],['Account Manager','Property Name','','Amount'],['Team A','House A','Total Payment',200],['','','Owner Payment',100],['','','AR',100]];
 const hidden:number[][]=[],borders:any[]=[],shown:number[][]=[];
 const sheet:any={getName:()=> 'September 2026',getLastRow:()=>rows.length,getLastColumn:()=>11,getFilter:()=>null,
  showRows:(...args:number[])=>shown.push(args),hideRows:(...args:number[])=>hidden.push(args),
  getRange:(row:any,column=1,count=1,width=1)=>row==='A2'?{getDisplayValue:()=>selection}:{
   getDisplayValues:()=>rows.slice(row-1,row-1+count).map(r=>Array.from({length:width},(_,i)=>r[column-1+i]??'')),
   setBorder:(...args:any[])=>borders.push({row,column,count,width,args})
  }};
 const context:any=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({getActiveSheet:()=>sheet,getSheetByName:()=>null}),BorderStyle:{SOLID:'SOLID'}}});
 vm.runInContext(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 return {context,sheet,hidden,borders,shown,rows};
}
test('A2 filters the edited September sheet and retains whole selected-team blocks',()=>{
 const a=setup();a.context.onEdit({range:{getSheet:()=>a.sheet,getA1Notation:()=> 'A2'}});
 assert.ok(a.hidden.some(([row,count])=>row===3&&count===4));
 assert.ok(!a.hidden.some(([row,count])=>row<=9&&row+count>9));
 assert.ok(a.borders.some(b=>b.row===8&&b.count===4&&b.width===4));
});
test('Team B hides Team A and All restores both blocks with enclosing borders',()=>{
 const b=setup('Team B');b.context.filterAccountManagers();assert.ok(b.hidden.some(([row,count])=>row===8&&count===4));
 const all=setup('All');all.context.filterAccountManagers();assert.equal(all.hidden.length,0);assert.equal(all.borders.length,2);assert.ok(all.shown.length);
});
test('unrelated tabs and edits are ignored',()=>{
 const a=setup();a.sheet.getName=()=> 'Property Owners';a.context.onEdit({range:{getSheet:()=>a.sheet,getA1Notation:()=> 'A2'}});assert.equal(a.shown.length,0);
 const b=setup();b.context.onEdit({range:{getSheet:()=>b.sheet,getA1Notation:()=> 'B2'}});assert.equal(b.shown.length,0);
});
test('all calendar months and bundle tabs support filtering, including abbreviated names',()=>{
 for(const name of ['January','February','March','April','May','June','July','August','September','October','November','December','Nov,']){
  for(const suffix of ['', ' - Bundle Matching']){
   const a=setup();a.sheet.getName=()=>name+' 2026'+suffix;
   a.context.onEdit({range:{getSheet:()=>a.sheet,getA1Notation:()=> 'A2'}});
   assert.equal(a.hidden.length,1,name+suffix);
  }
 }
});
test('all-tabs runner applies each tab selection and skips administrative tabs',()=>{
 const a=setup(),b=setup('Team B'),admin=setup();b.sheet.getName=()=> 'October 2026';admin.sheet.getName=()=> 'Owner Transfers';
 a.context.SpreadsheetApp.getActiveSpreadsheet=()=>({getSheets:()=>[a.sheet,b.sheet,admin.sheet]});
 a.context.filterAllMonthlySheets();assert.equal(a.hidden.length,1);assert.equal(b.hidden.length,1);assert.equal(admin.hidden.length,0);
});
test('final block without AR retains all populated rows and excludes blank trailing rows',()=>{
 const a=setup();a.rows[10]=['','','Owner Payment',100];a.rows.push([],[]);
 a.context.filterAccountManagers();
 assert.ok(a.borders.some(b=>b.row===8&&b.count===4));
});
