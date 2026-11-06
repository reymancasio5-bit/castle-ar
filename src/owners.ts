import type {Month,OwnerChange,OwnerTransfer,PropertyOwner,Snapshot} from './types.ts';
import type {BankDeposit} from './bank-statement.ts';
import {balance} from './domain.ts';

export const ownerKey=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
export const transferKey=(account:string,reference:string)=>JSON.stringify([account.replace(/[\s-]/g,'').toLowerCase(),reference.trim().toLowerCase()]);
const clean=(value:unknown,label:string,max=160,required=true,multiline=false):string=>{
 if(typeof value!=='string')throw new Error(`Enter a valid ${label}.`);
 const text=multiline?value.trim():value.trim().replace(/\s+/g,' ');
 if((required&&!text)||text.length>max||/^[=+@-]/.test(text)||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))throw new Error(`Enter a valid ${label}.`);
 return text;
};
const positive=(amount:number)=>Number.isSafeInteger(amount)&&amount>0&&amount<=999999999999;
export function prepareOwnerTransfer(snapshot:Snapshot,c:Extract<OwnerChange,{kind:'importOwnerTransfer'}>):OwnerTransfer {
 const owner=snapshot.owners?.find(o=>o.id===c.ownerId);if(!owner)throw new Error('Owner not found.');
 const month=snapshot.months.find(m=>m.id===c.monthId);if(!month)throw new Error('Month not found.');
 const account=clean(c.account,'bank account'),reference=clean(c.reference,'transaction reference');
 if(!/^\d{4}$/.test(account)||!/^[a-z0-9]+$/i.test(reference))throw new Error('Enter a valid account and transaction reference.');
 if(snapshot.ownerTransfers?.some(t=>transferKey(t.account,t.reference)===transferKey(account,reference)))throw new Error('This owner transfer has already been imported.');
 const bankName=clean(c.bankName,'statement name');if(ownerKey(bankName)!==ownerKey(owner.bankName))throw new Error('Statement name does not match this owner.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||c.date<'1900-01-01'||!Number.isFinite(Date.parse(c.date))||new Date(c.date).toISOString().slice(0,10)!==c.date)throw new Error('Enter a valid bank date.');
 if(!positive(c.amountCents)||!Array.isArray(c.allocations)||!c.allocations.length||c.allocations.length>500)throw new Error('Enter a positive deposit and allocations.');
 const seen=new Set<string>(),names=new Set<string>();
 const allocations=c.allocations.map(a=>{
  if(!a||!positive(a.amountCents)||seen.has(a.propertyId))throw new Error('Use positive allocations with each property only once.');
  seen.add(a.propertyId);const p=month.properties.find(p=>p.id===a.propertyId);
  if(!p||p.bundleOnly||!owner.propertyNames.some(n=>ownerKey(n)===ownerKey(p.name)))throw new Error('Allocate only to this owner’s AR properties in the selected month.');
  if(names.has(ownerKey(p.name)))throw new Error('These properties have ambiguous duplicate names. Correct their names before splitting this deposit.');
  names.add(ownerKey(p.name));
  return {propertyName:p.name,amountCents:a.amountCents};
 });
 if(allocations.reduce((sum,a)=>sum+a.amountCents,0)!==c.amountCents)throw new Error('Allocations must equal the deposit exactly.');
 return {id:crypto.randomUUID(),ownerId:owner.id,ownerName:owner.name,bankName,account,date:c.date,reference,source:clean(c.source,'statement source',240),amountCents:c.amountCents,monthId:month.id,allocations};
}
export function applyOwnerChange(snapshot:Snapshot,c:OwnerChange):void {
 if(c.kind==='saveOwner'){
  const input=c.owner;if(!input||typeof input.active!=='boolean'||!Array.isArray(input.propertyNames)||input.propertyNames.length>1000)throw new Error('Enter a valid owner profile.');
  if(typeof input.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))throw new Error('Enter a valid owner ID.');
  const owner:PropertyOwner={id:clean(input.id,'owner ID'),name:clean(input.name,'owner name'),bankName:clean(input.bankName,'statement name'),email:clean(input.email,'email',240,false),notes:clean(input.notes,'notes',4000,false,true),active:input.active,propertyNames:[]};
  for(const name of input.propertyNames){const normalized=clean(name,'property name');if(owner.propertyNames.some(n=>ownerKey(n)===ownerKey(normalized)))throw new Error('Choose each property only once.');owner.propertyNames.push(normalized);}
  if(owner.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email))throw new Error('Enter a valid email.');
  if(snapshot.owners?.some(o=>o.id!==owner.id&&ownerKey(o.bankName)===ownerKey(owner.bankName)))throw new Error('This statement name belongs to another owner.');
  const existing=snapshot.owners?.findIndex(o=>o.id===owner.id)??-1;
  snapshot.owners??=[];if(existing<0)snapshot.owners.push(owner);else snapshot.owners[existing]=owner;
  return;
 }
 const transfer=prepareOwnerTransfer(snapshot,c);
 const month=snapshot.months.find(m=>m.id===c.monthId)!;
 for(const a of c.allocations)month.properties.find(p=>p.id===a.propertyId)!.payments.push({id:crypto.randomUUID(),type:'Owner',amountCents:a.amountCents,payoutDate:'',bundleCents:null,bankDetails:'Checking '+transfer.account,bankDate:transfer.date,bankCents:a.amountCents,verifiedBySystem:true,verifiedByDaisy:false});
 (snapshot.ownerTransfers??=[]).push(transfer);
}
export function matchOwnerDeposits(deposits:BankDeposit[],month:Month,owners:PropertyOwner[],transfers:OwnerTransfer[]){
 const seen=new Set(transfers.map(t=>transferKey(t.account,t.reference)));
 const signatures=new Map<string,string>(),conflicts=new Set<string>();
 for(const d of deposits.filter(d=>d.kind==='owner'&&d.reference)){
  const key=transferKey(d.account,d.reference),signature=JSON.stringify([d.date,d.amountCents,ownerKey(d.ownerName??'')]);
  if(signatures.has(key)&&signatures.get(key)!==signature)conflicts.add(key);else signatures.set(key,signature);
 }
 const outstanding=new Map(month.properties.map(p=>[p.id,balance(p)]));
 return deposits.filter(d=>d.kind==='owner').map(deposit=>{
  const candidates=owners.filter(o=>ownerKey(o.bankName)===ownerKey(deposit.ownerName??''));
  const owner=candidates.length===1?candidates[0]:undefined;
  const properties=owner?month.properties.filter(p=>!p.bundleOnly&&owner.propertyNames.some(n=>ownerKey(n)===ownerKey(p.name))):[];
  const key=transferKey(deposit.account,deposit.reference),duplicate=!!deposit.reference&&(seen.has(key)||conflicts.has(key));
  if(deposit.reference)seen.add(key);
  const allocations:{propertyId:string;amountCents:number}[]=[];
  let status='Needs manual allocation';
  if(conflicts.has(key))status='Conflicting repeated reference — skip and verify statement';
  else if(duplicate)status='Already imported or repeated reference';
  else if(!deposit.reference)status='Missing transaction reference — skip';
  else if(!owner)status=candidates.length?'Ambiguous owner name':'Unknown owner';
  else if(!owner.active)status='Inactive owner — manual review';
  else {
   const exact=properties.filter(p=>outstanding.get(p.id)===deposit.amountCents&&positive(deposit.amountCents));
   if(exact.length===1){allocations.push({propertyId:exact[0].id,amountCents:deposit.amountCents});outstanding.set(exact[0].id,0);status='Ready';}
   else if(exact.length>1)status='Ambiguous: multiple exact outstanding balances';
  }
  return {deposit,owner,properties,allocations,status,duplicate};
 });
}
