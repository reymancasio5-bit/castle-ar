import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkImportPreview } from '../src/bulk-import.ts';
import type { Month } from '../src/types.ts';
import type { ImportSheet } from '../src/import.ts';
const month: Month = { id: 'm', label: '', month: '2026-10', properties: [] };
const options = { headerRow: 0, nameColumn: 1, amountColumn: 2, destination: 'Airbnb1' as const, sumDuplicates: false, propertyName: 'House', manager: 'Team A', total: '100', airbnbSlot: 'auto' as const };
const sheet = (n: number, currency = 'CAD'): ImportSheet => ({ name: 'CSV', rows: [['Type','Listing','Amount','Paid out','Arriving by date','Currency'], ['Payout','','',n,'2026-10-09',currency], ['Reservation','Listing',n,'','',currency]].map(row => row.map(value => ({value}))) });
const entry = (n: number) => ({ fileName: `${n}.csv`, sheet: sheet(n), options });

test('bulk imports accept blank listing names and exports without a Listing column', () => {
 const blank=entry(1); blank.sheet.rows[2][1].value='';
 const absent=entry(2); absent.sheet.rows.forEach(row=>row.splice(1,1));
 const result=buildBulkImportPreview(month,[blank,absent]);
 assert.equal(result.readyCount,2);
 assert.ok(result.rows.filter(row=>row.status==='ready').every(row=>row.propertyName==='House'));
 assert.equal(result.changes.length,1);
 assert.equal(result.changes[0].kind,'addProperty');
});

test('a bulk import cannot target more than one property', () => {
 assert.throws(() => buildBulkImportPreview(month, [entry(1), {...entry(2), options: {...options, propertyName: 'Other house'}}]), /one property/i);
});
test('consolidates a new property across files, appends beyond three, and deduplicates', () => {
 const result = buildBulkImportPreview(month, [entry(1),entry(2),entry(3),entry(4),entry(4)]);
 assert.equal(result.changes.length, 1);
 const change = result.changes[0]; assert.equal(change.kind, 'addProperty');
 if(change.kind === 'addProperty') { assert.equal(change.initialPayments?.length, 3); assert.equal(change.additionalPayments?.length, 1); }
 assert.equal(result.readyCount, 4); assert.equal(result.rows.at(-1)?.status, 'skipped');
 assert.equal(result.rows.at(-1)?.fileIndex, 4);
});
test('blocks conflicts and mixed currencies with file context', () => {
 assert.throws(() => buildBulkImportPreview(month, [entry(1), {...entry(2), options: {...options,total:'200'}}]), /2.csv.*total/i);
 assert.throws(() => buildBulkImportPreview(month, [entry(1), {...entry(2), options: {...options,manager:'Other'}}]), /2.csv.*manager/i);
 assert.throws(() => buildBulkImportPreview(month, [entry(1), {...entry(2),sheet:sheet(2,'USD')}]), /2.csv.*currency/i);
});
test('multi-file imports require recognized exports and enforce limits', () => {
 assert.throws(() => buildBulkImportPreview(month, [entry(1), {...entry(2),sheet:{name:'unknown',rows:[]}}]), /2.csv.*Airbnb/i);
 assert.throws(() => buildBulkImportPreview(month, Array.from({length:51},()=>entry(1))), /50/);
});

test('fills existing slots sequentially without overwriting, despite explicit selections', () => {
 const existing: Month = { ...month, properties: [{id:'p',name:'House',manager:'Team A',totalCents:10000,payments:Array.from({length:3},(_,i)=>({id:`p${i}`,type:'Airbnb' as const,amountCents:i===0?999:null,payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false}))}] };
 const result=buildBulkImportPreview(existing,[{...entry(1),options:{...options,airbnbSlot:'1'}},entry(2),entry(3)]);
 assert.deepEqual(result.changes.map(c=>c.kind),['updatePayment','updatePayment','appendPayments']);
 assert.equal(existing.properties[0].payments[1].amountCents,null);
});
test('blocks combined row/write limits', () => {
 const giant={...entry(1),sheet:{name:'large',rows:Array.from({length:10001},()=>[])}};
 assert.throws(()=>buildBulkImportPreview(month,[giant]),/10,000/);
 const many=sheet(1); many.rows=many.rows.slice(0,1);
 for(let i=1;i<=501;i++) many.rows.push(...sheet(i).rows.slice(1));
 assert.throws(()=>buildBulkImportPreview(month,[{...entry(1),sheet:many}]),/500/);
});
test('single-file new properties accept more than three payouts and deduplicate repeated bundles', () => {
 const many=sheet(1); for(let i=2;i<=4;i++) many.rows.push(...sheet(i).rows.slice(1)); many.rows.push(...sheet(4).rows.slice(1));
 const result=buildBulkImportPreview(month,[{...entry(1),sheet:many}]);
 assert.equal(result.readyCount,4);
 const change=result.changes[0];assert.equal(change.kind,'addProperty');
 if(change.kind==='addProperty')assert.equal(change.additionalPayments?.length,1);
});

