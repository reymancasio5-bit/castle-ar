import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOwnerChange,matchOwnerDeposits,ownerReceiptNote,ownerTransferOperationApplied} from '../src/owners.ts';
import type {OwnerChange,Snapshot} from '../src/types.ts';

const snapshot=():Snapshot=>({revision:'r',updatedAt:'',spreadsheetUrl:'',ownerReceiptSchema:1,ownerSchema:1,owners:[{id:'owner',name:'Example Owner',bankName:'EXAMPLE OWNER',email:'',notes:'',active:true,propertyNames:['Coastal Home','City Home']}],ownerTransfers:[],months:[
 {id:'oct',month:'2026-10',label:'October 2026',properties:[{id:'oct:a',name:'Coastal Home',manager:'',totalCents:8781,payments:[]},{id:'oct:b',name:'City Home',manager:'',totalCents:11591,payments:[]}]},
 {id:'nov',month:'2026-11',label:'November 2026',properties:[{id:'nov:a',name:'Coastal Home',manager:'',totalCents:88484,payments:[]}]},
]});
type Import=Extract<OwnerChange,{kind:'importOwnerTransfer'}>;
const change=():Import=>({kind:'importOwnerTransfer',ownerId:'owner',monthId:'oct',account:'8713',accountIdentity:'100008713',currency:'USD',date:'2026-11-09',reference:'TDP0KAXY6V6X',source:'statement.xlsx',bankName:'EXAMPLE OWNER',amountCents:108856,allocations:[{propertyId:'oct:a',amountCents:8781},{propertyId:'oct:b',amountCents:11591}]});
const deposit=()=>({kind:'owner' as const,ownerName:'EXAMPLE OWNER',account:'8713',accountIdentity:'100008713',currency:'USD' as const,date:'2026-11-09',reference:'TDP0KAXY6V6X',source:'statement.xlsx',amountCents:108856});
function resume(s:Snapshot,amountCents=88484):Import{return {...change(),monthId:'nov',transferId:s.ownerTransfers![0].id,priorAllocatedCents:20372,allocations:[{propertyId:'nov:a',monthId:'nov',amountCents}]};}

test('partial owner receipt records exact original and allocated amounts with a factual remainder note',()=>{
 const s=snapshot();applyOwnerChange(s,change());
 const saved=s.ownerTransfers![0];assert.equal(saved.amountCents,108856);assert.equal(saved.allocations.reduce((n,a)=>n+a.amountCents,0),20372);
 assert.match(saved.note??'',/Received USD 1,088\.56; allocated USD 203\.72; unallocated USD 884\.84/);
 assert.match(saved.note??'',/\[October 2026\] Coastal Home: USD 87\.81/);
 assert.deepEqual(s.months[0].properties.map(p=>p.payments[0].amountCents),[8781,11591]);
});

test('remaining owner funds can be allocated in another month without mutating prior receipt objects',()=>{
 const s=snapshot();applyOwnerChange(s,change());const prior=s.ownerTransfers![0],priorCopy=structuredClone(prior);
 const row=matchOwnerDeposits([deposit(),deposit()],s.months[1],s.owners!,s.ownerTransfers!,s.months)[0];
 assert.equal(row.duplicate,false);assert.equal(row.existingTransferId,prior.id);assert.equal(row.previouslyAllocatedCents,20372);assert.equal(row.remainingCents,88484);assert.deepEqual(row.allocations,[{propertyId:'nov:a',amountCents:88484}]);
 const duplicate=matchOwnerDeposits([deposit(),deposit()],s.months[1],s.owners!,s.ownerTransfers!,s.months)[1];assert.equal(duplicate.duplicate,true);
 applyOwnerChange(s,resume(s));assert.deepEqual(prior,priorCopy);assert.equal(s.ownerTransfers!.length,1);assert.notEqual(s.ownerTransfers![0],prior);
 assert.equal(s.ownerTransfers![0].allocations.length,3);assert.equal(s.months[1].properties[0].payments.length,1);assert.match(s.ownerTransfers![0].note??'',/unallocated USD 0\.00/);
 assert.equal(matchOwnerDeposits([deposit()],s.months[1],s.owners!,s.ownerTransfers!,s.months)[0].duplicate,true);
});

