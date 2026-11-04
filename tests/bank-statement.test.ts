import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, matchStatement } from '../src/bank-statement.ts';
import type { Month, Payment } from '../src/types.ts';
const header = 'September 4, 2026 to October 5, 2026\nAccount number: 00409 103-586-4\n';
const payment = (id: string, extra: Partial<Payment> = {}): Payment => ({id,type:'Airbnb',amountCents:113821,bundleCents:682451,payoutDate:'2026-09-09',bankDetails:'Checking 5864',bankCents:null,bankDate:'',verifiedByDaisy:false,...extra});
const month = (...payments: Payment[]): Month => ({id:'1',label:'November 2026',month:'2026-11',properties:[{id:'p',name:'House',manager:'A',totalCents:0,payments}]});
test('extracts only Airbnb deposits with inherited dates, references, and account suffix', () => {
 const result=parseStatement(header+'09 Sep Account Payable Pmt AIRBNB PAYMENTS\n00000344234136\t\t6,824.51\t20,000.00\nAccount Payable Pmt AIRBNB PAYMENTS\n00000344304967\t\t9,088.62\t\n10 Sep Loan\t\t30,000.00\t');
 assert.equal(result.deposits.length,2);
 assert.deepEqual(result.deposits.map(d=>[d.account,d.date,d.amountCents,d.reference]),[['5864','2026-09-09',682451,'00000344234136'],['5864','2026-09-09',908862,'00000344304967']]);
});
test('resolves December across year rollover and refuses missing period',()=>{
 const text='December 4, 2025 to January 5, 2026\nAccount number: 123 103-586-4\n31 Dec AIRBNB PAYMENTS\t\t12.34\t';
 assert.equal(parseStatement(text).deposits[0].date,'2025-12-31');
 assert.throws(()=>parseStatement('09 Sep AIRBNB PAYMENTS\t\t12.34\t'),/period|date|account/i);
});
test('never treats an Airbnb debit as a deposit',()=>{
 assert.equal(parseStatement(header+'09 Sep AIRBNB PAYMENTS\t100.00\t\t20,000.00').deposits.length,0);
});
test('matches same-account bundle rows and copies each row amount, not the bundle',()=>{
 const statement=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t6,824.51\t');
 const result=matchStatement(statement.deposits,month(payment('a'),payment('b',{amountCents:568630}),payment('wrong',{bankDetails:'Checking 7524'})));
 assert.equal(result.changes.length,2);
 assert.equal(result.rows[0].payments[0].payment.amountCents,113821);
 assert.deepEqual(result.changes[0],{kind:'reconcileBank',paymentId:'a',account:'5864',bundleCents:682451,bankDate:'2026-09-09'});
});
test('blocks repeated deposits, conflicting rows, and different payout dates for equal amounts',()=>{
 const s=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t6,824.51\t');
 assert.equal(matchStatement([...s.deposits,...s.deposits],month(payment('a'))).changes.length,0);
 assert.equal(matchStatement(s.deposits,month(payment('a'),payment('b',{payoutDate:'2026-09-08'}))).changes.length,0);
 assert.equal(matchStatement(s.deposits,month(payment('a',{bankCents:500}))).changes.length,0);
});
test('reimport is a no-op and a later statement does not match a future payout',()=>{
 const s=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t6,824.51\t');
 assert.equal(matchStatement(s.deposits,month(payment('a',{bankCents:113821,bankDate:'2026-09-09',verifiedBySystem:true}))).changes.length,0);
 assert.equal(matchStatement(s.deposits,month(payment('a',{payoutDate:'2026-10-01'}))).changes.length,0);
});

test('rejects mixed statement accounts instead of assigning the first account to every deposit',()=>{
 assert.throws(()=>parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t10.00\t\n'+header.replace('103-586-4','103-752-4')+'10 Sep AIRBNB PAYMENTS\t\t20.00\t'),/one statement|different accounts/i);
});
test('unpositioned numbers and split dates cannot become verified deposit evidence',()=>{
 assert.equal(parseStatement(header+'09 Sep AIRBNB PAYMENTS 100.00 20,000.00').deposits.length,0);
 const parsed=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t10.00\t\n10\nSep AIRBNB PAYMENTS\t\t20.00\t');
 assert.equal(parsed.deposits.length,1);
});
