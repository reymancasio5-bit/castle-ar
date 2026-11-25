import test from 'node:test';
import assert from 'node:assert/strict';
import {sameBankReference,validSourceAccount} from '../src/bank-account.ts';
import {matchStatement,recordPreviewReceipt} from '../src/bank-reconciliation.ts';
import {applyOwnerChange,matchOwnerDeposits} from '../src/owners.ts';
import {prepareFreshBankImport} from '../src/import-save.ts';
import type {BankReceipt,Change,Month,OwnerChange,Payment,Snapshot} from '../src/types.ts';

const credit={account:'0123',accountIdentity:'0123',currency:'CAD' as const,date:'2026-10-02',source:'fixture.csv',reference:'SOURCEA',amountCents:10000};
const pay=(id:string,amountCents=10000,bankDetails='Checking 0123 (CAD)'):Payment=>({id,amountCents,payoutDate:'2026-10-01',type:'Airbnb',bundleCents:10000,bankDetails,bankCents:null,bankDate:'',verifiedByDaisy:false});
const month=(...payments:Payment[]):Month=>({id:'m',month:'2026-10',label:'October',properties:[{id:'a',name:'Apartment',manager:'',totalCents:10000,payments}]});
const snapshot=(m=month()):Snapshot=>({revision:'r',months:[m],updatedAt:'',spreadsheetUrl:'',bankReceiptSchema:1,bankAccountSuffixSchema:1,bankReceipts:[],ownerReceiptSchema:1,ownerTransfers:[],owners:[{id:'o',name:'Owner',bankName:'OWNER',active:true,email:'',notes:'',propertyNames:['Apartment']}]});
type OwnerImport=Extract<OwnerChange,{kind:'importOwnerTransfer'}>;
const ownerImport=(identity='0123',amountCents=6000):OwnerImport=>({...credit,kind:'importOwnerTransfer',accountIdentity:identity,ownerId:'o',monthId:'m',bankName:'OWNER',allocations:[{propertyId:'a',amountCents}]});
const ownerDeposit=(identity='0123')=>({...credit,accountIdentity:identity,kind:'owner' as const,ownerName:'OWNER'});

test('last four digits preserve leading zeros and match suffix, full, and masked payout details',()=>{
 assert.equal(validSourceAccount('0123','0123'),true);assert.equal(validSourceAccount('0123','123'),false);assert.equal(validSourceAccount('0123',''),false);
 for(const details of ['Checking 0123 (CAD)','Checking 10000123 CAD','Checking ****0123 CAD'])assert.equal(matchStatement([credit],month(pay('p',10000,details))).changes.length,1,details);
 assert.equal(sameBankReference(credit,{...credit,accountIdentity:'10000123'}),true);
 assert.equal(sameBankReference({...credit,accountIdentity:'10000123'},{...credit,accountIdentity:'20000123'}),false);
});

test('same batch full and suffix receipt aliases are duplicates in either order',()=>{
 for(const identities of [['0123','10000123'],['10000123','0123']]){
  const result=matchStatement(identities.map(accountIdentity=>({...credit,accountIdentity})),month(pay('p')));
  assert.equal(result.changes.length,1);assert.match(result.rows[1].status,/duplicate/i);
  const conflict=matchStatement(identities.map((accountIdentity,i)=>({...credit,accountIdentity,amountCents:10000+i})),month(pay('p')));
  assert.equal(conflict.changes.length,0);assert.ok(conflict.rows.every(row=>/conflict/i.test(row.status)));
 }
});

test('platform aliases share cumulative receipt allocations and preserve stored source evidence',()=>{
 for(const [original,incoming] of [['0123','10000123'],['10000123','0123']]){
  const s=snapshot(month(pay('one',6000),pay('two',4000)));
  const first=matchStatement([{...credit,accountIdentity:original}],s.months[0]).changes[0];
  assert.ok(first);recordPreviewReceipt(s,first,[first]);
  const later=matchStatement([{...credit,accountIdentity:incoming}],s.months[0],{receipts:s.bankReceipts,months:s.months}).changes;
  assert.equal(later.length,1);recordPreviewReceipt(s,later[0],later);
  assert.equal(s.bankReceipts!.length,1);assert.equal(s.bankReceipts![0].accountIdentity,original);
  assert.equal(s.bankReceipts![0].allocations.reduce((sum,a)=>sum+a.amountCents,0),10000);
  recordPreviewReceipt(s,later[0],later);assert.equal(s.bankReceipts![0].allocations.length,2);
  const over=month(pay('third',1));over.id='other';
  assert.equal(matchStatement([{...credit,accountIdentity:incoming}],over,{receipts:s.bankReceipts,months:[...s.months,over]}).changes.length,0);
 }
});

