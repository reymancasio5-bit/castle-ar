import test from 'node:test';
import assert from 'node:assert/strict';
import {matchStatement} from '../src/bank-statement.ts';
import {prepareFreshBankImport} from '../src/import-save.ts';
import type {Month,Payment} from '../src/types.ts';

const credit={account:'0123',accountIdentity:'10000123',currency:'CAD' as const,date:'2026-10-02',source:'fixture.csv',reference:'SOURCEA',amountCents:10000};
const pay=(id:string,amountCents:number,extra:Partial<Payment>={}):Payment=>({id,amountCents,payoutDate:'2026-10-01',type:'Airbnb',bundleCents:10000,bankDetails:'Checking 0123',bankCents:null,bankDate:'',verifiedByDaisy:false,...extra});
const month=(...payments:Payment[]):Month=>({id:'m',month:'2026-10',label:'October',properties:[{id:'a',name:'Apartment',manager:'',totalCents:0,payments}]});
test('a second export is visible once as a duplicate while contradictory references block all related records',()=>{
 const m=month(pay('1',6000));
 const same=matchStatement([credit,{...credit,source:'repeat.csv'}],m);
 assert.equal(same.changes.length,1);assert.match(same.rows[1].status,/duplicate/i);
 const different=matchStatement([credit,{...credit,amountCents:20000}],m);
 assert.equal(different.changes.length,0);assert.ok(different.rows.every(r=>/conflict/i.test(r.status)));
});
test('a full source account never matches a different account with the same suffix, or an ambiguous suffix',()=>{
 const m=month(pay('one',6000,{bankDetails:'Checking 10000123 CAD'}),pay('two',4000,{bankDetails:'Checking 20000123 CAD'}),pay('unknown',1000));
 const result=matchStatement([credit],m);
 assert.deepEqual(result.changes.map(c=>c.paymentId),['one']);
 assert.equal(matchStatement([{...credit,currency:'USD'}],m).changes.length,0);
});
test('equal receipts can explicitly select distinct payout groups including single payments on the same date',()=>{
 const m=month(pay('1',10000),pay('2',10000));const deposits=[credit,{...credit,reference:'SOURCEB'}];
 const review=matchStatement(deposits,m);assert.equal(review.changes.length,0);
 assert.equal(review.rows[0].candidates.length,2);
 const selections=Object.fromEntries(review.rows.map((r,i)=>[r.selectionKey,r.candidates[i].id]));
 const result=matchStatement(deposits,m,{selections});assert.deepEqual(result.changes.map(c=>c.paymentId),['1','2']);
 const collision=matchStatement(deposits,m,{selections:Object.fromEntries(review.rows.map(r=>[r.selectionKey,r.candidates[0].id]))});
 assert.equal(collision.changes.length,0);
});
test('missing references, missing currency and incomplete account identifiers cannot issue verification',()=>{
 const m=month(pay('1',10000));
 for(const missing of [{reference:''},{accountIdentity:''},{currency:undefined}])assert.equal(matchStatement([{...credit,...missing}],m).changes.length,0);
});
test('a legacy backend cannot accept bank imports',()=>{
 const m=month(pay('1',10000));const snapshot={revision:'r',months:[m],updatedAt:'',spreadsheetUrl:''};
 assert.throws(()=>prepareFreshBankImport(snapshot,matchStatement([credit],m).changes,snapshot),/upgrade|deploy/i);
});


test('different full owner accounts sharing a suffix may reuse a reference, while legacy transfers reserve it across both accounts',async()=>{
 const {matchOwnerDeposits}=await import('../src/owners.ts');
 const saved={...credit,ownerId:'o',ownerName:'Owner',bankName:'Owner',id:'t',monthId:'m',allocations:[]};
 const other={...credit,kind:'owner' as const,ownerName:'Owner',accountIdentity:'20000123'};
 assert.equal(matchOwnerDeposits([other],month(),[],[saved])[0].duplicate,false);
 assert.equal(matchOwnerDeposits([other],month(),[],[{...saved,accountIdentity:undefined}])[0].duplicate,true);
 const contradiction=matchOwnerDeposits([{...other,accountIdentity:credit.accountIdentity,amountCents:20100}],month(),[],[saved])[0];
 assert.match(contradiction.status,/conflict/i);
});

test('a newly consumed receipt in a different month forces another review before a retry',()=>{
 const m=month(pay('1',6000)),snapshot={revision:'1',bankReceiptSchema:1,bankReceipts:[],months:[m],updatedAt:'',spreadsheetUrl:''};
 const changes=matchStatement([credit],m).changes;
 const previous={...credit,platform:'Airbnb' as const,allocations:[{monthId:'other',propertyName:'Farm',bundleOnly:false,paymentIndex:0,amountCents:6000}]};
 const latest={...snapshot,bankReceipts:[previous],revision:'2'};
 assert.throws(()=>prepareFreshBankImport(snapshot,changes,latest),/review/i);
 assert.match(matchStatement([credit],m,{receipts:latest.bankReceipts}).rows[0].status,/remaining/i);
});

test('reviewers can split overlapping same-day payout bundles into explicit receipt groups',()=>{
 const m=month(...[6000,4000,7000,3000].map((n,i)=>pay('p'+i,n)));
 const deposits=[credit,{...credit,reference:'SOURCEB'}],preview=matchStatement(deposits,m);
 const [a,b]=preview.rows.map(row=>row.selectionKey);
 const selected=(idsA:string[],idsB:string[]=[])=>matchStatement(deposits,m,{selections:{[a]:JSON.stringify(idsA),...(idsB.length?{[b]:JSON.stringify(idsB)}:{})}});
 assert.deepEqual(selected(['p0','p1'],['p2','p3']).changes.map(c=>[c.receipt.reference,c.paymentId]),[['SOURCEA','p0'],['SOURCEA','p1'],['SOURCEB','p2'],['SOURCEB','p3']]);
 assert.deepEqual(preview.rows[0].selectablePayments.map(row=>row.payment.id),['p0','p1','p2','p3']);
 for(const invalid of [[],['p1','p1'],['p0','gone'],['p0','p2']])assert.equal(selected(invalid).changes.length,0);
 assert.equal(selected(['p0','p1'],['p1','p3']).changes.length,0);
});
test('visible digits in a masked payout account must agree with the source',()=>{
 const source={...credit,account:'2222',accountIdentity:'117777772222'};
 for(const [label,expected] of [['99******2222',0],['11**88**2222',0],['11**77**2222',1],['****2222',1],['11***2222',1]] as const){
  const match=matchStatement([source],month(pay('p',10000,{bankDetails:'Checking '+label+' (CAD)'})));assert.equal(match.changes.length,expected,label);
 }
});
