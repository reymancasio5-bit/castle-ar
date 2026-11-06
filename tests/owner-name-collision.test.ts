import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOwnerChange} from '../src/owners.ts';
import type {Snapshot} from '../src/types.ts';
test('duplicate normalized property names cannot produce an unreadable transfer ledger',()=>{
 const state:Snapshot={revision:'1',updatedAt:'',spreadsheetUrl:'',owners:[{id:'owner',name:'Owner',bankName:'OWNER',email:'',notes:'',active:true,propertyNames:['House A']}],months:[{id:'month',label:'Month',month:'2026-11',properties:[{id:'a',name:'House A',manager:'',totalCents:1000,payments:[]},{id:'b',name:'House  A',manager:'',totalCents:1000,payments:[]}]}]};
 const before=structuredClone(state);
 assert.throws(()=>applyOwnerChange(state,{kind:'importOwnerTransfer',ownerId:'owner',monthId:'month',account:'5864',reference:'CA12345',source:'bank.pdf',date:'2026-11-01',bankName:'OWNER',amountCents:1000,allocations:[{propertyId:'a',amountCents:500},{propertyId:'b',amountCents:500}]}),/ambiguous duplicate names/);
 assert.deepEqual(state,before);
});