test('ambiguous suffix cannot bridge distinct full accounts in review or receipt saving',()=>{
 const m=month(pay('one',6000,'Checking 10000123 CAD'),pay('two',4000,'Checking 20000123 CAD'));
 const result=matchStatement([credit],m);assert.equal(result.changes.length,0);assert.match(result.rows[0].status,/ambiguous|same last four/i);
 const s=snapshot(m),change:Extract<Change,{kind:'reconcileBank'}>={kind:'reconcileBank',paymentId:'one',account:'0123',bundleCents:10000,bankDate:credit.date,receipt:{...credit,platform:'Airbnb'}};
 assert.throws(()=>recordPreviewReceipt(s,change,[change]),/ambiguous|same last four/i);
 const old:BankReceipt={...credit,platform:'Airbnb',allocations:[{monthId:'prior',propertyName:'Prior',bundleOnly:false,paymentIndex:0,amountCents:10000}]};
 assert.equal(matchStatement([{...credit,accountIdentity:'10000123'}],m,{receipts:[old]}).changes.length,0);
});

test('owner aliases resume partial receipts and replay without changing original account evidence',()=>{
 for(const [original,incoming] of [['0123','10000123'],['10000123','0123']]){
  const s=snapshot();applyOwnerChange(s,ownerImport(original));
  const review=matchOwnerDeposits([ownerDeposit(incoming)],s.months[0],s.owners!,s.ownerTransfers!,s.months,s.bankReceipts);
  assert.equal(review[0].duplicate,false);assert.equal(review[0].remainingCents,4000);assert.equal(review[0].existingTransferId,s.ownerTransfers![0].id);
  const resume={...ownerImport(incoming,4000),transferId:s.ownerTransfers![0].id,priorAllocatedCents:6000};
  assert.equal(prepareFreshBankImport(s,[resume],s).length,1);
  applyOwnerChange(s,resume);const saved=structuredClone(s);applyOwnerChange(s,resume);assert.deepEqual(s,saved);
  assert.equal(s.ownerTransfers!.length,1);assert.equal(s.ownerTransfers![0].accountIdentity,original);assert.equal(s.ownerTransfers![0].allocations.length,2);
  assert.throws(()=>applyOwnerChange(s,ownerImport(incoming)),/already/i);
 }
});

test('owner suffix collision and cross-category alias reuse cannot create extra receipts',()=>{
 const s=snapshot(month(pay('one',6000,'Checking 10000123 CAD'),pay('two',4000,'Checking 20000123 CAD')));
 assert.throws(()=>applyOwnerChange(s,ownerImport()),/ambiguous|same last four/i);
 const review=matchOwnerDeposits([ownerDeposit()],s.months[0],s.owners!,[],s.months);assert.equal(review[0].allocations.length,0);assert.match(review[0].status,/ambiguous|same last four/i);
 const valid=snapshot();applyOwnerChange(valid,ownerImport('10000123'));
 assert.equal(matchStatement([credit],month(pay('p')),{ownerTransfers:valid.ownerTransfers}).changes.length,0);
 const platform=snapshot();platform.bankReceipts=[{...credit,platform:'Airbnb',allocations:[]}];
 assert.throws(()=>applyOwnerChange(platform,ownerImport('10000123')),/platform/i);
});

test('fresh saves require the suffix-aware backend only when four digits are used',()=>{
 const s=snapshot(month(pay('p'))),changes=matchStatement([credit],s.months[0]).changes;
 assert.equal(prepareFreshBankImport(s,changes,s).length,1);
 const old={...s,bankAccountSuffixSchema:undefined};assert.throws(()=>prepareFreshBankImport(s,changes,old),/deploy|upgrade/i);
 const full=matchStatement([{...credit,accountIdentity:'10000123'}],s.months[0]).changes;assert.equal(prepareFreshBankImport(old,full,old).length,1);
});

test('contradictory masked accounts block suffix sources and ambiguous payment targets',()=>{
 const m=month(pay('one',6000,'Checking 10****0123 CAD'),pay('two',4000,'Checking 20****0123 CAD'));
 const suffix=matchStatement([credit],m);
 assert.equal(suffix.changes.length,0);assert.match(suffix.rows[0].status,/ambiguous/i);
 const full={...credit,accountIdentity:'10000123'};
 assert.equal(matchStatement([full],m).changes.length,0);
 const change:Extract<Change,{kind:'reconcileBank'}>={kind:'reconcileBank',paymentId:'one',account:'0123',bundleCents:10000,bankDate:credit.date,receipt:{...full,platform:'Airbnb'}};
 assert.throws(()=>recordPreviewReceipt(snapshot(m),change,[change]),/differ|ambiguous/i);
});

test('mixed currency history cannot bypass an earlier verification without a receipt reference',()=>{
 for(const accountIdentity of ['0123','10000123']){
  const legacy={...pay('legacy',10000,'Checking 0123'),verifiedBySystem:true,bankDate:credit.date,bankCents:10000};
  const s=snapshot(month(legacy,pay('next')));
  s.bankReceipts=[{...credit,accountIdentity:'10000123',currency:'USD',reference:'OTHER',platform:'Airbnb',allocations:[]}];
  const incoming={...credit,accountIdentity},review=matchStatement([incoming],s.months[0],{receipts:s.bankReceipts,months:s.months});
  assert.equal(review.changes.length,0);assert.match(review.rows[0].status,/no receipt reference/i);
  const change:Extract<Change,{kind:'reconcileBank'}>={kind:'reconcileBank',paymentId:'next',account:'0123',bundleCents:10000,bankDate:credit.date,receipt:{...incoming,platform:'Airbnb'}};
  assert.throws(()=>recordPreviewReceipt(s,change,[change]),/no receipt reference/i);
 }
});
