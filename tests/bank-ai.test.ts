import test from 'node:test';
import assert from 'node:assert/strict';
import type {ImportSheet} from '../src/import.ts';
import type {Month} from '../src/types.ts';
const sheet=(rows:unknown[][]):ImportSheet=>({name:'Checking',rows:rows.map(r=>r.map(value=>({value})))});
const month:Month={id:'m',month:'2026-11',label:'November',properties:[{id:'p',name:'Home',manager:'',totalCents:0,payments:[1000,2000].map((amountCents,i)=>({id:String(i),type:'Airbnb',amountCents,bundleCents:amountCents,bankDetails:'Checking 1234',bankDate:'',bankCents:null,payoutDate:'',verifiedByDaisy:false}))}]};
const source=sheet([['DATE','DESCRIPTION','AMOUNT','STATUS'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',10,'Posted'],['2026-11-24','AIRBNB PAYMENTS 000000346979008',20,'Posted']]);

test('recognized exports never call AI, including missing accounts and invalid source values',async()=>{
 const {prepareBankSheet}=await import('../src/bank-ai.ts');let calls=0;
 const ask=async()=>{calls++;throw Error('AI must not run for recognized files');};
 for(const input of [source,{...source,rows:source.rows.slice(0,2)},sheet([['DATE','DESCRIPTION','AMOUNT'],['invalid','ZELLE FROM JANE ON 11/23 REF # ABC123',10]])]){
  assert.equal((await prepareBankSheet(input,'bank.xlsx',month,ask)).method,'automatic');
 }
 assert.equal(calls,0);
});

test('automatic interpretation resolves missing account only with independent exact bundle evidence',async()=>{
 const {prepareBankSheet}=await import('../src/bank-ai.ts');
 const result=await prepareBankSheet(source,'bank.xlsx',month);
 assert.equal(result.account,'1234');assert.equal(result.method,'automatic');
 assert.match(result.note,/bundle/i);
 const uncertain=await prepareBankSheet({...source,rows:source.rows.slice(0,2)},'bank.xlsx',month);
 assert.equal(uncertain.account,'');
 const ambiguous=structuredClone(month);ambiguous.properties[0].payments.push(...month.properties[0].payments.map(p=>({...p,id:'other'+p.id,bankDetails:'Checking 9876'})));
 assert.equal((await prepareBankSheet(source,'bank.xlsx',ambiguous)).account,'');
});
test('AI maps unfamiliar labels but only original cells provide amounts and accounts',async()=>{
 const {prepareBankSheet}=await import('../src/bank-ai.ts');
 const custom=sheet([['When','Memo','Value','Account'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',10,'1234']]);
 let sent:any;
 const result=await prepareBankSheet(custom,'bank.xlsx',month,async request=>{sent=request;return {text:'Mapped',bankMapping:{headerRow:0,date:0,description:1,amount:2,account:3,description2:null,debit:null,reference:null,status:null}};});
 assert.equal(sent.task,'bankMapping');assert.equal(result.method,'ai');assert.equal(result.mapping.amount,2);
 const {parseBankSpreadsheet}=await import('../src/bank-spreadsheet.ts');
 assert.equal(parseBankSpreadsheet([custom],'bank.xlsx',result).deposits[0].amountCents,1000);
});
test('model cannot drop known status controls, invent account data, or reuse columns',async()=>{
 const {validateBankMapping}=await import('../src/bank-ai.ts');
 for(const proposal of [{headerRow:0,date:0,description:1,amount:2,status:null},{headerRow:0,date:0,description:1,amount:2,status:3,accountValue:'9999'},{headerRow:0,date:0,description:1,amount:0,status:3}]) assert.throws(()=>validateBankMapping(source,proposal),/mapping/i);
 assert.throws(()=>validateBankMapping(source,{headerRow:1,date:0,description:1,amount:2,status:3}),/mapping/i);
 const csv=sheet([['DATE','DESCRIPTION','VALUE','ACCOUNT','STATUS'],['2026-11-23','AIRBNB PAYMENTS 000000346979007','25','1234','Posted'],['2026-11-24','AIRBNB PAYMENTS 000000346979008','30','1234','Pending']]);
 assert.throws(()=>validateBankMapping(csv,{headerRow:1,date:0,description:1,amount:2,account:3,status:null}),/mapping/i);
 for(const label of ['Balance','Running Total','Debit Amount','Withdrawals']){
  const wrong=sheet([['DATE','DESCRIPTION',label,'ACCOUNT'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',10000,'1234']]);
  assert.throws(()=>validateBankMapping(wrong,{headerRow:0,date:0,description:1,amount:2,account:3}),/mapping/i);
 }
});
test('AI failure preserves known format automation and unfamiliar formats fail without writes',async()=>{
 const {prepareBankSheet}=await import('../src/bank-ai.ts');const ask=async()=>{throw Error('Offline');};
 assert.equal((await prepareBankSheet(source,'bank.xlsx',month,ask)).method,'automatic');
 await assert.rejects(()=>prepareBankSheet(sheet([['When','Narrative','Value'],['2026-11-23','Airbnb',10]]),'custom.xlsx',month,ask),/Offline/);
});
test('source account metadata is used only with explicit account labels and no conflicts',async()=>{
 const {prepareBankSheet}=await import('../src/bank-ai.ts');
 const metadata=sheet([['Account Number: 06061-1017524'],...source.rows.map(r=>r.map(c=>c.value))]);
 assert.equal((await prepareBankSheet(metadata,'file.xlsx',month)).account,'7524');
 metadata.rows.unshift([{value:'Account Number: 00409-1035864'}]);
 assert.equal((await prepareBankSheet(metadata,'file.xlsx',month)).account,'');
});

test('numbered RBC description headings remain valid while text date headings are rejected',async()=>{
 const {prepareBankSheet,validateBankMapping}=await import('../src/bank-ai.ts');
 const rbc=sheet([['Account Number','Transaction Date','Description 1','Description 2','CAD$'],['06061-1017524','2026-11-23','Account Payable Pmt','AIRBNB PAYMENTS 000000346979007',25]]);
 assert.equal((await prepareBankSheet(rbc,'rbc.xlsx',month)).mapping.description2,3);
 const malformed=sheet([['November 23 2026','AIRBNB','USD25'],['2026-11-24','AIRBNB PAYMENTS 000000346979007',25]]);
 assert.throws(()=>validateBankMapping(malformed,{headerRow:0,date:0,description:1,amount:2}),/mapping/i);
});
