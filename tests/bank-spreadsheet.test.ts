import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bankMappingCurrency, detectBankColumns, parseBankSpreadsheet, validateBankColumnMapping } from '../src/bank-spreadsheet.ts';
import { readSpreadsheet } from '../src/excel.ts';
import { matchStatement, parseStatement } from '../src/bank-statement.ts';
import { matchOwnerDeposits } from '../src/owners.ts';
import type { ImportSheet } from '../src/import.ts';
import type { Month, PropertyOwner } from '../src/types.ts';

const headers = ['Account Type','Account Number','Transaction Date','Cheque Number','Description 1','Description 2','CAD$'];
const row = (description = 'AIRBNB PAYMENTS 000000123450007', amount: unknown = 1070.1400000000001, date: unknown = new Date('2026-11-04T00:00:00Z'), account: unknown = '01234-0097524') => ['Chequing',account,date,'','Account Payable Pmt',description,amount];
const ownerRow = (description = 'Example Owner CAU5bcDE', amount = 143.69) => ['Chequing','01234-0097524',46332,'','e-Transfer - Autodeposit',description,amount];
const sheet = (...rows: unknown[][]): ImportSheet => ({name:'Transactions',rows:[headers,...rows].map(r=>r.map(value=>({value})))});

test('extracts CAD credits with per-row accounts, dates, exact cents and leading-zero references', () => {
 const result = parseBankSpreadsheet([sheet(row(), row('AIRBNB PAYMENTS 000000123450008',2289.94,46328,'06543-0095864'))],'bank.xlsx');
 assert.deepEqual(result, {deposits:[
  {account:'7524',accountIdentity:'012340097524',currency:'CAD',date:'2026-11-04',amountCents:107014,reference:'000000123450007',source:'bank.xlsx',sheet:'Transactions',sourceRow:2,description:'Account Payable Pmt AIRBNB PAYMENTS 000000123450007',platform:'Airbnb'},
  {account:'5864',accountIdentity:'065430095864',currency:'CAD',date:'2026-11-02',amountCents:228994,reference:'000000123450008',source:'bank.xlsx',sheet:'Transactions',sourceRow:3,description:'Account Payable Pmt AIRBNB PAYMENTS 000000123450008',platform:'Airbnb'},
 ],warnings:[],excluded:[]});
});

test('owner deposits preserve source names and alphanumeric RBC references', () => {
 const result = parseBankSpreadsheet([sheet(ownerRow(),ownerRow('9501-6465 QUéBEC INC. CAU5WgUN'),ownerRow('Jane  Smith 114d718933b133221b8774073fff3da5'))],'owners.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.kind,d.ownerName,d.reference,d.amountCents]),[
  ['owner','Example Owner','CAU5bcDE',14369],['owner','9501-6465 QUéBEC INC.','CAU5WgUN',14369],['owner','Jane  Smith','114d718933b133221b8774073fff3da5',14369],
 ]);
});

test('ordinary surnames and unbounded letter-only tokens cannot become transaction references', () => {
 const names=['JOHN CARTER','JOHN CALLAHAN','John Callahan','Example Owner CAUabcDEF'];
 const deposits=parseBankSpreadsheet([sheet(...names.map(name=>ownerRow(name)))],'bank.xlsx').deposits;
 assert.deepEqual(deposits.map(d=>[d.ownerName,d.reference]),names.map(name=>[name,'']));
});

test('RBC owner deposits recognize bounded mixed-case letter-only references', () => {
 const names=['Example Owner CARbEBhY','Other Owner CAPVCqhQ','Another Owner CAGpZMAv'];
 const deposits=parseBankSpreadsheet([sheet(...names.map(name=>ownerRow(name)))],'bank.xlsx').deposits;
 assert.deepEqual(deposits.map(d=>[d.ownerName,d.reference]),[
  ['Example Owner','CARbEBhY'],['Other Owner','CAPVCqhQ'],['Another Owner','CAGpZMAv'],
 ]);
});

