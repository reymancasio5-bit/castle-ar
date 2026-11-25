import {sameBankReference,validSourceAccount} from './bank-account.ts';
import type {BankReceipt,Month,OwnerChange,OwnerTransfer,PropertyOwner,Snapshot} from './types.ts';
import type {BankDeposit} from './bank-statement.ts';
import {balance} from './domain.ts';

export const ownerKey=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
export const ownerBankNames=(value:string)=>value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);
export function ownerDepositSkipped(row:{duplicate:boolean;allocations:unknown[];owner?:PropertyOwner},choice?:boolean){
 return row.duplicate||(choice??(!row.owner?.active||!row.allocations.length));
}
function cleanBankNames(value:string){
 if(typeof value!=='string'||value.length>4000)throw new Error('Enter up to 20 bank statement names, one per line.');
 const names=ownerBankNames(value).map(name=>clean(name,'statement name'));
 if(!names.length||names.length>20)throw new Error('Enter between 1 and 20 bank statement names.');
 if(new Set(names.map(ownerKey)).size!==names.length)throw new Error('Enter each bank statement name only once.');
 return names.join('\n');
}
// Compare address text, not just its street number; never fuzzy-match owners.
const addressKey=(value:string)=>ownerKey(value).replace(/^.*?(?=\d)/,'').replace(/\b(?:street|st|road|rd|avenue|ave|drive|dr)\.?$/,'').replace(/[^a-z0-9]+/g,' ').trim();
export const transferKey=(account:string,reference:string)=>JSON.stringify([account.replace(/[\s-]/g,'').toLowerCase(),reference.trim().toLowerCase()]);
const clean=(value:unknown,label:string,max=160,required=true,multiline=false):string=>{
 if(typeof value!=='string')throw new Error(`Enter a valid ${label}.`);
 const text=multiline?value.trim():value.trim().replace(/\s+/g,' ');
 if((required&&!text)||text.length>max||/^[=+@-]/.test(text)||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))throw new Error(`Enter a valid ${label}.`);
 return text;
};
const positive=(amount:number)=>Number.isSafeInteger(amount)&&amount>0&&amount<=999999999999;
export const ownerTransferAllocated=(transfer:Pick<OwnerTransfer,'allocations'>)=>transfer.allocations.reduce((sum,a)=>sum+a.amountCents,0);
export const ownerTransferRemaining=(transfer:Pick<OwnerTransfer,'amountCents'|'allocations'>)=>transfer.amountCents-ownerTransferAllocated(transfer);
const receiptMoney=(cents:number)=>`${cents<0?'-':''}${Math.floor(Math.abs(cents)/100).toLocaleString('en-US')}.${String(Math.abs(cents)%100).padStart(2,'0')}`;
export function ownerReceiptNote(receipt:Pick<OwnerTransfer,'currency'|'amountCents'|'allocations'> & {monthId?:string},months?:Pick<Month,'id'|'label'>[]):string {
 const currency=receipt.currency?receipt.currency+' ':'',allocated=ownerTransferAllocated(receipt);
 const monthLabels=new Map(months?.map(month=>[month.id,month.label]));
 const details=receipt.allocations.slice(0,10).map(a=>{const monthId=a.monthId??receipt.monthId??'Unspecified Month';return `[${monthLabels.get(monthId)??monthId}] ${a.propertyName}: ${currency}${receiptMoney(a.amountCents)}`;}).join('; ');
 const extra=receipt.allocations.length>10?` ${receipt.allocations.length-10} more allocation${receipt.allocations.length===11?'':'s'}.`:'';
 return `Received ${currency}${receiptMoney(receipt.amountCents)}; allocated ${currency}${receiptMoney(allocated)}; unallocated ${currency}${receiptMoney(receipt.amountCents-allocated)}.${details?` Allocations: ${details}.`:''}${extra}`;
}
type StoredAllocation=OwnerTransfer['allocations'][number];
const allocationSignature=(a:StoredAllocation,monthId:string)=>JSON.stringify([a.monthId??monthId,ownerKey(a.propertyName),a.amountCents]);
export function ownerTransferOperationApplied(transfer:OwnerTransfer,priorAllocatedCents:number,allocations:StoredAllocation[]):boolean {
 if(!Number.isSafeInteger(priorAllocatedCents)||priorAllocatedCents<0||!allocations.length)return false;
 let sum=0,start=0;
 for(;start<transfer.allocations.length&&sum<priorAllocatedCents;start++)sum+=transfer.allocations[start].amountCents;
 if(sum!==priorAllocatedCents)return false;
 const recorded=transfer.allocations.slice(start,start+allocations.length);
 if(recorded.length!==allocations.length)return false;
 return JSON.stringify(recorded.map(a=>allocationSignature(a,transfer.monthId)).sort())===JSON.stringify(allocations.map(a=>allocationSignature(a,transfer.monthId)).sort());
}
export function prepareOwnerTransfer(snapshot:Snapshot,c:Extract<OwnerChange,{kind:'importOwnerTransfer'}>):OwnerTransfer {
 const owner=snapshot.owners?.find(o=>o.id===c.ownerId);if(!owner)throw new Error('Owner not found.');
 const month=snapshot.months.find(m=>m.id===c.monthId);if(!month)throw new Error('Month not found.');
 const account=clean(c.account,'bank account'),reference=clean(c.reference,'transaction reference');
 if(!/^\d{4}$/.test(account)||!/^[a-z0-9]+$/i.test(reference))throw new Error('Enter a valid account and transaction reference.');
 if(!validSourceAccount(account,c.accountIdentity)||!c.currency||!['CAD','USD'].includes(c.currency))throw new Error('Confirm the full bank account and currency from the statement.');
 if(snapshot.bankReceipts?.some(r=>sameBankReference(r,c)))throw new Error('This reference was used for a platform receipt.');
 const resuming=c.transferId!==undefined||c.priorAllocatedCents!==undefined;
 if(resuming&&(typeof c.transferId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(c.transferId)||!Number.isSafeInteger(c.priorAllocatedCents)||c.priorAllocatedCents!<0))throw new Error('Enter a valid receipt and prior allocation amount.');
 const existing=resuming?snapshot.ownerTransfers?.find(t=>t.id===c.transferId):undefined;
 if(resuming&&!existing)throw new Error('The original owner receipt was not found. Refresh and review the receipt.');
 if(!resuming&&snapshot.ownerTransfers?.some(t=>sameBankReference(t,{...c,reference,account})))throw new Error('This owner transfer has already been imported.');
 const bankName=clean(c.bankName,'statement name');if(!ownerBankNames(owner.bankName).some(name=>ownerKey(name)===ownerKey(bankName)))throw new Error('Statement name does not match this owner.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||c.date<'1900-01-01'||!Number.isFinite(Date.parse(c.date))||new Date(c.date).toISOString().slice(0,10)!==c.date)throw new Error('Enter a valid bank date.');
 if(!positive(c.amountCents)||!Array.isArray(c.allocations)||!c.allocations.length||c.allocations.length>500)throw new Error('Enter a positive deposit and allocations.');
 const source=clean(c.source,'statement source',240);
 if(existing&&(existing.ownerId!==owner.id||existing.account!==account||existing.accountIdentity!==c.accountIdentity||existing.currency!==c.currency||existing.date!==c.date||existing.amountCents!==c.amountCents||ownerKey(existing.bankName)!==ownerKey(bankName)||ownerKey(existing.reference)!==ownerKey(reference)))throw new Error('The original owner receipt evidence has changed. Review the statement.');
 const seen=new Set<string>(),names=new Set<string>();
 const allocations=c.allocations.map(a=>{
  if(!a||!positive(a.amountCents)||seen.has(a.propertyId))throw new Error('Use positive allocations with each property only once.');
  const allocationMonth=snapshot.months.find(m=>m.id===(a.monthId??c.monthId));
  if(!allocationMonth)throw new Error('Allocation month not found.');
  seen.add(a.propertyId);const p=allocationMonth.properties.find(p=>p.id===a.propertyId);
  if(!p||p.bundleOnly||!owner.propertyNames.some(n=>ownerKey(n)===ownerKey(p.name)))throw new Error('Allocate only to this owner’s AR properties in the selected month.');
  const nameKey=JSON.stringify([allocationMonth.id,ownerKey(p.name)]);
  if(names.has(nameKey))throw new Error('These properties have ambiguous duplicate names. Correct their names before splitting this deposit.');
  names.add(nameKey);
  return {propertyName:p.name,monthId:allocationMonth.id,amountCents:a.amountCents};
 });
 const requested=allocations.reduce((sum,a)=>sum+a.amountCents,0),prior=existing?ownerTransferAllocated(existing):0;
 if((resuming||requested<c.amountCents)&&snapshot.ownerReceiptSchema!==1)throw new Error('Update the Apps Script deployment before saving partial owner receipts.');
 if(existing&&c.priorAllocatedCents!==prior){
  if(ownerTransferOperationApplied(existing,c.priorAllocatedCents!,allocations))return existing;
  throw new Error('The receipt allocations changed. Refresh and review the remaining amount.');
 }
 if(requested>c.amountCents-prior)throw new Error('Allocations exceed the remaining receipt amount.');
 if((existing?.allocations.length??0)+allocations.length>500)throw new Error('A receipt supports at most 500 total allocations.');
 const transfer:OwnerTransfer=existing?{...existing,allocations:[...existing.allocations,...allocations]}:{id:crypto.randomUUID(),ownerId:owner.id,ownerName:owner.name,bankName,account,accountIdentity:c.accountIdentity,currency:c.currency,...(c.description?{description:c.description}:{}),...(c.sheet?{sheet:c.sheet}:{}),...(c.sourceRow!==undefined?{sourceRow:c.sourceRow}:{}),date:c.date,reference,source,amountCents:c.amountCents,monthId:month.id,allocations};
 if(JSON.stringify(transfer.allocations).length>50000)throw new Error('This receipt allocation history exceeds the spreadsheet cell limit.');
 return {...transfer,note:ownerReceiptNote(transfer,snapshot.months)};
}
export function applyOwnerChange(snapshot:Snapshot,c:OwnerChange):void {
 if(c.kind==='saveOwner'){
  const input=c.owner;if(!input||typeof input.active!=='boolean'||!Array.isArray(input.propertyNames)||input.propertyNames.length>1000)throw new Error('Enter a valid owner profile.');
  if(typeof input.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))throw new Error('Enter a valid owner ID.');
  const owner:PropertyOwner={id:clean(input.id,'owner ID'),name:clean(input.name,'owner name'),bankName:cleanBankNames(input.bankName),email:clean(input.email,'email',240,false),notes:clean(input.notes,'notes',4000,false,true),active:input.active,propertyNames:[]};
  for(const name of input.propertyNames){const normalized=clean(name,'property name');if(owner.propertyNames.some(n=>ownerKey(n)===ownerKey(normalized)))throw new Error('Choose each property only once.');owner.propertyNames.push(normalized);}
  if(owner.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email))throw new Error('Enter a valid email.');
  const names=new Set(ownerBankNames(owner.bankName).map(ownerKey));
  if(snapshot.owners?.some(o=>o.id!==owner.id&&ownerBankNames(o.bankName).some(name=>names.has(ownerKey(name)))))throw new Error('This statement name belongs to another owner.');
  const existing=snapshot.owners?.findIndex(o=>o.id===owner.id)??-1;
  snapshot.owners??=[];if(existing<0)snapshot.owners.push(owner);else snapshot.owners[existing]=owner;
  return;
 }
 const transfer=prepareOwnerTransfer(snapshot,c);
 const existingIndex=c.transferId===undefined?-1:(snapshot.ownerTransfers??[]).findIndex(t=>t.id===c.transferId);
 if(existingIndex>=0&&snapshot.ownerTransfers![existingIndex]===transfer)return;
 for(const a of c.allocations)snapshot.months.find(m=>m.id===(a.monthId??c.monthId))!.properties.find(p=>p.id===a.propertyId)!.payments.push({id:crypto.randomUUID(),type:'Owner',amountCents:a.amountCents,payoutDate:'',bundleCents:null,bankDetails:'Checking '+transfer.account,bankDate:transfer.date,bankCents:a.amountCents,verifiedBySystem:true,verifiedByDaisy:false});
 if(existingIndex>=0)snapshot.ownerTransfers![existingIndex]=transfer;else(snapshot.ownerTransfers??=[]).push(transfer);
}
// Count distinct subsets (capped at two); never choose arbitrarily between exact matches.
function exactOwnerSplit(candidates:{propertyId:string;amountCents:number}[],target:number){
 type Match={count:number;items:typeof candidates};
 const sums=new Map<number,Match>([[0,{count:1,items:[]}]]);
 if(!positive(target))return {status:'Needs manual allocation',items:[]};
 if(candidates.length>200)return {status:'Too many balances to compare automatically — allocate manually',items:[]};
 for(const candidate of candidates){
  for(const [sum,match] of [...sums]){
   const next=sum+candidate.amountCents;if(next>target)continue;
   const existing=sums.get(next);
   sums.set(next,{count:Math.min(2,(existing?.count??0)+match.count),items:existing?.items??[...match.items,candidate]});
   // Bound work for large portfolios; incomplete searches must never suggest a match.
   if(sums.size>50000)return {status:'Too many combinations to compare automatically — allocate manually',items:[]};
  }
 }
 const match=sums.get(target);
 return match?.count===1?{status:'Ready',items:match.items}:{status:match?'Multiple exact combinations — allocate manually':'No exact balance combination — allocate manually',items:[]};
}
export function matchOwnerDeposits(deposits:BankDeposit[],month:Month,owners:PropertyOwner[],transfers:OwnerTransfer[],allocationMonths:Month[]=[month],receipts:BankReceipt[]=[]){
 const seen=new Set<string>();
 const stored=new Map<string,OwnerTransfer[]>(),platforms=new Map<string,Array<BankDeposit|BankReceipt>>();
 for(const t of transfers){const key=transferKey(t.account,t.reference),list=stored.get(key)??[];list.push(t);stored.set(key,list);}
 for(const p of [...receipts,...deposits.filter(d=>d.kind!=='owner')]){const key=transferKey(p.account,p.reference),list=platforms.get(key)??[];list.push(p);platforms.set(key,list);}
 const signatures=new Map<string,string>(),conflicts=new Set<string>();
 for(const d of deposits.filter(d=>d.kind==='owner'&&d.reference)){
  const key=transferKey(d.accountIdentity||d.account,d.reference),signature=JSON.stringify([d.currency,d.date,d.amountCents,ownerKey(d.ownerName??''),d.propertyReference??'',d.serviceMonth??'']);
  if(signatures.has(key)&&signatures.get(key)!==signature)conflicts.add(key);else signatures.set(key,signature);
 }
 const byName=new Map<string,PropertyOwner[]>();
 for(const owner of owners)for(const name of ownerBankNames(owner.bankName)){const key=ownerKey(name),matches=byName.get(key)??[];matches.push(owner);byName.set(key,matches);}
 const propertiesByOwner=new Map<string,Array<Month['properties'][number]&{monthId:string;monthLabel:string;monthKey:string}>>();
 const outstanding=new Map(allocationMonths.flatMap(m=>m.properties.map(p=>[p.id,balance(p)] as const)));
 return deposits.filter(d=>d.kind==='owner').map(deposit=>{
  const candidates=byName.get(ownerKey(deposit.ownerName??''))??[];
  const owner=candidates.length===1?candidates[0]:undefined;
  if(owner&&!propertiesByOwner.has(owner.id)){
   const names=new Set(owner.propertyNames.map(ownerKey));
   propertiesByOwner.set(owner.id,allocationMonths.flatMap(m=>m.properties.filter(p=>!p.bundleOnly&&names.has(ownerKey(p.name))).map(p=>({...p,monthId:m.id,monthLabel:m.label,monthKey:m.month}))));
  }
  const properties=owner?propertiesByOwner.get(owner.id)!:[];
  const key=transferKey(deposit.accountIdentity||deposit.account,deposit.reference),suffixKey=transferKey(deposit.account,deposit.reference);
  const previous=stored.get(suffixKey)?.find(t=>sameBankReference(t,deposit));
  const previouslyAllocatedCents=previous?ownerTransferAllocated(previous):0;
  const remainingCents=deposit.amountCents-previouslyAllocatedCents;
  const existingTransferId=previous?.id;
  const partial=!!previous&&remainingCents>0;
  if(platforms.get(suffixKey)?.some(p=>sameBankReference(p,deposit))||(previous&&(previous.date!==deposit.date||previous.amountCents!==deposit.amountCents||ownerKey(previous.bankName)!==ownerKey(deposit.ownerName??'')||(previous.currency&&previous.currency!==deposit.currency)||(partial&&(previous.ownerId!==owner?.id||previous.accountIdentity!==deposit.accountIdentity||previous.currency!==deposit.currency))||remainingCents<0)))conflicts.add(key);
  const duplicate=!!deposit.reference&&((!!previous&&!partial)||seen.has(key)||conflicts.has(key));
  if(deposit.reference)seen.add(key);
  const allocations:{propertyId:string;amountCents:number}[]=[];
  let status='Needs manual allocation';
  if(conflicts.has(key))status='Conflicting repeated reference — skip and verify statement';
  else if(duplicate)status='Already imported or repeated reference';
  else if(!deposit.reference)status='Missing transaction reference — skip';
  else if(!owner)status=candidates.length?'Ambiguous owner name':'Unknown owner';
  else if(!owner.active)status='Inactive owner — manual review';
  else if(deposit.propertyReference){
   const hinted=properties.filter(p=>addressKey(p.name)===addressKey(deposit.propertyReference!)&&(deposit.serviceMonth?p.monthKey===deposit.serviceMonth:p.monthId===month.id));
   if(hinted.length===1&&positive(remainingCents)&&outstanding.get(hinted[0].id)===remainingCents){
    allocations.push({propertyId:hinted[0].id,amountCents:remainingCents});
    outstanding.set(hinted[0].id,(outstanding.get(hinted[0].id)??balance(hinted[0]))-remainingCents);
    status='Suggested from statement property reference — review allocation';
   }else status=hinted.length===1?'Statement amount does not equal the referenced balance — allocate manually':hinted.length?'Ambiguous property reference — choose the allocation':'Statement property or reporting month is not mapped — review allocation';
  }
  else {
   const eligible=properties.filter(p=>deposit.serviceMonth?p.monthKey===deposit.serviceMonth:p.monthId===month.id)
    .map(p=>({propertyId:p.id,amountCents:outstanding.get(p.id)??0}))
    .filter(p=>positive(p.amountCents)&&p.amountCents<=remainingCents);
   const match=exactOwnerSplit(eligible,remainingCents);
   allocations.push(...match.items);status=match.status;
   for(const allocation of allocations)outstanding.set(allocation.propertyId,0);
  }
  if(partial&&!duplicate)status=`Partially allocated receipt — ${status==='Ready'?'remaining balance ready':status.toLowerCase()}`;
  return {deposit,owner,properties,allocations,status,duplicate,remainingCents,previouslyAllocatedCents,existingTransferId};
 });
}
