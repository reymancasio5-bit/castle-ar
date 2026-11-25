import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const text=(node:any):string=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):text(node.children);
async function withImport(run:(root:any,makeFile:(rows:unknown[][],name?:string)=>File,writes:()=>number)=>Promise<void>,ledger=true,payments?:any[],pdfText?:string,receipts:any[]=[],suffixSupport=true){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 // PDF extraction has its own source-file tests; this adapter isolates editable review state.
 const plugins=pdfText?[{name:'bank-review-pdf-adapter',enforce:'pre' as const,resolveId(id:string){if(id==='./bank-pdf')return '\0bank-review-pdf';},load(id:string){if(id==='\0bank-review-pdf')return `export async function extractStatementText(){return ${JSON.stringify(pdfText)}}`;}}]:[];
 const server=await createServer({plugins,cacheDir:'node_modules/.vite-bank-review-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 const context:any={Date,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Buffer};vm.createContext(context);vm.runInContext(readFileSync('public/vendor/xlsx.full.min.js','utf8'),context);
 const previous=globalThis.window;(globalThis as any).window={XLSX:context.XLSX};let root:any,count=0;
 const makeFile=(rows:unknown[][],name='bank.xlsx')=>{const book=context.XLSX.utils.book_new();context.XLSX.utils.book_append_sheet(book,context.XLSX.utils.aoa_to_sheet(rows),'Transactions');return new File([new Uint8Array(context.XLSX.write(book,{bookType:name.split('.').at(-1),type:'array'}))],name);};
 try{
  const {default:Import}=await server.ssrLoadModule('/src/BankStatementImport.tsx');
  const month={id:'m',month:'2026-11',label:'November 2026',properties:[{id:'p',name:'Example Home',manager:'',totalCents:2500,payments:payments??[{id:'pay',type:'Airbnb',amountCents:2500,bundleCents:2500,bankDetails:'Checking 12345678',payoutDate:'2026-11-23',bankDate:'',bankCents:null,verifiedByDaisy:false}]}]};
  const snapshot={revision:'r',updatedAt:'',spreadsheetUrl:'',months:[month],ownerSchema:1,ownerAllocationSchema:1,owners:[],ownerTransfers:[],...(suffixSupport?{bankAccountSuffixSchema:1}:{}),...(ledger?{bankReceiptSchema:1,bankReceipts:receipts}:{} )};
  await act(async()=>{root=TestRenderer.create(React.createElement(Import,{month,snapshot,supported:true,onClose(){},onApply:async()=>{count++;}}),{createNodeMock:(element:any)=>element.type==='dialog'?{open:false,showModal(){this.open=true},close(){this.open=false}}:{value:''}});});
  await run(root,makeFile,()=>count);
 }finally{if(root)await act(async()=>root.unmount());await server.close();globalThis.window=previous;delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
}
const upload=(root:any,files:File[])=>act(async()=>{await root.root.findByProps({'aria-label':'Choose Bank Files'}).props.onChange({target:{files}});});

test('entering only four account digits automatically enables a matching bank import',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$'],['2026-11-23','AIRBNB PAYMENTS 000000123456789',25]],'bank.csv')]);
 const account=root.root.findAllByType('input').find((node:any)=>node.props.autoComplete==='off'&&node.props.inputMode==='numeric');
 await act(async()=>account.props.onChange({target:{value:'5678'}}));
 const save=root.root.findAllByType('button').find((node:any)=>text(node)==='Save 1 Payment Rows');
 assert.ok(save);assert.equal(save.props.disabled,false);
 await act(async()=>save.props.onClick());assert.equal(writes(),1);
}));

test('a four-digit PDF account proceeds without requesting a full account number',async()=>withImport(async(root,_makeFile,writes)=>{
 await upload(root,[new File(['PDF reader adapter input'],'statement.pdf')]);
 assert.equal(root.root.findAllByType('input').filter((node:any)=>node.props.inputMode==='numeric').length,0);
 const save=root.root.findAllByType('button').find((node:any)=>text(node)==='Save 1 Payment Rows');
 assert.ok(save);assert.equal(save.props.disabled,false);
 await act(async()=>save.props.onClick());assert.equal(writes(),1);
},true,undefined,'November 1, 2026 to November 30, 2026\nAccount number: 5678\nCurrency: CAD\n23 Nov AIRBNB PAYMENTS 000000123456789\t\t25.00\t100.00'));

test('four-digit accounts support excluded-credit owner review',async()=>withImport(async(root,makeFile)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account','Reference'],['2026-11-23','Deposit',25,'5678','ORIGINAL8']])]);
 const review=root.root.findAllByType('button').find((node:any)=>text(node)==='Review As Owner Payment');
 assert.ok(review);assert.equal(review.props.disabled,false);
 await act(async()=>review.props.onClick());assert.match(text(root.toJSON()),/Reference:.*ORIGINAL8/);
}));

