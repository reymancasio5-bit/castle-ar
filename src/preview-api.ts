import {bootstrapManagers, applyManagerChange, resolveManager} from './managers.ts';
import { sampleSnapshot } from './sample.ts';
import type { Change, Payment, Snapshot } from './types.ts';
import { validateFollowUpDraft } from './follow-ups.ts';
export function createPreviewApi() {
 let state:Snapshot=bootstrapManagers(sampleSnapshot);
 return {read:async()=>structuredClone(state), save:async(revision:string, changes:Change[])=>{
  if(revision!==state.revision)throw new Error('Preview changed. Refresh and try again.');
  const next=structuredClone(state);
  for(const c of changes) {
   if(c.kind==='deleteManager'||c.kind==='saveManager'||c.kind==='saveTask'||c.kind==='addManagerUpdate'){applyManagerChange(next,c);continue;}
   if(c.kind==='addProperty') {
    const manager=resolveManager(next,c.manager);if(!manager)throw new Error('Choose a registered account manager.');
    const month=next.months.find(m=>m.id===c.monthId);if(!month)throw new Error('Month not found.');
    const id='preview-'+crypto.randomUUID();
    const payments: Payment[] = [];
    for (const { index, ...fields } of [...(c.initialPayments ?? [])].sort((a,b)=>(a.index===4?-1:a.index)-(b.index===4?-1:b.index))) {
     payments.push({id:id+':'+index,type:index===4?'Owner':index===3?'Vrbo':'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});
    }
    month.properties.push({id,name:c.name,manager:manager.name,managerId:manager.id,totalCents:c.totalCents,payments});
    for (const fields of c.additionalPayments ?? []) month.properties[month.properties.length - 1].payments.push({id:crypto.randomUUID(),type:'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});
   } else {
    const properties=next.months.flatMap(m=>m.properties);
    if(c.kind==='setTotal'){const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');p.totalCents=c.amountCents;}
    else if(c.kind==='updateFollowUp') {
     validateFollowUpDraft(c);
     const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');
     const manager=resolveManager(next,c.manager,p.managerId);p.manager=manager?.name??'';p.managerId=manager?.id;p.followUp={status:c.status,note:c.note,attachments:structuredClone(c.attachments),updatedAt:new Date().toISOString()};
    }
    else if(c.kind==='appendPayments'){const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');for(const fields of c.payments)p.payments.push({id:crypto.randomUUID(),type:'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});}
    else {const p=properties.flatMap(p=>p.payments).find(p=>p.id===c.paymentId);if(!p)throw new Error('Payment not found.');Object.assign(p,c.fields)}
   }
  }
  next.revision='preview-'+crypto.randomUUID();next.updatedAt=new Date().toISOString();state=next;return structuredClone(state);
 }};
}
