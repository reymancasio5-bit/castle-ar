import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStatement} from '../src/bank-statement.ts';
import {statementPageText} from '../src/bank-pdf-layout.ts';

const rbcHeader = 'October 1, 2026 to November 2, 2026\nAccount number: 00099 123-456-7\n';
const wellsHeader = 'Wells Fargo Everyday Checking\nOctober 31, 2026 Page 2 of 6\nAccount number: 0000012345 (primary account)\nBeginning balance on 10/1 $100.00\nEnding balance on 10/31 $200.00\n';

test('Wells Fargo imports Airbnb payout references without reading deposit balances or debits', () => {
 const {deposits} = parseStatement(wellsHeader + [
  '10/5 Airbnb 4977 Airbnb Oct 02 M-aBcD123eFgHiJ\t\t126.43\t1,000.00',
  '10/6 Airbnb 4977 Airbnb Oct 05\t\t30.05\t1,030.05',
  'M-aBcd567eFgHiJ',
  '10/7 Airbnb 4977 Airbnb Oct 06 M-oUtD567eFgHiJ\t40.00\t\t990.05',
  '10/8 Zelle To Recipient on 10/08 Ref # OUT123 Airbnb 4977 Airbnb Oct 07 M-nOtD567eFgHiJ\t20.00\t\t970.05',
 ].join('\n'), 'statement.pdf');
 assert.deepEqual(deposits.map(d => [d.date,d.platform,d.amountCents,d.reference,d.account,d.accountIdentity]), [
  ['2026-10-05','Airbnb',12643,'M-aBcD123eFgHiJ','2345','0000012345'],
  ['2026-10-06','Airbnb',3005,'M-aBcd567eFgHiJ','2345','0000012345'],
 ]);
});

test('Wells Fargo explains each excluded credit and preserves its source, amount, date, and currency', () => {
 const {deposits,excluded} = parseStatement(wellsHeader + 'Currency: USD\n' + [
  '10/5 Remote Online Deposit\t\t26.43\t1,000.00',
  'Follow-up line',
  '10/6 Airbnb 4977 Airbnb Oct 05\t\t30.05\t1,030.05',
  '10/30 Zelle From Sender on 10/30 Ref # BAD123\t40.00\t20.00\t990.05',
  '11/1 Bank credit\t\t29.05\t1,019.10',
  '10/31 Monthly fee\t3.00\t\t1,016.10',
 ].join('\n'), 'statement.pdf');
 assert.deepEqual(deposits, []);
 assert.deepEqual(excluded?.map(e => [e.source,e.sourceRow,e.date,e.amountCents,e.currency,e.accountIdentity,e.description,!!e.reviewable]), [
  ['statement.pdf',7,'2026-10-05',2643,'USD','0000012345','Remote Online Deposit\nFollow-up line',true],
  ['statement.pdf',9,'2026-10-06',3005,'USD','0000012345','Airbnb 4977 Airbnb Oct 05',false],
  ['statement.pdf',10,'2026-10-30',2000,'USD','0000012345','Zelle From Sender on 10/30 Ref # BAD123',false],
  ['statement.pdf',11,undefined,2905,'USD','0000012345','Bank credit',false],
 ]);
 const reasons = excluded?.map(e => e.reason) ?? [];
 assert.match(reasons[0], /unsupported/i);
 assert.match(reasons[1], /reference/i);
 assert.match(reasons[2], /debit/i);
 assert.match(reasons[3], /date/i);
});

test('Wells Fargo accepts a matching trace reference and excludes a contradictory trace reference', () => {
 const {deposits,excluded} = parseStatement(wellsHeader + [
  '10/5 Airbnb 4977 Airbnb Oct 02 M-aBcD123eFgHiJ\t\t126.43\t1,000.00',
  'TRN*1*M-aBcD123eFgHiJ\\',
  '10/6 Airbnb 4977 Airbnb Oct 05 M-ABcD456eFgHiJ\t\t30.05\t1,030.05',
  'TRN*1*M-aBcD456eFgHiJ\\',
 ].join('\n'));
 assert.deepEqual(deposits.map(d => d.reference),['M-aBcD123eFgHiJ']);
 assert.equal(excluded?.[0]?.amountCents,3005);
 assert.match(excluded?.[0]?.reason ?? '',/reference/i);
});