test('last-four saves identify an older backend before submission',async()=>withImport(async(root,makeFile)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 000000123456789',25,'5678']])]);
 const save=root.root.findAllByType('button').find((node:any)=>text(node).startsWith('Save '));assert.equal(save.props.disabled,true);
 assert.match(text(root.root.findByProps({className:'bank-save-summary'})),/Update.*Apps Script.*four/i);
},true,undefined,undefined,[],false));

for(const sourceAccount of ['1234-5678','5678'])for(const extension of ['xlsx','xls','csv'])test(`${extension} bank files with ${sourceAccount.length===4?'four-digit':'full'} accounts reach a saveable review without column choices`,async()=>withImport(async(root,makeFile,writes)=>{
 const rows=[['Account Type','Account Number','Transaction Date','Cheque Number','Description 1','Description 2','CAD$','USD$'],['Chequing',sourceAccount,'2026-11-23','','Account Payable Pmt','AIRBNB PAYMENTS 000000123456789',25,'']];
 await upload(root,[makeFile(rows,`bank.${extension}`)]);
 assert.equal(root.root.findAllByType('select').filter((select:any)=>/Column For/.test(select.props['aria-label']??'')).length,0);
 assert.doesNotMatch(text(root.toJSON()),/Continue To Review|Review Or Adjust Columns/);
 const save=root.root.findAllByType('button').find((button:any)=>text(button)==='Save 1 Payment Rows');
 assert.equal(save.props.disabled,false);
 await act(async()=>save.props.onClick());
 assert.equal(writes(),1);
}));

for(const [bank,pdfText] of [
 ['RBC','November 1, 2026 to November 30, 2026\nAccount number: 12345678\nCurrency: CAD\n23 Nov AIRBNB PAYMENTS 000000123456789\t\t25.00\t100.00'],
 ['Wells Fargo','Wells Fargo Everyday Checking\nNovember 30, 2026 Page 2 of 6\nAccount number: 12345678 (primary account)\nCurrency: USD\nBeginning balance on 11/1 $100.00\nEnding balance on 11/30 $125.00\n11/23 Airbnb 4977 Airbnb Nov 20 M-aBcD123eFgHiJ\t\t25.00\t125.00'],
])test(`${bank} PDF reaches a saveable review without column choices`,async()=>withImport(async(root,_makeFile,writes)=>{
 await upload(root,[new File(['PDF reader adapter input'],'statement.pdf')]);
 assert.equal(root.root.findAllByType('select').length,0);
 assert.doesNotMatch(text(root.toJSON()),/Continue To Review|Review Or Adjust Columns/);
 const save=root.root.findAllByType('button').find((button:any)=>text(button)==='Save 1 Payment Rows');
 assert.ok(save);assert.equal(save.props.disabled,false);
 await act(async()=>save.props.onClick());assert.equal(writes(),1);
},true,undefined,pdfText));

