import { sampleSnapshot } from './sample.ts';
import type { Change, Payment, Snapshot } from './types.ts';
export function createPreviewApi() {
 let state:Snapshot=structuredClone(sampleSnapshot);
 return {read:async()=>structuredClone(state), save:async(revision:string, changes:Change[])=>{
  if(revision!==state.revision)throw new Error('Preview changed. Refresh and try again.');
  const next=structuredClone(state);
  for(const c of changes) {
   if(c.kind==='addProperty') {
    const month=next.months.find(m=>m.id===c.monthId);if(!month)throw new Error('Month not found.');
    const id='preview-'+crypto.randomUUID();
    month.properties.push({id,name:c.name,manager:c.manager,totalCents:c.totalCents,payments:['Airbnb','Airbnb','Airbnb','Vrbo','Owner'].map((type,i)=>({id:id+':'+i,type,amountCents:null,payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false} as Payment))});
   } else {
    const properties=next.months.flatMap(m=>m.properties);
    if(c.kind==='setTotal'){const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');p.totalCents=c.amountCents;}
    else {const p=properties.flatMap(p=>p.payments).find(p=>p.id===c.paymentId);if(!p)throw new Error('Payment not found.');Object.assign(p,c.fields)}
   }
  }
  next.revision='preview-'+crypto.randomUUID();next.updatedAt=new Date().toISOString();state=next;return structuredClone(state);
 }};
}