test('explicit RBC reference markers preserve the sender name and source reference', () => {
 const names=['Example Owner Reference:CAU1ABCD','Another Owner Ref # LETTERSONLY','Third Owner Ref CAU5bcDE'];
 const deposits=parseBankSpreadsheet([sheet(...names.map(name=>ownerRow(name)))],'bank.xlsx').deposits;
 assert.deepEqual(deposits.map(d=>[d.ownerName,d.reference]),[
  ['Example Owner','CAU1ABCD'],['Another Owner','LETTERSONLY'],['Third Owner','CAU5bcDE'],
 ]);
});

test('withdrawals, zero amounts and fees are ignored while unrelated credits are visible', () => {
 const result = parseBankSpreadsheet([sheet(row('AIRBNB PAYMENTS 000000123450007',-100),ownerRow('Example Owner CAUabcDE',0),row('Monthly fee',-6),row('Loan',30000),ownerRow('Example Owner CAUabcDE',-100))],'bank.xlsx');
 assert.deepEqual(result.deposits,[]);
 assert.deepEqual(result.warnings,[]);
 assert.equal(result.excluded.length,1);
 assert.deepEqual(result.excluded[0],{
  source:'bank.xlsx',sheet:'Transactions',sourceRow:5,date:'2026-11-04',amountCents:3000000,
  currency:'CAD',account:'7524',accountIdentity:'012340097524',description:'Account Payable Pmt Loan',
  reason:'This credit does not match a supported bank payment description.',reviewable:true,
 });
});

test('supports reordered headers and ignores completely empty sheets and rows', () => {
 const s = sheet(row()); s.rows = s.rows.map(r=>r.toReversed()); s.rows.unshift([]); s.rows.push([]);
 assert.equal(parseBankSpreadsheet([{name:'Empty',rows:[]},s],'bank.xlsx').deposits[0].account,'7524');
});

test('invalid account, date, amount, formula, or error cells warn with row location and cannot become evidence', () => {
 const invalid = [row(undefined,100,'2026-02-30'),row(undefined,100,'11/31/2026'),row(undefined,100,46328,'not-an-account'),row(undefined,'1,00.00'),row(undefined,null),row(undefined,100,NaN)];
 const s=sheet(...invalid,row(),row()); s.rows[7][6].formula='100+1'; s.rows[8][2].error='#VALUE!';
 const result=parseBankSpreadsheet([s],'broken.xlsx');
 assert.equal(result.deposits.length,0);assert.equal(result.warnings.length,8);
 assert.equal(result.excluded.length,8);
 assert.deepEqual(result.excluded.map(d=>[d.sourceRow,d.amountCents,d.reviewable??false]),[
  [2,10000,false],[3,10000,false],[4,10000,false],[5,null,false],
  [6,null,false],[7,10000,false],[8,107014,false],[9,107014,false],
 ]);
 assert.match(result.warnings[0],/broken.xlsx.*Transactions.*2/);
});

test('rejects duplicate or missing columns and oversized-sheet reader errors', () => {
 const duplicate=sheet(row());duplicate.rows[0].push({value:'CAD$'});
 for(const s of [duplicate,{name:'Wrong',rows:[[{value:'Property'},{value:'Amount'}]]},{name:'Large',rows:[],error:'This worksheet exceeds 10,000 rows.'}]) {
  assert.throws(()=>parseBankSpreadsheet([s],'wrong.xlsx'),/wrong.xlsx/i);
 }
});

