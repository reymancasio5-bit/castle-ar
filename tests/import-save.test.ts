import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFreshBulkImport,saveRebuiltImport,ImportReviewRequired,prepareFreshBankImport,BankImportReviewRequired,remapBankAllocationDrafts} from '../src/import-save.ts';
import {buildBulkImportPreview,type BulkImportEntry} from '../src/bulk-import.ts';
import type {Month,Snapshot,Change} from '../src/types.ts';
const month:Month={id:'m',label:'October',month:'2026-10',properties:[]};
const entries:BulkImportEntry[]=[{fileName:'payment.csv',sheet:{name:'CSV',rows:[['Type','Amount','Paid out','Arriving by date','Currency'],['Payout','',10,'2026-10-09','CAD'],['Reservation',10,'','','CAD']].map(row=>row.map(value=>({value})))},options:{headerRow:0,nameColumn:0,amountColumn:1,destination:'Airbnb1',sumDuplicates:false,propertyName:'House',manager:'Team A',total:'100',airbnbSlot:'auto',airbnbRecipient:'castle'}}];
const snap=(m=month,revision='fresh'):Snapshot=>({revision,months:[m],updatedAt:'',spreadsheetUrl:''});
const existing=(totalCents=10000):Month=>({...month,properties:[{id:'m:9',name:'House',manager:'Team A',totalCents,payments:[]}]});
test('fresh import uses current row IDs and merges another user creating the same property',()=>{
 const reviewed=buildBulkImportPreview(month,entries).changes;
 const changes=prepareFreshBulkImport(month,entries,reviewed,snap(existing()));
 assert.equal(changes.length,1);assert.equal(changes[0].kind,'appendPayments');
 if(changes[0].kind==='appendPayments')assert.equal(changes[0].propertyId,'m:9');
});
test('fresh import skips identical payouts already saved by another user',()=>{
 const latest=existing();latest.properties[0].payments.push({id:'m:10',type:'Airbnb',receivedBy:'castle',amountCents:1000,bundleCents:1000,payoutDate:'2026-10-09',bankDate:'',bankCents:null,verifiedByDaisy:false});
 assert.deepEqual(prepareFreshBulkImport(month,entries,buildBulkImportPreview(month,entries).changes,snap(latest)),[]);
});
test('changed totals and deleted targets require review instead of overwriting or recreating them',()=>{
 const original=existing();const reviewed=buildBulkImportPreview(original,entries).changes;
 assert.throws(()=>prepareFreshBulkImport(original,entries,reviewed,snap(existing(20000))),ImportReviewRequired);
 assert.throws(()=>prepareFreshBulkImport(original,entries,reviewed,snap(month)),ImportReviewRequired);
});
test('save rereads and rebuilds on an explicit conflict, never resending old row IDs',async()=>{
 let reads=0,writes=0;const revisions:string[]=[];
 const result=await saveRebuiltImport({read:async()=>snap(month,String(++reads)),save:async(revision,changes)=>{revisions.push(revision);assert.equal((changes[0] as any).propertyId,revision);if(++writes===1)throw Object.assign(new Error('changed'),{code:'CONFLICT'});return snap(month,'saved');}},latest=>[{kind:'appendPayments',propertyId:latest.revision,payments:[{amountCents:1}]}],async()=>{});
 assert.equal(result.revision,'saved');assert.deepEqual(revisions,['1','2']);
});
test('uncertain writes are not retried and duplicate-only batches do not write',async()=>{
 let writes=0;
 await assert.rejects(saveRebuiltImport({read:async()=>snap(),save:async()=>{writes++;throw Object.assign(new Error('unconfirmed'),{code:'WRITE_UNCONFIRMED'});}},()=>[{kind:'setTotal',propertyId:'p',amountCents:1}],async()=>{}),/unconfirmed/);
 assert.equal(writes,1);
 await saveRebuiltImport({read:async()=>snap(),save:async()=>{throw new Error('must not write');}},()=>[]);
});
test('retries are bounded and preserve the draft when the sheet stays busy',async()=>{
 let writes=0;
 await assert.rejects(saveRebuiltImport({read:async()=>snap(),save:async()=>{writes++;throw Object.assign(new Error('busy'),{code:'BUSY'});}},()=>[{kind:'setTotal',propertyId:'p',amountCents:1}],async()=>{}),/files.*kept/i);
 assert.equal(writes,4);
});

test('bank uploads remap shifted rows while preserving manual allocation amounts',()=>{
 const before=snap(existing()),latest=structuredClone(before);latest.months[0].properties[0].id='m:30';
 const change:Change={kind:'importOwnerTransfer',ownerId:'owner',monthId:'m',bankName:'Owner',account:'1234',date:'2026-10-01',reference:'REF123',source:'bank.pdf',amountCents:5000,allocations:[{propertyId:'m:9',monthId:'m',amountCents:5000}]};
 const result=prepareFreshBankImport(before,[change],latest);
 assert.equal(result[0].kind,'importOwnerTransfer');
 if(result[0].kind==='importOwnerTransfer')assert.equal(result[0].allocations[0].propertyId,'m:30');
 assert.deepEqual(remapBankAllocationDrafts(before,latest,{0:{'m:9':'50.00'}}),{0:{'m:30':'50.00'}});
 latest.months[0].properties[0].totalCents=5000;
 assert.throws(()=>prepareFreshBankImport(before,[change],latest),BankImportReviewRequired);
 latest.ownerTransfers=[{id:'transfer',ownerId:'owner',ownerName:'Owner',bankName:'Owner',account:'1234',date:change.date,reference:change.reference,source:change.source,amountCents:5000,monthId:'m',allocations:[{propertyName:'House',amountCents:5000}]}];
 assert.deepEqual(prepareFreshBankImport(before,[change],latest),[]);
});

test('bank reconciliation remaps the payment but refuses changed payment evidence',()=>{
 const before=snap(existing());before.months[0].properties[0].payments.push({id:'m:10',type:'Airbnb',amountCents:1000,bundleCents:1000,payoutDate:'2026-10-09',bankDate:'',bankCents:null,verifiedByDaisy:false});
 const latest=structuredClone(before);latest.months[0].properties[0].id='m:20';latest.months[0].properties[0].payments[0].id='m:21';
 const change:Change={kind:'reconcileBank',paymentId:'m:10',account:'1234',bundleCents:1000,bankDate:'2026-10-10'};
 assert.deepEqual(prepareFreshBankImport(before,[change],latest),[{...change,paymentId:'m:21'}]);
 latest.months[0].properties[0].payments[0].bankCents=2000;
 assert.throws(()=>prepareFreshBankImport(before,[change],latest),BankImportReviewRequired);
});

test('an explicit payment replacement can follow a row move but not a concurrent amount edit',()=>{
 const original=existing();original.properties[0].payments.push({id:'m:10',type:'Airbnb',amountCents:500,bundleCents:500,payoutDate:'2026-10-08',bankDate:'',bankCents:null,verifiedByDaisy:false});
 const replace=entries.map(entry=>({...entry,options:{...entry.options,airbnbSlot:'1' as const}}));
 const reviewed=buildBulkImportPreview(original,replace).changes,latest=structuredClone(original);
 latest.properties[0].id='m:20';latest.properties[0].payments[0].id='m:21';
 const changes=prepareFreshBulkImport(original,replace,reviewed,snap(latest));
 assert.ok(changes.some(c=>c.kind==='updatePayment'&&c.paymentId==='m:21'));
 latest.properties[0].payments[0].amountCents=999;
 assert.throws(()=>prepareFreshBulkImport(original,replace,reviewed,snap(latest)),ImportReviewRequired);
});
