import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkImportPreview } from '../src/bulk-import.ts';
import type { Month } from '../src/types.ts';
import type { ImportSheet } from '../src/import.ts';
const month: Month = { id: 'm', label: '', month: '2026-10', properties: [] };
const options = { headerRow: 0, nameColumn: 1, amountColumn: 2, destination: 'Airbnb1' as const, sumDuplicates: false, propertyName: 'House', manager: 'Manager', total: '100', airbnbSlot: 'auto' as const };
const sheet = (n: number, currency = 'CAD'): ImportSheet => ({ name: 'CSV', rows: [['Type','Listing','Amount','Paid out','Arriving by date','Currency'], ['Payout','','',n,'2026-10-09',currency], ['Reservation','Listing',n,'','',currency]].map(row => row.map(value => ({value}))) });
const entry = (n: number) => ({ fileName: `${n}.csv`, sheet: sheet(n), options });

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
 const existing: Month = { ...month, properties: [{id:'p',name:'House',manager:'Manager',totalCents:10000,payments:Array.from({length:3},(_,i)=>({id:`p${i}`,type:'Airbnb' as const,amountCents:i===0?999:null,payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false}))}] };
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
 const result=await api.save(before.revision,[{kind:'addProperty',monthId:before.months[0].id,name:'Bulk test house',manager:'Team',totalCents:500,additionalPayments:[{amountCents:100,payoutDate:'2026-10-09',bundleCents:200}]}]);
 const property=result.months[0].properties.at(-1)!;
 assert.equal(property.payments.length,6);
 const appended=await api.save(result.revision,[{kind:'appendPayments',propertyId:property.id,payments:[{amountCents:300}]}]);
 assert.equal(appended.months[0].properties.at(-1)!.payments.at(-1)!.amountCents,300);
});