test('maps US exports with an explicit account, incoming Zelle and Airbnb only', () => {
 const s:ImportSheet={name:'Checking (1)',rows:[['DATE','DESCRIPTION','AMOUNT','CHECK #','STATUS'],
 [46349,'AIRBNB 4977 AIRBNB NOV 20 M-TEST0012ABCD3 TRN*1*M-TEST0012ABCD3\\',70.39,'','Posted'],
 [46349,'ZELLE FROM JANE SMITH ON 11/21 REF # WFTEST003EX OCT 26',210.03,'','Posted'],
 [46349,'ZELLE TO JANE SMITH ON 11/21 REF # WFTEST003EX',-210.03,'','Posted'],
 [46349,'AIRBNB PAYMENTS 000000123450007',100,'','Pending']].map(r=>r.map(value=>({value})))};
 assert.throws(()=>parseBankSpreadsheet([s],'arbitrary.xlsx'),/account/i);
 const result=parseBankSpreadsheet([s],'arbitrary.xlsx',{account:'1234'});
 assert.equal(result.deposits.length,2);
 assert.equal(result.deposits[0].reference,'M-TEST0012ABCD3');
 assert.equal(result.deposits[1].ownerName,'JANE SMITH');
 assert.equal(result.deposits[1].reference,'WFTEST003EX');
 assert.equal(result.deposits[1].serviceMonth,'2026-10');
 assert.ok(result.deposits.every(d=>d.account==='1234'&&d.date==='2026-11-23'));
 assert.equal(result.excluded[0].amountCents,10000);
 assert.equal(result.excluded[0].reviewable??false,false);
 assert.match(result.excluded[0].reason,/posted/i);
});

test('explicit mapping rejects reused columns and does not override invalid source accounts', () => {
 const s=sheet(row(undefined,10,46349,'invalid'));
 assert.equal(parseBankSpreadsheet([s],'bank.xlsx',{account:'1234'}).deposits.length,0);
 assert.throws(()=>parseBankSpreadsheet([s],'bank.xlsx',{account:'1234',mapping:{headerRow:0,date:2,description:4,amount:2}}),/distinct/);
 const noAccount:ImportSheet={name:'Data',rows:[['Date','Description','Amount'],['2026-11-23','AIRBNB PAYMENTS 000000123450007',10]].map(r=>r.map(value=>({value})))};
 assert.throws(()=>parseBankSpreadsheet([noAccount],'bank.xlsx',{account:'12'}),/account/i);
});

test('transaction account columns must agree with the full account stated above the table', () => {
 const s=sheet(
  row(undefined,10,46349,'1111-2222'), row(undefined,20,46349,'2222'),
  row(undefined,30,46349,'9999-2222'), row(undefined,40,46349,'1111-3333'),
 );
 s.rows.unshift([{value:'Account Number: 1111-2222'}]);
 const result=parseBankSpreadsheet([s],'bank.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.sourceRow,d.accountIdentity]),[[3,'11112222'],[4,'11112222']]);
 assert.deepEqual(result.excluded.map(d=>[d.sourceRow,d.amountCents,d.accountIdentity]),[[5,3000,'99992222'],[6,4000,'11113333']]);
 assert.ok(result.excluded.every(d=>/account.*conflicts/i.test(d.reason)&&!d.reviewable));
});

test('partial worksheet account metadata permits only transaction accounts with the matching suffix', () => {
 const s=sheet(row(undefined,10,46349,'9999-2222'),row(undefined,20,46349,'7777-3333'),row(undefined,30,46349,'2222'));
 s.rows.unshift([{value:'Account Number: 2222'}]);
 const result=parseBankSpreadsheet([s],'bank.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.sourceRow,d.accountIdentity]),[[3,'99992222'],[5,undefined]]);
 assert.equal(result.excluded[0].sourceRow,4);
 assert.match(result.excluded[0].reason,/account.*conflicts/i);
});

test('explicit column mapping supports unfamiliar labels and split credit/debit columns', () => {
 const s:ImportSheet={name:'Custom',rows:[['When','Memo','In','Out'],['2026-11-23','AIRBNB PAYMENTS 000000123450007',10,''],['2026-11-23','AIRBNB PAYMENTS 000000123450009',20,5]].map(r=>r.map(value=>({value})))};
 const result=parseBankSpreadsheet([s],'renamed.csv',{account:'1234',mapping:{headerRow:0,date:0,description:1,amount:2,debit:3}});
 assert.equal(result.deposits.length,1);assert.equal(result.deposits[0].amountCents,1000);
 assert.equal(result.warnings.length,1);
});

test('USD headers and optional second descriptions do not restrict ingestion', () => {
 const s=sheet(row());s.rows[0][6].value='USD$';
 assert.equal(parseBankSpreadsheet([s],'usd.xlsx').deposits[0].currency,'USD');
});

test('selects the only populated currency column across the full transaction table', () => {
 const s=sheet(row());s.rows[0].push({value:'USD$'});s.rows[1].push({value:null});
 assert.equal(detectBankColumns(s).amount,6);
 assert.equal(parseBankSpreadsheet([s],'record.xlsx').deposits[0].currency,'CAD');
 [s.rows[1][6],s.rows[1][7]]=[s.rows[1][7],s.rows[1][6]];
 assert.equal(detectBankColumns(s).amount,7);
 assert.equal(parseBankSpreadsheet([s],'record.xlsx').deposits[0].currency,'USD');
});

test('conflicting currency columns cannot discard positive entries through a supplied mapping', () => {
 const s=sheet(row(),row());s.rows[0].push({value:'USD$'});s.rows[2][6].value=null;s.rows[2][7]={value:55};
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx'),/CAD.*USD/i);
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{mapping:{headerRow:0,date:2,description:4,description2:5,account:1,amount:6}}),/CAD.*USD/i);
});