test('preview API persists additional and appended Airbnb payments', async () => {
 const {createPreviewApi}=await import('../src/preview-api.ts');
 const api=createPreviewApi(); const before=await api.read();
 const result=await api.save(before.revision,[{kind:'addProperty',monthId:before.months[0].id,name:'Bulk test house',manager:'Team A',totalCents:500,additionalPayments:[{amountCents:100,payoutDate:'2026-10-09',bundleCents:200}]}]);
 const property=result.months[0].properties.at(-1)!;
 assert.deepEqual(property.payments.map(payment=>payment.type),['Airbnb']);
 const appended=await api.save(result.revision,[{kind:'appendPayments',propertyId:property.id,payments:[{amountCents:300}]}]);
 assert.equal(appended.months[0].properties.at(-1)!.payments.at(-1)!.amountCents,300);
});

test('a new property starts without payments and imports append only supplied Airbnb payments', async () => {
 const {createPreviewApi}=await import('../src/preview-api.ts');
 const api=createPreviewApi(); const before=await api.read();
 const created=await api.save(before.revision,[{kind:'addProperty',monthId:before.months[0].id,name:'Empty house',manager:'Team A',totalCents:10000}]);
 const target=created.months[0].properties.at(-1)!;
 assert.deepEqual(target.payments.map(payment=>[payment.type,payment.amountCents]),[]);
 const batch=buildBulkImportPreview(created.months[0],[{...entry(1),options:{...options,propertyName:'Empty house'}},{...entry(2),options:{...options,propertyName:'Empty house'}}]);
 assert.equal(batch.changes.length,1);
 assert.equal(batch.changes[0].kind,'appendPayments');
 const saved=await api.save(created.revision,batch.changes);
 assert.deepEqual(saved.months[0].properties.at(-1)!.payments.map(payment=>[payment.type,payment.amountCents]),[['Airbnb',100],['Airbnb',200]]);
});

test('creating a property during bulk import saves only the supplied payouts', async () => {
 const {createPreviewApi}=await import('../src/preview-api.ts');
 const api=createPreviewApi(); const before=await api.read();
 const batch=buildBulkImportPreview(before.months[0],[entry(1),entry(2),entry(2)]);
 const saved=await api.save(before.revision,batch.changes);
 assert.deepEqual(saved.months[0].properties.at(-1)!.payments.map(payment=>[payment.type,payment.amountCents]),[['Airbnb',100],['Airbnb',200]]);
});

test('manual Vrbo imports into a property without payments retain their platform through save', async () => {
 const {createPreviewApi}=await import('../src/preview-api.ts');
 const api=createPreviewApi(); const before=await api.read();
 const created=await api.save(before.revision,[{kind:'addProperty',monthId:before.months[0].id,name:'House',manager:'Team A',totalCents:10000}]);
 const manual: ImportSheet={name:'CSV',rows:[['Property','Amount'],['Listing',12]].map(row=>row.map(value=>({value})))};
 const batch=buildBulkImportPreview(created.months[0],[{fileName:'vrbo.csv',sheet:manual,options:{...options,nameColumn:0,amountColumn:1,destination:'Vrbo'}}]);
 const saved=await api.save(created.revision,batch.changes);
 assert.deepEqual(saved.months[0].properties.at(-1)!.payments.map(payment=>[payment.type,payment.amountCents]),[['Vrbo',1200]]);
});

test('an Owner payment row is created only for imported Owner data, including explicit zero', async () => {
 const {createPreviewApi}=await import('../src/preview-api.ts');
 const api=createPreviewApi(); const before=await api.read();
 const manual: ImportSheet={name:'CSV',rows:[['Property','Amount'],['Listing',0]].map(row=>row.map(value=>({value})))};
 const batch=buildBulkImportPreview(before.months[0],[{fileName:'owner.csv',sheet:manual,options:{...options,nameColumn:0,amountColumn:1,destination:'Owner'}}]);
 const saved=await api.save(before.revision,batch.changes);
 assert.deepEqual(saved.months[0].properties.at(-1)!.payments.map(payment=>[payment.type,payment.amountCents]),[['Owner',0]]);
});

test('bulk new properties retain bank accounts from each file',()=>{
 const entries=[entry(1),entry(2)];entries.forEach((e,i)=>{e.sheet.rows[0].push({value:'Details'});e.sheet.rows[1].push({value:'Transfer to Name, Checking '+(5864+i)+' (CAD)'});});
 const result=buildBulkImportPreview(month,entries);const change=result.changes[0];assert.equal(change.kind,'addProperty');if(change.kind!=='addProperty')return;
 assert.deepEqual(change.initialPayments?.map(p=>p.bankDetails),['Checking 5864','Checking 5865']);
});
