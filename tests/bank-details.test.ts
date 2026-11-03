import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {extractBankDetails,bankReport,propertyBanks} from '../src/bank-details.ts';
import {exportBankWorkbook} from '../src/excel.ts';
import type {Month,Snapshot} from '../src/types.ts';
const payment=(id:string,bankDetails:string,amountCents:number|null)=>({id,bankDetails,amountCents,type:'Airbnb' as const,payoutDate:'2026-11-01',bundleCents:99900,bankDate:'',bankCents:null,verifiedByDaisy:false});
const month:Month={id:'m',label:'November 2026',month:'2026-11',properties:[{id:'p',name:'Jarvis',manager:'Team A',totalCents:50000,payments:[payment('1','Checking 5864',10000),payment('2','Savings 2222',5000),payment('3','Checking 5864',-500),payment('4','',0),payment('5','',null)]}]};
test('extract only the bank account label without beneficiary or currency',()=>{
 assert.equal(extractBankDetails('Transfer to Xin Hong, Checking 5864 (CAD)'),'Checking 5864');
 assert.equal(extractBankDetails('Transfer to Name, savings 0012 (USD)'),'Savings 0012');
 assert.equal(extractBankDetails('Transfer to Name, Checking ****5864 (CAD)'),'Checking ****5864');
 assert.equal(extractBankDetails('Transfer to Xin Hong (CAD)'),'');
});
test('bank report filters banks and totals payments once, including refunds and zero',()=>{
 const all=bankReport(month,null);assert.equal(all.total,145);assert.equal(all.records.length,4);
 assert.deepEqual(propertyBanks(month.properties[0]),['Checking 5864','Savings 2222']);
 const one=bankReport(month,['Checking 5864']);assert.equal(one.total,95);assert.equal(one.summary[0].Properties,1);assert.equal(one.records.length,2);
 assert.equal(bankReport(month,['Checking 5864','Savings 2222']).records.length,3);
 assert.equal(bankReport(month,[]).records.length,0);
 assert.equal(bankReport(month,['Not Specified']).records.length,1);
});
test('download creates a readable workbook with matching summary and filtered payment records',()=>{
 const context:any={};vm.runInNewContext(readFileSync('public/vendor/xlsx.full.min.js','utf8'),context);const xlsx=context.XLSX;
 let captured:any;let filename='';const previous=(globalThis as any).window;
 (globalThis as any).window={XLSX:{...xlsx,writeFile:(book:any,name:string)=>{captured=book;filename=name;}}};
 try{
  exportBankWorkbook({months:[month],revision:'r',updatedAt:'',spreadsheetUrl:''} as Snapshot,'m',['Checking 5864']);
  assert.equal(filename,'Castle-Bank-Report-2026-11.xlsx');
  const roundtrip=xlsx.read(xlsx.write(captured,{type:'array',bookType:'xlsx'}),{type:'array'});
  assert.deepEqual(Array.from(roundtrip.SheetNames),['Bank Summary','Payment Records']);
  assert.equal(roundtrip.Sheets['Bank Summary'].D7.v,95);assert.equal(roundtrip.Sheets['Bank Summary'].D8.v,95);
  assert.equal(roundtrip.Sheets['Payment Records'].A2.v,'Checking 5864');assert.equal(roundtrip.Sheets['Payment Records'].A3.v,'Checking 5864');assert.equal(roundtrip.Sheets['Payment Records'].A4,undefined);
  assert.equal(roundtrip.Sheets['Payment Records']['!autofilter'].ref,'A1:I3');
 }finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