test('a supported currency cannot be overridden and generic amounts use explicit user currency', () => {
 const result=parseBankSpreadsheet([sheet(row())],'US checking.xlsx');
 assert.equal(result.deposits[0].currency,'CAD');
 assert.throws(()=>parseBankSpreadsheet([sheet(row())],'record.xlsx',{currency:'USD'}),/currency/i);
 const generic=sheet(row());generic.rows[0][6].value='Amount';
 assert.equal(parseBankSpreadsheet([generic],'bank-USD.xlsx').deposits[0].currency,undefined);
 assert.equal(parseBankSpreadsheet([generic],'bank.xlsx',{currency:'USD'}).deposits[0].currency,'USD');
});

test('a dedicated source currency column establishes the currency of generic amounts', () => {
 const s=sheet(row());s.rows[0][6].value='Amount';s.rows[0].push({value:'CurrencyCode'});s.rows[1].push({value:'USD'});
 assert.equal(parseBankSpreadsheet([s],'record.xlsx').deposits[0].currency,'USD');
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}),/currency.*conflicts/i);
});

test('explicit display and format currencies on numeric amounts cannot be overridden', () => {
 for(const cell of [{value:100,formatted:'USD100.00'},{value:100,format:'"USD" #,##0.00'},{value:100,format:'[$US$-409] #,##0.00'}]){
  const s=sheet(row());s.rows[0][6].value='Amount';s.rows[1][6]=cell;
  assert.equal(bankMappingCurrency(s,detectBankColumns(s)),'USD');
  assert.equal(parseBankSpreadsheet([s],'record.xlsx').deposits[0].currency,'USD');
  assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}),/currency.*conflicts/i);
 }
});

test('bare dollar signs stay ambiguous while conflicting and foreign numeric formats block mapping', () => {
 const s=sheet(row());s.rows[0][6].value='Amount';s.rows[1][6]={value:100,formatted:'$100.00',format:'[$$-409]0.00'};
 assert.equal(bankMappingCurrency(s,detectBankColumns(s)),undefined);
 assert.equal(parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}).deposits[0].currency,'CAD');
 s.rows[1][6]={value:100,formatted:'USD 100.00',format:'"CAD" #,##0.00'};
 assert.throws(()=>validateBankColumnMapping(s,detectBankColumns(s)),/conflicting.*currenc/i);
 s.rows[1][6]={value:100,format:'[$EUR-407] #,##0.00'};
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}),/currency.*CAD.*USD/i);
});

