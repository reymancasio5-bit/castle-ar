import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseBankSpreadsheet } from '../src/bank-spreadsheet.ts';
import { readSpreadsheet } from '../src/excel.ts';
import { matchStatement, parseStatement } from '../src/bank-statement.ts';
import { matchOwnerDeposits } from '../src/owners.ts';
import type { ImportSheet } from '../src/import.ts';
import type { Month, PropertyOwner } from '../src/types.ts';

const headers = ['Account Type','Account Number','Transaction Date','Cheque Number','Description 1','Description 2','CAD$'];
const row = (description = 'AIRBNB PAYMENTS 000000346979007', amount: unknown = 1070.1400000000001, date: unknown = new Date('2026-11-04T00:00:00Z'), account: unknown = '06061-1017524') => ['Chequing',account,date,'','Account Payable Pmt',description,amount];
const ownerRow = (description = 'Example Owner CAU5bcDE', amount = 143.69) => ['Chequing','06061-1017524',46332,'','e-Transfer - Autodeposit',description,amount];
const sheet = (...rows: unknown[][]): ImportSheet => ({name:'Transactions',rows:[headers,...rows].map(r=>r.map(value=>({value})))});

test('extracts CAD credits with per-row accounts, dates, exact cents and leading-zero references', () => {
 const result = parseBankSpreadsheet([sheet(row(), row('AIRBNB PAYMENTS 000000346849382',2289.94,46328,'00409-1035864'))],'bank.xlsx');
 assert.deepEqual(result, {deposits:[
  {account:'7524',date:'2026-11-04',amountCents:107014,reference:'000000346979007',source:'bank.xlsx'},
  {account:'5864',date:'2026-11-02',amountCents:228994,reference:'000000346849382',source:'bank.xlsx'},
 ],warnings:[]});
});

test('owner deposits preserve source names and alphanumeric RBC references', () => {
 const result = parseBankSpreadsheet([sheet(ownerRow(),ownerRow('9501-6465 QUéBEC INC. CAU5WgUN'),ownerRow('Jane  Smith 114d718933b133221b8774073fff3da5'))],'owners.xlsx');
 assert.deepEqual(result.deposits.map(d=>[d.kind,d.ownerName,d.reference,d.amountCents]),[
  ['owner','Example Owner','CAU5bcDE',14369],['owner','9501-6465 QUéBEC INC.','CAU5WgUN',14369],['owner','Jane  Smith','114d718933b133221b8774073fff3da5',14369],
 ]);
});

test('ordinary surnames and ambiguous letter-only tokens cannot become transaction references', () => {
 const names=['JOHN CARTER','JOHN CALLAHAN','Example Owner CAUabcDE'];
 const deposits=parseBankSpreadsheet([sheet(...names.map(name=>ownerRow(name)))],'bank.xlsx').deposits;
 assert.deepEqual(deposits.map(d=>[d.ownerName,d.reference]),names.map(name=>[name,'']));
});

test('withdrawals, zero amounts, fees and unrelated credits are ignored', () => {
 const result = parseBankSpreadsheet([sheet(row('AIRBNB PAYMENTS 000000346979007',-100),ownerRow('Example Owner CAUabcDE',0),row('Monthly fee',-6),row('Loan',30000),ownerRow('Example Owner CAUabcDE',-100))],'bank.xlsx');
 assert.deepEqual(result,{deposits:[],warnings:[]});
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
 assert.match(result.warnings[0],/broken.xlsx.*Transactions.*2/);
});

test('rejects unsupported currency, duplicate or missing columns and oversized-sheet reader errors', () => {
 const usd=sheet(row());usd.rows[0][6].value='USD$';
 const duplicate=sheet(row());duplicate.rows[0].push({value:'CAD$'});
 for(const s of [usd,duplicate,{name:'Wrong',rows:[[{value:'Property'},{value:'Amount'}]]},{name:'Large',rows:[],error:'This worksheet exceeds 10,000 rows.'}]) {
  assert.throws(()=>parseBankSpreadsheet([s],'wrong.xlsx'),/wrong.xlsx/i);
 }
});

test('supports ISO and explicitly US-formatted text dates without using upload month', () => {
 const result=parseBankSpreadsheet([sheet(row(undefined,10,'2025-12-31'),row(undefined,20,'01/02/2026'))],'bank.csv');
 assert.deepEqual(result.deposits.map(d=>d.date),['2025-12-31','2026-01-02']);
});

const month: Month = {id:'m',month:'2026-11',label:'November 2026',properties:[{id:'p',name:'House',manager:'',totalCents:14369,payments:[{id:'a',type:'Airbnb',amountCents:107014,bundleCents:107014,bankDetails:'Checking 7524',payoutDate:'',bankCents:null,bankDate:'',verifiedByDaisy:false}]}]};

test('spreadsheet deposits reach the existing bundle matcher and mixed PDF duplicates remain blocked', () => {
 const deposits=parseBankSpreadsheet([sheet(row())],'bank.xlsx').deposits;
 assert.deepEqual(matchStatement(deposits,month).changes,[{kind:'reconcileBank',paymentId:'a',account:'7524',bundleCents:107014,bankDate:'2026-11-04'}]);
 const pdf=parseStatement('November 1, 2026 to November 10, 2026\nAccount number: 06061 101-752-4\n04 Nov AIRBNB PAYMENTS 000000346979007\t\t1,070.14\t','bank.pdf');
 assert.equal(matchStatement([...deposits,...pdf.deposits],month).changes.length,0);
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
   assert.deepEqual(result,{deposits:[{account:'7524',date:'2026-11-02',amountCents:107014,reference:'000000346979007',source:file.name}],warnings:[]},extension);
  }
 } finally { if(previous===undefined)delete (globalThis as any).window;else globalThis.window=previous; }
});
