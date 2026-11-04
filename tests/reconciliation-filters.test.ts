import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationRows } from '../src/reconciliation-filters.ts';
import type {Payment,Property} from '../src/types.ts';
const payment=(id:string,extra:Partial<Payment>):Payment=>({id,type:'Airbnb',amountCents:100,bundleCents:100,bankCents:null,bankDate:'',payoutDate:'',verifiedByDaisy:false,...extra});
const properties:Property[]=[{id:'p',name:'House',manager:'Team A',totalCents:300,payments:[payment('matched',{bankCents:100,bankDate:'2026-09-10',verifiedBySystem:true}),payment('mismatch',{bankCents:50,bankDate:'2026-09-10',verifiedByDaisy:true}),payment('pending',{})]}];
test('system filter selects matching payment rows rather than all rows of their property',()=>{
 assert.deepEqual(reconciliationRows(properties,'Matched','all').map(r=>r.payment.id),['matched']);
 assert.deepEqual(reconciliationRows(properties,'Mismatch','all').map(r=>r.payment.id),['mismatch']);
 assert.deepEqual(reconciliationRows(properties,'Pending','all').map(r=>r.payment.id),['pending']);
});
test('Daisy and system filters combine with AND and retain original row numbering',()=>{
 assert.deepEqual(reconciliationRows(properties,'all','verified').map(r=>[r.payment.id,r.index]),[['mismatch',1]]);
 assert.deepEqual(reconciliationRows(properties,'Matched','pending').map(r=>r.payment.id),['matched']);
 assert.equal(reconciliationRows(properties,'Matched','verified').length,0);
 assert.equal(reconciliationRows(properties,'all','all').length,3);
 assert.equal(properties[0].payments.length,3);
});
