import test from 'node:test';
import assert from 'node:assert/strict';
import {statementPageText} from '../src/bank-pdf-layout.ts';
import {parseStatement} from '../src/bank-statement.ts';
import {matchOwnerDeposits,applyOwnerChange} from '../src/owners.ts';
import type {Month,PropertyOwner} from '../src/types.ts';
const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
const header='Wells Fargo Everyday Checking\nOctober 31, 2026 Page 2 of 6\nAccount number: 0000008713 (primary account)\nBeginning balance on 10/1 $100.00\nEnding balance on 10/31 $200.00\n';
const incoming='10/5 Zelle From Sample Owner on 10/05 Ref # ABC123 09/2026\t\t330.25\t900.00\nService Fee for Unit 1400 Speedway';
test('Wells Fargo columns preserve credits and exclude Zelle To and debit amounts',()=>{
 const text=statementPageText([item('Deposits/',403,700),item('Withdrawals/',458,700),item('Ending daily',525,700),item('Date',62,690),item('Description',150,690),item('Additions',403,690),item('Subtractions',462,690),item('balance',540,690),item('10/5',62,680),item('Zelle From Sample Owner on 10/05 Ref # ABC123 09/2026',150,680),item('330.25',411,680),{...item('104,344.88',528,680),width:36},item('Service Fee for Unit 1400 Speedway',150,670),item('10/6',62,660),item('Zelle To Someone on 10/06 Ref # OUT123',150,660),item('50.00',480,660),item('850.00',540,660)]);
 const result=parseStatement(header+text);assert.equal(result.deposits.length,1);
 assert.deepEqual(result.deposits[0],{kind:'owner',ownerName:'Sample Owner',account:'8713',date:'2026-10-05',amountCents:33025,reference:'ABC123',source:'Pasted statement',description:'09/2026 Service Fee for Unit 1400 Speedway',propertyReference:'1400 Speedway',serviceMonth:'2026-09'});
});
test('wrapped Zelle references, posting dates, and missing credit columns are handled safely',()=>{
 const result=parseStatement(header+'10/13 Zelle From Sample LLC on 10/11 Ref #\t\t100.00\t900.00\nWRAP123 Service Fee\n10/14 Zelle From Other on 10/14 Ref # BAD123\t50.00\t\t850.00');
 assert.equal(result.deposits.length,1);assert.equal(result.deposits[0].reference,'WRAP123');assert.equal(result.deposits[0].date,'2026-10-13');assert.ok(result.warnings.length);
 assert.throws(()=>parseStatement(header.replace('10/1','11/1')+incoming),/period/i);
});
const owner:PropertyOwner={id:'o',name:'Sample Owner',bankName:'Sample Owner',propertyNames:['1400 Speedway','Other'],email:'',notes:'',active:true};
const sept:Month={id:'sep',label:'September',month:'2026-09',properties:[{id:'sep:p',name:'1400 Speedway',manager:'',totalCents:50000,payments:[]},{id:'sep:q',name:'Other',manager:'',totalCents:33025,payments:[]}]};
const oct:Month={...sept,id:'oct',label:'October',month:'2026-10',properties:sept.properties.map(p=>({...p,payments:[],id:p.id.replace('sep','oct')}))};
test('memo address and explicit month require an exact balance; partial payments remain manual',()=>{
 const deposits=parseStatement(header+incoming).deposits;
 assert.deepEqual(matchOwnerDeposits(deposits,oct,[owner],[],[sept,oct])[0].allocations,[]);
 const exactSept=structuredClone(sept);exactSept.properties[0].totalCents=33025;
 const row=matchOwnerDeposits(deposits,oct,[owner],[],[exactSept,oct])[0];
 assert.deepEqual(row.allocations,[{propertyId:'sep:p',amountCents:33025}]);
 const saved={revision:'1',updatedAt:'',spreadsheetUrl:'',months:structuredClone([sept,oct]),owners:[owner],ownerTransfers:[]};
 const d=deposits[0];
 applyOwnerChange(saved,{kind:'importOwnerTransfer',ownerId:owner.id,monthId:oct.id,bankName:d.ownerName!,account:d.account,date:d.date,reference:d.reference,source:d.source,amountCents:d.amountCents,allocations:row.allocations.map(a=>({...a,monthId:'sep'}))});
 assert.equal(saved.months[0].properties[0].payments[0].amountCents,33025);
 assert.equal(saved.months[1].properties[0].payments.length,0);
 assert.equal(matchOwnerDeposits(deposits,oct,[owner],saved.ownerTransfers,[sept,oct])[0].duplicate,true);
 const absent=matchOwnerDeposits(deposits,oct,[{...owner,propertyNames:['Other']}],[],[sept,oct])[0];assert.deepEqual(absent.allocations,[]);
 const unknown=matchOwnerDeposits(deposits,oct,[],[],[sept,oct])[0];assert.deepEqual(unknown.allocations,[]);
 const unavailable=matchOwnerDeposits(deposits,oct,[owner],[],[oct])[0];assert.deepEqual(unavailable.allocations,[]);
 const ambiguous={...sept,properties:[...sept.properties,{...sept.properties[0],id:'duplicate'}]};
 assert.deepEqual(matchOwnerDeposits(deposits,oct,[owner],[],[ambiguous,oct])[0].allocations,[]);
});

test('statement dates resolve December deposits in a January statement and reject mixed accounts',()=>{
 const rollover=header.replaceAll('October 31, 2026','January 5, 2027').replace('10/1','12/6').replace('10/31','1/5');
 const result=parseStatement(rollover+'12/31 Zelle From Sample Owner on 12/30 Ref # YEAR123\t\t10.00\t100.00');
 assert.equal(result.deposits[0].date,'2026-12-31');
 assert.throws(()=>parseStatement(header+'Account number: 9999991234\n'+incoming),/single Wells Fargo account/);
});
