import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useState} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {detectBankColumns,parseBankSpreadsheet} from '../src/bank-spreadsheet.ts';

async function withUi(run:(server:any)=>Promise<void>){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const server=await createServer({cacheDir:'node_modules/.vite-bank-mapping-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{await run(server);}finally{await server.close();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
}

test('automatic preparation keeps column controls collapsed and requires confirmed account and currency',async()=>withUi(async server=>{
 const {default:Mapping}=await server.ssrLoadModule('/src/BankSpreadsheetMapping.tsx');
 const sheet={name:'Checking',rows:[['DATE','DESCRIPTION','AMOUNT'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',25]].map(r=>r.map(value=>({value})))};
 let root:any,result:any;
 function Harness(){
  const [drafts,setDrafts]=useState([{source:'any-name.xlsx',sheet,mapping:detectBankColumns(sheet),account:'',currency:undefined as 'CAD'|'USD'|undefined,method:'ai' as const,note:'AI interpreted the columns.'}]);
  return React.createElement(Mapping,{drafts,reviewed:false,onChange:setDrafts,disabled:false,onReview:()=>{result=parseBankSpreadsheet([sheet],drafts[0].source,{mapping:drafts[0].mapping,account:drafts[0].account,currency:drafts[0].currency});}});
 }
 try{
  await act(async()=>{root=TestRenderer.create(React.createElement(Harness));});
  assert.equal(root.root.findByProps({className:'bank-column-details'}).props.open,false);
  assert.equal(root.root.findByType('button').props.disabled,true);
  await act(async()=>root.root.findByProps({placeholder:'Enter the full source account'}).props.onChange({target:{value:'12349876'}}));
  await act(async()=>root.root.findByProps({'aria-label':'Currency For Checking'}).props.onChange({target:{value:'CAD'}}));
  await act(async()=>root.root.findByType('button').props.onClick());
  assert.equal(result.deposits[0].account,'9876');assert.equal(result.deposits[0].amountCents,2500);
 }finally{if(root)await act(async()=>root.unmount());}
}));

for(const extraSheet of [false,true])test('upload uses AI and saves only on submit; extra notes sheet: '+extraSheet,async()=>withUi(async server=>{
 const {default:Import}=await server.ssrLoadModule('/src/BankStatementImport.tsx');
 const c:any={Date,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Buffer};vm.createContext(c);vm.runInContext(readFileSync('public/vendor/xlsx.full.min.js','utf8'),c);
 const previous=globalThis.window;(globalThis as any).window={XLSX:c.XLSX};
 const book=c.XLSX.utils.book_new();c.XLSX.utils.book_append_sheet(book,c.XLSX.utils.aoa_to_sheet([['When','Narrative','Value','Account'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',25,'98761234']]),'Transactions');
 if(extraSheet)c.XLSX.utils.book_append_sheet(book,c.XLSX.utils.aoa_to_sheet([['Notes'],['Not transaction data']]),'Notes');
 const file=new File([new Uint8Array(c.XLSX.write(book,{bookType:'xlsx',type:'array'}))],'bank.xlsx');
 const month={id:'m',month:'2026-11',label:'November',properties:[{id:'p',name:'Home',manager:'',totalCents:0,payments:[{id:'pay',type:'Airbnb',amountCents:2500,bundleCents:2500,bankDetails:'Checking 98761234',payoutDate:'',bankDate:'',bankCents:null,verifiedByDaisy:false}]}]};
 const snapshot={revision:'r',updatedAt:'',spreadsheetUrl:'',months:[month],bankReceiptSchema:1,bankReceipts:[]};
 let root:any,requests=0,writes=0,submitted:any,revalidate:any;
 try{
  await act(async()=>{root=TestRenderer.create(React.createElement(Import,{month,snapshot,supported:true,onClose(){},ask:async(request:any)=>{requests++;assert.equal(request.task,'bankMapping');if(request.bankSample.sheet==='Notes')return {text:'Unrecognized',bankMapping:{headerRow:-1}};return {text:'Mapped',bankMapping:{headerRow:0,date:0,description:1,amount:2,account:3,description2:null,debit:null,reference:null,status:null}};},onApply:async(changes:any,prepare:any)=>{writes++;submitted=changes;revalidate=prepare;}}),{createNodeMock:(element:any)=>element.type==='dialog'?{open:false,showModal(){this.open=true;},close(){this.open=false;}}:{value:''}});});
  await act(async()=>{await root.root.findByProps({'aria-label':'Choose Bank Files'}).props.onChange({target:{files:[file]}});});
  assert.equal(requests,extraSheet?2:1);assert.equal(writes,0);
  await act(async()=>root.root.findByProps({'aria-label':'Currency For Transactions'}).props.onChange({target:{value:'CAD'}}));
  if(extraSheet){
   assert.equal(root.root.findAllByType('button').find((b:any)=>b.children.join('')==='Continue To Review').props.disabled,true);
   await act(async()=>root.root.findAllByType('fieldset').find((field:any)=>field.findAllByType('legend').some((legend:any)=>legend.children.join('').includes('Notes'))).findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
   await act(async()=>root.root.findAllByType('button').find((b:any)=>b.children.join('')==='Continue To Review').props.onClick());
   assert.equal(writes,0);
  }
  if(!extraSheet)await act(async()=>root.root.findAllByType('button').find((b:any)=>b.children.join('')==='Continue To Review').props.onClick());
  const save=root.root.findAllByType('button').find((button:any)=>button.children.join('')==='Save 1 Payment Rows');
  assert.ok(save);assert.equal(save.props.disabled,false);
  await act(async()=>{save.props.onClick();await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(writes,1);assert.equal(submitted[0].bundleCents,2500);assert.equal(submitted[0].account,'1234');
  assert.equal(typeof revalidate,'function');assert.equal(revalidate(snapshot)[0].paymentId,'pay');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=previous;}
}));