test('RBC accounts for unknown and VRBO credits and validates references before classifying a VRBO payout', () => {
 const {deposits,excluded} = parseStatement(rbcHeader + 'Currency: CAD\n' + [
  '03 Oct Misc Payment VRBO HOLDINGS I\t\t51.15\t123.45',
  'Savings interest\t\t0.13\t123.58',
  '04 Oct Misc Payment VRBO HOLDINGS I Ref # VRB-234567\t\t61.14\t184.72',
  '05 Oct e-Transfer sent Recipient\t50.00\t\t134.72',
 ].join('\n'), 'statement.pdf');
 assert.deepEqual(deposits.map(d => [d.date,d.platform,d.amountCents,d.reference,d.currency,d.accountIdentity]), [
  ['2026-10-04','Vrbo',6114,'VRB-234567','CAD','000991234567'],
 ]);
 assert.deepEqual(excluded?.map(e => [e.date,e.amountCents,e.description]), [
  ['2026-10-03',5115,'Misc Payment VRBO HOLDINGS I'],
  ['2026-10-03',13,'Savings interest'],
 ]);
 assert.match(excluded?.[0]?.reason ?? '', /VRBO.*reference/i);
 assert.equal(excluded?.[0]?.reviewable,true);
});

test('RBC preserves an unsupported wrapped description and does not guess what a VRBO merchant number means', () => {
 const {deposits,excluded} = parseStatement(rbcHeader + [
  '03 Oct Other bank payment',
  '123456789012\t\t10.15\t123.45',
  '04 Oct VRBO HOLDINGS 123456789012\t\t11.15\t134.60',
 ].join('\n'));
 assert.deepEqual(deposits,[]);
 assert.deepEqual(excluded?.map(row => [row.description,row.amountCents]),[
  ['Other bank payment\n123456789012',1015], ['VRBO HOLDINGS 123456789012',1115],
 ]);
});

test('PDF location identifies each credit by page and does not inherit a date across pages', () => {
 const {deposits,excluded} = parseStatement('===== PAGE 1 =====\n' + rbcHeader + [
  '03 Oct AIRBNB PAYMENTS 000000012345678\t\t50.00\t250.00',
  '===== PAGE 2 =====',
  'Unknown bank credit\t\t10.15\t260.15',
 ].join('\n'));
 assert.deepEqual(deposits.map(d => [d.sheet,d.sourceRow,d.date]),[['Page 1',3,'2026-10-03']]);
 assert.deepEqual(excluded?.map(e => [e.sheet,e.sourceRow,e.date,e.amountCents]),[['Page 2',1,undefined,1015]]);
});

test('RBC recognizes bank-shaped letter-only references without stripping a surname', () => {
 const {deposits} = parseStatement(rbcHeader + [
  '03 Oct e-Transfer - Autodeposit Sam Callahan',
  'CAaBcDef\t\t51.15\t123.45',
  '04 Oct e-Transfer - Autodeposit Sam Callahan CAeFghIj\t\t51.15\t174.60',
  '05 Oct e-Transfer - Autodeposit SAM CALLAHAN\t\t51.15\t225.75',
 ].join('\n'));
 assert.deepEqual(deposits.map(d => [d.ownerName,d.reference]), [
  ['Sam Callahan','CAaBcDef'], ['Sam Callahan','CAeFghIj'], ['SAM CALLAHAN',''],
 ]);
});

test('RBC keeps wrapped owner details and an explicitly labelled reference', () => {
 const {deposits} = parseStatement(rbcHeader + [
  '03 Oct e-Transfer - Autodeposit Sam Callahan',
  'Reference: LETTERREF\t\t51.15\t123.45',
  '04 Oct e-Transfer - Autodeposit',
  'Sam Callahan\t\t51.15\t174.60',
 ].join('\n'));
 assert.deepEqual(deposits.map(row => [row.ownerName,row.reference]),[
  ['Sam Callahan','LETTERREF'], ['Sam Callahan',''],
 ]);
});

test('a currency in the filename does not establish the account currency', () => {
 const {deposits} = parseStatement(rbcHeader + '03 Oct AIRBNB PAYMENTS 000000012345678\t\t50.00\t250.00', 'CAD.pdf');
 assert.equal(deposits[0].currency,undefined);
});

test('PDF positioning retains malformed and signed values in their original amount columns', () => {
 const item = (str:string,x:number,y:number,width = 0) => ({str,transform:[1,0,0,1,x,y],width});
 const extracted = statementPageText([
  item('Date',20,700),item('Description',60,700),item('Cheques & Debits',290,700),item('Deposits & Credits',400,700),item('Balance',530,700),
  item('03 Oct',20,680),item('Other incoming payment',60,680),item('1,00.00',398,680,30),item('200.00',526,680,25),
  item('04 Oct',20,660),item('AIRBNB PAYMENTS',60,660),item('-50.00',399,660,25),
 ]);
 const {deposits,excluded} = parseStatement(rbcHeader+extracted);
 assert.deepEqual(deposits,[]);
 assert.deepEqual(excluded?.map(e => [e.date,e.amountCents,!!e.reviewable]),[
  ['2026-10-03',null,false],
 ]);
});
