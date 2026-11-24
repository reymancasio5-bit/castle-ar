import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useState} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';
import {detectBankColumns,parseBankSpreadsheet} from '../src/bank-spreadsheet.ts';

test('worksheet mapping lets users supply missing accounts and remap unfamiliar headings before review',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const server=await createServer({cacheDir:'node_modules/.vite-bank-mapping-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null},appType:'custom'});
 let root:any;
 try{
  const {default:Mapping}=await server.ssrLoadModule('/src/BankSpreadsheetMapping.tsx');
  const sheet={name:'Checking',rows:[['DATE','DESCRIPTION','Custom Credit'],['2026-11-23','AIRBNB PAYMENTS 000000346979007',25]].map(r=>r.map(value=>({value})))};
  let result:any;
  function Harness(){
   const [drafts,setDrafts]=useState([{source:'any-name.xlsx',sheet,mapping:detectBankColumns(sheet),account:'',skip:false}]);
   return React.createElement(Mapping,{drafts,onChange:setDrafts,disabled:false,onReview:()=>{result=parseBankSpreadsheet([sheet],drafts[0].source,{mapping:drafts[0].mapping,account:drafts[0].account});}});
  }
  await act(async()=>{root=TestRenderer.create(React.createElement(Harness));});
  const amountLabel=root.root.findAllByType('label').find((l:any)=>l.children.includes('Amount / Credit'));
  await act(async()=>amountLabel.findByType('select').props.onChange({target:{value:'2'}}));
  await act(async()=>root.root.findByProps({placeholder:'Enter the source account'}).props.onChange({target:{value:'9876'}}));
  await act(async()=>root.root.findByType('button').props.onClick());
  assert.equal(result.deposits[0].account,'9876');assert.equal(result.deposits[0].amountCents,2500);
 }finally{
  if(root)await act(async()=>root.unmount());
  await server.close();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
 }
});
