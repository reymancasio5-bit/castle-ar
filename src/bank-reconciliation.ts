import type {BankDeposit} from './bank-statement.ts';
import type {BankReceipt,Change,Month,OwnerTransfer,Payment,ReceiptAllocation,ReceiptEvidence,Snapshot} from './types.ts';
import {accountDirectory,maskedAccountMatches,payoutAccount,receiptKey,sameBankReference,validSourceAccount} from './bank-account.ts';

export type ReconcileChange=Extract<Change,{kind:'reconcileBank'}>;
type Payout={property:string;payment:Payment};
type Candidate={id:string;label:string;payments:Payout[]};
interface Options { receipts?:BankReceipt[]; months?:Month[]; selections?:Record<string,string>; ownerTransfers?:OwnerTransfer[] }
type ReviewRow={deposit:BankDeposit;selectablePayments:Payout[];payments:Payout[];status:string;selectionKey:string;candidates:Candidate[]};
const allocationKey=(a:Omit<ReceiptAllocation,'amountCents'>)=>JSON.stringify([a.monthId,a.propertyName.trim().toLowerCase(),a.bundleOnly,a.paymentIndex]);
const evidenceKey=(date:string,amount:number,platform:string,currency?:string)=>JSON.stringify([date,amount,platform,currency]);
const bundleKey=(account:string,amount:number|null,platform:string)=>JSON.stringify([account,amount,platform]);
function group<T>(map:Map<string,T[]>,key:string,value:T){const values=map.get(key);if(values)values.push(value);else map.set(key,[value]);}
const positive=(value:number|null):value is number=>Number.isSafeInteger(value)&&value!>0;
const total=(rows:Payout[])=>rows.reduce((sum,r)=>sum+(r.payment.amountCents??0),0);
function candidate(payments:Payout[]):Candidate{
 const id=JSON.stringify(payments.map(row=>row.payment.id));
 const names=[...new Set(payments.map(row=>row.property))].join(', ');
 const dates=[...new Set(payments.map(row=>row.payment.payoutDate).filter(Boolean))].join(', ');
 return {id,label:[names,dates,(total(payments)/100).toFixed(2),payments.map(row=>row.payment.id).join(', ')].filter(Boolean).join(' · '),payments};
}
function manualGroup(value:string,available:Map<string,Payout>):Candidate|undefined{
 let ids:unknown;
 try{ids=JSON.parse(value);}catch{return;}
 if(!Array.isArray(ids)||!ids.length||ids.length>available.size||new Set(ids).size!==ids.length)return;
 const payments:Payout[]=[];
 for(const id of ids){if(typeof id!=='string')return;const row=available.get(id);if(!row)return;payments.push(row);}
 return candidate(payments);
}
function candidatesFor(rows:Payout[],amount:number,competing:boolean):Candidate[]{
 const payoutDates=new Set(rows.map(r=>r.payment.payoutDate).filter(Boolean));
 if(!competing&&payoutDates.size<=1&&total(rows)<=amount)return [candidate(rows)];
 const dates=new Map<string,Payout[]>();for(const row of rows)group(dates,row.payment.payoutDate,row);
 const result:Candidate[]=[];
 for(const items of dates.values()){
  if(total(items)<=amount)result.push(candidate(items));
  else for(const row of items)if(positive(row.payment.amountCents)&&row.payment.amountCents<=amount)result.push(candidate([row]));
 }
 return result;
}