test('partially labelled numeric amounts cannot establish a worksheet currency or be assigned a conflicting one', () => {
 const s=sheet(row(),row());s.rows[0][6].value='Amount';s.rows[1][6]={value:100,formatted:'US$100.00'};
 assert.equal(bankMappingCurrency(s,detectBankColumns(s)),undefined);
 assert.deepEqual(parseBankSpreadsheet([s],'record.xlsx').deposits.map(d=>d.currency),['USD',undefined]);
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}),/currency.*conflicts/i);
});

test('source currency metadata establishes the currency of generic amounts', () => {
 const s=sheet(row());s.rows[0][6].value='Amount';s.rows.unshift([{value:'Currency: USD'}]);
 assert.equal(parseBankSpreadsheet([s],'record.xlsx').deposits[0].currency,'USD');
 assert.throws(()=>parseBankSpreadsheet([s],'record.xlsx',{currency:'CAD'}),/currency.*conflicts/i);
});

test('mixed, unsupported and contradictory source currencies cannot be ignored', () => {
 const mixed=sheet(row(),row());mixed.rows[0][6].value='Amount';mixed.rows[0].push({value:'Currency'});
 mixed.rows[1].push({value:'USD'});mixed.rows[2].push({value:'CAD'});
 assert.throws(()=>parseBankSpreadsheet([mixed],'record.xlsx'),/mixed.*currenc/i);
 mixed.rows[2][7].value='EUR';
 assert.throws(()=>parseBankSpreadsheet([mixed],'record.xlsx',{currency:'CAD'}),/currency.*CAD.*USD/i);
 mixed.rows[2][7].value='USD';mixed.rows[0][6].value='CAD$';
 assert.throws(()=>parseBankSpreadsheet([mixed],'record.xlsx'),/currency.*conflict/i);
});