test('resume replay is idempotent and stale conflicting allocations are rejected without mutation',()=>{
 const s=snapshot();applyOwnerChange(s,change());const operation=resume(s,40000);applyOwnerChange(s,operation);const applied=structuredClone(s);
 applyOwnerChange(s,operation);assert.deepEqual(s,applied);
 assert.throws(()=>applyOwnerChange(s,{...operation,allocations:[{propertyId:'nov:a',monthId:'nov',amountCents:40001}]}),/changed|stale|remaining|allocation/i);assert.deepEqual(s,applied);
 const again={...operation,priorAllocatedCents:60372,allocations:[{propertyId:'nov:a',monthId:'nov',amountCents:48484}]};applyOwnerChange(s,again);
 assert.equal(s.months[1].properties[0].payments.length,2);assert.equal(s.ownerTransfers![0].allocations.length,4);
});

test('zero, excessive, incomplete resume identity and contradictory receipt evidence remain blocked',()=>{
 for(const mutation of [(c:Import)=>{c.allocations=[];},(c:Import)=>{c.allocations[0].amountCents=0;},(c:Import)=>{c.allocations[0].amountCents=108856;},(c:Import)=>{c.priorAllocatedCents=0;}]){
  const s=snapshot(),before=structuredClone(s),c=change();mutation(c);assert.throws(()=>applyOwnerChange(s,c));assert.deepEqual(s,before);
 }
 for(const mutation of [(c:Import)=>{c.priorAllocatedCents=undefined;},(c:Import)=>{c.amountCents++;},(c:Import)=>{c.currency='CAD';},(c:Import)=>{c.reference='OTHERREF';},(c:Import)=>{c.date='2026-11-10';},(c:Import)=>{c.accountIdentity='200008713';},(c:Import)=>{c.allocations[0].amountCents=88485;}]){
  const s=snapshot();applyOwnerChange(s,change());const before=structuredClone(s),c=resume(s);mutation(c);assert.throws(()=>applyOwnerChange(s,c));assert.deepEqual(s,before);
 }
});

test('original partial imports cannot bypass explicit resumption by reusing a reference',()=>{
 const s=snapshot();applyOwnerChange(s,change());const before=structuredClone(s);assert.throws(()=>applyOwnerChange(s,change()),/already|duplicate/i);assert.deepEqual(s,before);
});

test('partial transfers require the new backend capability while exact legacy imports remain usable',()=>{
 const s=snapshot();delete s.ownerReceiptSchema;assert.throws(()=>applyOwnerChange(s,change()),/deployment|partial|receipt/i);
 const c=change();c.amountCents=20372;assert.doesNotThrow(()=>applyOwnerChange(s,c));
});

test('notes preserve exact totals while bounding detail and using available reporting-month labels',()=>{
 const receipt={currency:'USD' as const,amountCents:123456,monthId:'oct',allocations:Array.from({length:12},(_,i)=>({propertyName:`Home ${i+1}`,amountCents:100}))};
 const note=ownerReceiptNote(receipt,snapshot().months);
 assert.match(note,/Received USD 1,234\.56; allocated USD 12\.00; unallocated USD 1,222\.56/);
 assert.match(note,/\[October 2026\] Home 10: USD 1\.00/);assert.doesNotMatch(note,/Home 11|Home 12/);assert.match(note,/2 more allocations\.$/);
 assert.match(ownerReceiptNote({...receipt,allocations:receipt.allocations.slice(0,11)}),/1 more allocation\.$/);
 assert.match(ownerReceiptNote({...receipt,allocations:[]}),/unallocated USD 1,234\.56\.$/);
});

test('replay verification requires the exact base boundary and target amounts regardless of row order',()=>{
 const s=snapshot();applyOwnerChange(s,change());const receipt=s.ownerTransfers![0];
 assert.equal(ownerTransferOperationApplied(receipt,0,[...receipt.allocations].reverse()),true);
 assert.equal(ownerTransferOperationApplied(receipt,1,[...receipt.allocations]),false);
 assert.equal(ownerTransferOperationApplied(receipt,8781,[receipt.allocations[1]]),true);
 assert.equal(ownerTransferOperationApplied(receipt,8781,[{...receipt.allocations[1],amountCents:11590}]),false);
 assert.equal(ownerTransferOperationApplied(receipt,20372,[]),false);
});

test('oversized cumulative receipt history is rejected before any property payment is added',()=>{
 const s=snapshot();
 s.months[0].properties=Array.from({length:300},(_,index)=>({id:`property-${index}`,name:`Property ${index} ${'x'.repeat(140)}`,manager:'',totalCents:10,payments:[]}));
 s.owners![0].propertyNames=s.months[0].properties.map(p=>p.name);
 const c={...change(),allocations:s.months[0].properties.map(p=>({propertyId:p.id,amountCents:1}))};
 const before=structuredClone(s);assert.throws(()=>applyOwnerChange(s,c),/spreadsheet cell limit/);assert.deepEqual(s,before);
});