export function matchStatement(deposits:BankDeposit[],month:Month,options:Options={}){
 const receipts=options.receipts??[],months=options.months??[month],owners=options.ownerTransfers??[];
 const directory=accountDirectory(), ledger=new Map<string,BankReceipt>(),used=new Map<string,string>();
 const ownerRefs=new Map<string,OwnerTransfer[]>(),choicesByBundle=new Map<string,{available:Payout[];candidates:Candidate[];byId:Map<string,Payout>}>();
 const drafts=new Map<string,ReconcileChange[]>(),paymentClaims=new Map<string,string[]>(),legacy=new Map<string,Payout[]>();
 const slots=new Map<string,string>(),bundles=new Map<string,Payout[]>(),signatures=new Map<string,string>(),conflicts=new Set<string>(),referencesByBundle=new Map<string,Set<string>>();
 for(const r of receipts){
  const key=receiptKey(r.accountIdentity,r.reference);ledger.set(key,r);directory.observe(r.account,r.accountIdentity,r.currency);
  for(const a of r.allocations)used.set(allocationKey(a),key);
 }
 for(const r of owners){directory.observe(r.account,r.accountIdentity,r.currency);group(ownerRefs,receiptKey(r.account,r.reference),r);}
 for(const m of months)for(const p of m.properties)p.payments.forEach((payment,i)=>{
  const bank=payoutAccount(payment.bankDetails),slot=allocationKey({monthId:m.id,propertyName:p.name,bundleOnly:!!p.bundleOnly,paymentIndex:i});
  slots.set(payment.id,slot);directory.observe(bank.suffix,bank.identity,bank.currency);
  if(payment.receivedBy==='owner'||payment.type==='Owner')return;
  const row={property:p.name,payment},key=bundleKey(bank.suffix,payment.bundleCents,payment.type);
  if(m.id===month.id)group(bundles,key,row);
  if(payment.verifiedBySystem&&payment.bankDate&&!used.has(slot))group(legacy,JSON.stringify([key,payment.bankDate]),row);
 });
 for(const d of deposits){
  const platform=d.kind==='owner'?'Owner':d.platform??'Airbnb';
  directory.observe(d.account,d.accountIdentity,d.currency);
  if(!d.reference)continue;
  const key=receiptKey(d.accountIdentity||d.account,d.reference),sig=evidenceKey(d.date,d.amountCents,platform,d.currency);
  if(signatures.has(key)&&signatures.get(key)!==sig)conflicts.add(key);signatures.set(key,sig);
  const bundle=bundleKey(d.accountIdentity||d.account,d.amountCents,platform+'|'+d.currency),refs=referencesByBundle.get(bundle)??new Set();
  refs.add(key);referencesByBundle.set(bundle,refs);
 }
 const encountered=new Set<string>();
 const rows:ReviewRow[]=deposits.filter(d=>d.kind!=='owner').map(deposit=>{
  const {account,accountIdentity,currency,reference,date,amountCents,source}=deposit,platform=deposit.platform??'Airbnb';
  const key=receiptKey(accountIdentity||account,reference);
  const row:ReviewRow={deposit,selectionKey:key,candidates:[],selectablePayments:[],payments:[],status:''};
  const status=(message:string)=>{row.status=message;return row;};
  if(!validSourceAccount(account,accountIdentity)||!currency||!['CAD','USD'].includes(currency))return status('Confirm the full source account and currency');
  if(!reference.trim())return status('Missing transaction reference');
  if(!positive(amountCents)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return status('Invalid deposit date or amount');
  const existing=ledger.get(key);
  if(conflicts.has(key)||ownerRefs.get(receiptKey(account,reference))?.some(o=>sameBankReference(deposit,o))||(existing&&evidenceKey(existing.date,existing.amountCents,existing.platform,existing.currency)!==evidenceKey(date,amountCents,platform,currency)))return status('Conflicting transaction reference');
  if(encountered.has(key))return status('Duplicate statement entry');encountered.add(key);
  const bundle=bundleKey(account,amountCents,platform);
  const compatible=(r:Payout)=>directory.matches(r.payment.bankDetails,account,accountIdentity!,currency);
  if(legacy.get(JSON.stringify([bundle,date]))?.some(r=>{const b=payoutAccount(r.payment.bankDetails);return maskedAccountMatches(b.mask,accountIdentity!)&&(!b.identity||b.identity===accountIdentity)&&(!b.currency||b.currency===currency);}))return status('Previously verified payment has no receipt reference; review bank history');
  const scope=bundleKey(accountIdentity!,amountCents,platform+'|'+currency);
  const competing=(referencesByBundle.get(scope)?.size??0)>1;
  let choices=choicesByBundle.get(scope);
  if(!choices){
   const available=(bundles.get(bundle)??[]).filter(r=>!used.has(slots.get(r.payment.id)!)&&compatible(r));
   const candidates=available.length?candidatesFor(available,amountCents,competing):[];
   choices={available,candidates,byId:new Map(available.map(row=>[row.payment.id,row]))};
   choicesByBundle.set(scope,choices);
  }
  if(!choices.available.length)return status(existing?'Already recorded for this receipt':'No matching unallocated bundle in this month');
  const remaining=amountCents-(existing?.allocations.reduce((n,a)=>n+a.amountCents,0)??0);
  if(!remaining)return status('Receipt fully allocated');
  row.candidates=choices.candidates;
  row.selectablePayments=choices.available;
  const selected=options.selections?.[key];
  const choice=selected?manualGroup(selected,choices.byId):!competing&&row.candidates.length===1?row.candidates[0]:undefined;
  if(!choice&&selected)return status('Choose a valid group of available payments');
  if(!choice)return status(row.candidates.length?'Choose a payout group':'Matched payments exceed the bundle');
  row.payments=choice.payments;
  if(choice.payments.some(({payment:p})=>!positive(p.amountCents)||p.verifiedBySystem||(p.bankCents!==null&&p.bankCents!==p.amountCents)||(p.bankDate&&p.bankDate!==date)))return status('Needs review: existing bank values or missing payment amount');
  if(total(choice.payments)>remaining)return status('Payments exceed the remaining receipt amount');
  const description=deposit.sourceDescription??deposit.description;
  const receipt:ReceiptEvidence={accountIdentity:accountIdentity!,currency,reference,source,platform,...(description?{description}:{}),...(deposit.sheet?{sheet:deposit.sheet}:{}),...(deposit.sourceRow!==undefined?{sourceRow:deposit.sourceRow}:{})};
  drafts.set(key,choice.payments.map(({payment})=>({kind:'reconcileBank',paymentId:payment.id,account,bundleCents:amountCents,bankDate:date,receipt})));
  for(const {payment} of choice.payments)group(paymentClaims,payment.id,key);
  return status('Ready');
 });
 const overlapping=new Set([...paymentClaims.values()].filter(keys=>keys.length>1).flat());
 const changes:ReconcileChange[]=[];
 for(const row of rows)if(row.status==='Ready'){if(overlapping.has(row.selectionKey))row.status='Payout group selected for more than one receipt';else changes.push(...drafts.get(row.selectionKey)!);}
 return {rows,changes};
}


export function protectReceiptHistory(snapshot:Snapshot,changes:Change[]){
 const allocations=(snapshot.bankReceipts??[]).flatMap(r=>r.allocations);
 if(!allocations.length)return;
 for(const change of changes){
  if(change.kind!=='deletePayment'&&change.kind!=='deleteProperty'&&change.kind!=='updateProperty')continue;
  for(const month of snapshot.months)for(const p of month.properties){
   const index=change.kind==='deletePayment'?p.payments.findIndex(row=>row.id===change.paymentId):-1;
   if(change.kind==='deletePayment'?index<0:change.propertyId!==p.id)continue;
   if(change.kind==='updateProperty'&&change.name.trim().toLowerCase()===p.name.trim().toLowerCase())continue;
   if(allocations.some(a=>a.monthId===month.id&&a.propertyName.trim().toLowerCase()===p.name.trim().toLowerCase()&&a.bundleOnly===!!p.bundleOnly&&a.paymentIndex>=index))throw new Error('This edit would move or remove bank receipt history.');
  }
 }
}
export function recordPreviewReceipt(snapshot:Snapshot,change:ReconcileChange,batch:Change[]){
 const r=change.receipt;
 if(!r||!validSourceAccount(change.account,r.accountIdentity)||!['CAD','USD'].includes(r.currency)||!r.reference.trim()||!r.source.trim()||!positive(change.bundleCents)||!/^\d{4}-\d{2}-\d{2}$/.test(change.bankDate)||!Number.isFinite(Date.parse(change.bankDate))||new Date(change.bankDate).toISOString().slice(0,10)!==change.bankDate)throw new Error('Invalid statement receipt evidence.');
 const receipts=snapshot.bankReceipts??=[],key=receiptKey(r.accountIdentity,r.reference),directory=accountDirectory();
 const identity={...r,account:change.account};
 if(snapshot.ownerTransfers?.some(t=>sameBankReference(identity,t)))throw new Error('Reference already used for an owner transfer.');
 const existing=receipts.find(stored=>receiptKey(stored.accountIdentity,stored.reference)===key);
 if(existing&&evidenceKey(existing.date,existing.amountCents,existing.platform,existing.currency)!==evidenceKey(change.bankDate,change.bundleCents,r.platform,r.currency))throw new Error('Conflicting receipt evidence.');
 const claimed=new Map<string,BankReceipt>();
 for(const receipt of receipts){directory.observe(receipt.account,receipt.accountIdentity,receipt.currency);for(const a of receipt.allocations)claimed.set(allocationKey(a),receipt);}
 for(const t of snapshot.ownerTransfers??[])directory.observe(t.account,t.accountIdentity,t.currency);
 for(const c of batch){if(c.kind==='reconcileBank'&&c.receipt)directory.observe(c.account,c.receipt.accountIdentity,c.receipt.currency);if(c.kind==='importOwnerTransfer')directory.observe(c.account,c.accountIdentity,c.currency);}
 let target:{payment:Payment;allocation:ReceiptAllocation}|undefined;
 for(const m of snapshot.months)for(const property of m.properties)for(const [index,payment] of property.payments.entries()){
  const b=payoutAccount(payment.bankDetails);directory.observe(b.suffix,b.identity,b.currency);
  const a={monthId:m.id,propertyName:property.name,bundleOnly:!!property.bundleOnly,paymentIndex:index,amountCents:payment.amountCents??0};
  if(payment.id===change.paymentId)target={payment,allocation:a};
  if(payment.type===r.platform&&payment.receivedBy!=='owner'&&payment.bundleCents===change.bundleCents&&payment.bankDate===change.bankDate&&payment.verifiedBySystem&&b.suffix===change.account&&maskedAccountMatches(b.mask,r.accountIdentity)&&(!b.identity||b.identity===r.accountIdentity)&&(!b.currency||b.currency===r.currency)&&!claimed.has(allocationKey(a)))throw new Error('Earlier payment verification has no receipt reference.');
 }
 if(!target)throw new Error('Payment not found.');
 const {payment:p,allocation:a}=target,allocated=claimed.get(allocationKey(a));
 if(p.receivedBy==='owner'||p.type!==r.platform||p.bundleCents!==change.bundleCents||!positive(p.amountCents)||!directory.matches(p.bankDetails,change.account,r.accountIdentity,r.currency)||(p.bankCents!==null&&p.bankCents!==p.amountCents)||(p.bankDate&&p.bankDate!==change.bankDate))throw new Error('The payment and source receipt differ.');
 if(allocated){
  if(allocated===existing&&p.verifiedBySystem&&p.bankDate===existing.date&&p.bankCents===p.amountCents&&existing.allocations.some(entry=>allocationKey(entry)===allocationKey(a)&&entry.amountCents===p.amountCents))return;
  throw new Error('This payment already has a receipt allocation.');
 }
 if(p.verifiedBySystem)throw new Error('This payment was already verified.');
 const receipt=existing??{...identity,date:change.bankDate,amountCents:change.bundleCents,allocations:[]};
 if(receipt.allocations.reduce((n,a)=>n+a.amountCents,p.amountCents)>receipt.amountCents)throw new Error('Allocations exceed the remaining receipt amount.');
 receipt.allocations.push(a);if(!existing)receipts.push(receipt);
 p.verifiedBySystem=true;p.bankDate=change.bankDate;p.bankCents=p.amountCents;
}