test('eleven-file review reports duplicates and excluded credits without saving',async()=>withImport(async(root,makeFile,writes)=>{
 const rows=[['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789012',25,'12345678'],['2026-11-23','Deposit',12.5,'12345678']];
 await upload(root,Array.from({length:11},(_,i)=>makeFile(rows,`statement-${i}.xlsx`)));
 const copy=text(root.toJSON());
 assert.doesNotMatch(copy,/Choose up to 10 bank files/);
 assert.match(copy,/Excluded Credits/);assert.match(copy,/statement-0.xlsx/);assert.match(copy,/12.50/);
 assert.match(copy,/Duplicate|Repeated/i);
 assert.equal(writes(),0);
}));

test('missing currency and account require explicit review before submission',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','Amount'],['2026-11-23','AIRBNB PAYMENTS 123456789012',25]])]);
 const account=root.root.findByProps({placeholder:'Enter the last 4 digits or full account number'});
 const currency=root.root.findByProps({'aria-label':'Currency For Transactions'});
 assert.equal(root.root.findAllByType('button').find((b:any)=>text(b).startsWith('Save ')).props.disabled,true);
 await act(async()=>account.props.onChange({target:{value:'12345678'}}));
 await act(async()=>root.root.findByProps({'aria-label':'Currency For Transactions'}).props.onChange({target:{value:'CAD'}}));
 assert.doesNotMatch(text(root.toJSON()),/Continue To Review/);
 assert.equal(root.root.findAllByType('button').find((b:any)=>text(b)==='Save 1 Payment Rows').props.disabled,false);
 assert.equal(writes(),0);
}));

test('the save footer identifies a missing backend instead of reporting zero rows as ready',async()=>withImport(async(root,makeFile)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789012',25,'12345678']])]);
 assert.match(text(root.root.findByProps({className:'bank-save-summary'})),/Update.*Apps Script/i);
},false));

test('the save footer explains when parsed receipts do not match database rows',async()=>withImport(async(root,makeFile)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789012',50,'12345678']])]);
 assert.match(text(root.root.findByProps({className:'bank-save-summary'})),/No payment rows.*Review/i);
}));

test('recognized deposits cannot save through a backend without receipt protection',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789012',25,'12345678']])]);
 assert.match(text(root.toJSON()),/Update.*Apps Script/i);
 const save=root.root.findAllByType('button').find((b:any)=>text(b).startsWith('Save '));assert.equal(save.props.disabled,true);
 assert.equal(writes(),0);
},false));

test('a readable source reference remains immutable when an owner name is reviewed',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','e-Transfer - Autodeposit SAMPLE OWNER C1ABC2345',25,'12345678']])]);
 await act(async()=>root.root.findAllByType('button').find((button:any)=>text(button).trim()==='Edit').props.onClick());
 const reference=root.root.findAllByType('input').find((input:any)=>input.props.value==='C1ABC2345');
 assert.ok(reference);assert.equal(reference.props.readOnly,true);
 await act(async()=>reference.props.onChange({target:{value:'REPLACED123'}}));
 assert.match(text(root.toJSON()),/C1ABC2345/);assert.doesNotMatch(text(root.toJSON()),/REPLACED123/);
 assert.equal(writes(),0);
}));

test('equal receipts can each select multiple same-day payouts without arbitrary grouping',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789011',100,'12345678'],['2026-11-23','AIRBNB PAYMENTS 123456789012',100,'12345678']])]);
 for(const [reference,ids] of [['123456789011',['pay-0','pay-1']],['123456789012',['pay-2','pay-3']]] as const){
  for(const id of ids)await act(async()=>root.root.findByProps({'aria-label':`Select Payout ${id} For ${reference}`}).props.onChange({target:{checked:true}}));
 }
 assert.equal(root.root.findAllByType('button').find((button:any)=>text(button)==='Save 4 Payment Rows').props.disabled,false);
 assert.equal(writes(),0);
},true,[6000,4000,7000,3000].map((amountCents,index)=>({id:`pay-${index}`,type:'Airbnb',amountCents,bundleCents:10000,bankDetails:'Checking 12345678',payoutDate:'2026-11-23',bankDate:'',bankCents:null,verifiedByDaisy:false}))));

