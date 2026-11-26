import {listingCatalog,listingOwners} from './listings.ts';
import type {Change,Snapshot,Property,Payment} from './types.ts';
import {ownerKey} from './owners.ts';
import {prepareFreshBankImport} from './import-save.ts';

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='updatedAt'&&key!=='createdAt').sort(([a],[b])=>a.localeCompare(b))):item);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const paymentValue=({id:_,...p}:Payment)=>p;
const propertyValue=(p:Property)=>({name:p.name,manager:p.manager,totalCents:p.totalCents,payments:p.payments.map(paymentValue),followUp:p.followUp});
export class RecordConflict extends Error {
  constructor(details:string[]){super(details.join('\n\n'));this.name='RecordConflict';}
}
function display(value:unknown):string{
  if(typeof value==='string'&&value.startsWith('data:'))return 'Profile image';
  if(Array.isArray(value))return value.every(v=>typeof v==='string')?value.join(', '):`${value.length} items`;
  if(value&&typeof value==='object')return Object.entries(value).filter(([key])=>key!=='id').map(([key,v])=>`${key}: ${display(v)}`).join('; ');
  const text=String(value??'(empty)');return text.length>180?text.slice(0,180)+'…':text;
}

/** Three-way merge: retain remote edits to fields the current user did not change. */
export function prepareRecordChanges(original:Snapshot,changes:Change[],latest:Snapshot,resolveConflicts=false):Change[]{
  const conflicts:string[]=[];
  function conflict(label:string,current:unknown,desired:unknown){if(!resolveConflicts)conflicts.push(`${label}\nCurrent: ${display(current)}\nYour change: ${display(desired)}`);}
  function merge<T extends object>(before:T|undefined,desired:T,current:T|undefined,label:string):T{
    if(before&&!current)throw new Error(`${label} was removed. Your draft is kept; review the record before saving.`);
    if(!current)return desired;
    const result={...current} as Record<string,unknown>;
    for(const [key,value] of Object.entries(desired)){
      if(['id','updatedAt','createdAt'].includes(key))continue;
      const old=(before as Record<string,unknown>|undefined)?.[key],now=(current as Record<string,unknown>)[key];
      if(before&&same(value,old))continue;
      if(key==='propertyNames'&&Array.isArray(old)&&Array.isArray(now)&&Array.isArray(value)){
        const removed=new Set(old.filter(n=>!value.some(v=>ownerKey(v)===ownerKey(n))).map(ownerKey));
        const merged=now.filter(n=>!removed.has(ownerKey(n)));
        for(const name of value)if(!old.some(n=>ownerKey(n)===ownerKey(name))&&!merged.some(n=>ownerKey(n)===ownerKey(name)))merged.push(name);
        result[key]=merged;continue;
      }
      if(!same(now,old)&&!same(now,value)){
        const field=key.replace(/Cents$/,'').replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
        const readable=(v:unknown)=>key.endsWith('Cents')&&typeof v==='number'?(v/100).toFixed(2):v;
        conflict(`${label} — ${field}`,readable(now),readable(value));
      }
      result[key]=value;
    }
    return result as T;
  }
  function property(id:string){
    const month=original.months.find(m=>m.properties.some(p=>p.id===id)),before=month?.properties.find(p=>p.id===id);
    if(!before||!month)throw new Error('The original property is unavailable. Your draft is kept.');
    const matches=latest.months.find(m=>m.id===month.id)?.properties.filter(p=>!!p.bundleOnly===!!before.bundleOnly&&ownerKey(p.name)===ownerKey(before.name))??[];
    if(matches.length!==1)throw new Error(`${before.name} was renamed, removed, or now has an ambiguous name. Your draft is kept; review the property before saving.`);
    return {before,current:matches[0]};
  }
  function payment(id:string){
    const parent=original.months.flatMap(m=>m.properties).find(p=>p.payments.some(row=>row.id===id));
    if(!parent)throw new Error('The original payment is unavailable. Your draft is kept.');
    const {before:oldProperty,current:newProperty}=property(parent.id),index=oldProperty.payments.findIndex(p=>p.id===id),before=oldProperty.payments[index];
    const exact=newProperty.payments.filter(p=>same(paymentValue(p),paymentValue(before)));
    const originalCopies=oldProperty.payments.filter(p=>same(paymentValue(p),paymentValue(before))).length;
    if(originalCopies>1&&exact.length!==originalCopies)throw new Error(`${parent.name}: identical payment rows changed and the original row cannot be identified safely. Your draft is kept; review the payment list.`);
    let current=exact.length===1?exact[0]:undefined;
    // An edited row can be identified by position only when every other row is unchanged.
    if(!current&&oldProperty.payments.length===newProperty.payments.length&&oldProperty.payments.every((p,i)=>i===index||same(paymentValue(p),paymentValue(newProperty.payments[i]))))current=newProperty.payments[index];
    if(!current)throw new Error(`${parent.name}: payment rows changed and this payment cannot be identified safely. Your draft is kept; review the payment list.`);
    return {before,current,label:`${parent.name} payment`};
  }
  const result:Change[]=[];
  for(const change of changes){
    switch(change.kind){
      case 'saveListing':{
        const before=listingCatalog(original).find(l=>l.id===change.listing.id),current=listingCatalog(latest).find(l=>l.id===change.listing.id);
        const listing=merge(before,change.listing,current,'Listing');
        const oldOwners=listingOwners(original,change.listing.name).map(o=>o.id).sort(),nowOwners=listingOwners(latest,change.listing.name).map(o=>o.id).sort();
        const desiredOwners=change.ownerId?[change.ownerId]:[];
        const ownerUnchanged=same(oldOwners,desiredOwners);
        const ownerId=ownerUnchanged&&nowOwners.length<=1?(nowOwners[0]??''):change.ownerId;
        if((!ownerUnchanged||nowOwners.length>1)&&!same(oldOwners,nowOwners)&&!same(nowOwners,desiredOwners))conflict('Listing Owner',nowOwners,change.ownerId);
        const assignments=(s:Snapshot)=>s.months.flatMap(m=>m.properties.filter(p=>ownerKey(p.name)===ownerKey(change.listing.name)).map(p=>[m.id,p.managerId??'',p.manager]));
        if(!same(assignments(original),assignments(latest)))conflict('Monthly Account Manager Assignments',assignments(latest),listing.managerId);
        result.push({...change,listing,ownerId});break;
      }
      case 'saveOwner':{
        const current=latest.owners?.find(o=>o.id===change.owner.id),owner=merge(original.owners?.find(o=>o.id===change.owner.id),change.owner,current,'Owner');
        if(!same(current,owner))result.push({...change,owner});break;
      }
      case 'saveManager':{
        const current=latest.managers?.find(m=>m.id===change.manager.id),manager=merge(original.managers?.find(m=>m.id===change.manager.id),change.manager,current,'Account Manager');
        if(!same(current,manager))result.push({...change,manager});break;
      }
      case 'saveTask':{
        const current=latest.tasks?.find(t=>t.id===change.task.id),task=merge(original.tasks?.find(t=>t.id===change.task.id),change.task,current,'Task');
        if(!same(current,task))result.push({...change,task});break;
      }
      case 'addManagerUpdate':{
        const current=latest.managerUpdates?.find(u=>u.id===change.update.id);
        if(current&&!same(current,change.update))throw new Error('An update with this ID already exists. Your draft is kept.');
        if(!current)result.push(change);break;
      }
      case 'deleteManager':{
        const before=original.managers?.find(m=>m.id===change.managerId),current=latest.managers?.find(m=>m.id===change.managerId);
        if(current){if(!same(before,current))conflict('Delete account manager',current,'Delete');result.push(change);}break;
      }
      case 'addProperty':{
        const month=latest.months.find(m=>m.id===change.monthId);
        if(!month)throw new Error('This month was removed. Your draft is kept.');
        if(month.properties.some(p=>!!p.bundleOnly===!!change.bundleOnly&&ownerKey(p.name)===ownerKey(change.name)))throw new Error('Another user already added this property. Your draft is kept; open the existing property to edit it.');
        result.push(change);break;
      }
      case 'updateProperty':{
        const {before,current}=property(change.propertyId);
        const value=merge({name:before.name,manager:before.manager},{name:change.name,manager:change.manager},{name:current.name,manager:current.manager},before.name);
        if(value.name!==current.name||value.manager!==current.manager)result.push({...change,propertyId:current.id,...value});break;
      }
      case 'setTotal':{
        const {before,current}=property(change.propertyId),value=merge({totalCents:before.totalCents},{totalCents:change.amountCents},{totalCents:current.totalCents},`${before.name} expected amount`);
        if(value.totalCents!==current.totalCents)result.push({...change,propertyId:current.id,amountCents:value.totalCents});break;
      }
      case 'updateFollowUp':{
        const {before,current}=property(change.propertyId);
        const values=(p:Property)=>({manager:p.manager,status:p.followUp?.status??'not_contacted',note:p.followUp?.note??'',attachments:p.followUp?.attachments??[]});
        const value=merge(values(before),{manager:change.manager,status:change.status,note:change.note,attachments:change.attachments},values(current),`${before.name} follow-up`);
        if(!same(value,values(current)))result.push({...change,propertyId:current.id,...value});break;
      }
      case 'updatePayment':{
        const {before,current,label}=payment(change.paymentId),value=merge(paymentValue(before),{...paymentValue(before),...change.fields},paymentValue(current),label);
        if((change.fields.verifiedByDaisy===true||change.fields.verifiedBySystem===true)&&!same(paymentValue(before),paymentValue(current)))conflict(`${label} verification`,current,'Verify changed payment');
        const fields=Object.fromEntries(Object.entries(value).filter(([key,v])=>!same(v,(current as unknown as Record<string,unknown>)[key])));
        if(Object.keys(fields).length)result.push({...change,paymentId:current.id,fields});break;
      }
      case 'deletePayment':{
        const {before,current,label}=payment(change.paymentId);if(!same(paymentValue(before),paymentValue(current)))conflict(`Delete ${label}`,current,'Delete');
        result.push({...change,paymentId:current.id});break;
      }
      case 'deleteProperty':{
        const {before,current}=property(change.propertyId);if(!same(propertyValue(before),propertyValue(current)))conflict(`Delete ${before.name}`,propertyValue(current),'Delete');
        result.push({...change,propertyId:current.id});break;
      }
      case 'appendPayments':{
        const {before,current}=property(change.propertyId);
        if(!same(before.payments.map(paymentValue),current.payments.map(paymentValue)))throw new Error('Payments for this property changed. Your draft is kept; review the payment list before appending.');
        result.push({...change,propertyId:current.id});break;
      }
      case 'reconcileBank':case 'importOwnerTransfer':result.push(...prepareFreshBankImport(original,[change],latest));break;
      default:{const exhaustive:never=change;throw new Error(`Unsupported save: ${String(exhaustive)}`);}
    }
  }
  if(conflicts.length)throw new RecordConflict(conflicts);
  return result;
}
