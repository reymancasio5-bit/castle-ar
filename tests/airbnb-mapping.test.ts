import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPropertyImportPreview } from '../src/property-import.ts';
import type { ImportSheet } from '../src/import.ts';
import type { Month } from '../src/types.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readSpreadsheet } from '../src/excel.ts';
import { buildBulkImportPreview } from '../src/bulk-import.ts';
import { createPreviewApi } from '../src/preview-api.ts';

const headers = ['Date','Arriving by date','Type','Confirmation code','Booking date','Start date','End date','Nights','Guest','Listing','Details','Reference code','Currency','Amount','Paid out'];
const payout = (bundle = 3040, bank = '5864') => ['09/14/2026','09/21/2026','Payout','','','','','','','','Transfer to Name, Checking '+bank+' (CAD)','','CAD','',bundle];
const reservation = (id = 'one', amount = 436.86) => ['09/14/2026','','Reservation',id,'09/08/2026','09/11/2026','09/13/2026',2,'Guest','Listing','','','CAD',amount,''];
const sheet = (...rows: unknown[][]): ImportSheet => ({name:'Airbnb',rows:[headers,...rows].map(row=>row.map(value=>({value})))});
const month: Month = {id:'m',label:'September',month:'2026-09',properties:[]};
const options = {headerRow:0,nameColumn:9,amountColumn:13,destination:'Airbnb1' as const,sumDuplicates:false,propertyName:'Foxglove',manager:'Team A',total:'910.34',airbnbSlot:'auto' as const};
function imported(input: ImportSheet) {
 const result=buildPropertyImportPreview(month,input,options);
 const change=result.changes[0];
 assert.equal(change?.kind,'addProperty');
 if(change.kind!=='addProperty') throw new Error('Expected property');
 return [...(change.initialPayments??[]),...(change.additionalPayments??[])];
}
test('skips standalone bundles and carries the matching parent details to the reservation',()=>{
 const rows=imported(sheet(payout(100),payout(),reservation(),payout(200)));
 assert.equal(rows.length,1);
 assert.deepEqual([rows[0].amountCents,rows[0].bundleCents,rows[0].payoutDate,rows[0].bankDetails],[43686,304000,'2026-09-21','Checking 5864']);
});
test('each D-J value is required, including listing, while numeric zero counts as present',()=>{
 for(let column=3;column<=9;column++) {
  const incomplete=reservation(); incomplete[column]=' ';
  assert.equal(buildPropertyImportPreview(month,sheet(payout(),incomplete),options).changes.length,0);
 }
 const zero=reservation();zero[7]=0;
 assert.equal(imported(sheet(payout(),zero)).length,1);
});
test('separate reservations retain their amounts and the nearest parent bundle even on the same date',()=>{
 const payments=imported(sheet(payout(),reservation('a',100),reservation('b',100),payout(900,'9999'),reservation('c',200)));
 assert.deepEqual(payments.map(p=>[p.amountCents,p.bundleCents,p.bankDetails]),[[10000,304000,'Checking 5864'],[10000,304000,'Checking 5864'],[20000,90000,'Checking 9999']]);
});
test('a reservation date must match its own parent rather than an earlier bundle',()=>{
 const wrong=reservation();wrong[0]='09/15/2026';
 const result=buildPropertyImportPreview(month,sheet(payout(),wrong),options);
 assert.equal(result.changes.length,0);
 assert.match(result.rows.at(-1)!.reason,/date/i);
});
test('Excel date cells match CSV-style dates',()=>{
 const input=sheet(payout(),reservation());input.rows[2][0].value=new Date('2026-09-14T00:00:00Z');
 assert.equal(imported(input).length,1);
});

test('Resolution Payout permits a blank booking date and retains its parent bundle details',()=>{
 const resolution=reservation('claim',24.40);resolution[2]='Resolution Payout';resolution[4]='';
 const parent=payout(2011.63);parent[0]='09/28/2026';parent[1]='10/06/2026';resolution[0]='09/28/2026';
 for(const prefix of [[],[payout(),reservation()]]) {
  const payments=imported(sheet(...prefix,payout(10),parent,resolution));
  const payment=payments.at(-1)!;
  assert.deepEqual([payment.amountCents,payment.bundleCents,payment.payoutDate,payment.bankDetails],[2440,201163,'2026-10-06','Checking 5864']);
 }
});

test('Resolution Payout exemption does not bypass other details or matching dates',()=>{
 const resolution=reservation('claim',24.40);resolution[2]='Resolution Payout';resolution[4]='';
 for(const column of [3,5,6,7,8,9]) {
  const incomplete=[...resolution];incomplete[column]='';
  assert.equal(buildPropertyImportPreview(month,sheet(payout(),incomplete),options).changes.length,0);
 }
 resolution[0]='09/15/2026';
 assert.equal(buildPropertyImportPreview(month,sheet(payout(),resolution),options).changes.length,0);
});

test('CSV and Excel uploads persist separate equal payments and repeat imports add nothing',async()=>{
 const xlsx=vm.runInThisContext(readFileSync('public/vendor/xlsx.full.min.js','utf8')+'\nXLSX;');
 const previous=(globalThis as any).window;
 (globalThis as any).window={XLSX:xlsx};
 try {
  const input=sheet(payout(10),payout(),reservation('a',100),reservation('b',100),reservation('c',200),reservation('d',300),payout(20));
  const workbook=xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook,xlsx.utils.aoa_to_sheet(input.rows.map(row=>row.map(cell=>cell.value))),'Airbnb');
  for(const format of ['csv','xlsx']) {
   const bytes=xlsx.write(workbook,{type:'array',bookType:format});
   const [parsed]=await readSpreadsheet(new File([new Uint8Array(bytes)],`reservations.${format}`));
   const api=createPreviewApi();const before=await api.read();
   const target=before.months[0];
   const entry={fileName:`reservations.${format}`,sheet:parsed,options};
   const preview=buildBulkImportPreview(target,[entry]);
   const saved=await api.save(before.revision,preview.changes);
   const after=saved.months.find(m=>m.id===target.id)!;
   const property=after.properties.find(p=>p.name==='Foxglove')!;
   assert.deepEqual(property.payments.map(p=>p.amountCents),[10000,10000,20000,30000]);
   assert.ok(property.payments.every(p=>p.bundleCents===304000 && p.bankDetails==='Checking 5864' && p.payoutDate==='2026-09-21' && p.bankCents===null && p.bankDate===''));
   assert.equal(buildBulkImportPreview(after,[entry]).changes.length,0);
  }
 } finally {
  if(previous===undefined) delete (globalThis as any).window;
  else (globalThis as any).window=previous;
 }
});