test('an excluded credit keeps its authentic reference when reviewed as an owner payment',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account','Reference'],['2026-11-23','Deposit',25,'12345678','ORIGINAL8']])]);
 await act(async()=>root.root.findAllByType('button').find((button:any)=>text(button)==='Review As Owner Payment').props.onClick());
 await act(async()=>root.root.findAllByType('button').find((button:any)=>text(button).trim()==='Edit').props.onClick());
 const reference=root.root.findAllByType('input').find((input:any)=>input.props.value==='ORIGINAL8');
 assert.ok(reference);assert.equal(reference.props.readOnly,true);assert.equal(writes(),0);
}));

test('corrected PDF currency follows a credit promoted into owner review',async()=>withImport(async(root,_makeFile,writes)=>{
 await upload(root,[new File(['Extraction adapter input'],'statement.pdf')]);
 await act(async()=>root.root.findByProps({'aria-label':'Currency For statement.pdf'}).props.onChange({target:{value:'USD'}}));
 await act(async()=>root.root.findAllByType('button').find((button:any)=>text(button)==='Review As Owner Payment').props.onClick());
 assert.match(text(root.root.findByProps({className:'owner-payment-review'})),/USD\s+26.43/);
 await act(async()=>root.root.findByProps({'aria-label':'Currency For statement.pdf'}).props.onChange({target:{value:'CAD'}}));
 assert.match(text(root.root.findByProps({className:'owner-payment-review'})),/CAD\s+26.43/);
 assert.doesNotMatch(text(root.root.findByProps({className:'owner-payment-review'})),/USD/);assert.equal(writes(),0);
},true,undefined,'Wells Fargo Everyday Checking\nOctober 31, 2026 Page 2 of 6\nAccount number: 0000012345 (primary account)\nBeginning balance on 10/1 $100.00\nEnding balance on 10/31 $200.00\n10/5 Remote Online Deposit\t\t26.43\t1,000.00'));

test('a partially allocated receipt can select a smaller subset of its single suggested group',async()=>withImport(async(root,makeFile,writes)=>{
 await upload(root,[makeFile([['Date','Description','CAD$','Account'],['2026-11-23','AIRBNB PAYMENTS 123456789011',100,'12345678']])]);
 assert.match(text(root.toJSON()),/exceed the remaining receipt amount/);
 await act(async()=>root.root.findByProps({'aria-label':'Select Payout partial-0 For 123456789011'}).props.onChange({target:{checked:true}}));
 assert.equal(root.root.findAllByType('button').find((button:any)=>text(button)==='Save 1 Payment Rows').props.disabled,false);
 await act(async()=>root.root.findByProps({'aria-label':'Select Payout partial-0 For 123456789011'}).props.onChange({target:{checked:false}}));
 assert.equal(root.root.findAllByType('button').find((button:any)=>text(button).startsWith('Save ')).props.disabled,true);
 assert.equal(writes(),0);
},true,[4000,2000].map((amountCents,index)=>({id:`partial-${index}`,type:'Airbnb',amountCents,bundleCents:10000,bankDetails:'Checking 12345678',payoutDate:'2026-11-23',bankDate:'',bankCents:null,verifiedByDaisy:false})),undefined,[{account:'5678',accountIdentity:'12345678',currency:'CAD',reference:'123456789011',source:'previous.xlsx',platform:'Airbnb',date:'2026-11-23',amountCents:10000,allocations:[{monthId:'previous-month',propertyName:'Other Home',bundleOnly:false,paymentIndex:0,amountCents:6000}]}]));
