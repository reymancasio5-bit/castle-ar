import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {applyOwnerChange} from '../src/owners.ts';

const text=(node:any):string=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):text(node.children);
const property=(id:string,name:string,totalCents:number)=>({id,name,totalCents,manager:'',payments:[]});
const base=()=>({revision:'r',updatedAt:'',spreadsheetUrl:'',bankReceiptSchema:1,bankAccountSuffixSchema:1,bankReceipts:[],ownerSchema:1,ownerAllocationSchema:1,ownerReceiptSchema:1,
 owners:[{id:'owner',name:'Example Owner',bankName:'EXAMPLE OWNER',propertyNames:['Home A','Home B'],email:'',notes:'',active:true}],ownerTransfers:[],
 months:[{id:'oct',month:'2026-10',label:'October 2026',properties:[property('oct:a','Home A',8781),property('oct:b','Home B',11591)]},{id:'nov',month:'2026-11',label:'November 2026',properties:[property('nov:a','Home A',50000),property('nov:b','Home B',38484)]}]});
const savedReceipt=()=>({id:'receipt',ownerId:'owner',ownerName:'Example Owner',bankName:'EXAMPLE OWNER',account:'8713',accountIdentity:'0001238713',currency:'USD',date:'2026-11-09',reference:'CAUabcD1',source:'bank.xlsx',amountCents:108856,monthId:'oct',allocations:[{propertyName:'Home A',monthId:'oct',amountCents:8781},{propertyName:'Home B',monthId:'oct',amountCents:11591}]});

async function withImport(run:(root:any,upload:(account?:string)=>Promise<void>,submitted:()=>any[])=>Promise<void>,snapshot:any=base(),receipt?:any){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const server=await createServer({cacheDir:'node_modules/.vite-owner-partial-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 const context:any={Date,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Buffer};vm.createContext(context);vm.runInContext(readFileSync('public/vendor/xlsx.full.min.js','utf8'),context);
 const previous=globalThis.window;(globalThis as any).window={XLSX:context.XLSX};let root:any,submitted:any[]=[];
 try{
  const {default:Import}=await server.ssrLoadModule('/src/BankStatementImport.tsx');
  await act(async()=>{root=TestRenderer.create(React.createElement(Import,{month:snapshot.months[receipt?1:0],snapshot,initialOwnerTransfer:receipt,supported:true,onClose(){},onApply:async(changes:any[],prepare:any)=>{submitted=prepare?prepare(snapshot):changes;}}),{createNodeMock:(element:any)=>element.type==='dialog'?{open:false,showModal(){this.open=true},close(){this.open=false}}:{value:''}});});
  const upload=async(account='0001238713')=>{
   const book=context.XLSX.utils.book_new();context.XLSX.utils.book_append_sheet(book,context.XLSX.utils.aoa_to_sheet([['Date','Description','USD$','Account'],['2026-11-09','e-Transfer - Autodeposit EXAMPLE OWNER CAUabcD1',1088.56,account]]),'Transactions');
   const file=new File([new Uint8Array(context.XLSX.write(book,{bookType:'xlsx',type:'array'}))],'bank.xlsx');
   await act(async()=>root.root.findByProps({'aria-label':'Choose Bank Files'}).props.onChange({target:{files:[file]}}));
  };
  await run(root,upload,()=>submitted);
 }finally{if(root)await act(async()=>root.unmount());await server.close();globalThis.window=previous;delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
}
const button=(root:any,label:string)=>root.root.findAllByType('button').find((node:any)=>text(node).trim()===label);
async function allocateOctober(root:any){
 await act(async()=>button(root,'Edit').props.onClick());
 for(const [name,value] of [['Home A','87.81'],['Home B','115.91']])await act(async()=>root.root.findByProps({'aria-label':`Allocate to ${name} - October 2026`}).props.onChange({target:{value}}));
}

test('partial owner payment saves applied rows and shows an automatic unallocated-credit note',async()=>withImport(async(root,upload,submitted)=>{
 await upload();await allocateOctober(root);
 const save=button(root,'Save 2 Payment Rows');assert.equal(save.props.disabled,false);
 assert.match(text(root.toJSON()),/Unallocated[^]*884\.84/);
 assert.match(text(root.toJSON()),/Transaction Note[^]*Received USD 1,088\.56[^]*allocated USD 203\.72[^]*unallocated USD 884\.84/);
 await act(async()=>save.props.onClick());
 assert.equal(submitted().length,1);assert.equal(submitted()[0].amountCents,108856);
 assert.equal(submitted()[0].allocations.reduce((n:number,a:any)=>n+a.amountCents,0),20372);
 const state:any=base();applyOwnerChange(state,submitted()[0]);
 assert.equal(state.ownerTransfers.length,1);assert.match(state.ownerTransfers[0].note,/unallocated USD 884\.84/);
 assert.deepEqual(state.months[0].properties.map((p:any)=>p.payments[0].amountCents),[8781,11591]);
}));

test('four-digit owner accounts save partial allocations with their remaining-credit note',async()=>withImport(async(root,upload,submitted)=>{
 await upload('8713');await allocateOctober(root);
 const save=button(root,'Save 2 Payment Rows');assert.equal(save.props.disabled,false);
 assert.match(text(root.toJSON()),/Transaction Note[^]*unallocated USD 884\.84/);
 await act(async()=>save.props.onClick());
 assert.equal(submitted().length,1);assert.equal(submitted()[0].accountIdentity,'8713');
 assert.equal(submitted()[0].allocations.reduce((n:number,a:any)=>n+a.amountCents,0),20372);
}));

test('owner allocations cannot exceed the available receipt balance',async()=>withImport(async(root,upload)=>{
 await upload();await allocateOctober(root);
 await act(async()=>root.root.findByProps({'aria-label':'Allocate to Home A - October 2026'}).props.onChange({target:{value:'1100'}}));
 const save=root.root.findAllByType('button').find((node:any)=>text(node).startsWith('Save '));
 assert.equal(save.props.disabled,true);assert.match(text(root.toJSON()),/exceed.*(?:available|remaining)/i);
}));

test('an older backend blocks partial owner saves with an actionable message',async()=>{
 const snapshot:any=base();delete snapshot.ownerReceiptSchema;
 await withImport(async(root,upload)=>{await upload();await allocateOctober(root);assert.equal(root.root.findAllByType('button').find((node:any)=>text(node).startsWith('Save ')).props.disabled,true);assert.match(text(root.toJSON()),/Update.*Apps Script.*partial/i);},snapshot);
});

test('a saved partial receipt opens without a file and allocates only its remaining credit',async()=>{
 const snapshot:any=base(),receipt=savedReceipt();snapshot.ownerTransfers=[receipt];
 await withImport(async(root,_upload,submitted)=>{
  assert.match(text(root.toJSON()),/Previously Applied[^]*203\.72/);
  const save=button(root,'Save 2 Payment Rows');assert.ok(save);assert.equal(save.props.disabled,false);
  await act(async()=>save.props.onClick());
  assert.equal(submitted()[0].transferId,'receipt');assert.equal(submitted()[0].priorAllocatedCents,20372);
  assert.equal(submitted()[0].allocations.reduce((n:number,a:any)=>n+a.amountCents,0),88484);
  assert.deepEqual(receipt,savedReceipt(),'review must not mutate the original receipt');
 },snapshot,receipt);
});
