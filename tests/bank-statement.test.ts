import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, matchStatement } from '../src/bank-statement.ts';
import type { Month, Payment } from '../src/types.ts';
const header = 'September 4, 2026 to October 5, 2026\nAccount number: 00409 103-586-4\n';
test('extracts repeated owner Autodeposit credits with names and alphanumeric references only',()=>{
 const result=parseStatement(header+'09 Sep e-Transfer - Autodeposit Jane Smith CA123456\t\t100.00\t900.00\ne-Transfer - Autodeposit Jane Smith\nCA987654\t\t200.00\t1,100.00\n10 Sep e-Transfer - Autodeposit Debit Person ZZ123456\t50.00\t\t1,050.00');
 assert.deepEqual(result.deposits.map(d=>[d.kind,d.ownerName,d.reference,d.amountCents]),[['owner','Jane Smith','CA123456',10000],['owner','Jane Smith','CA987654',20000]]);
 assert.equal(matchStatement(result.deposits,month(payment('a'))).rows.length,0);
});
test('owner name and reference can follow the Autodeposit label without absorbing other transactions',()=>{
 const result=parseStatement(header+'09 Sep e-Transfer - Autodeposit\nJane Smith CA123456\t\t100.00\t900.00\n10 Sep e-Transfer - Autodeposit Jane Smith\t\t100.00\t1,000.00\nService Fee ZZ987654\t5.00\t\t995.00');
 assert.equal(result.deposits[0].ownerName,'Jane Smith');assert.equal(result.deposits[0].reference,'CA123456');assert.equal(result.deposits[1].reference,'');
});
test('negative or malformed owner credits cannot become positive payments',()=>{for(const value of ['-100.00','100.00 CR 500.00','1,00.00'])assert.equal(parseStatement(header+'09 Sep e-Transfer - Autodeposit Jane Smith CA123456\t\t'+value+'\t900.00').deposits.length,0);});
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
test('blocks repeated deposits and conflicting existing bank values',()=>{
 const s=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t6,824.51\t');
 assert.equal(matchStatement([...s.deposits,...s.deposits],month(payment('a'))).changes.length,0);

 assert.equal(matchStatement(s.deposits,month(payment('a',{bankCents:500}))).changes.length,0);
});
test('reimport is a no-op',()=>{
 const s=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t6,824.51\t');
 assert.equal(matchStatement(s.deposits,month(payment('a',{bankCents:113821,bankDate:'2026-09-09',verifiedBySystem:true}))).changes.length,0);

});

test('rejects mixed statement accounts instead of assigning the first account to every deposit',()=>{
 assert.throws(()=>parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t10.00\t\n'+header.replace('103-586-4','103-752-4')+'10 Sep AIRBNB PAYMENTS\t\t20.00\t'),/one statement|different accounts/i);
});
test('unpositioned numbers and split dates cannot become verified deposit evidence',()=>{
 assert.equal(parseStatement(header+'09 Sep AIRBNB PAYMENTS 100.00 20,000.00').deposits.length,0);
 const parsed=parseStatement(header+'09 Sep AIRBNB PAYMENTS\t\t10.00\t\n10\nSep AIRBNB PAYMENTS\t\t20.00\t');
 assert.equal(parsed.deposits.length,1);
});


test('944.03 bank deposit matches F regardless of E and previews D 594.20 for I',()=>{
 const statement=parseStatement(header+'10 Sep AIRBNB PAYMENTS\t\t944.03\t');
 const result=matchStatement(statement.deposits,month(payment('116',{amountCents:59420,bundleCents:94403,payoutDate:'2026-09-17'}),payment('other',{amountCents:34983,bundleCents:94403,payoutDate:''}),payment('wrong-F',{amountCents:94403,bundleCents:59420}),payment('wrong-bank',{bundleCents:94403,bankDetails:'Checking 7524'})));
 assert.equal(result.rows[0].status,'Ready');assert.deepEqual(result.changes.map(c=>c.paymentId),['116','other']);assert.equal(result.rows[0].payments[0].payment.amountCents,59420);
});
