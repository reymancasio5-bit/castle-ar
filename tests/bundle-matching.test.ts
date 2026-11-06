import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPropertyImportPreview} from '../src/property-import.ts';
import {buildBulkImportPreview} from '../src/bulk-import.ts';
import {createPreviewApi} from '../src/preview-api.ts';
import {matchStatement} from '../src/bank-statement.ts';
import {createExportSheets} from '../src/excel.ts';
import type {Month} from '../src/types.ts';

const sheet={name:'Airbnb CSV',rows:[['Arriving by date','Type','Currency','Amount','Paid out','Details'],['11/05/2026','Payout','CAD','',500,'Checking 5864'],['','Co-Host payout','CAD',200,'','']].map(row=>row.map(value=>({value})))};
const options={headerRow:0,nameColumn:0,amountColumn:3,destination:'Airbnb1' as const,sumDuplicates:false,propertyName:'New House',manager:'Team A',total:'',airbnbSlot:'auto' as const};
const month:Month={id:'m',label:'November 2026',month:'2026-11',properties:[]};

test('blank and zero Airbnb imports explicitly create bundle-only records',()=>{
 for(const total of ['', '  ', '0','0.00']){
  const result=buildPropertyImportPreview(month,sheet,{...options,total});
  assert.equal(result.changes[0].kind,'addProperty');
  assert.equal((result.changes[0] as any).bundleOnly,true);
  assert.equal((result.changes[0] as any).totalCents,0);
 }
});
test('positive expectations retain AR; invalid and negative expectations are rejected',()=>{
 assert.equal((buildPropertyImportPreview(month,sheet,{...options,total:'200'}).changes[0] as any).bundleOnly,undefined);
 for(const total of ['oops','-1'])assert.throws(()=>buildPropertyImportPreview(month,sheet,{...options,total}));
});
test('bulk routing survives duplicate imports and does not mutate a same-name legacy AR record',()=>{
 const legacy={id:'legacy',name:'New House',manager:'Team A',totalCents:0,payments:[]};
 const source={...month,properties:[legacy]};
 const result=buildBulkImportPreview(source,[{fileName:'one.csv',sheet,options},{fileName:'two.csv',sheet,options:{...options,total:'0'}}]);
 assert.equal(result.changes.length,1);
 const change=result.changes[0] as any;
 assert.equal(change.kind,'addProperty');assert.equal(change.bundleOnly,true);
 assert.equal(change.initialPayments.length,1);
 assert.deepEqual(source.properties,[legacy]);
});
test('preview import round-trips bundle routing, bank matching and separate exports',async()=>{
 const api=createPreviewApi();let snapshot=await api.read();const target=snapshot.months[0];
 const manager=snapshot.managers!.find(m=>m.active)!;
 const result=buildBulkImportPreview(target,[{fileName:'new.csv',sheet,options:{...options,manager:manager.name}}]);
 snapshot=await api.save(snapshot.revision,result.changes);
 const saved=snapshot.months[0].properties.find(p=>p.name===options.propertyName)!;
 assert.equal(saved.bundleOnly,true);
 const match=matchStatement([{account:'5864',date:'2026-11-05',amountCents:50000,reference:'',source:'PDF'}],snapshot.months[0]);
 assert.equal(match.changes.length,1);
 snapshot=await api.save(snapshot.revision,match.changes);
 assert.equal(snapshot.months[0].properties.find(p=>p.id===saved.id)!.payments[0].verifiedBySystem,true);
 const exported=createExportSheets(snapshot,target.id);
 assert.ok(!exported.records.some(r=>r.Property===saved.name));
 assert.equal(exported.bundleRecords.length,1);
 assert.ok(!('Accounts receivable' in exported.bundleRecords[0]));
});


test('editing a same-name bundle record preserves AR task history in preview',async()=>{
 const api=createPreviewApi();let snapshot=await api.read();const month=snapshot.months[0],ar=month.properties[0];
 const key=JSON.stringify([month.id,ar.name.trim().toLowerCase()]);
 snapshot=await api.save(snapshot.revision,[{kind:'saveTask',task:{id:'bundle-history',managerId:ar.managerId!,title:'Owner follow-up',description:'',dueDate:'2026-11-10',status:'open',propertyKey:key}}]);
 snapshot=await api.save(snapshot.revision,[{kind:'addProperty',monthId:month.id,name:ar.name,manager:ar.manager,totalCents:0,bundleOnly:true,initialPayments:[{index:0,amountCents:100}]}]);
 const bundle=snapshot.months[0].properties.find(p=>p.bundleOnly)!;
 snapshot=await api.save(snapshot.revision,[{kind:'updateProperty',propertyId:bundle.id,name:'Renamed bundle',manager:bundle.manager}]);
 assert.equal(snapshot.tasks!.find(t=>t.id==='bundle-history')!.propertyKey,key);
});
