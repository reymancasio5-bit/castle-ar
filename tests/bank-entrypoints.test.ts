import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';

const month={id:'november',month:'2026-11',label:'November 2026',properties:[]};
const click={type:'click',currentTarget:{tagName:'BUTTON'}};
const text=(node:any):string=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node.children);

async function withView(path:string,props:Record<string,unknown>,run:(root:any)=>Promise<void>){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const server=await createServer({cacheDir:'node_modules/.vite-bank-entrypoint-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 let root:any;
 try{
  const {default:View}=await server.ssrLoadModule(path);
  await act(async()=>{root=TestRenderer.create(React.createElement(View,props));});
  await run(root);
 }finally{if(root)await act(async()=>root.unmount());await server.close();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
}

test('Bundle Matching bank import preserves the reporting month instead of forwarding the click event',async()=>{
 let target:any;
 await withView('/src/BundleMatching.tsx',{month,onImport(){},onBankImport:(selected=month)=>{target=selected;},onOpen(){},onExport(){}},async root=>{
  const button=root.root.findAllByType('button').find((button:any)=>text(button)==='Import Bank Statement');
  assert.ok(button);
  await act(async()=>button.props.onClick(click));
  assert.equal(target,month);
 });
});

test('both Bundle Matching payment-import buttons preserve the reporting month',async()=>{
 const targets:any[]=[];
 await withView('/src/BundleMatching.tsx',{month,onImport:(selected=month)=>{targets.push(selected);},onBankImport(){},onOpen(){},onExport(){}},async root=>{
  const buttons=root.root.findAllByType('button').filter((button:any)=>['Import Excel / CSV','Import Airbnb Payments'].includes(text(button)));
  assert.equal(buttons.length,2);
  for(const button of buttons)await act(async()=>button.props.onClick(click));
  assert.deepEqual(targets,[month,month]);
 });
});

for(const ownerSchema of [1,undefined])test(`Property Owners bank import opens read/review with owner schema ${ownerSchema??'legacy'} and preserves the reporting month`,async()=>{
 let target:any;
 const snapshot={revision:'r',updatedAt:'',spreadsheetUrl:'',months:[month],ownerSchema,owners:[{id:'owner',name:'Example Owner',bankName:'EXAMPLE OWNER',email:'',notes:'',active:true,propertyNames:[]}],ownerTransfers:[]};
 await withView('/src/PropertyOwners.tsx',{snapshot,monthId:month.id,onSave:async()=>{},onDirtyChange(){},onOpenListing(){},onBankImport:(selected=month)=>{target=selected;}},async root=>{
  const button=root.root.findAllByType('button').find((button:any)=>text(button)==='Import Bank Statement');
  assert.ok(button);assert.equal(button.props.disabled,false);
  await act(async()=>button.props.onClick(click));
  assert.equal(target,month);
 });
});

for(const ownerReceiptSchema of [1,undefined])test(`saved partial owner receipts show their remaining credit and resume capability ${ownerReceiptSchema??'legacy'}`,async()=>{
 let resumed:any;
 const transfer={id:'receipt',ownerId:'owner',ownerName:'Example Owner',bankName:'EXAMPLE OWNER',account:'8713',accountIdentity:'10008713',currency:'USD',date:'2026-11-09',reference:'EXAMPLE123',source:'bank.xlsx',amountCents:108856,monthId:month.id,allocations:[{propertyName:'Example Home',monthId:month.id,amountCents:20372}],note:'Received USD 1,088.56; allocated USD 203.72; unallocated USD 884.84.'};
 const snapshot={revision:'r',updatedAt:'',spreadsheetUrl:'',months:[month],ownerSchema:1,ownerReceiptSchema,owners:[{id:'owner',name:'Example Owner',bankName:'EXAMPLE OWNER',email:'',notes:'',active:true,propertyNames:['Example Home']}],ownerTransfers:[transfer]};
 await withView('/src/PropertyOwners.tsx',{snapshot,monthId:month.id,onSave:async()=>{},onDirtyChange(){},onOpenListing(){},onBankImport(){},onAllocateReceipt:(receipt:any)=>{resumed=receipt;}},async root=>{
  const history=root.root.findByProps({className:'owner-history'});
  const copy=text(history);
  assert.match(copy,/Received.*USD 1,088\.56/);
  assert.match(copy,/Allocated.*USD 203\.72/);
  assert.match(copy,/Unallocated.*USD 884\.84/);
  assert.match(copy,/Received USD 1,088\.56; allocated USD 203\.72; unallocated USD 884\.84\./);
  const button=history.findAllByType('button').find((button:any)=>text(button)==='Allocate Remaining');
  assert.ok(button);assert.equal(button.props.disabled,ownerReceiptSchema!==1);
  if(ownerReceiptSchema===1){await act(async()=>button.props.onClick(click));assert.equal(resumed,transfer);}
 });
});

test('fully allocated owner receipts do not offer another allocation',async()=>{
 const transfer={id:'receipt',ownerId:'owner',ownerName:'Example Owner',bankName:'EXAMPLE OWNER',account:'8713',accountIdentity:'10008713',currency:'USD',date:'2026-11-09',reference:'EXAMPLE123',source:'bank.xlsx',amountCents:20372,monthId:month.id,allocations:[{propertyName:'Example Home',monthId:month.id,amountCents:20372}]};
 const snapshot={revision:'r',updatedAt:'',spreadsheetUrl:'',months:[month],ownerSchema:1,ownerReceiptSchema:1,owners:[{id:'owner',name:'Example Owner',bankName:'EXAMPLE OWNER',email:'',notes:'',active:true,propertyNames:['Example Home']}],ownerTransfers:[transfer]};
 await withView('/src/PropertyOwners.tsx',{snapshot,monthId:month.id,onSave:async()=>{},onDirtyChange(){},onOpenListing(){},onBankImport(){},onAllocateReceipt(){}},async root=>{
  assert.equal(root.root.findAllByType('button').filter((button:any)=>text(button)==='Allocate Remaining').length,0);
  assert.match(text(root.root.findByProps({className:'owner-history'}).findByType('details')),/\[November 2026\]/);
 });
});