test('conflicting Airbnb payout references exclude the full original credit', () => {
 const result=parseBankSpreadsheet([sheet(
  row('AIRBNB PAYMENTS 123456789012 Reference:OTHER123',10),
  row('AIRBNB PAYMENTS 123456789012 222222222222',20),
  row('AIRBNB PAYMENTS123456789012 Reference:OTHER123',30),
  row('AIRBNB PAYMENTS 123456789012 Reference:123456789012',40),
 )],'record.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.reference,d.amountCents]),[['123456789012',4000]]);
 assert.deepEqual(result.excluded.map(d=>d.amountCents),[1000,2000,3000]);
 assert.ok(result.excluded.every(d=>/conflicting.*reference/i.test(d.reason)&&!d.reviewable));
});

test('unsupported incoming credits retain the original value in a dedicated reference column', () => {
 const s=sheet(row('Mobile deposit',10));s.rows[0].push({value:'Reference'});s.rows[1].push({value:'ORIGINAL8'});
 const result=parseBankSpreadsheet([s],'record.xlsx');
 assert.equal(result.excluded[0].reference,'ORIGINAL8');
 assert.equal(result.excluded[0].reviewable,true);
});

test('zero-padded numeric bank identifiers match equivalent text identifiers', () => {
 const s=sheet(ownerRow('Example Owner'),ownerRow('Example Owner'),ownerRow('Example Owner'));
 s.rows[0].push({value:'Reference'});
 s.rows[1][1]={value:123456,formatted:'00123456'};
 s.rows[1].push({value:12345678,formatted:'0012345678'});
 s.rows[2][1]={value:'00123456'};
 s.rows[2].push({value:'0012345678'});
 s.rows[3][1]={value:123456,format:'00000000'};
 s.rows[3].push({value:12345678,format:'0000000000'});
 const result=parseBankSpreadsheet([s],'record.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.accountIdentity,d.reference]),Array.from({length:3},()=>['00123456','0012345678']));
 assert.deepEqual(matchOwnerDeposits(result.deposits,month,[],[]).map(d=>d.duplicate),[false,true,true]);
});

test('numeric bank identifiers with unreliable precision or formatting cannot become evidence', () => {
 const s=sheet(ownerRow('Example Owner'),ownerRow('Example Owner'),ownerRow('Example Owner'));
 s.rows[0].push({value:'Reference'});
 s.rows[1][1]={value:1234567890123456,formatted:'1234567890123456'};
 s.rows[1].push({value:'TRANSACTION8'});
 s.rows[2].push({value:1234567890123456,formatted:'1234567890123456'});
 s.rows[3].push({value:12345678,formatted:'0012345687'});
 const result=parseBankSpreadsheet([s],'record.xlsx');
 assert.equal(result.deposits.length,0);
 assert.deepEqual(result.excluded.map(r=>r.amountCents),[14369,14369,14369]);
 assert.match(result.excluded[0].reason,/account/i);
 assert.ok(result.excluded.slice(1).every(r=>/reference/i.test(r.reason)&&!r.reviewable));
});

test('foreign or conflicting amount prefixes cannot become CAD credit evidence', () => {
 const result=parseBankSpreadsheet([sheet(row(undefined,'€10.00'),row(undefined,'USD 20.00'),row(undefined,'CAD 30.00'))],'bank.xlsx');
 assert.deepEqual(result.deposits.map(d=>d.amountCents),[3000]);
 assert.equal(result.excluded.length,2);
 assert.ok(result.excluded.every(d=>/currency/i.test(d.reason)&&!d.reviewable));
});

test('fractional-cent transactions are reported instead of rounded into bank evidence', () => {
 const result=parseBankSpreadsheet([sheet(row(undefined,'25.005'),row(undefined,30.001),row(undefined,1070.1400000000001))],'bank.xlsx');
 assert.deepEqual(result.deposits.map(d=>d.amountCents),[107014]);
 assert.equal(result.excluded.length,2);
 assert.ok(result.excluded.every(d=>/fractional cents/i.test(d.reason)&&!d.reviewable));
});

test('an unrecognized incoming credit with any invalid evidence cannot be promoted manually', () => {
 const s=sheet(row('Online Banking transfer',20),row('Mobile deposit',50),row('Deposit',75));
 s.rows[2][2].formula='TODAY()';
 s.rows[0][7]={value:'Status'};s.rows[1][7]={value:'Posted'};s.rows[2][7]={value:'Posted'};s.rows[3][7]={value:''};
 const result=parseBankSpreadsheet([s],'bank.xlsx');
 assert.deepEqual(result.excluded.map(d=>[d.sourceRow,d.amountCents,d.reviewable??false]),[[2,2000,true],[3,5000,false],[4,7500,false]]);
 assert.match(result.excluded[1].reason,/formula/i);
 assert.match(result.excluded[2].reason,/posted/i);
});

test('split debit rows are ignored while conflicting debit and credit are excluded', () => {
 const s:ImportSheet={name:'Transactions',rows:[['Date','Description','Credit','Debit','Account'],['2026-11-23','ZELLE TO EXAMPLE',null,10,'12345678'],['2026-11-23','External Deposit',15,15,'12345678']].map(r=>r.map(value=>({value})))};
 const result=parseBankSpreadsheet([s],'bank.xlsx',{currency:'USD'});
 assert.equal(result.excluded.length,1);
 assert.equal(result.excluded[0].amountCents,1500);
 assert.match(result.excluded[0].reason,/debit/i);
});

test('a positive amount cannot make explicitly outgoing descriptions reviewable', () => {
 const s=sheet(ownerRow('Example Owner'),ownerRow('Example Owner'));
 s.rows[1][4].value='e-Transfer sent';s.rows[2][4].value='Zelle To';
 const result=parseBankSpreadsheet([s],'bank.xlsx');
 assert.equal(result.excluded.length,2);
 assert.ok(result.excluded.every(d=>d.amountCents===14369&&/outgoing/i.test(d.reason)&&!d.reviewable));
});

test('supports ISO and explicitly US-formatted text dates without using upload month', () => {
 const result=parseBankSpreadsheet([sheet(row(undefined,10,'2025-12-31'),row(undefined,20,'01/02/2026'))],'bank.csv');
 assert.deepEqual(result.deposits.map(d=>d.date),['2025-12-31','2026-01-02']);
});

const month: Month = {id:'m',month:'2026-11',label:'November 2026',properties:[{id:'p',name:'House',manager:'',totalCents:14369,payments:[{id:'a',type:'Airbnb',amountCents:107014,bundleCents:107014,bankDetails:'Checking 7524',payoutDate:'',bankCents:null,bankDate:'',verifiedByDaisy:false}]}]};

test('spreadsheet deposits reach the receipt matcher and a matching PDF cannot count the receipt twice', () => {
 const deposits=parseBankSpreadsheet([sheet(row())],'bank.xlsx').deposits;
 assert.deepEqual(matchStatement(deposits,month).changes,[{
  kind:'reconcileBank',paymentId:'a',account:'7524',bundleCents:107014,bankDate:'2026-11-04',
  receipt:{accountIdentity:'012340097524',currency:'CAD',reference:'000000123450007',source:'bank.xlsx',platform:'Airbnb',description:'Account Payable Pmt AIRBNB PAYMENTS 000000123450007',sheet:'Transactions',sourceRow:2},
 }]);
 const pdf=parseStatement('November 1, 2026 to November 10, 2026\nAccount number: 01234 009-752-4\nCurrency: CAD\n04 Nov AIRBNB PAYMENTS 000000123450007\t\t1,070.14\t','bank.pdf');
 const repeated=matchStatement([...deposits,...pdf.deposits],month);
 assert.equal(repeated.changes.length,1);
 assert.deepEqual(repeated.rows.map(d=>d.status),['Ready','Duplicate statement entry']);
});

test('owner matching keeps duplicate and missing-reference protections', () => {
 const deposits=parseBankSpreadsheet([sheet(ownerRow(),ownerRow(),ownerRow('Example Johnson'))],'bank.xlsx').deposits;
 const owner:PropertyOwner={id:'o',name:'Example',bankName:'Example Owner',email:'',notes:'',active:true,propertyNames:['House']};
 const rows=matchOwnerDeposits(deposits,{...month,properties:month.properties.map(p=>({...p,payments:[]}))},[owner],[]);
 assert.equal(rows[0].allocations[0].amountCents,14369);assert.equal(rows[1].duplicate,true);
 assert.equal(deposits[2].reference,'');assert.equal(deposits[2].ownerName,'Example Johnson');assert.equal(rows[2].allocations.length,0);
});

test('real SheetJS file decoding preserves bank evidence across XLSX, XLS and CSV', async () => {
 const context:any={Date,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Buffer};
 vm.createContext(context);vm.runInContext(readFileSync('public/vendor/xlsx.full.min.js','utf8'),context);
 const xlsx=context.XLSX, previous=globalThis.window;
 (globalThis as any).window={XLSX:xlsx};
 try {
  for(const extension of ['xlsx','xls','csv']) {
   const book=xlsx.utils.book_new();
   const worksheet=xlsx.utils.aoa_to_sheet([headers,row(undefined,1070.1400000000001,46328)]);
   worksheet.C2.z='mm/dd/yyyy';
   xlsx.utils.book_append_sheet(book,worksheet,'Transactions');
   const file=new File([new Uint8Array(xlsx.write(book,{bookType:extension,type:'array'}))],`bank.${extension}`);
   const result=parseBankSpreadsheet(await readSpreadsheet(file),file.name);
   assert.equal(result.deposits.length,1,extension);
   const {account,accountIdentity,currency,date,amountCents,reference,source}=result.deposits[0];
   assert.deepEqual({account,accountIdentity,currency,date,amountCents,reference,source},
    {account:'7524',accountIdentity:'012340097524',currency:'CAD',date:'2026-11-02',amountCents:107014,reference:'000000123450007',source:file.name},extension);
   assert.deepEqual(result.excluded,[],extension);
  }
 } finally { if(previous===undefined)delete (globalThis as any).window;else globalThis.window=previous; }
});
