import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, collected, balance, systemStatus } from '../src/domain.ts';
import { sampleSnapshot } from '../src/sample.ts';
test('currency parsing preserves blanks and zeros, validates complete values', () => {
  for(const [input, expected] of [['',null],[null,null],[0,0],['0.00',0],['$1,234.56',123456],['(12.34)',-1234],[-3.25,-325],['1.005',101]] as const) assert.equal(parseMoney(input),expected);
  for(const input of ['1,23','10 overdue','12%','Infinity',true,new Date(), '1.2.3']) assert.throws(()=>parseMoney(input));
});
test('source totals reconcile exactly in integer cents',()=>{
 const p=sampleSnapshot.months[0].properties;
 assert.equal(p.reduce((s,p)=>s+p.totalCents,0),105590);
 assert.equal(p.reduce((s,p)=>s+collected(p),0),32486);
 assert.equal(p.reduce((s,p)=>s+balance(p),0),73104);
 assert.equal(balance(p[2]),4562);
});
test('verification requires both known bundle and bank amounts',()=>{
 const p=sampleSnapshot.months[0].properties[0].payments[0];
 assert.equal(systemStatus({...p,bundleCents:null,bankCents:0}),'Pending');
 assert.equal(systemStatus({...p,bundleCents:0,bankCents:0}),'Matched');
 assert.equal(systemStatus({...p,bundleCents:100,bankCents:99}),'Mismatch');
});
